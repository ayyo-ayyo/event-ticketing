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
  res.status(200).json({
    status: "healthy",
    service: "payment-service",
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

  const existing = await redisClient.get(`payment:${purchaseId}`);
  if(existing){
    return res.status(200).json(JSON.parse(existing));
  }
  
  const success = Math.random() > 0.1;


  const result = success? {status: "success", purchaseId, message: "Payment processed"} : { status: "failed", purchaseId, message: "Payment declined"};
  const statusCode = success ? 200 : 402
  
  await redisClient.set(`payment:${purchaseId}`, JSON.stringify(result));
  
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

async function startServer() {
  await redisClient.connect();

  app.listen(PORT, () => {
    console.log(`Payment Service listening on port ${PORT}`);
  });
}

startServer();
