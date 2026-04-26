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
const updateEventByIdSql = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'update-event-by-id.sql'),
  'utf8'
);
const deleteEventByIdSql = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'delete-event-by-id.sql'),
  'utf8'
);
const newEventSql = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'new-event.sql'),
  'utf8'
);
const newVenueSql = fs.readFileSync(
  path.join(__dirname, '..', 'sql', 'new_venue.sql'),
  'utf8'
);

// Receiving service to service HTTP call from ticket purchasing service
app.get("/info", async (_req, res) => {
  //await new Promise(resolve => setTimeout(resolve, 7000)); // 7 seconds (For Testing AbortError)
  res.json({service: "event-catalog-service",
      status: "running",
  });
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


// Update an event (partial updates allowed)
app.put('/events/:id', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `event:${id}`;

  // Accept several common field names from clients
  const title = req.body.title ?? null;
  const eventDate = req.body.event_date ?? null;
  const basePriceCents = req.body.base_price_cents ?? null;
  const venueId = req.body.venue_id ?? null;
  const seats_available = req.body.seats_available ?? null;

  try {
    const updateResult = await pool.query(updateEventByIdSql, [
      id,
      title,
      eventDate,
      basePriceCents,
      venueId,
      seats_available,
    ]);

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'event_not_found' });
    }

    // Fetch the full, current event representation using existing SQL
    const fresh = await pool.query(getEventByIdSql, [id]);
    if (fresh.rowCount === 0) {
      return res.status(404).json({ error: 'event_not_found' });
    }

    const row = fresh.rows[0];
    const event = {
      id: String(row.id),
      title: row.title,
      venue: row.venue,
      date: row.event_date,
      currency: 'USD',
      basePriceCents: row.base_price_cents,
      seats_available: row.seats_available,
    };

    // Update cache with new value (short TTL)
    try {
      await redis.set(cacheKey, JSON.stringify(event), { EX: 60 });
    } catch (err) {
      console.error('Failed to update redis cache:', err.message);
    }

    return res.status(200).json({ source: 'database', event });
  } catch (error) {
    return res.status(500).json({ error: 'failed_to_update_event', message: error.message });
  }
});

app.delete('/events/:id', async (req, res) => {
  const { id } = req.params;
  const cacheKey = `event:${id}`;

  try {
    const result = await pool.query(deleteEventByIdSql, [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'event_not_found' });
    }

    try {
      await redis.del(cacheKey);
    } catch (err) {
      console.error('Failed to delete redis cache for event:', err.message);
    }

    return res.status(204).send();
  } catch (error) {
    return res.status(500).json({ error: 'failed_to_delete_event', message: error.message });
  }
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
      seats_available: row.seats_available
    };

    await redis.set(cacheKey, JSON.stringify(event), { EX: 60 });
    //push to analytics queue so the Analytics Worker can update read metrics
    const analyticsJob = JSON.stringify({
      eventId: event.id,
      read: 1,
    });
    await redis.lPush("analytics:queue", analyticsJob);
    return res.status(200).json({ source: 'database', event });
  } catch (error) {
    return res.status(500).json({ error: 'failed_to_fetch_event', message: error.message });
  }
});


// Create a new event
app.post('/events', async (req, res) => {
  const title = req.body.title ?? null;
  const eventDate = req.body.event_date ?? null;
  const basePriceCents = req.body.base_price_cents ?? 0;
  const venueId = req.body.venue_id ?? null;
  

  if (!title || !eventDate || !venueId) {
    return res.status(400).json({ error: 'invalid_payload', message: 'title, date, and venue_id are required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Get venue capacity to seed seat inventory (best-effort)
    const vres = await client.query('SELECT capacity FROM venues WHERE id = $1', [venueId]);
    console.log(`Venue capacity for venueId ${venueId}: ${vres.rowCount > 0 ? vres.rows[0].capacity : 'not found'}`);
    const capacity = vres.rowCount > 0 ? vres.rows[0].capacity : 0;
    
    const insertRes = await client.query(newEventSql, [venueId, title, eventDate, basePriceCents, capacity]);
    const eventId = insertRes.rows[0].id;
    await client.query(
      'INSERT INTO seat_inventory (event_id, section_name, total_seats, available_seats, price_cents) VALUES ($1, $2, $3, $4, $5)',
      [eventId, 'General', capacity, capacity, basePriceCents]
    );

    await client.query('COMMIT');

    // Return the canonical event representation
    const fresh = await pool.query(getEventByIdSql, [eventId]);
    if (fresh.rowCount === 0) {
      return res.status(500).json({ error: 'failed_to_fetch_event' });
    }

    const row = fresh.rows[0];
    const event = {
      id: String(row.id),
      title: row.title,
      venue: row.venue,
      date: row.event_date,
      currency: 'USD',
      basePriceCents: row.base_price_cents,
      seats_available: row.seats_available,
    };

    // Update cache with new value
    const cacheKey = `event:${eventId}`;
    try {
      await redis.set(cacheKey, JSON.stringify(event), { EX: 60 });
    } catch (err) {
      console.error('Failed to set redis cache for new event:', err.message);
    }

    return res.status(201).json({ source: 'database', event });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ error: 'failed_to_create_event', message: error.message });
  } finally {
    client.release();
  }
});

// Create a new venue
app.post('/venues', async (req, res) => {
  const name = req.body.name ?? null;
  const city = req.body.city ?? null;
  const rawCapacity = req.body.capacity;
  const capacity = Number(rawCapacity);

  if (!name || !city || !Number.isInteger(capacity) || capacity <= 0) {
    return res.status(400).json({
      error: 'invalid_payload',
      message: 'name, city, and positive integer capacity are required',
    });
  }

  try {
    const result = await pool.query(newVenueSql, [name, city, capacity]);
    const row = result.rows[0];

    const venue = {
      id: String(row.id),
      name: row.name,
      city: row.city,
      capacity: row.capacity,
    };

    return res.status(201).json({ source: 'database', venue });
  } catch (error) {
    return res.status(500).json({ error: 'failed_to_create_venue', message: error.message });
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
