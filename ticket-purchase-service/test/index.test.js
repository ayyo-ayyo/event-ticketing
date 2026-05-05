const test = require("node:test");
const assert = require("node:assert/strict");

const {
  pool,
  redisClient,
  createPurchase,
  getHealth,
  getUiEvent,
  postUiRefund,
} = require("../src/index");
const { PURCHASE_QUEUE_KEY } = require("../src/purchase-queue");

function createResponseDouble() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
}

test("GET /ui/events/:id proxies event payload", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url) => {
    assert.equal(url, "http://event-catalog-service:3001/events/event-123");
    return {
      ok: true,
      async json() {
        return { event: { id: "event-123", seats_available: 9 } };
      },
    };
  };

  try {
    const req = {
      params: { id: "event-123" },
    };
    const res = createResponseDouble();

    await getUiEvent(req, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      event: { id: "event-123", seats_available: 9 },
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("GET /health includes TPS queue and DLQ depths", async () => {
  const originalQuery = pool.query;
  const originalPing = redisClient.ping;
  const originalLLen = redisClient.lLen;

  pool.query = async (sql) => {
    assert.equal(sql, "SELECT 1");
    return { rows: [{ "?column?": 1 }] };
  };
  redisClient.ping = async () => "PONG";
  redisClient.lLen = async (key) => {
    if (key === "tps:purchase:queue") {
      return 7;
    }
    if (key === "tps:purchase:dlq") {
      return 2;
    }
    throw new Error(`Unexpected Redis key: ${key}`);
  };

  try {
    const res = createResponseDouble();

    await getHealth({}, res);

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
      status: "healthy",
      service: "ticket-purchase-service",
      database: "up",
      redis: "up",
      queueDepth: 7,
      dlqDepth: 2,
    });
  } finally {
    pool.query = originalQuery;
    redisClient.ping = originalPing;
    redisClient.lLen = originalLLen;
  }
});

test("GET /health leaves queue depths null when Redis is unavailable", async () => {
  const originalQuery = pool.query;
  const originalPing = redisClient.ping;
  const originalLLen = redisClient.lLen;

  pool.query = async () => ({ rows: [{ "?column?": 1 }] });
  redisClient.ping = async () => {
    throw new Error("redis down");
  };
  redisClient.lLen = async () => {
    throw new Error("lLen should not run when ping fails");
  };

  try {
    const res = createResponseDouble();

    await getHealth({}, res);

    assert.equal(res.statusCode, 503);
    assert.deepEqual(res.body, {
      status: "unhealthy",
      service: "ticket-purchase-service",
      database: "up",
      redis: "down",
      queueDepth: null,
      dlqDepth: null,
    });
  } finally {
    pool.query = originalQuery;
    redisClient.ping = originalPing;
    redisClient.lLen = originalLLen;
  }
});

test("POST /ui/refunds requires Idempotency-Key header", async () => {
  const req = {
    header() {
      return undefined;
    },
    body: { purchaseId: 1 },
  };
  const res = createResponseDouble();

  await postUiRefund(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: "Idempotency-Key header is required",
  });
});

test("POST /ui/refunds forwards refund response and status", async () => {
  const originalFetch = global.fetch;

  global.fetch = async (url, options) => {
    assert.equal(url, "http://refund-service:3006/refunds");
    assert.equal(options.method, "POST");
    assert.equal(options.headers["Idempotency-Key"], "refund-123");
    assert.equal(options.headers["Content-Type"], "application/json");
    assert.deepEqual(JSON.parse(options.body), { purchaseId: 42 });

    return {
      status: 202,
      async json() {
        return { refundId: "r-1", status: "queued" };
      },
    };
  };

  try {
    const req = {
      header(name) {
        if (name === "Idempotency-Key") {
          return "refund-123";
        }
        return undefined;
      },
      body: { purchaseId: 42 },
    };
    const res = createResponseDouble();

    await postUiRefund(req, res);

    assert.equal(res.statusCode, 202);
    assert.deepEqual(res.body, {
      refundId: "r-1",
      status: "queued",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("GET /ui/events/:id returns 404 when event lookup misses", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => ({
    ok: false,
    status: 404,
  });

  try {
    const req = {
      params: { id: "missing-event" },
    };
    const res = createResponseDouble();

    await getUiEvent(req, res);

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.body, {
      error: "Event not found",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("POST /ui/refunds returns 502 when refund service is unavailable", async () => {
  const originalFetch = global.fetch;

  global.fetch = async () => {
    throw new Error("network down");
  };

  try {
    const req = {
      header(name) {
        if (name === "Idempotency-Key") {
          return "refund-123";
        }
        return undefined;
      },
      body: { purchaseId: 42 },
    };
    const res = createResponseDouble();

    await postUiRefund(req, res);

    assert.equal(res.statusCode, 502);
    assert.deepEqual(res.body, {
      error: "Refund Service unavailable",
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("createPurchase publishes confirmed purchases to the TPS purchase queue", async () => {
  const originalQuery = pool.query;
  const originalFetch = global.fetch;
  const originalLPush = redisClient.lPush;

  const lPushCalls = [];
  const insertedPurchase = {
    id: 101,
    user_id: "user-1",
    event_id: "event-1",
    quantity: 2,
    unit_ticket_cents: 5000,
    reservation_status: "reserved",
    payment_status: "pending",
    idempotency_key: "idem-queue-1",
    created_at: "2026-05-05T12:00:00.000Z",
  };
  const confirmedPurchase = {
    ...insertedPurchase,
    reservation_status: "confirmed",
    payment_status: "paid",
  };

  pool.query = async (sql, params) => {
    if (sql.includes("INSERT INTO purchases")) {
      assert.deepEqual(params, [
        "user-1",
        "event-1",
        2,
        5000,
        "reserved",
        "pending",
        "idem-queue-1",
      ]);
      return { rows: [insertedPurchase] };
    }

    if (sql.includes("UPDATE purchases")) {
      assert.deepEqual(params, ["paid", "confirmed", 101]);
      return { rows: [confirmedPurchase] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  global.fetch = async (url, options = {}) => {
    if (url === "http://event-catalog-service:3001/events/event-1" && !options.method) {
      return {
        ok: true,
        async json() {
          return {
            event: {
              id: "event-1",
              seats_available: 10,
            },
          };
        },
      };
    }

    if (url === "http://event-catalog-service:3001/events/event-1" && options.method === "PUT") {
      assert.equal(JSON.parse(options.body).seats_available, 8);
      return {
        ok: true,
      };
    }

    if (url === "http://payment-service:3003/payments") {
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), { purchaseId: 101 });
      return {
        ok: true,
        async json() {
          return {
            status: "success",
            purchaseId: 101,
            message: "Payment processed",
          };
        },
      };
    }

    throw new Error(`Unexpected fetch: ${url}`);
  };

  redisClient.lPush = async (key, value) => {
    lPushCalls.push({ key, value });
  };

  const req = {
    header(name) {
      if (name === "Idempotency-Key") {
        return "idem-queue-1";
      }
      return undefined;
    },
    body: {
      userId: "user-1",
      eventId: "event-1",
      quantity: 2,
      unitTicketCents: 5000,
    },
  };
  const res = createResponseDouble();

  try {
    await createPurchase(req, res);

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.purchase.id, 101);
    assert.equal(res.body.purchaseQueued, undefined);

    const purchaseQueueCall = lPushCalls.find(
      (call) => call.key === PURCHASE_QUEUE_KEY
    );
    assert.ok(purchaseQueueCall);

    assert.deepEqual(JSON.parse(purchaseQueueCall.value), {
      purchaseId: 101,
      userId: "user-1",
      eventId: "event-1",
      quantity: 2,
      idempotencyKey: "idem-queue-1",
      createdAt: "2026-05-05T12:00:00.000Z",
    });
  } finally {
    pool.query = originalQuery;
    global.fetch = originalFetch;
    redisClient.lPush = originalLPush;
  }
});

test("createPurchase rejects waitlist promotion when seats stay unavailable", async () => {
  const originalQuery = pool.query;
  const originalFetch = global.fetch;
  const originalLPush = redisClient.lPush;

  const queryCalls = [];

  pool.query = async (sql, params) => {
    queryCalls.push({ sql, params });

    if (sql.includes("INSERT INTO purchases")) {
      return {
        rows: [
          {
            id: 99,
            user_id: "user-1",
            event_id: "event-1",
            quantity: 2,
            unit_ticket_cents: 5000,
          },
        ],
      };
    }

    if (sql === "DELETE FROM purchases WHERE id = $1") {
      assert.deepEqual(params, [99]);
      return { rowCount: 1 };
    }

    throw new Error(`Unexpected query: ${sql}`);
  };

  redisClient.lPush = async () => {
    throw new Error("waitlist should not be enqueued for promotion retries");
  };

  global.fetch = async (url) => {
    assert.equal(url, "http://event-catalog-service:3001/events/event-1");
    return {
      ok: true,
      async json() {
        return {
          event: {
            id: "event-1",
            seats_available: 1,
          },
        };
      },
    };
  };

  const req = {
    header(name) {
      const headers = {
        "Idempotency-Key": "idem-123",
        "X-Waitlist-Promotion": "true",
      };
      return headers[name];
    },
    body: {
      userId: "user-1",
      eventId: "event-1",
      quantity: 2,
      unitTicketCents: 5000,
    },
  };
  const res = createResponseDouble();

  try {
    await createPurchase(req, res);

    assert.equal(res.statusCode, 409);
    assert.deepEqual(res.body, {
      error: "Insufficient seats for waitlist promotion",
      event: {
        id: "event-1",
        seats_available: 1,
      },
    });
    assert.equal(queryCalls.length, 2);
    assert.match(queryCalls[0].sql, /INSERT INTO purchases/);
    assert.equal(queryCalls[1].sql, "DELETE FROM purchases WHERE id = $1");
  } finally {
    pool.query = originalQuery;
    global.fetch = originalFetch;
    redisClient.lPush = originalLPush;
  }
});
