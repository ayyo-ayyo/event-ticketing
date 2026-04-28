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



app.get('/payments/status/:purchaseId', async (req, res) => {
  const { purchaseId } = req.params
  const existing = await redisClient.get(`payment:${purchaseId}`)
  if (!existing) {
    return res.status(404).json({ status: 'not found', purchaseId })
  }
  return res.status(200).json(JSON.parse(existing))
})

//Endpoint for refund-service to make refund
app.post('/payments/refunds', async (req, res) => {
  const { purchaseId } = req.body;

  if (!purchaseId) {
    return res.status(400).json({ status: 'failed', message: 'purchaseId is required' });
  }

  const existing = await redisClient.get(`refund:${purchaseId}`);
  if (existing) {
    return res.status(200).json(JSON.parse(existing));
  }

  const success = Math.random() > 0.1;

  const result = success
    ? { status: 'success', purchaseId, message: 'Refund processed' }
    : { status: 'failed', purchaseId, message: 'Refund declined' };

  await redisClient.set(`refund:${purchaseId}`, JSON.stringify(result));

  return res.status(success ? 200 : 402).json(result);
})

app.get("/", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Payment Service</title>
      </head>
      <body>
        <h1>Payment Service</h1>

        <h2>Submit a Payment</h2>
        <input type="text" id="paymentPurchaseId" placeholder="Purchase ID">
        <button onclick="submitPayment()">Pay</button>
        <pre id="paymentResult"></pre>

        <h2>Submit a Refund</h2>
        <input type="text" id="refundPurchaseId" placeholder="Purchase ID">
        <button onclick="submitRefund()">Refund</button>
        <pre id="refundResult"></pre>

        <h2>Check Payment Status</h2>
        <input type="text" id="statusPurchaseId" placeholder="Purchase ID">
        <button onclick="checkStatus()">Check</button>
        <pre id="statusResult"></pre>

        <script>
          async function submitPayment() {
            const purchaseId = document.getElementById('paymentPurchaseId').value
            const res = await fetch('/payments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ purchaseId })
            })
            const data = await res.json()
            document.getElementById('paymentResult').textContent = JSON.stringify(data, null, 2)
          }

          async function submitRefund() {
            const purchaseId = document.getElementById('refundPurchaseId').value
            const res = await fetch('/payments/refunds', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ purchaseId })
            })
            const data = await res.json()
            document.getElementById('refundResult').textContent = JSON.stringify(data, null, 2)
          }

          async function checkStatus() {
            const purchaseId = document.getElementById('statusPurchaseId').value
            const res = await fetch('/payments/status/' + purchaseId)
            const data = await res.json()
            document.getElementById('statusResult').textContent = JSON.stringify(data, null, 2)
          }
        </script>
      </body>
    </html>
  `)
})

async function startServer() {
  await redisClient.connect();

  app.listen(PORT, () => {
    console.log(`Payment Service listening on port ${PORT}`);
  });
}

startServer();
