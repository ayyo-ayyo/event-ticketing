# Sprint 4 Report — Group 9

**Sprint:** 4 — Replication, Scaling, and Polish  
**Tag:** `sprint-4`  
**Submitted:** [date, before 05.05 class]

---

## What We Built

[Which services are replicated? How does load balancing work? What polish work was completed?]

---

## Individual Contributions

| Team Member | What They Delivered | Key Commits |
| ----------- | ------------------- | ----------- |
| Ayo      | analytics service | 965bc0ff0c49632626e4703a0e22736e7e6c8403, 9d324d504d48e0aaf6adea724a8959dc636f83a1 |
| [Name]      | | |
| [Name]      | | |

---

## Starting the System with Replicas

```bash
docker compose up --scale [service-name]=3 --scale [other-service]=2
```

After startup:

```
[Paste docker compose ps output here showing all replicas as (healthy)]
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
