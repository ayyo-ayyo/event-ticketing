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
  base_price_cents INTEGER NOT NULL DEFAULT 0 CHECK (base_price_cents >= 0)
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


-- Populating tables for k6 test
INSERT INTO venues (name, city, capacity) VALUES
('Venue 1', 'Amherst', 100),
('Venue 2', 'Amherst', 1000),
('Venue 3', 'Hadley', 50);

INSERT INTO events (venue_id, title, event_date, base_price_cents) VALUES
(1, 'Event 1', NOW(), 100),
(1, 'Event 2', NOW(), 1000),
(1, 'Event 3', NOW(), 500),
(1, 'Event 4', NOW(), 1499),
(2, 'Event 5', NOW(), 200),
(2, 'Event 6', NOW(), 550),
(2, 'Event 7', NOW(), 150),
(3, 'Event 8', NOW(), 300),
(3, 'Event 9', NOW(), 10000),
(3, 'Event 10', NOW(), 5000);

INSERT INTO seat_inventory (event_id, section_name, total_seats, available_seats, price_cents) VALUES
(1, 'Section A', 100, 50, 100),
(1, 'Section B', 1000, 500, 100),
(2, 'Section A', 10, 5, 100),
(3, 'Section A', 150, 54, 100),
(4, 'Section A', 105, 13, 100),
(5, 'Section C', 107, 107, 100),
(5, 'Section D', 110, 10, 100),
(6, 'Section E', 24, 3, 100),
(6, 'Section D', 1005, 0, 100),
(7, 'Section A', 1500, 150, 100),
(8, 'Section A', 2000, 20, 100),
(9, 'Section F', 40, 34, 100),
(9, 'Section G', 405, 400, 100),
(10, 'Section M', 50, 49, 100),
(10, 'Section A', 506, 50, 100);
