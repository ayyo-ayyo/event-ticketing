UPDATE metrics
SET
  total_tickets_sold = total_tickets_sold + $2,
  total_revenue_cents = total_revenue_cents + ($2 * $3),
  total_reads = total_reads + $4
WHERE event_id = $1