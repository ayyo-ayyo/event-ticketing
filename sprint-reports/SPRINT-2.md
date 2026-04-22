# Sprint 2 Report — Group 9

**Sprint:** 2 — Async Pipelines and Caching  
**Tag:** `sprint-2`  
**Submitted:** 04.21

---

## What We Built

We added a cache to the event catalog service/database. We added the wait list queue and wait list worker, which is our async pipeline that promotes previously invalid purchases when another user has a cancelled or failed purchase. 

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Ayo         | ticket-purchase-service now pushes unfulfillable orders to the waitlist, and adjusts seat # in database based on ticket quantity POST, PUT, and DELETE endpoints for events, POST endpoint for venues      | 75f676c5f196c0d210a54024f46e3ff24030ed90, a70d3f448c04ee001f83c8c77787205cbf2c6637 | 
| [Name]      | | |
| [Name]      | | |
| [Name]      | | |
| Mateus M    | switched the database query tosql folder and added get event by id and now cache pulls data from the data base and not fake data
| Maycol M    | updated the idempotency key to be set in the headers, and fixed a race condition, now inserts first and then checks using sql unique constraints
| Sean R      | k6 tests + report, http timeout, fetchEvent() | 6090f7818957393c5e81fc46bbe9210ee397a6c1, 2d98cca208f42ff458623916d08f05f057f3fbb0, 47b3996e0f687a9f6703243230a7b72e3bcc7ce7|
| Jimmy J | implement notification service/worker, health endpoint, worker logs | f4c4aae5070f9245bd36936dce6bab70393ddb41 |

---

## What Is Working

- [X] Redis cache in use — repeated reads do not hit the database
- [] Async pipeline works end-to-end (message published → worker consumes → action taken)
- [X] At least one write path is idempotent (same request twice produces same result)
- [X] Worker logs show pipeline activity in `docker compose logs`
- [X] Worker `GET /health` returns queue depth, DLQ depth, and last-job-at

---

## What Is Not Working / Cut
Nothing that we built isn't working, but we haven't tested the async pipeline yet. 
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
| Metric | Sprint 2 Async    |
| ------ | ----------------- |
| p50    | 13.31 ms          |
| p95    | 19.1 ms           |
| p99    | 22.33 ms          |
| RPS    | 53.0239/s         |
```

Worker health during the burst (hit `/health` while k6 is running):

```json
    {"status":"healthy",
    "service":"waitlist-worker",
    "queueDepth":0,
    "dlqDepth":0,
    "lastProcessedAt":null}
```
Although the waitlist-worker is healthy it hasn't been connected to the queue yet because the Async pipeline is not complete right now.

Idempotency check: 
Using curl to post an entry to the ticket purchasing system:
$ curl -X POST http://ticket-purchase-service:3002/purchases \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "eventId": 2,
    "quantity": 1,
    "unitTicketCents": 5000,
    "idempotencyKey": "key1"
  }'

Response: "message":"Purchase created and payment processed", ... 
"status":"success","purchaseId":475,"message":"Payment processed"


Repeating the same post entry or changing the other values but keeping the same idempotency key should result in a decline due to duplicates. Doing this, the result is:


Response" "message":"Duplicate request detected, returning existing purchase"


So, we get the same response from sending the same idempotency key, even when changing other values. This is how the implementation of idempotency should be working.

---

## Blockers and Lessons Learned
Some of us got started on our tasks somewhat late, and we underestimated how long they would take, so from here on out we definitely want to start our tasks sooner. 
