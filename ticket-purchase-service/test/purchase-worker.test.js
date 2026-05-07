const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PURCHASE_QUEUE_KEY,
  PURCHASE_DLQ_KEY,
} = require("../src/purchase-queue");
const { processPurchaseMessage } = require("../src/purchase-worker");

function createRedisDouble() {
  return {
    lPushCalls: [],
    rPushCalls: [],
    async lPush(key, value) {
      this.lPushCalls.push({ key, value });
    },
    async rPush(key, value) {
      this.rPushCalls.push({ key, value });
    },
  };
}

const logger = {
  log() {},
  warn() {},
  error() {},
};

function validJob(overrides = {}) {
  return {
    purchaseId: 1,
    userId: "user-1",
    eventId: "event-1",
    quantity: 2,
    idempotencyKey: "idem-1",
    attempts: 0,
    createdAt: "2026-04-27T12:00:00.000Z",
    ...overrides,
  };
}

test("valid purchase job processes successfully", async () => {
  const redisClient = createRedisDouble();
  let processed = false;

  const result = await processPurchaseMessage(JSON.stringify(validJob()), {
    redisClient,
    logger,
    async processJob() {
      processed = true;
    },
  });

  assert.equal(result, "processed");
  assert.equal(processed, true);
  assert.equal(redisClient.lPushCalls.length, 0);
  assert.equal(redisClient.rPushCalls.length, 0);
});

test("malformed purchase job goes to DLQ", async () => {
  const redisClient = createRedisDouble();

  const result = await processPurchaseMessage('{"bad-json"', {
    redisClient,
    logger,
    async processJob() {},
  });

  assert.equal(result, "dlq");
  assert.equal(redisClient.lPushCalls.length, 1);
  assert.equal(redisClient.lPushCalls[0].key, PURCHASE_DLQ_KEY);

  const dlqRecord = JSON.parse(redisClient.lPushCalls[0].value);
  assert.equal(dlqRecord.originalMessage, '{"bad-json"');
  assert.match(dlqRecord.errorMessage, /Malformed JSON/);
});

test("purchase job missing required fields goes to DLQ", async () => {
  const redisClient = createRedisDouble();

  const result = await processPurchaseMessage(
    JSON.stringify({ bad: "message", attempts: 0 }),
    {
      redisClient,
      logger,
      async processJob() {},
    }
  );

  assert.equal(result, "dlq");
  assert.equal(redisClient.lPushCalls.length, 1);

  const dlqRecord = JSON.parse(redisClient.lPushCalls[0].value);
  assert.equal(dlqRecord.originalMessage.bad, "message");
  assert.match(dlqRecord.errorMessage, /userId and eventId/);
});

test("purchase job without purchase identity goes to DLQ", async () => {
  const redisClient = createRedisDouble();
  let processed = false;

  const result = await processPurchaseMessage(
    JSON.stringify(
      validJob({
        purchaseId: undefined,
        idempotencyKey: undefined,
      })
    ),
    {
      redisClient,
      logger,
      async processJob() {
        processed = true;
      },
    }
  );

  assert.equal(result, "dlq");
  assert.equal(processed, false);
  assert.equal(redisClient.lPushCalls.length, 1);
  assert.equal(redisClient.rPushCalls.length, 0);

  const dlqRecord = JSON.parse(redisClient.lPushCalls[0].value);
  assert.match(dlqRecord.errorMessage, /purchaseId or idempotencyKey/);
});

test("purchase job can identify purchase by idempotency key only", async () => {
  const redisClient = createRedisDouble();
  let processedJob;

  const result = await processPurchaseMessage(
    JSON.stringify(
      validJob({
        purchaseId: undefined,
      })
    ),
    {
      redisClient,
      logger,
      async processJob(job) {
        processedJob = job;
      },
    }
  );

  assert.equal(result, "processed");
  assert.equal(processedJob.idempotencyKey, "idem-1");
  assert.equal(redisClient.lPushCalls.length, 0);
  assert.equal(redisClient.rPushCalls.length, 0);
});

test("purchase job that fails 3 times goes to DLQ", async () => {
  const redisClient = createRedisDouble();

  const first = await processPurchaseMessage(JSON.stringify(validJob()), {
    redisClient,
    logger,
    async processJob() {
      throw new Error("temporary processing failure");
    },
  });

  assert.equal(first, "retried");
  assert.equal(redisClient.rPushCalls.length, 1);
  assert.equal(redisClient.rPushCalls[0].key, PURCHASE_QUEUE_KEY);

  const second = await processPurchaseMessage(redisClient.rPushCalls[0].value, {
    redisClient,
    logger,
    async processJob() {
      throw new Error("temporary processing failure");
    },
  });

  assert.equal(second, "retried");
  assert.equal(redisClient.rPushCalls.length, 2);

  const third = await processPurchaseMessage(redisClient.rPushCalls[1].value, {
    redisClient,
    logger,
    async processJob() {
      throw new Error("temporary processing failure");
    },
  });

  assert.equal(third, "dlq");
  assert.equal(redisClient.lPushCalls.length, 1);

  const dlqRecord = JSON.parse(redisClient.lPushCalls[0].value);
  assert.equal(dlqRecord.attempts, 3);
  assert.equal(dlqRecord.originalMessage.attempts, 3);
  assert.equal(dlqRecord.service, "ticket-purchase-service");
});

test("worker continues after poison-pill message", async () => {
  const redisClient = createRedisDouble();
  const processed = [];

  await processPurchaseMessage('{"bad-json"', {
    redisClient,
    logger,
    async processJob(job) {
      processed.push(job.purchaseId);
    },
  });

  const result = await processPurchaseMessage(JSON.stringify(validJob()), {
    redisClient,
    logger,
    async processJob(job) {
      processed.push(job.purchaseId);
    },
  });

  assert.equal(result, "processed");
  assert.deepEqual(processed, [1]);
});
