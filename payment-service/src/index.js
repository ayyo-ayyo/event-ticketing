const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3001;
const DATABASE_URL = process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: DATABASE_URL,
});

app.get("/health", async (req, res) => {
  let database = "down";

  try {
    await pool.query("SELECT 1");
    database = "up";
  } catch (err) {
    console.error("Database health check failed:", err.message);
  }

  const healthy = database === "up";

  res.status(healthy ? 200 : 503).json({
    status: healthy ? "healthy" : "unhealthy",
    service: "payment-service",
    database,
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

  try {
    const purchase = await pool.query(
      "SELECT * FROM purchases WHERE id = $1",
      [purchaseId]
    );

    if (purchase.rows.length === 0) {
      return res.status(404).json({
        status: "failed",
        purchaseId,
        message: "Purchase not found",
      });
    }

    // Simulate payment processing — succeeds most of the time
    const success = Math.random() > 0.1;
    const paymentStatus = success ? "paid" : "failed";

    await pool.query(
      "UPDATE purchases SET payment_status = $1 WHERE id = $2",
      [paymentStatus, purchaseId]
    );

    if (success) {
      return res.status(200).json({
        status: "success",
        purchaseId,
        message: "Payment processed",
      });
    } else {
      return res.status(402).json({
        status: "failed",
        purchaseId,
        message: "Payment declined",
      });
    }
  } catch (err) {
    console.error("Payment processing failed:", err.message);
    return res.status(500).json({
      status: "failed",
      purchaseId,
      message: "Internal server error",
    });
  }
});

async function startServer() {
  try {
    await pool.query("SELECT 1");
    console.log("Connected to Postgres");

    app.listen(PORT, () => {
      console.log(`Payment Service listening on port ${PORT}`);
    });
  } catch (err) {
    console.error("Startup failed:", err.message);
    process.exit(1);
  }
}

startServer();