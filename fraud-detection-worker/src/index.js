const express = require("express");
const { Pool } = require("pg");
const { createClient } = require("redis");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3007;
const DATABASE_URL = process.env.DATABASE_URL;
const REDIS_URL = process.env.REDIS_URL;

const QUEUE_KEY = "fraud:queue";
const DLQ_KEY = "fraud:queue:dlq";
const FRAUD_CHANNEL = "fraud:flagged";
const MAX_RETRIES = 3;

// Flag a purchase if the same user makes 3+ purchases within 60 seconds
const RAPID_PURCHASE_THRESHOLD = 3;
const RAPID_PURCHASE_WINDOW_SECS = 60;

// Flag a purchase if the same payment token is used across 3+ distinct events
// within 10 minutes (simulates stolen card used to sweep multiple events)
const MULTI_EVENT_THRESHOLD = 3;
const MULTI_EVENT_WINDOW_SECS = 600;

// Shared state for /health
let lastProcessedAt = null;
let workerRunning = false;
let jobsProcessed = 0;

const pool = new Pool({ connectionString: DATABASE_URL });

// Two separate Redis clients: consumer blocks on BRPOP; publisher is free for
// lLen, lPush, and PUBLISH
const consumer = createClient({ url: REDIS_URL });
const publisher = createClient({ url: REDIS_URL });

consumer.on("error", (err) =>
  console.error(JSON.stringify({
    event: "redis_error",
    service: "fraud-detection-worker",
    client: "consumer",
    error: err.message,
    timestamp: new Date().toISOString(),
  }))
);
publisher.on("error", (err) =>
  console.error(JSON.stringify({
    event: "redis_error",
    service: "fraud-detection-worker",
    client: "publisher",
    error: err.message,
    timestamp: new Date().toISOString(),
  }))
);

// ── Fraud pattern analysis ─────────────────────────────────────────────────
async function analyzePatterns(job) {
  const flags = [];

  // Pattern 1: rapid sequential purchases — same user, last 60 s
  const rapidResult = await pool.query(
    `SELECT COUNT(*) FROM purchase_patterns
     WHERE user_id = $1
       AND recorded_at > NOW() - ($2 || ' seconds')::INTERVAL`,
    [job.userId, RAPID_PURCHASE_WINDOW_SECS]
  );
  if (parseInt(rapidResult.rows[0].count) >= RAPID_PURCHASE_THRESHOLD) {
    flags.push("rapid_sequential_purchases");
  }

  // Pattern 2: payment token used across multiple events — same token, last 10 min
  const multiEventResult = await pool.query(
    `SELECT COUNT(DISTINCT event_id) FROM purchase_patterns
     WHERE payment_token = $1
       AND recorded_at > NOW() - ($2 || ' seconds')::INTERVAL`,
    [job.paymentToken, MULTI_EVENT_WINDOW_SECS]
  );
  if (parseInt(multiEventResult.rows[0].count) >= MULTI_EVENT_THRESHOLD) {
    flags.push("payment_token_multi_event");
  }

  return flags;
}

// ── Core job processor ─────────────────────────────────────────────────────
async function processJob(raw) {
  let job;

  // --- Poison-pill: malformed JSON → DLQ immediately ---
  try {
    job = JSON.parse(raw);
  } catch {
    console.log(JSON.stringify({
      event: "dlq_enqueued",
      service: "fraud-detection-worker",
      reason: "malformed_json",
      raw,
      timestamp: new Date().toISOString(),
    }));
    await publisher.lPush(DLQ_KEY, raw);
    return;
  }

  // --- Structural validation → DLQ if required fields missing ---
  if (!job.purchaseId || !job.userId || !job.eventId || !job.paymentToken) {
    console.log(JSON.stringify({
      event: "dlq_enqueued",
      service: "fraud-detection-worker",
      reason: "missing_required_fields",
      missingFields: ["purchaseId", "userId", "eventId", "paymentToken"].filter(
        (f) => !job[f]
      ),
      job,
      timestamp: new Date().toISOString(),
    }));
    await publisher.lPush(DLQ_KEY, raw);
    return;
  }

  // --- Process with retries for transient errors (e.g. DB timeout) ---
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const start = Date.now();
    try {
      console.log(JSON.stringify({
        event: "job_processing",
        service: "fraud-detection-worker",
        purchaseId: job.purchaseId,
        attempt,
        maxRetries: MAX_RETRIES,
        timestamp: new Date().toISOString(),
      }));

      // Record pattern BEFORE analyzing so this purchase counts toward the window
      await pool.query(
        `INSERT INTO purchase_patterns
         (purchase_id, user_id, event_id, payment_token)
         VALUES ($1, $2, $3, $4)`,
        [job.purchaseId, job.userId, job.eventId, job.paymentToken]
      );

      const flags = await analyzePatterns(job);
      const isFraud = flags.length > 0;

      if (isFraud) {
        // Write one fraud_flag row per triggered rule
        for (const reason of flags) {
          await pool.query(
            `INSERT INTO fraud_flags
             (purchase_id, user_id, event_id, reason)
             VALUES ($1, $2, $3, $4)`,
            [job.purchaseId, job.userId, job.eventId, reason]
          );
        }

        // Publish "fraud flagged" event to pub/sub for any downstream listener
        const fraudEvent = JSON.stringify({
          purchaseId: job.purchaseId,
          userId: job.userId,
          eventId: job.eventId,
          flags,
          detectedAt: new Date().toISOString(),
        });
        await publisher.publish(FRAUD_CHANNEL, fraudEvent);

        console.log(JSON.stringify({
          event: "fraud_flagged",
          service: "fraud-detection-worker",
          purchaseId: job.purchaseId,
          userId: job.userId,
          eventId: job.eventId,
          flags,
          timestamp: new Date().toISOString(),
        }));
      } else {
        console.log(JSON.stringify({
          event: "fraud_clear",
          service: "fraud-detection-worker",
          purchaseId: job.purchaseId,
          userId: job.userId,
          timestamp: new Date().toISOString(),
        }));
      }

      lastProcessedAt = new Date().toISOString();
      jobsProcessed += 1;
      const queueDepth = await publisher.lLen(QUEUE_KEY);

      console.log(JSON.stringify({
        event: "job_processed",
        service: "fraud-detection-worker",
        purchaseId: job.purchaseId,
        fraudFlagged: isFraud,
        flags,
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
        service: "fraud-detection-worker",
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
    service: "fraud-detection-worker",
    reason: "max_retries_exhausted",
    purchaseId: job.purchaseId,
    timestamp: new Date().toISOString(),
  }));
  await publisher.lPush(DLQ_KEY, raw);
}

// ── Worker loop ────────────────────────────────────────────────────────────
async function runWorker() {
  workerRunning = true;
  console.log(JSON.stringify({
    event: "worker_started",
    service: "fraud-detection-worker",
    queue: QUEUE_KEY,
    timestamp: new Date().toISOString(),
  }));

  while (true) {
    try {
      // BRPOP blocks up to 5 s then loops — keeps the process alive without busy-waiting
      const result = await consumer.brPop(QUEUE_KEY, 5);
      if (result) {
        console.log(JSON.stringify({
          event: "job_dequeued",
          service: "fraud-detection-worker",
          queue: QUEUE_KEY,
          timestamp: new Date().toISOString(),
        }));
        await processJob(result.element);
      }
    } catch (err) {
      console.log(JSON.stringify({
        event: "worker_loop_error",
        service: "fraud-detection-worker",
        error: err.message,
        timestamp: new Date().toISOString(),
      }));
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ── Health endpoint ────────────────────────────────────────────────────────
app.get("/health", async (req, res) => {
  let redis = "down";
  let database = "down";
  let queueDepth = null;
  let dlqDepth = null;

  try {
    await publisher.ping();
    redis = "up";
    queueDepth = await publisher.lLen(QUEUE_KEY);
    dlqDepth = await publisher.lLen(DLQ_KEY);
  } catch (err) {
    console.error(JSON.stringify({
      event: "health_check_failed",
      service: "fraud-detection-worker",
      component: "redis",
      error: err.message,
      timestamp: new Date().toISOString(),
    }));
  }

  try {
    await pool.query("SELECT 1");
    database = "up";
  } catch (err) {
    console.error(JSON.stringify({
      event: "health_check_failed",
      service: "fraud-detection-worker",
      component: "database",
      error: err.message,
      timestamp: new Date().toISOString(),
    }));
  }

  const healthy = redis === "up" && database === "up";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    service: "fraud-detection-worker",
    redis,
    database,
    workerRunning,
    depth: queueDepth,
    dlq_depth: dlqDepth,
    last_job_at: lastProcessedAt,
    jobs_processed: jobsProcessed,
  });
});

// ── Startup ────────────────────────────────────────────────────────────────
async function start() {
  await pool.query("SELECT 1");
  console.log(JSON.stringify({
    event: "db_connected",
    service: "fraud-detection-worker",
    timestamp: new Date().toISOString(),
  }));

  await consumer.connect();
  await publisher.connect();
  console.log(JSON.stringify({
    event: "redis_connected",
    service: "fraud-detection-worker",
    timestamp: new Date().toISOString(),
  }));

  app.listen(PORT, () => {
    console.log(JSON.stringify({
      event: "http_listening",
      service: "fraud-detection-worker",
      port: PORT,
      timestamp: new Date().toISOString(),
    }));
  });

  runWorker().catch((err) => {
    console.error(JSON.stringify({
      event: "worker_fatal_crash",
      service: "fraud-detection-worker",
      error: err.message,
      timestamp: new Date().toISOString(),
    }));
    process.exit(1);
  });
}

start().catch((err) => {
  console.error(JSON.stringify({
    event: "startup_failed",
    service: "fraud-detection-worker",
    error: err.message,
    timestamp: new Date().toISOString(),
  }));
  process.exit(1);
});
