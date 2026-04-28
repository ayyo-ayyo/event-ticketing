# Sprint 3 Report — [Team Name]

**Sprint:** 3 — Reliability and Poison Pills  
**Tag:** `sprint-3`  
**Submitted:** [date, before 04.28 class]

---

## What We Built
We added the k6 poison pills test, implemented the fraud worker w/ DLQ handling, started the analytics worker, has DLQ handling (untested/not working), when a poison pill is injected, the request heads straight to the DLQ of whatever worker it was injected into. Also started implementing a front-end, and making sure the system fails gracefully

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Ayo      | added metrics table, purchase and browse events are pushed to analytics queue, started code for worker to process them, DLQ implemented but not working yet | 88718283194958a0ddc63b87d9a4a639eea714cc |
| Jimmy Jiang | implement fraud detection worker, db, and dlq | 7ab67b1c6b995221d309482031f26052932c3038 |
| Lucky Kovvuri      |created payment service frontend user endpoint | 75333c65f7b9c865db01ff76ea94d32e61e03ffc |
| [Derek B]      | Added the k6 poison pill resilience test | 6c75a4fcff1ae48cb48a75e8dc63743231f97ccb |

---

## What Is Working

- [X] Poison pill handling: malformed messages go to DLQ, worker keeps running
- [X] Worker `GET /health` shows non-zero `dlq_depth` after poison pills are injected
- [X] Worker status remains `healthy` while DLQ fills
- [X] System handles failure scenarios gracefully (no dangling state, no crash loops)
- [X] All services/workers required for team size are implemented

---

## What Is Not Working / Cut
The analytics worker is not working yet
---

## Poison Pill Demonstration

How to inject a poison pill:

```bash
# From inside holmes:
docker compose exec holmes bash

# Example — publish a malformed message directly to the queue:
redis-cli -h redis RPUSH your-queue '{"this": "is malformed"}'
```

Worker health before injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 0,
  "last_job_at": "2025-04-24T..."
}
```

Worker health after injection:

```json
{
  "status": "healthy",
  "queue_depth": 0,
  "dlq_depth": 3,
  "last_job_at": "2025-04-24T..."
}
```

---

## k6 Results: Poison Pill Resilience (`k6/sprint-3-poison.js`)

```
[Paste k6 summary output here]
```

| Metric | Normal-only run | Mixed with poison pills | Change |
| ------ | --------------- | ----------------------- | ------ |
| p95    | | | |
| RPS    | | | |
| Error rate | | | |

[Explain: did throughput hold? Did the worker stay healthy throughout?]

---

## Blockers and Lessons Learned
While waiting for the the compose to rebuild between tests, it can be easy to get distracted, perhaps restarting individual containers for testing would be faster