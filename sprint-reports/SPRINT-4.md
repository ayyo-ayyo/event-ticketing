# Sprint 4 Report — Group 9

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** [date, before 05.07 class]

---

## What We Built

The 3 core services event-catalog-service, ticket-purchase-service and payment-service are replicated.

Using caddy, the repllicas successfully distribute the load evenly

There was also lots of polish to the DLQs and the refund service revolving around seats available among other fixes
[Which services are replicated? How does load balancing work? What polish work was completed?]

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Ayo      | analytics service | 965bc0ff0c49632626e4703a0e22736e7e6c8403, 9d324d504d48e0aaf6adea724a8959dc636f83a1 |
| Sean R  | Caddy to core services | f7d99c5db2e416ee635c93ef6921e4f7281ebfd2 |
| Derek B | Fixed seats available and tested replicas with --scale command | 869fd114c060f846342d6415f98dda85713ada22 |
| Mateus A |Made K6 replica test | 2dd294629a33c11da8004c79b27a4c20a44ed2e4 |
| Maycol M | DLQ for tps | 676315d5cc6dcd11f6e01350d0c32065de430859 | fa00dca419f3e34532a296ed088c5621145f2935 | a6aff7502077232b4aebdc7828052dbd0c67f0ef | 36618d6f067979a36f505335687f5838b119b7af |
---

## Starting the System with Replicas

```bash
docker compose up --scale [service-name]=3 --scale [other-service]=2
```

After startup:

```
NAME                                        IMAGE                                     COMMAND                  SERVICE                   CREATED          STATUS                    PORTS
event-catalog-db                            postgres:16                               "docker-entrypoint.s…"   event-catalog-db          43 seconds ago   Up 41 seconds (healthy)   5432/tcp
event-ticketing-caddy-1                     caddy:2-alpine                            "caddy run --config …"   caddy                     42 seconds ago   Up 27 seconds             0.0.0.0:8080->80/tcp, [::]:8080->80/tcp
event-ticketing-event-catalog-service-1     event-ticketing-event-catalog-service     "docker-entrypoint.s…"   event-catalog-service     42 seconds ago   Up 34 seconds (healthy)   3001/tcp
event-ticketing-event-catalog-service-2     event-ticketing-event-catalog-service     "docker-entrypoint.s…"   event-catalog-service     42 seconds ago   Up 34 seconds (healthy)   3001/tcp
event-ticketing-event-catalog-service-3     event-ticketing-event-catalog-service     "docker-entrypoint.s…"   event-catalog-service     42 seconds ago   Up 34 seconds (healthy)   3001/tcp
event-ticketing-payment-service-1           event-ticketing-payment-service           "docker-entrypoint.s…"   payment-service           42 seconds ago   Up 34 seconds (healthy)   3003/tcp
event-ticketing-payment-service-2           event-ticketing-payment-service           "docker-entrypoint.s…"   payment-service           42 seconds ago   Up 35 seconds (healthy)   3003/tcp
event-ticketing-payment-service-3           event-ticketing-payment-service           "docker-entrypoint.s…"   payment-service           42 seconds ago   Up 34 seconds (healthy)   3003/tcp
event-ticketing-ticket-purchase-service-1   event-ticketing-ticket-purchase-service   "docker-entrypoint.s…"   ticket-purchase-service   42 seconds ago   Up 28 seconds (healthy)   3002/tcp
event-ticketing-ticket-purchase-service-2   event-ticketing-ticket-purchase-service   "docker-entrypoint.s…"   ticket-purchase-service   42 seconds ago   Up 28 seconds (healthy)   3002/tcp
event-ticketing-ticket-purchase-service-3   event-ticketing-ticket-purchase-service   "docker-entrypoint.s…"   ticket-purchase-service   42 seconds ago   Up 27 seconds (healthy)   3002/tcp
fraud-db                                    postgres:16                               "docker-entrypoint.s…"   fraud-db                  43 seconds ago   Up 41 seconds (healthy)   5432/tcp
fraud-detection-worker                      event-ticketing-fraud-detection-worker    "docker-entrypoint.s…"   fraud-detection-worker    42 seconds ago   Up 34 seconds (healthy)   0.0.0.0:3007->3007/tcp, [::]:3007->3007/tcp
holmes                                      event-ticketing-holmes                    "sleep infinity"         holmes                    43 seconds ago   Up 41 seconds             
notification-service                        event-ticketing-notification-service      "docker-entrypoint.s…"   notification-service      42 seconds ago   Up 35 seconds (healthy)   0.0.0.0:3004->3004/tcp, [::]:3004->3004/tcp
purchase-db                                 postgres:16                               "docker-entrypoint.s…"   purchase-db               43 seconds ago   Up 41 seconds (healthy)   5432/tcp
redis                                       redis:7                                   "docker-entrypoint.s…"   redis                     43 seconds ago   Up 41 seconds (healthy)   6379/tcp
refund-service                              event-ticketing-refund-service            "docker-entrypoint.s…"   refund-service            42 seconds ago   Up 22 seconds (healthy)   0.0.0.0:3006->3006/tcp, [::]:3006->3006/tcp
refund-service-db                           postgres:16                               "docker-entrypoint.s…"   refund-service-db         43 seconds ago   Up 41 seconds (healthy)   5432/tcp
waitlist-worker                             event-ticketing-waitlist-worker           "docker-entrypoint.s…"   waitlist-worker           42 seconds ago   Up 22 seconds (healthy)   0.0.0.0:3005->3005/tcp, [::]:3005->3005/tcp
```

---

## What Is Working

- [ ] At least [N] services replicated via `--scale`
- [ ] Load balancer distributes traffic across replicas (visible in logs)
- [ ] Services are stateless — multiple instances run without conflicts
- [ ] `docker compose ps` shows all replicas as `(healthy)`
- [ ] System is fully complete for team size

---

## What Is Not Working / Cut

---

## k6 Results

### Test 1: Scaling Comparison (`k6/sprint-4-scale.js`)
 THRESHOLDS 

    http_req_duration
    ✓ 'p(50)<500' p(50)=4.61ms
    ✓ 'p(95)<500' p(95)=25.09ms
    ✓ 'p(99)<1000' p(99)=73.58ms

    http_req_failed
    ✓ 'rate<0.10' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 29568  367.114322/s
    checks_succeeded...: 99.92% 29547 out of 29568
    checks_failed......: 0.07%  21 out of 29568

    ✓ status is 200
    ✓ response time < 500ms
    ✗ from the cache
      ↳  99% — ✓ 9835 / ✗ 21

    CUSTOM
    errors.........................: 0.21%  21 out of 9856

    HTTP
    http_req_duration..............: avg=8.22ms   min=477.79µs med=4.61ms   max=143.66ms p(90)=17.07ms  p(95)=25.09ms 
      { expected_response:true }...: avg=8.22ms   min=477.79µs med=4.61ms   max=143.66ms p(90)=17.07ms  p(95)=25.09ms 
    http_req_failed................: 0.00%  0 out of 9866
    http_reqs......................: 9866   122.4956/s

    EXECUTION
    iteration_duration.............: avg=509.83ms min=500.66ms med=506.23ms max=646.69ms p(90)=519.21ms p(95)=527.53ms
    iterations.....................: 9856   122.371441/s
    vus............................: 2      min=2          max=100
    vus_max........................: 100    min=100        max=100

    NETWORK
    data_received..................: 4.0 MB 49 kB/s
    data_sent......................: 928 kB 12 kB/s



3 REPLICAS
  █ THRESHOLDS 

    http_req_duration
    ✓ 'p(50)<500' p(50)=3.25ms
    ✓ 'p(95)<500' p(95)=18.22ms
    ✓ 'p(99)<1000' p(99)=45.42ms

    http_req_failed
    ✓ 'rate<0.10' rate=0.00%


  █ TOTAL RESULTS 

    checks_total.......: 29709  370.381609/s
    checks_succeeded...: 99.79% 29647 out of 29709
    checks_failed......: 0.20%  62 out of 29709

    ✓ status is 200
    ✓ response time < 500ms
    ✗ from the cache
      ↳  99% — ✓ 9841 / ✗ 62

    CUSTOM
    errors.........................: 0.62%  62 out of 9903

    HTTP
    http_req_duration..............: avg=6ms      min=463.62µs med=3.25ms   max=175.93ms p(90)=11.65ms  p(95)=18.22ms
      { expected_response:true }...: avg=6ms      min=463.62µs med=3.25ms   max=175.93ms p(90)=11.65ms  p(95)=18.22ms
    http_req_failed................: 0.00%  0 out of 9913
    http_reqs......................: 9913   123.585206/s

    EXECUTION
    iteration_duration.............: avg=507.52ms min=500.68ms med=504.71ms max=676.68ms p(90)=514.17ms p(95)=520.8ms
    iterations.....................: 9903   123.460536/s
    vus............................: 2      min=2          max=100
    vus_max........................: 100    min=100        max=100

    NETWORK
    data_received..................: 4.0 MB 50 kB/s
    data_sent......................: 933 kB 12 kB/s



| Metric | 1 replica | 3 replicas | Change |
| ------ | --------- | ---------- | ------ |
| p50    | 4.61ms|3.25ms| 29% faster|
| p95    | 25.09ms|18.22ms | 27% faster|
| p99    | 73.58ms|45.42ms | 38% faster |
| RPS    | 122.4956/s | 123.585206/s|1% increase |

[Explain the improvement. Which replica count started to show diminishing returns?]
The response times improved meaningfully across all percentiles, especially at p99 which means the worst case requests got much faster. This makes sense because with 3 replicas the load is spread across three instances so no single instance gets overwhelmed. However we can see that the RPS didn't really change much, because after caching the database through Redis in Sprint 2, scaling from 1 to 3 replicas horizontally has diminishing returns on this endpoint. This is because the cache is handling the load efficiently, and so the bottleneck for RPS is not the number of service instances. 

### Test 2: Replica Failure (`k6/sprint-4-replica.js`)

Timeline:

| Time | Event |
| ---- | ----- |
| 0s   | k6 started, 3 replicas running |
| [t]s | Killed replica: `docker stop [container-id]` |
| [t]s | Surviving replicas absorbed traffic |
| [t]s | Replica restarted: `docker compose up -d` |
| [t]s | Traffic redistributed, back to normal |

```
[Paste k6 output showing before / during / after the failure — annotate with timestamps]
```

During failure — `docker compose ps`:

```
[Paste output showing stopped/unhealthy replica alongside healthy survivors]
```

After restart — `docker compose ps`:

```
[Paste output showing all replicas back to (healthy)]
```

---

## Blockers and Lessons Learned

