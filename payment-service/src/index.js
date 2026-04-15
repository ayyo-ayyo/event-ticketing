const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3003;

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

  // Simulate payment processing. The purchase service owns purchase persistence.
  const success = Math.random() > 0.1;

  if (success) {
    return res.status(200).json({
      status: "success",
      purchaseId,
      message: "Payment processed",
    });
  }

  return res.status(402).json({
    status: "failed",
    purchaseId,
    message: "Payment declined",
  });
});

async function startServer() {
  app.listen(PORT, () => {
    console.log(`Payment Service listening on port ${PORT}`);
  });
}

startServer();
