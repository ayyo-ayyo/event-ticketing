CREATE TABLE IF NOT EXISTS metrics (
  event_id INTEGER PRIMARY KEY,
  total_tickets_sold INTEGER NOT NULL DEFAULT 0 CHECK (total_tickets_sold >= 0),
  total_revenue_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_revenue_cents >= 0),
  total_reads INTEGER NOT NULL DEFAULT 0 CHECK (total_reads >= 0)
);