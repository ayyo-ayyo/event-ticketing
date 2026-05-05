CREATE TABLE IF NOT EXISTS event_reads_$1 (
  time_window TIMESTAMPTZ NOT NULL,
  reads INTEGER NOT NULL DEFAULT 0 CHECK (reads >= 0),
  PRIMARY KEY (time_window)
);

INSERT INTO event_reads_$1 (time_window, reads)
VALUES (DATE_BIN('15 minutes', $2, '2000-01-01'), 1)
ON CONFLICT (time_window) DO UPDATE SET reads = reads + 1;

SELECT * FROM event_reads_$1 ORDER BY reads;

