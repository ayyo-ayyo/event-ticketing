INSERT INTO metrics (event_id, total_tickets_sold, total_revenue_cents, total_reads)
VALUES ($1, $2, $2 * $3, $4)
ON CONFLICT (event_id) DO UPDATE
SET
  total_tickets_sold = metrics.total_tickets_sold + $2,
  total_revenue_cents = metrics.total_revenue_cents + ($2 * $3),
  total_reads = metrics.total_reads + $4;