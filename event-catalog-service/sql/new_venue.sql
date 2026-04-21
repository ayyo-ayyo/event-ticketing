INSERT INTO venues (name, city, capacity)
VALUES ($1, $2, $3)
RETURNING id, name, city, capacity;
