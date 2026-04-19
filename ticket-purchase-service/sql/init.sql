CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  unit_ticket_cents INT NOT NULL,
  reservation_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
