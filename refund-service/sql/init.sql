CREATE TABLE IF NOT EXISTS refunds(
  id SERIAL PRIMARY KEY, 
  purchase_id INT NOT NULL, 
  user_id VARCHAR(255) NOT NULL,
  event_id VARCHAR(255) NOT NULL,
  quantity INT NOT NULL DEFAULT 1, 
  refund_amount_cents INT NOT NULL, 
  payment_status VARCHAR(50) NOT NULL DEFAULT 'pending',
  idempotency_key VARCHAR(255) UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);