const express = require('express');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { createClient } = require('redis');

const PORT = Number(process.env.PORT || 3001);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://catalog:catalog@event-catalog-db:5432/event_catalog';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = createClient({ url: REDIS_URL });
const getEventByIdSql = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'get-event-by-id.sql'),
  'utf8'
);

// Receiving service to service HTTP call from ticket purchasing service
app.get("/info", (_req, res) => {
  res.json({message: "Message from Event Catalog Service"});
})

app.get('/health', async (_req, res) => {
  let dbStatus = 'ok';
  let redisStatus = 'ok';
  service: "event-catalog-service";
  message: "running";

  try {
    await pool.query('SELECT 1');
  } catch (error) {
    dbStatus = `error: ${error.message}`;
  }

  try {
    await redis.ping();
  } catch (error) {
    redisStatus = `error: ${error.message}`;
  }

  if (dbStatus === 'ok' && redisStatus === 'ok') {
    return res.status(200).json({ status: 'healthy', db: dbStatus, redis: redisStatus });
  }

  return res.status(503).json({ status: 'unhealthy', db: dbStatus, redis: redisStatus });
});

app.get('/events/:id', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `event:${id}`;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      return res.status(200).json({ source: 'cache', event: JSON.parse(cached) });
    }

    const result = await pool.query(getEventByIdSql, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'event_not_found' });
    }

    const row = result.rows[0];
    const event = {
      id: String(row.id),
      title: row.title,
      venue: row.venue,
      date: row.event_date,
      currency: 'USD',
      basePriceCents: row.base_price_cents,
      seatsAvailable: row.seats_available
    };

    await redis.set(cacheKey, JSON.stringify(event), { EX: 60 });

    return res.status(200).json({ source: 'database', event });
  } catch (error) {
    return res.status(500).json({ error: 'failed_to_fetch_event', message: error.message });
  }
});

async function start() {
  try {
    redis.on('error', (err) => {
      console.error('Redis client error:', err.message);
    });

    await redis.connect();

    app.listen(PORT, () => {
      console.log(`event-catalog-service listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start event-catalog-service:', error.message);
    process.exit(1);
  }
}

start();
