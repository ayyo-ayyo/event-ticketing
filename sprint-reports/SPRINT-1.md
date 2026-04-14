# Sprint 1 Report — Group 9

**Sprint:** 1 — Foundation  
**Tag:** `sprint-1`  
**Submitted:** [date, before 04.14 class]

---

## What We Built

[One or two paragraphs. What is running? What does `docker compose up` produce? What endpoints are live?]

---

## Individual Contributions

| Team Member | What They Delivered                                     | Key Commits            |
| ----------- | ------------------------------------------------------- | ---------------------- |
| Lucky K      | Customized k6 load test script and added synthesized baseline results into Sprint 1 Report    | [short SHA or PR link] |
| [Name]      | [e.g. restaurant-service, synchronous call integration] |                        |
| Sean R      | Completed service to service HTTP call from Ticket Purchasing service to Event Catalog Service | 27169c833d36aae729a48b9df60346d68834113f |
| Maycol M      | Finish setting the ticket purshcase service and made db for it           |     5dcf088a81be18773fa7281984e8c26e1cabd49e, and 1beb13e7a1f92d34073a39de9840465d604623ef                   |

| Mateus      | Event Catalog service foundation: Postgres schema bootstrap (`venues`, `events`, `seat_inventory`), Redis integration, `GET /health`, and working `GET /events/:id` endpoint with cache-first behavior |                        |

Verify with:

```bash
git log --author="Name" --oneline -- path/to/directory/

```

---

## What Is Working

- [ ] `docker compose up` starts all services without errors
- [ ] `docker compose ps` shows every service as `(healthy)`
- [ ] `GET /health` on every service returns `200` with DB and Redis status
- [ ] At least one synchronous service-to-service call works end-to-end
- [ ] k6 baseline test runs successfully

---

## What Is Not Working / Cut

[Be honest. What did you not finish? What did you cut from the sprint plan and why? How will you address it in Sprint 2?]

---

## k6 Baseline Results

Script: `k6/sprint-1.js`  
Run: `docker compose exec holmes k6 run /workspace/k6/sprint-1.js`

```

  █ THRESHOLDS 

    errors
    ✓ 'rate<0.01' rate=0.00%

    http_req_duration
    ✓ 'p(95)<500' p(95)=6ms


  █ TOTAL RESULTS 

    checks_total.......: 3998    56.869876/s
    checks_succeeded...: 100.00% 3998 out of 3998
    checks_failed......: 0.00%   0 out of 3998

    ✓ status is 200
    ✓ response time < 500ms

    CUSTOM
    errors.........................: 0.00%  0 out of 1999

    HTTP
    http_req_duration..............: avg=3.45ms   min=497.37µs med=3.25ms   max=22.76ms  p(90)=5.03ms   p(95)=6ms     
      { expected_response:true }...: avg=3.45ms   min=497.37µs med=3.25ms   max=22.76ms  p(90)=5.03ms   p(95)=6ms     
    http_req_failed................: 0.00%  0 out of 1999
    http_reqs......................: 1999   28.434938/s

    EXECUTION
    iteration_duration.............: avg=505.45ms min=500.76ms med=505.09ms max=526.92ms p(90)=508.32ms p(95)=509.18ms
    iterations.....................: 1999   28.434938/s
    vus............................: 1      min=1         max=20
    vus_max........................: 20     min=20        max=20

    NETWORK
    data_received..................: 840 kB 12 kB/s
    data_sent......................: 184 kB 2.6 kB/s




running (1m10.3s), 00/20 VUs, 1999 complete and 0 interrupted iterations
default ✓ [============================] 00/20 VUs  1m10s
```

| Metric             | Value |
| ------------------ | ----- |
| p50 response time  |  3.25 ms     |
| p95 response time  |  6 ms     |
| p99 response time  |       |
| Requests/sec (avg) |    28.4349   |
| Error rate         |   0%    |

These numbers are your baseline. Sprint 2 caching should improve them measurably.

---

## Blockers and Lessons Learned

[What slowed you down? What would you do differently? What surprised you?]
