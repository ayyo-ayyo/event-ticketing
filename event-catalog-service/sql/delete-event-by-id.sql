WITH deleted_inventory AS (
	DELETE FROM seat_inventory
	WHERE event_id = $1
)
DELETE FROM events
WHERE id = $1
RETURNING id;
