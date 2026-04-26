const express = require("express");
const { createClient } = require("redis");
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const app = express();

const PORT = process.env.PORT || 3007;
const REDIS_URL = process.env.REDIS_URL;
const TICKET_PURCHASE_SERVICE_URL = process.env.TICKET_PURCHASE_SERVICE_URL;

const ANALYTICS_QUEUE = "analytics:queue";
const DLQ = "analytics:dlq";

const redisClient = createClient({ url: REDIS_URL });
const newMetricsSql = fs.readFileSync(
  path.join(__dirname, "..", "sql", "new-metrics.sql"),
  "utf8"
);
const updateReadMetricsSql = fs.readFileSync(
  path.join(__dirname, "..", "sql", "update-read-metrics.sql"),
  "utf8"
);
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

redisClient.on("error", (err) => {
  console.error("[analytics-worker] Redis error:", err.message);
});

// Health endpoint

app.get("/health", async (req, res) => {
  try {
    const queueDepth = await redisClient.lLen(ANALYTICS_QUEUE);
    const dlqDepth = await redisClient.lLen(DLQ);
    res.status(200).json({
        status: "healthy",
        service: "analytics-worker", 
        queueDepth, 
         dlqDepth 
        });
  } catch (error) {
    res.status(500).json({ status: "unhealthy", service: "analytics-worker", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`[analytics-worker] Listening on port ${PORT}`);
});

//Message validation

function isValidMessage(msg) {
    return (
        msg &&
        (typeof msg.eventId === "string" &&
        typeof msg.read === "number") ||
        (typeof msg.eventId === "string" &&
        typeof msg.quantity === "number" &&
        typeof msg.unitTicketCents === "number")
    );
}

//Message processing

async function processMessage(raw) {
    let job;
    try {
        job = JSON.parse(raw);
    } catch (error) {
        console.error("[analytics-worker] Failed to parse message:", error.message);
        await redisClient.lPush(DLQ, raw); // Move to DLQ for manual inspection
        return false; // Don't retry, message is malformed
    }
    if (!isValidMessage(job)) {
        console.error("[analytics-worker] Invalid message:", job);
        await redisClient.lPush(DLQ, raw); // Move to DLQ for manual inspection
        return false; // Don't retry, message is invalid
    }
    // Process the valid message here
    try {      
        if (job.read) {
        // Update read metrics in the database
            console.log(`[analytics-worker] Updating read metrics for eventId=${job.eventId}`);
            await pool.query(updateReadMetricsSql, [job.eventId, 0, 0, job.read]);
        } else {
            console.log(`[analytics-worker] Inserting new metrics for eventId=${job.eventId}`);
            await pool.query(newMetricsSql, [job.eventId, job.quantity, job.unitTicketCents, 0]);
        }
    } catch (error) {
        console.error("[analytics-worker] Failed to process message:", error.message);
        await redisClient.lPush(DLQ, raw); // Move to DLQ for manual inspection
        return false; // Don't retry, message processing failed
    }

}

// Worker loop
async function workerLoop() {
    while (true) {
        try {            
            const raw = await redisClient.brPop(ANALYTICS_QUEUE, 0); // Block until a message is available
            const message = raw.element;
            const success = await processMessage(message);
            if (!success) {
                console.error("[analytics-worker] Message processing failed, moved to DLQ:", message);
            }
        } catch (error) {
            console.error("[analytics-worker] Worker loop error:", error.message);
            // Optionally add a delay here before retrying to avoid tight error loops
            // Brief pause before looping to avoid a tight error spin
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
    }
}

async function start() {
    try {
        await redisClient.connect();
        console.log("[analytics-worker] Connected to Redis");
    } catch (error) {
        console.error("[analytics-worker] Failed to start worker:", error.message);
        process.exit(1); // Exit with failure code
    }
    app.listen(PORT, () => {
        console.log(`[analytics-worker] Health endpoint listening on port ${PORT}`);
    });
    workerLoop(); // Start the worker loop without awaiting to keep the health endpoint responsive

}

start().catch((error) => {
    console.error("[analytics-worker] Startup error:", error.message);
    process.exit(1); // Exit with failure code
});
