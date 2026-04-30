const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const { createClient } = require("redis");
const { startPurchaseWorker } = require("./purchase-worker");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3002;
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL;
const REFUND_SERVICE_URL = process.env.REFUND_SERVICE_URL || "http://refund-service:3006";
const POSTGRES_UNIQUE_VIOLATION = "23505";
const SEAT_RELEASED_CHANNEL = "seat.released";

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const redisClient = createClient({
  url: REDIS_URL,
});

const redisWorkerClient = createClient({
  url: REDIS_URL,
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err.message);
});

redisWorkerClient.on("error", (err) => {
  console.error("Redis worker error:", err.message);
});

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("Connected to Redis");
  }

  if (!redisWorkerClient.isOpen) {
    await redisWorkerClient.connect();
    console.log("Connected TPS purchase worker to Redis");
  }
}

async function connectEventCatalogService() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch("http://event-catalog-service:3001/info", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      throw new Error(`HTTP error. Status: ${response.status}`);
    }

    const data = await response.json();
    console.log(data);
  } catch (error) {
    if (error.name === "AbortError") {
      console.error("Error: Timeout on HTTP request to Event Catalog Service");
    } else {
      console.error("Error calling Event Catalog Service:", error.message);
    }
  }
}

// Use this function for fetching events corresponding to the ticket
async function fetchEvent(eventId) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`http://event-catalog-service:3001/events/${eventId}`, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      const error = new Error(`HTTP error. Status: ${response.status}`);
      error.status = response.status;
      throw error;
    }
    const event = await response.json();
    return event;
  } catch (error) {
    if (error.name === "AbortError") {
      clearTimeout(timeout);
      console.error("Error: Timeout on HTTP request for fetching event based on eventId");
    } else {
      console.error("Error fetching event from Event Catalog Service:", error.message);
    }
    throw error;
  }
}

async function adjustEventSeats(event, eventId, quantity) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  console.log(
    `Adjusting seats for eventId ${eventId} by ${quantity}. Current seats available: ${event.seats_available}`
  );
  try {
    const updateResponse = await fetch(`http://event-catalog-service:3001/events/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...event,
        seats_available: event.seats_available + quantity,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!updateResponse.ok) {
      throw new Error(`Failed to update seats for eventId: ${eventId}`);
    }
    return true;
  } catch (updateErr) {
    console.error("Failed to update seats in Event Catalog Service:", updateErr.message);
    clearTimeout(timeout);
    return false;
  }
}

async function processQueuedPurchaseJob(job) {
  if (job.purchaseId) {
    const result = await pool.query("SELECT id FROM purchases WHERE id = $1", [
      job.purchaseId,
    ]);

    if (result.rows.length === 0) {
      throw new Error(`Purchase not found for purchaseId=${job.purchaseId}`);
    }
  }

  if (job.idempotencyKey) {
    const result = await pool.query(
      "SELECT id FROM purchases WHERE idempotency_key = $1",
      [job.idempotencyKey]
    );

    if (result.rows.length === 0) {
      throw new Error(
        `Purchase not found for idempotencyKey=${job.idempotencyKey}`
      );
    }
  }
}

async function publishSeatReleased(eventId, purchaseId, quantity) {
  try {
    await redisClient.publish(
      SEAT_RELEASED_CHANNEL,
      JSON.stringify({ eventId, purchaseId, quantity })
    );
  } catch (pubErr) {
    console.error("Failed to publish seat.released event:", pubErr.message);
  }
}

app.get("/", (req, res) => {
  res.json({
    service: "ticket-purchase-service",
    message: "running",
  });
});

app.get("/health", async (req, res) => {
  let database = "down";
  let redis = "down";

  try {
    await pool.query("SELECT 1");
    database = "up";
  } catch (err) {
    console.error("Database health check failed:", err.message);
  }

  try {
    await redisClient.ping();
    redis = "up";
  } catch (err) {
    console.error("Redis health check failed:", err.message);
  }

  const healthy = database === "up" && redis === "up";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    service: "ticket-purchase-service",
    database,
    redis,
  });
});

app.get("/purchases/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("SELECT * FROM purchases WHERE id = $1", [
      id,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Purchase not found" });
    }

    return res.status(200).json({ purchase: result.rows[0] });
  } catch (error) {
    console.error("Failed to fetch purchase:", error.message);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// UI proxy: lets purchase.html (served from this service) read events from the
// catalog service without a cross-origin browser request.
app.get("/ui/events/:id", async (req, res) => {
  try {
    const data = await fetchEvent(req.params.id);
    return res.status(200).json(data);
  } catch (err) {
    if (err.status === 404) {
      return res.status(404).json({ error: "Event not found" });
    }
    return res.status(502).json({ error: "Event Catalog Service unavailable" });
  }
});

// UI proxy: forwards a refund request from the browser to refund-service so
// purchase.html stays same-origin.
app.post("/ui/refunds", async (req, res) => {
  const idempotencyKey = req.header("Idempotency-Key")?.trim();
  if (!idempotencyKey) {
    return res.status(400).json({ error: "Idempotency-Key header is required" });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${REFUND_SERVICE_URL}/refunds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const body = await response.json().catch(() => ({}));
    return res.status(response.status).json(body);
  } catch (err) {
    clearTimeout(timeout);
    console.error("Failed to reach Refund Service:", err.message);
    return res.status(502).json({ error: "Refund Service unavailable" });
  }
});

async function createPurchase(req, res) {
  const idempotencyKey = req.header("Idempotency-Key")?.trim();
  const isWaitlistPromotion = req.header("X-Waitlist-Promotion") === "true";
  const {
    userId,
    eventId,
    quantity,
    unitTicketCents,
  } = req.body;

  if (!idempotencyKey) {
    return res.status(400).json({
      error: "Idempotency-Key header is required",
    });
  }

  if (!userId || !eventId || !quantity || !unitTicketCents) {
    return res.status(400).json({
      error: "userId, eventId, quantity, and unitTicketCents are required",
    });
  }

  try {
    let result;

    try {
      result = await pool.query(
        `INSERT INTO purchases
         (user_id, event_id, quantity, unit_ticket_cents, reservation_status, payment_status, idempotency_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          userId,
          eventId,
          quantity,
          unitTicketCents,
          "reserved",
          "pending",
          idempotencyKey,
        ]
      );
    } catch (insertErr) {
      if (insertErr.code === POSTGRES_UNIQUE_VIOLATION) {
        const existing = await pool.query(
          "SELECT * FROM purchases WHERE idempotency_key = $1",
          [idempotencyKey]
        );

        if (existing.rows.length > 0) {
          return res.status(200).json({
            message: "Duplicate request detected, returning existing purchase",
            purchase: existing.rows[0],
          });
        }
      }

      throw insertErr;
    }

    let event;
    try {
      event = (await fetchEvent(eventId))?.event || null;
    } catch (fetchErr) {
      if (fetchErr.status === 404) {
        return res.status(404).json({
          error: "Event not found for eventId: " + eventId,
        });
      }

      return res.status(502).json({
        error: "Event Catalog Service unavailable",
      });
    }

    if (event.seats_available < quantity) {
      if (isWaitlistPromotion) {
        try {
          await pool.query("DELETE FROM purchases WHERE id = $1", [result.rows[0].id]);
        } catch (cleanupErr) {
          console.error(
            "[ticket-purchase-service] Failed to clean up promotion purchase after insufficient seats:",
            cleanupErr.message
          );
        }

        return res.status(409).json({
          error: "Insufficient seats for waitlist promotion",
          event,
        });
      }

      const waitlistJob = {
        userId: result.rows[0].user_id,
        eventId: result.rows[0].event_id,
        quantity: result.rows[0].quantity,
        unitTicketCents: result.rows[0].unit_ticket_cents,
      };

      try {
        await redisClient.lPush("waitlist", JSON.stringify(waitlistJob));
      } catch (enqueueErr) {
        console.error("[ticket-purchase-service] Failed to enqueue waitlist job:", enqueueErr.message);
        try {
          await pool.query("DELETE FROM purchases WHERE id = $1", [result.rows[0].id]);
        } catch (cleanupErr) {
          console.error("[ticket-purchase-service] Failed to clean up orphan purchase:", cleanupErr.message);
        }

        return res.status(503).json({
          error: "Waitlist queue unavailable",
          purchase: result.rows[0],
        });
      }

      return res.status(200).json({
        message: "Purchase created but added to waiting list due to insufficient seats",
        purchase: result.rows[0],
        event,
      });
    }

    const seatsReserved = await adjustEventSeats(event, eventId, -quantity);
    if (!seatsReserved) {
      try {
        await pool.query("DELETE FROM purchases WHERE id = $1", [result.rows[0].id]);
      } catch (cleanupErr) {
        console.error(
          "[ticket-purchase-service] Failed to clean up purchase after seat reservation failure:",
          cleanupErr.message
        );
      }

      return res.status(502).json({
        error: "Failed to reserve seats",
      });
    }

    const purchase = result.rows[0];

    let paymentResult;
    let paymentResponse;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      paymentResponse = await fetch(`${PAYMENT_SERVICE_URL}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId: purchase.id }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      paymentResult = await paymentResponse.json();
    } catch (paymentErr) {
      console.error("Failed to reach Payment Service:", paymentErr.message);
      const seatsRestored = await adjustEventSeats(event, eventId, quantity); // Rollback seat reservation
      if (!seatsRestored) {
        return res.status(502).json({
          error: "Payment Service unreachable and seat rollback failed",
          purchase,
        });
      }
      await publishSeatReleased(eventId, purchase.id, quantity);
      return res.status(502).json({
        error: "Payment Service unreachable",
        purchase,
      });
    }

    const paymentStatus = paymentResponse.ok ? "paid" : "failed";
    const reservationStatus = paymentResponse.ok ? "confirmed" : "released";
    let updatedPurchase;

    try {
      updatedPurchase = await pool.query(
        `UPDATE purchases
         SET payment_status = $1, reservation_status = $2
         WHERE id = $3
         RETURNING *`,
        [paymentStatus, reservationStatus, purchase.id]
      );
    } catch (statusErr) {
      console.error("Failed to update payment status:", statusErr.message);
      return res.status(500).json({
        error: "Payment processed but failed to update purchase status",
        purchase,
        payment: paymentResult,
      });
    }

    if (paymentResponse.ok) {
      const confirmedPurchase = updatedPurchase.rows[0];
      const notificationJob = JSON.stringify({
        purchaseId: confirmedPurchase.id,
        userId: confirmedPurchase.user_id,
        eventId: confirmedPurchase.event_id,
        quantity: confirmedPurchase.quantity,
        unitTicketCents: confirmedPurchase.unit_ticket_cents,
      });
      //Publish to analytics queue so the Analytics Worker can update sales metrics
      const analyticsJob = JSON.stringify({
        eventId: confirmedPurchase.event_id,
        quantity: confirmedPurchase.quantity,
        unitTicketCents: confirmedPurchase.unit_ticket_cents,
      });
      let analyticsQueued = true;
      try {
        await redisClient.lPush("analytics:queue", analyticsJob);
        console.log(
          `[ticket-purchase-service] Published analytics job for purchaseId=${confirmedPurchase.id}`
        );
      } catch (enqueueErr) {
        analyticsQueued = false;
        console.error(
          "[ticket-purchase-service] Failed to enqueue analytics job:",
          enqueueErr.message
        );
      }
      try {
        await redisClient.lPush("notification:queue", notificationJob);
        console.log(
          `[ticket-purchase-service] Published notification job for purchaseId=${confirmedPurchase.id}`
        );
      } catch (enqueueErr) {
        console.error("[ticket-purchase-service] Failed to enqueue notification job:", enqueueErr.message);
        return res.status(201).json({
          message: "Purchase created and payment processed, but notification queue is unavailable",
          purchase: confirmedPurchase,
          payment: paymentResult,
          analyticsQueued,
          notificationQueued: false,
        });
      }

      // Publish to fraud detection queue for pattern analysis
      const fraudJob = JSON.stringify({
        purchaseId: confirmedPurchase.id,
        userId: confirmedPurchase.user_id,
        eventId: confirmedPurchase.event_id,
        quantity: confirmedPurchase.quantity,
        unitTicketCents: confirmedPurchase.unit_ticket_cents,
        // Synthesized payment token — simulates a user's single card on file.
        // In a real system this would be the tokenized card ID from the payment provider.
        paymentToken: `tok_${confirmedPurchase.user_id}`,
      });
      await redisClient.lPush("fraud:queue", fraudJob);
      console.log(
        `[ticket-purchase-service] Published fraud detection job for purchaseId=${confirmedPurchase.id}`
      );

      return res.status(201).json({
        message: analyticsQueued
          ? "Purchase created and payment processed"
          : "Purchase created and payment processed, but analytics queue is unavailable",
        purchase: confirmedPurchase,
        payment: paymentResult,
        ...(analyticsQueued ? {} : { analyticsQueued: false }),
      });
    } else {
      const seatsRestored = await adjustEventSeats(event, eventId, quantity); // Rollback seat reservation on payment failure
      if (!seatsRestored) {
        return res.status(502).json({
          message: "Purchase created but payment failed and seat rollback failed",
          purchase: updatedPurchase.rows[0],
          payment: paymentResult,
        });
      }
      await publishSeatReleased(eventId, updatedPurchase.rows[0].id, quantity);
      return res.status(402).json({
        message: "Purchase created but payment failed",
        purchase: updatedPurchase.rows[0],
        payment: paymentResult,
      });
    }
  } catch (err) {
    console.error("Failed to create purchase:", err.message);
    return res.status(500).json({
      error: "Internal server error",
    });
  }
}

app.post("/purchases", createPurchase);

async function startServer() {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to Postgres");

    await connectRedis();

    app.listen(PORT, () => {
      console.log(`Ticket Purchase Service listening on port ${PORT}`);
    });

    startPurchaseWorker({
      consumerClient: redisWorkerClient,
      redisClient,
      processJob: processQueuedPurchaseJob,
    }).catch((err) => {
      console.error("TPS purchase worker crashed:", err.message);
      process.exit(1);
    });
  } catch (err) {
    console.error("Startup failed:", err.message);
    process.exit(1);
  }

  await connectEventCatalogService();
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  pool,
  redisClient,
  redisWorkerClient,
  startServer,
  createPurchase,
  fetchEvent,
  adjustEventSeats,
};
