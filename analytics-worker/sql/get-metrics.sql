SELECT
    m.event_id,
    m.total_tickets_sold,
    m.total_revenue_cents,
    m.total_reads 
FROM metrics m
WHERE m.event_id = $1;