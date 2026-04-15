# Sprint 1 Report — Group 9

**Sprint:** 1 — Foundation  
**Tag:** `sprint-1`  
**Submitted:** [date, before 04.14 class]

---

## What We Built

We've laid the foundation of the three core services of the event ticketing app, the ticket purchase service, the event catalog service and the payment service. Each core service has a `GET /health` endpoint and another endpoint unique to it, `POST /purchases` (to create new purchases) for the ticket purchase service, `GET /events/:id` for the event catalog service, and `POST /payments` (to process purchases) for the payment service. There is also a test route `GET /info` on the event catalog services that the ticket purchase service calls to test cross-service connection, there's also a call from the ticket purchase service to the payment service for the route `POST /payments` for a similar purpose.

---

## Individual Contributions

| Team Member | What They Delivered                                     | Key Commits            |
| ----------- | ------------------------------------------------------- | ---------------------- |
| Lucky K      | Customized k6 load test script and added synthesized baseline results into Sprint 1 Report    | 21e0942 |
| Jimmy J | Implemented synchronous service call from ticket purchase service to payment service | 20efa35b1bec690849c37d2be82d98e7a54bb6bf |
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

- [X] `docker compose up` starts all services without errors
- [X] `docker compose ps` shows every service as `(healthy)`
- [X] `GET /health` on every service returns `200` with DB and Redis status
- [X] At least one synchronous service-to-service call works end-to-end
- [X] k6 baseline test runs successfully

---

## What Is Not Working / Cut

We did everything that we wanted to do in this sprint

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

Definitely should try to split tasks so everyone can code, and document their own stuff, even if everyone can't work on a core service. We also want to try to make sure we know which tasks depend on other beforehand
