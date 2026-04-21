# Sprint 2 Report — [Team Name]

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** [date, before 04.21 class]

---

## What We Built

[What cache did you add? What queue and worker are running? What does the async pipeline do?]

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| [Name]      | | |
| [Name]      | | |
| [Name]      | | |
| [Sean]      | k6 tests + Http timeout|  |

---

## What Is Working

- [ ] Redis cache in use — repeated reads do not hit the database
- [ ] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [ ] At least one write path is idempotent (same request twice produces same result)
- [ ] Worker logs show pipeline activity in `docker compose logs`
- [ ] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Caching Comparison (`k6/sprint-2-cache.js`)

| Metric | Sprint 1 Baseline | Sprint 2 Cached | Change    |
| ------ | ----------------- | --------------- | ------    |
| p50    | 3.25 ms           | 1.29 ms         | -1.96 ms  |
| p95    | 6 ms              | 2.02 ms         | -3.98 ms  |
| p99    | N/A               | 2.67 ms         | N/A       |
| RPS    | 28.4349/s         | 128.05059/s     | +99.616/s |

The numbers improved by a good amount. This is because the memory lookup with the implemented cache is a lot quicker than in sprint 1, which used database queries.
The VUs were also changed between Sprint 1 and Sprint 2, from 20 to 100. Although this added more concurrency, the new system still is more efficient with the the implementation of the cache-based calls compared to the database queries.

### Test 2: Async Pipeline Burst (`k6/sprint-2-async.js`)

```
[Paste k6 summary output here]
```

Worker health during the burst (hit `/health` while k6 is running):

```json
[Paste an example health response showing non-zero queue depth]
```

Idempotency check: [Describe what you sent and what happened when you sent the same idempotency key twice.]

---

## Blockers and Lessons Learned
