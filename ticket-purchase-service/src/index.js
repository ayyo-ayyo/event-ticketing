const e = require("express");
const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3002;
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;
const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

const redisClient = createClient({
  url: REDIS_URL,
});

redisClient.on("error", (err) => {
  console.error("Redis error:", err.message);
});

async function connectRedis() {
  if (!redisClient.isOpen) {
    await redisClient.connect();
    console.log("Connected to Redis");
  }
}

// HTTP to connect to Event Catalog Service
async function connectEventCatalogService(){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // Timeout 5s

  try{
    const response = await fetch("http://event-catalog-service:3001/info", {signal: controller.signal});
    clearTimeout(timeout);

    if(!response.ok){
      throw new Error(`HTTP error. Status: ${response.status}`);
    }
    const data = await response.json();
    console.log(data);
  } catch (error) {
    if(error.name == "AbortError"){
      console.error('Error: Timeout on HTTP request to Event Catalog Service');
    } else {
      console.error('Error calling Event Catalog Service:', error.message)
    }
  }
}

// Use this function for fetching events corresponding to the ticket
async function fetchEvent(eventId){ 
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000); // Timeout 5s;
  try{
    const response = await fetch(`http://event-catalog-service:3001/events/${eventId}`, {signal: controller.signal});
    clearTimeout(timeout);

    if(!response.ok){
    throw new Error(`HTTP error. Status: ${response.status}`)
    }
  const event = await response.json();
  return event;

  } catch (error) {
    if(error.name == "AbortError"){
      console.error('')
      console.error('Error: Timeout on HTTP request for fetching event based on eventId');
    } else {
      console.error('Error fetching event from Event Catalog Service:', error.message)
    }
  }
}

async function adjustEventSeats(event, eventId, quantity){
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  console.log(`Adjusting seats for eventId ${eventId} by ${quantity}. Current seats available: ${event.seats_available}`);
  try {
          const updateResponse = await fetch(`http://event-catalog-service:3001/events/${eventId}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...event,
              seats_available: event.seats_available + quantity,
            }),
          });
          if (!updateResponse.ok) {
            throw new Error(`Failed to update seats for eventId: ${eventId}`);
          }
        } catch (updateErr) {
          console.error("Failed to update seats in Event Catalog Service:", updateErr.message);
          return res.status(502).json({
            error: "Event Catalog Service unreachable",
            purchase: result.rows[0],
          });
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

app.post("/purchases", async (req, res) => {
  const {
    userId,
    eventId,
    quantity,
    unitTicketCents,
    idempotencyKey,
  } = req.body;

  if (!userId || !eventId || !quantity || !unitTicketCents || !idempotencyKey) {
    return res.status(400).json({
      error:
        "userId, eventId, quantity, unitTicketCents, and idempotencyKey are required",
    });
  }

  try {
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

    const result = await pool.query(
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
    const event = (await fetchEvent(eventId))?.event || null;
    if (!event) {
      return res.status(404).json({ error: "Event not found for eventId: " + eventId });
    }

    //if there is no seats available, push the purchase onto waiting list and return response to user
      if(event.seats_available < quantity){
        //push purchase object onto waiting queue in Redis
        await redisClient.lPush("waitlist", JSON.stringify(result.rows[0]));
        return res.status(200).json({
          message: "Purchase created but added to waiting list due to insufficient seats",
          purchase: result.rows[0],
          event,
        });
      }
      //otherwise, decrement the available seats in the event catalog service using the put route and proceed with payment
      await adjustEventSeats(event, eventId, -quantity);

    const purchase = result.rows[0];

    // Synchronous HTTP call to Payment Service
    let paymentResult;
    let paymentResponse;
    try {
      paymentResponse = await fetch(`${PAYMENT_SERVICE_URL}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purchaseId: purchase.id }),
      });

      paymentResult = await paymentResponse.json();
    } catch (paymentErr) {
      console.error("Failed to reach Payment Service:", paymentErr.message);
      await adjustEventSeats(event, eventId, quantity); // Rollback seat reservation
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
      return res.status(201).json({
        message: "Purchase created and payment processed",
        purchase: updatedPurchase.rows[0],
        payment: paymentResult,
      });
    } else {
      await adjustEventSeats(event, eventId, quantity); // Rollback seat reservation on payment failure
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
});

async function startServer() {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to Postgres");

    await connectRedis();

    app.listen(PORT, () => {
      console.log(`Ticket Purchase Service listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup failed:", err.message);
    process.exit(1);
  }

  await connectEventCatalogService();
}

startServer();
