const express = require('express');
const { Pool } = require('pg');
const {createClient} = require('redis');

const PORT = Number(process.env.PORT || 3004);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://postgres:password@refund-service-db:5432/refund-service';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

const app = express();
app.use(express.json());

const redisClient = createClient({url: REDIS_URL});
const pool = new Pool({connectionString: DATABASE_URL});

redisClient.on('error', err => {
  console.log('Redis error:', err.message)
});

async function connectRedis(){
  if(!redisClient.isOpen){
    await redisClient.connect();
    console.log('Connected to redis');
  }
}

//HTTP to connect to the ticket purchase service
async function connectTicketPurchaseService(){
  try{
    const response = await fetch('http://ticket-purchase-service/info');

    if(!response.ok){
      throw new Error(`HTTP error, status: ${response.status}`);
    }

    const data = await response.json();
    console.log(data);
  }catch(error){
    console.log('Error calling the ticket purchase service: ', error.message);
  }
}

app.get('/', async (req, res) => {
  res.json({
    service: 'refund-service',
    message: 'running'
  });
});

app.get('/health', async (req, res) => {
  let database = 'down';
  let redis = 'down';

  try{
    await pool.query('SELECT 1');
    database = 'up';
  } catch(error){
    console.log('Database error: ', error.message);
  }

  try{
    await redisClient.ping();
    redis = 'up';
  } catch(error){
    console.log('Redis error: ', error.message);
  }

  const health = database === 'up' && redis === 'up';

  res.status(health ? 200 : 503).json({
    status: health ? 'Healthy' : 'Unhealthy',
    service: 'refund-service', 
    database, 
    redis
  });
});

app.post('/refunds', async (req, res) => {
  const {
    userId,
    purchaseId,
    eventId,
    quantity, 
    refundAmountCents, 
    idempotencyKey
  } = req.body;

  if (!userId || !purchaseId || !eventId || !quantity || !refundAmountCents || !idempotencyKey) {
    return res.status(400).json({
      error:
        'userId, purchaseId, eventId, quantity, refundAmountCents, and idempotencyKey are required',
    });
  }

  try{
    const existing = await pool.query(
      'SELECT * FROM refunds WHERE idempotency_key = $1',
      [idempotencyKey]
    );

    if(existing.rows.length > 0){
      return res.status(200).json({
        message: 'Duplicate refund, exiting refund service',
        purchase: existing.rows[0],
      });
    }

    const result = await pool.query(
      `INSERT INTO refunds (user_id, purchase_id, event_id, quantity, refund_amount_cents, idempotency_key) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, purchaseId, eventId, quantity, refundAmountCents, idempotencyKey]
    );

    //Seat released event on Redis
    await redisClient.publish('seat.released', JSON.stringify({
      eventId,
      purchaseId,
      quantity,
      refundId: result.rows[0].id
    }));

    return res.status(201).json({
      message: 'Refund created successfully',
      refund: result.rows[0]
    });

  } catch(error){
    console.error('Error processing refund: ', error.message);
    return res.status(500).json({error: 'Internal server error'});
  }
});

async function startServer(){
  try{
    await pool.query('SELECT 1');
    console.log('Connected to postgres');

    await connectRedis();

    app.listen(PORT, () => {
      console.log(`Refund service listening on port: ${PORT}`);
    });
  } catch(error){
    console.error('Service failed to start: ', error.message);
    process.exit(1);
  }

  await connectTicketPurchaseService();
}

startServer();