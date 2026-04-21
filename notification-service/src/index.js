const express = require("express");
const { createClient } = require("redis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3004;
const REDIS_URL = process.env.REDIS_URL;

const QUEUE_KEY = "notification:queue";
const DLQ_KEY = "notification:dlq";
const MAX_RETRIES = 3;

// Shared state reported by /health
let lastProcessedAt = null;
let workerRunning = false;
let jobsProcessed = 0;

// Two separate Redis clients: one blocked on BRPOP, one free for lLen / lPush
const consumer = createClient({ url: REDIS_URL });
const publisher = createClient({ url: REDIS_URL });

consumer.on("error", (err) =>
  console.error("[notification-service] Redis consumer error:", err.message)
);
publisher.on("error", (err) =>
  console.error("[notification-service] Redis publisher error:", err.message)
);

// Simulated email — logs are visible in `docker compose logs -f`
function sendConfirmationEmail(job) {
  console.log(JSON.stringify({
    event: "email_sent",
    service: "notification-worker",
    purchaseId: job.purchaseId,
    userId: job.userId,
    eventId: job.eventId,
    quantity: job.quantity,
    totalCents: job.quantity * job.unitTicketCents,
    timestamp: new Date().toISOString(),
  }));
}

async function processJob(raw) {
  let job;

  // --- Poison-pill check: malformed JSON goes straight to DLQ ---
  try {
    job = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({
      event: "dlq_enqueued",
      service: "notification-worker",
      reason: "malformed_json",
      raw,
      timestamp: new Date().toISOString(),
    }));
    await publisher.lPush(DLQ_KEY, raw);
    return;
  }

  // --- Structural validation ---
  if (!job.userId || !job.eventId || !job.purchaseId) {
    console.log(JSON.stringify({
      event: "dlq_enqueued",
      service: "notification-worker",
      reason: "missing_required_fields",
      job,
      timestamp: new Date().toISOString(),
    }));
    await publisher.lPush(DLQ_KEY, raw);
    return;
  }

  // --- Process with retries ---
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      console.log(JSON.stringify({
        event: "job_processing",
        service: "notification-worker",
        purchaseId: job.purchaseId,
        attempt,
        maxRetries: MAX_RETRIES,
        timestamp: new Date().toISOString(),
      }));
      sendConfirmationEmail(job);
      lastProcessedAt = new Date().toISOString();
      jobsProcessed += 1;
      const queueDepth = await publisher.lLen(QUEUE_KEY);
      console.log(JSON.stringify({
        event: "job_processed",
        service: "notification-worker",
        purchaseId: job.purchaseId,
        processingTimeMs: Date.now() - start,
        queueDepth,
        jobsProcessed,
        last_job_at: lastProcessedAt,
        timestamp: lastProcessedAt,
      }));
      return;
    } catch (err) {
      console.log(JSON.stringify({
        event: "job_attempt_failed",
        service: "notification-worker",
        purchaseId: job.purchaseId,
        attempt,
        error: err.message,
        timestamp: new Date().toISOString(),
      }));
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
      }
    }
  }

  // --- Exhausted retries → DLQ ---
  console.log(JSON.stringify({
    event: "dlq_enqueued",
    service: "notification-worker",
    reason: "max_retries_exhausted",
    purchaseId: job.purchaseId,
    timestamp: new Date().toISOString(),
  }));
  await publisher.lPush(DLQ_KEY, raw);
}

async function runWorker() {
  workerRunning = true;
  console.log(JSON.stringify({
    event: "worker_started",
    service: "notification-worker",
    queue: QUEUE_KEY,
    timestamp: new Date().toISOString(),
  }));

  while (true) {
    try {
      // BRPOP blocks up to 5 s waiting for a message, then loops
      const result = await consumer.brPop(QUEUE_KEY, 5);
      if (result) {
        console.log(JSON.stringify({
          event: "job_dequeued",
          service: "notification-worker",
          queue: QUEUE_KEY,
          timestamp: new Date().toISOString(),
        }));
        await processJob(result.element);
      }
    } catch (err) {
      console.log(JSON.stringify({
        event: "worker_loop_error",
        service: "notification-worker",
        error: err.message,
        timestamp: new Date().toISOString(),
      }));
      // Brief pause before retrying to avoid a tight error loop
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ── Health endpoint ────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  let redis = "down";
  let queueDepth = null;
  let dlqDepth = null;

  try {
    await publisher.ping();
    redis = "up";
    queueDepth = await publisher.lLen(QUEUE_KEY);
    dlqDepth = await publisher.lLen(DLQ_KEY);
  } catch (err) {
    console.error("[notification-service] Redis health check failed:", err.message);
  }

  const healthy = redis === "up";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    service: "notification-service",
    redis,
    workerRunning,
    depth: queueDepth,
    dlq_depth: dlqDepth,
    last_job_at: lastProcessedAt,
    jobs_processed: jobsProcessed,
  });
});

// ── Startup ────────────────────────────────────────────────────────────────
async function start() {
  await consumer.connect();
  console.log("[notification-service] Redis consumer connected");

  await publisher.connect();
  console.log("[notification-service] Redis publisher connected");

  app.listen(PORT, () => {
    console.log(`[notification-service] HTTP server listening on port ${PORT}`);
  });

  // Worker runs in the background — if it crashes fatally, exit so Docker restarts us
  runWorker().catch((err) => {
    console.error("[notification-worker] Fatal crash:", err.message);
    process.exit(1);
  });
}

start();
