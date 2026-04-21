
UPDATE events
SET
	title = COALESCE(NULLIF($2, ''), title),
	event_date = COALESCE($3, event_date),
	base_price_cents = COALESCE($4, base_price_cents),
	venue_id = COALESCE($5, venue_id),
	seats_available = COALESCE($6, seats_available)
WHERE id = $1
RETURNING id;

