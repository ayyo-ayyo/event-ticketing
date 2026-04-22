SELECT
  e.id,
  e.title,
  e.event_date,
  e.base_price_cents,
  v.name AS venue,
  e.seats_available
FROM events e
JOIN venues v ON v.id = e.venue_id
LEFT JOIN seat_inventory si ON si.event_id = e.id
WHERE e.id = $1
GROUP BY e.id, e.title, e.event_date, e.base_price_cents, v.name;
