-- purchase_patterns: rolling record used for pattern analysis
-- Each confirmed purchase is recorded here by the fraud worker.
CREATE TABLE IF NOT EXISTS purchase_patterns (
  id          SERIAL PRIMARY KEY,
  purchase_id INT          NOT NULL,
  user_id     VARCHAR(255) NOT NULL,
  event_id    VARCHAR(255) NOT NULL,
  payment_token VARCHAR(255) NOT NULL,
  recorded_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_patterns_user_recorded
  ON purchase_patterns (user_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_patterns_token_recorded
  ON purchase_patterns (payment_token, recorded_at DESC);

-- fraud_flags: one row per flagged purchase
CREATE TABLE IF NOT EXISTS fraud_flags (
  id          SERIAL PRIMARY KEY,
  purchase_id INT          NOT NULL,
  user_id     VARCHAR(255) NOT NULL,
  event_id    VARCHAR(255) NOT NULL,
  reason      VARCHAR(255) NOT NULL,
  flagged_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_flags_user
  ON fraud_flags (user_id, flagged_at DESC);
