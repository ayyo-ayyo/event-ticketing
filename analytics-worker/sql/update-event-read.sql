INSERT INTO event_reads (event_id, time_window, reads)
VALUES ($1, DATE_BIN('15 minutes', $2, '2000-01-01'), 1)
ON CONFLICT (event_id, time_window) DO UPDATE SET reads = event_reads.reads + 1;

