const express = require("express");

const redis = require("redis");



const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3003;

const redisClient = redis.createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379"
});

redisClient.on("error", (err) => console.error("Redis error:", err));




app.get("/health", async (req, res) => {
  let redisStatus = 'down';
  try {
    await redisClient.ping();
    redisStatus = 'up';
  } catch (err) {
    console.error('[payment-service] Redis health check failed:', err.message);
  }

  const healthy = redisStatus === 'up';

  res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'unhealthy',
    service: 'payment-service',
    redis: redisStatus,
  });
});

app.post("/payments", async (req, res) => {
  const { purchaseId } = req.body;

  if (!purchaseId) {
    return res.status(400).json({
      status: "failed",
      message: "purchaseId is required",
    });
  }

  let existing = null;
  try {
    existing = await redisClient.get(`payment:${purchaseId}`);
  } catch (err) {
    console.error('[payment-service] Redis get failed:', err.message);
  }
  if (existing) {
    try {
      return res.status(200).json(JSON.parse(existing));
    } catch (err) {
      console.error('[payment-service] Failed to parse cached payment:', err.message);
    }
  }
  
  const success = Math.random() > 0.1;


  const result = success? {status: "success", purchaseId, message: "Payment processed"} : { status: "failed", purchaseId, message: "Payment declined"};
  const statusCode = success ? 200 : 402
  
  try {
    await redisClient.set(`payment:${purchaseId}`, JSON.stringify(result));
  } catch (err) {
    console.error('[payment-service] Redis set failed:', err.message);
  }
  
  return res.status(statusCode).json(result)


  // if (success) {
  //   return res.status(200).json({
  //     status: "success",
  //     purchaseId,
  //     message: "Payment processed",
  //   });
  // }


  // return res.status(402).json({
  //   status: "failed",
  //   purchaseId,
  //   message: "Payment declined",
  // });
});

//Endpoint for refund-service to make refund
app.post('/payments/refunds', async (req, res) => {
  const { purchaseId } = req.body;

  if (!purchaseId) {
    return res.status(400).json({ status: 'failed', message: 'purchaseId is required' });
  }

  let existing = null;
  try {
    existing = await redisClient.get(`refund:${purchaseId}`);
  } catch (err) {
    console.error('[payment-service] Redis get failed:', err.message);
  }
  if (existing) {
    try {
      return res.status(200).json(JSON.parse(existing));
    } catch (err) {
      console.error('[payment-service] Failed to parse cached refund:', err.message);
    }
  }

  const success = Math.random() > 0.1;

  const result = success
    ? { status: 'success', purchaseId, message: 'Refund processed' }
    : { status: 'failed', purchaseId, message: 'Refund declined' };

  try {
    await redisClient.set(`refund:${purchaseId}`, JSON.stringify(result));
  } catch (err) {
    console.error('[payment-service] Redis set failed:', err.message);
  }

  return res.status(success ? 200 : 402).json(result);
})

async function startServer() {
  await redisClient.connect();

  app.listen(PORT, () => {
    console.log(`Payment Service listening on port ${PORT}`);
  });
}

startServer();
