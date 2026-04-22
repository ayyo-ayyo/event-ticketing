INSERT INTO events (venue_id, title, event_date, base_price_cents, seats_available)
VALUES ($1, $2, $3, $4, $5)
RETURNING id;
