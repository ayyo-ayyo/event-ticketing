const express = require("express");
const { createClient } = require("redis");

const app = express();

const PORT = process.env.PORT || 3005;
const REDIS_URL = process.env.REDIS_URL;
const TICKET_PURCHASE_SERVICE_URL = process.env.TICKET_PURCHASE_SERVICE_URL;

const WAITLIST_QUEUE = "waitlist";
const DLQ = "waitlist:dlq";

const redisClient = createClient({ url: REDIS_URL });

redisClient.on("error", (err) => {
  console.error("[waitlist-worker] Redis error:", err.message);
});

let lastProcessedAt = null;

// Health endpoint

app.get("/health", async (req, res) => {
  try {
    const queueDepth = await redisClient.lLen(WAITLIST_QUEUE);
    const dlqDepth = await redisClient.lLen(DLQ);

    res.json({
      status: "healthy",
      service: "waitlist-worker",
      queueDepth,
      dlqDepth,
      lastProcessedAt,
    });
  } catch (err) {
    console.error("[waitlist-worker] Health check error:", err.message);
    res.status(503).json({
      status: "unhealthy",
      service: "waitlist-worker",
      error: err.message,
    });
  }
});

// Message validation

function isValidMessage(msg) {
  return (
    msg &&
    typeof msg.userId !== "undefined" &&
    typeof msg.eventId !== "undefined" &&
    typeof msg.quantity !== "undefined" &&
    typeof msg.unitTicketCents !== "undefined"
  );
}

// Message processing

async function processMessage(raw) {
  let purchase;

  // Parse (malformed JSON is a poison pill)
  try {
    purchase = JSON.parse(raw);
  } catch (err) {
    console.error(
      "[waitlist-worker] Poison pill, invalid JSON, moving to DLQ:",
      raw
    );
    await redisClient.lPush(DLQ, raw);
    return;
  }

  // Validate required fields (missing fields is a poison pill)
  if (!isValidMessage(purchase)) {
    console.error(
      "[waitlist-worker] Poison pill, missing required fields, moving to DLQ:",
      JSON.stringify(purchase)
    );
    await redisClient.lPush(DLQ, raw);
    return;
  }

  console.log(
    `[waitlist-worker] Promoting waitlisted user ${purchase.userId} for event ${purchase.eventId} (qty: ${purchase.quantity})`
  );

  // Generate a unique idempotency key for this promotion (distinct from any prior purchase attempt)
  const promotionKey = `waitlist-promotion-${purchase.userId}-${purchase.eventId}-${Date.now()}`;

  const payload = {
    userId: purchase.userId,
    eventId: purchase.eventId,
    quantity: purchase.quantity,
    unitTicketCents: purchase.unitTicketCents,
  };

  try {
    const response = await fetch(`${TICKET_PURCHASE_SERVICE_URL}/purchases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": promotionKey,
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (response.ok) {
      console.log(
        `[waitlist-worker] Promotion successful, user ${purchase.userId} secured ticket for event ${purchase.eventId}, purchase id: ${result.purchase?.id}`
      );
      lastProcessedAt = new Date().toISOString();
    } else {
      // Promotion attempt failed (e.g. payment declined), move to DLQ, do not re-promote
      console.error(
        `[waitlist-worker] Promotion failed for user ${purchase.userId} (status ${response.status}): ${result.error || result.message} — moving to DLQ`
      );
      await redisClient.lPush(DLQ, raw);
    }
  } catch (err) {
    // Ticket Purchase Service unreachable, put entry back at the tail so the next attempt can try again
    console.error(
      `[waitlist-worker] Could not reach Ticket Purchase Service: ${err.message} — re-queuing entry`
    );
    await redisClient.rPush(WAITLIST_QUEUE, raw);
  }
}

// Worker loop

async function runWorker() {
  console.log(
    `[waitlist-worker] Listening on queue "${WAITLIST_QUEUE}" (DLQ: "${DLQ}")`
  );

  while (true) {
    try {
      // Block for up to 5 s waiting for the next message
      const result = await redisClient.blPop(WAITLIST_QUEUE, 5);

      if (result) {
        console.log("[waitlist-worker] Message received from queue");
        await processMessage(result.element);
      }
    } catch (err) {
      console.error("[waitlist-worker] Worker loop error:", err.message);
      // Brief pause before looping to avoid a tight error spin
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

// Startup

async function start() {
  await redisClient.connect();
  console.log("[waitlist-worker] Connected to Redis");

  app.listen(PORT, () => {
    console.log(`[waitlist-worker] Health endpoint listening on port ${PORT}`);
  });

  // Run worker loop without awaiting so the health endpoint stays responsive
  runWorker();
}

start().catch((err) => {
  console.error("[waitlist-worker] Startup failed:", err.message);
  process.exit(1);
});