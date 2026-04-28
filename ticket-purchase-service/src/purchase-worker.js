const {
  PURCHASE_QUEUE_KEY,
  PURCHASE_DLQ_KEY,
  MAX_PURCHASE_ATTEMPTS,
} = require("./purchase-queue");

function getAttempts(value) {
  const attempts = Number.parseInt(value, 10);
  return Number.isInteger(attempts) && attempts >= 0 ? attempts : 0;
}

function validateJob(job) {
  if (!job || typeof job !== "object" || Array.isArray(job)) {
    return "Purchase job must be a JSON object";
  }

  if (!job.userId || !job.eventId) {
    return "Purchase job must include userId and eventId";
  }

  const quantity = Number(job.quantity);
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return "Purchase job must include a positive integer quantity";
  }

  return null;
}

function createDlqRecord(originalMessage, errorMessage, attempts) {
  return {
    originalMessage,
    errorMessage,
    failedAt: new Date().toISOString(),
    attempts,
    service: "ticket-purchase-service",
  };
}

async function pushToDlq(redisClient, originalMessage, errorMessage, attempts, logger) {
  const record = createDlqRecord(originalMessage, errorMessage, attempts);
  await redisClient.lPush(PURCHASE_DLQ_KEY, JSON.stringify(record));
  logger.error(
    `[ticket-purchase-service] Moved purchase job to DLQ (${PURCHASE_DLQ_KEY}): ${errorMessage}`
  );
}

async function processPurchaseMessage(
  rawMessage,
  { redisClient, processJob, logger = console }
) {
  logger.log(`[ticket-purchase-service] Received purchase job from ${PURCHASE_QUEUE_KEY}`);

  let job;

  try {
    job = JSON.parse(rawMessage);
  } catch (error) {
    await pushToDlq(
      redisClient,
      rawMessage,
      `Malformed JSON: ${error.message}`,
      0,
      logger
    );
    return "dlq";
  }

  job.attempts = getAttempts(job.attempts);
  job.createdAt = job.createdAt || job.timestamp || new Date().toISOString();

  const validationError = validateJob(job);
  if (validationError) {
    await pushToDlq(redisClient, job, validationError, job.attempts, logger);
    return "dlq";
  }

  try {
    await processJob(job);
    logger.log(
      `[ticket-purchase-service] Processed purchase job successfully for purchaseId=${job.purchaseId ?? "n/a"}`
    );
    return "processed";
  } catch (error) {
    job.attempts += 1;

    if (job.attempts < MAX_PURCHASE_ATTEMPTS) {
      await redisClient.rPush(PURCHASE_QUEUE_KEY, JSON.stringify(job));
      logger.warn(
        `[ticket-purchase-service] Retrying purchase job for purchaseId=${job.purchaseId ?? "n/a"} (attempt ${job.attempts}/${MAX_PURCHASE_ATTEMPTS})`
      );
      return "retried";
    }

    await pushToDlq(redisClient, job, error.message, job.attempts, logger);
    return "dlq";
  }
}

async function startPurchaseWorker({
  consumerClient,
  redisClient,
  processJob,
  logger = console,
}) {
  console.log(
    `[ticket-purchase-service] Listening for purchase jobs on ${PURCHASE_QUEUE_KEY}`
  );

  while (true) {
    try {
      const result = await consumerClient.brPop(PURCHASE_QUEUE_KEY, 5);

      if (result) {
        await processPurchaseMessage(result.element, {
          redisClient,
          processJob,
          logger,
        });
      }
    } catch (error) {
      logger.error(
        `[ticket-purchase-service] Purchase worker loop error: ${error.message}`
      );
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

module.exports = {
  processPurchaseMessage,
  startPurchaseWorker,
};
