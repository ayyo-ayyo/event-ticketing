CREATE TABLE IF NOT EXISTS venues (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0)
);

CREATE TABLE IF NOT EXISTS events (
  id SERIAL PRIMARY KEY,
  venue_id INTEGER NOT NULL REFERENCES venues(id),
  title TEXT NOT NULL,
  event_date TIMESTAMPTZ NOT NULL,
  base_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0),
  seats_available INTEGER NOT NULL DEFAULT 0 CHECK (seats_available >= 0)
);

CREATE TABLE IF NOT EXISTS seat_inventory (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES events(id),
  section_name TEXT NOT NULL,
  total_seats INTEGER NOT NULL CHECK (total_seats >= 0),
  available_seats INTEGER NOT NULL CHECK (available_seats >= 0),
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0)
);

-- Keep compatibility for DBs created before pricing columns were added.
ALTER TABLE events
ADD COLUMN IF NOT EXISTS base_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0);

ALTER TABLE seat_inventory
ADD COLUMN IF NOT EXISTS price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0);
