const express = require('express');
const { Pool } = require('pg');
const { createClient } = require('redis');

const PORT = Number(process.env.PORT || 3003);
const DATABASE_URL = process.env.DATABASE_URL || 'postgres://catalog:catalog@event-catalog-db:5432/event_catalog';
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

const app = express();
app.use(express.json());

const pool = new Pool({ connectionString: DATABASE_URL });
const redis = createClient({ url: REDIS_URL });

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS venues (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      city TEXT NOT NULL,
      capacity INTEGER NOT NULL CHECK (capacity > 0)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      venue_id INTEGER NOT NULL REFERENCES venues(id),
      title TEXT NOT NULL,
      event_date TIMESTAMPTZ NOT NULL,
      base_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0)
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS seat_inventory (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id),
      section_name TEXT NOT NULL,
      total_seats INTEGER NOT NULL CHECK (total_seats >= 0),
      available_seats INTEGER NOT NULL CHECK (available_seats >= 0),
      price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0)
    );
  `);

  // Ensure pricing columns exist for already-provisioned databases.
  await pool.query(`
    ALTER TABLE events
    ADD COLUMN IF NOT EXISTS base_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0);
  `);

  await pool.query(`
    ALTER TABLE seat_inventory
    ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0);
  `);
}

// Receiving service to service HTTP call from ticket purchasing service
app.get("/info", (_req, res) => {
  res.json({message: "Message from Event Catalog Service"});
})

app.get('/health', async (_req, res) => {
  let dbStatus = 'ok';
  let redisStatus = 'ok';

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

    // Placeholder event data until DB-backed event listing is implemented.
    const event = {
      id,
      title: 'Placeholder Concert',
      venue: 'Downtown Arena',
      date: '2026-10-31T20:00:00Z',
      currency: 'USD',
      basePriceCents: 6500,
      seatsAvailable: 240
    };

    await redis.set(cacheKey, JSON.stringify(event), { EX: 60 });

    return res.status(200).json({ source: 'placeholder', event });
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
    await ensureSchema();

    app.listen(PORT, () => {
      console.log(`event-catalog-service listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start event-catalog-service:', error.message);
    process.exit(1);
  }
}

start();
