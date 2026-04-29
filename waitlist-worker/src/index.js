const express = require("express");
const { createClient } = require("redis");

const app = express();

const PORT = process.env.PORT || 3005;
const REDIS_URL = process.env.REDIS_URL;
const TICKET_PURCHASE_SERVICE_URL = process.env.TICKET_PURCHASE_SERVICE_URL;

const WAITLIST_QUEUE = "waitlist";
const DLQ = "waitlist:dlq";
const SEAT_RELEASED_CHANNEL = "seat.released";

const redisClient = createClient({ url: REDIS_URL });
const subscriberClient = createClient({ url: REDIS_URL });

redisClient.on("error", (err) => {
  console.error("[waitlist-worker] Redis error:", err.message);
});

subscriberClient.on("error", (err) => {
  console.error("[waitlist-worker] Redis subscriber error:", err.message);
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
    try {
      await redisClient.lPush(DLQ, raw);
    } catch (pushErr) {
      console.error("[waitlist-worker] Failed to push to DLQ:", pushErr.message);
    }
    return;
  }

  // Validate required fields (missing fields is a poison pill)
  if (!isValidMessage(purchase)) {
    console.error(
      "[waitlist-worker] Poison pill, missing required fields, moving to DLQ:",
      JSON.stringify(purchase)
    );
    try {
      await redisClient.lPush(DLQ, raw);
    } catch (pushErr) {
      console.error("[waitlist-worker] Failed to push to DLQ:", pushErr.message);
    }
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${TICKET_PURCHASE_SERVICE_URL}/purchases`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": promotionKey,
        "X-Waitlist-Promotion": "true",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const result = await response.json();

    if (response.status === 409) {
      console.log(
        `[waitlist-worker] Seats are still unavailable for user ${purchase.userId}, keeping entry at the front of the waitlist`
      );
      try {
        await redisClient.lPush(WAITLIST_QUEUE, raw);
      } catch (pushErr) {
        console.error("[waitlist-worker] Failed to restore waitlist entry:", pushErr.message);
        try {
          await redisClient.lPush(DLQ, raw);
        } catch (dlqErr) {
          console.error("[waitlist-worker] Failed to push restored entry to DLQ:", dlqErr.message);
        }
      }
      return;
    }

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
      try {
        await redisClient.lPush(DLQ, raw);
      } catch (pushErr) {
        console.error("[waitlist-worker] Failed to push to DLQ:", pushErr.message);
      }
    }
  } catch (err) {
    // Ticket Purchase Service unreachable, put entry back at the tail so the next attempt can try again
    console.error(
      `[waitlist-worker] Could not reach Ticket Purchase Service: ${err.message} — re-queuing entry`
    );
    try {
      await redisClient.rPush(WAITLIST_QUEUE, raw);
    } catch (pushErr) {
      console.error("[waitlist-worker] Failed to re-queue entry:", pushErr.message);
      // If re-queueing fails, try pushing to DLQ to avoid losing the message
      try {
        await redisClient.lPush(DLQ, raw);
      } catch (dlqErr) {
        console.error("[waitlist-worker] Failed to push to DLQ after re-queue failure:", dlqErr.message);
      }
    }
  }
}

async function processNextWaitlistEntry(releaseEventRaw) {
  if (releaseEventRaw) {
    console.log(
      `[waitlist-worker] Received ${SEAT_RELEASED_CHANNEL} event: ${releaseEventRaw}`
    );
  }

  try {
    const nextEntry = await redisClient.lPop(WAITLIST_QUEUE);

    if (!nextEntry) {
      console.log("[waitlist-worker] No waitlist entries to promote");
      return;
    }

    console.log("[waitlist-worker] Message received from queue");
    await processMessage(nextEntry);
  } catch (err) {
    console.error("[waitlist-worker] Failed to process next waitlist entry:", err.message);
  }
}

// Worker subscription

async function listenForSeatReleases() {
  console.log(
    `[waitlist-worker] Listening for "${SEAT_RELEASED_CHANNEL}" events (queue: "${WAITLIST_QUEUE}", DLQ: "${DLQ}")`
  );

  await subscriberClient.subscribe(SEAT_RELEASED_CHANNEL, async (message) => {
    await processNextWaitlistEntry(message);
  });
}

// Startup

async function start() {
  await redisClient.connect();
  await subscriberClient.connect();
  console.log("[waitlist-worker] Connected to Redis");

  app.listen(PORT, () => {
    console.log(`[waitlist-worker] Health endpoint listening on port ${PORT}`);
  });

  listenForSeatReleases().catch((err) => {
    console.error("[waitlist-worker] Subscription loop failed:", err.message);
    process.exit(1);
  });
}

start().catch((err) => {
  console.error("[waitlist-worker] Startup failed:", err.message);
  process.exit(1);
});
