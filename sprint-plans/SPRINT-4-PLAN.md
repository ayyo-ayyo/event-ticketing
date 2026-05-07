# Sprint 4 Plan — Group 9

**Sprint:** 4 — Replication, Scaling, and Polish  
**Dates:** 04.28 → 05.07  
**Written:** 04.28 in class

---

## Goal

[Which services will you replicate? What is the exact `--scale` command? What polish work remains?]

Still have to finish the analytics worker and the front-end, We're planning on replicating the three core services, event-catalog-service, ticket-purchase-service, and payment-service.

```bash
docker compose up --scale event-catalog-service=3 --scale ticket-purchase-service=3 --scale payment-service=3
```

We're also planning on doing the last of the k6 tests, and resolving dlq issues for the ticket purchase service

---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ------------------------------------- |
| Ayo      | `analytics-worker/` |
| Brian     | `purchase-service/` |
| Mateus     | `k6/sprint-4-replica.js` |
| Lucky     | `k6/sprint-4-scaling.js` |
| Sean     | `caddy/` |
| Maycol     | `ticket-purchase-service/` |
| Jimmy     | `index.html`, `purchase.html` |
| Derek     | `` |

---




## Tasks

### [Ayo]

- [ ] finish analytics worker

### [Brian]

- [ ] finish purchase screen

### [Maycol]

- [ ] resolving dlq issues for ticket purchase service

### [Sean]

- [ ] Caddy

### [Lucky]

 - [ ] k6 Scaling comparison test

### [Derek]

- [ ] Replication

### [Jimmy]

- [ ] connect frontends

### [Mateus]

- [ ] k6 Replica failure test

---

## Risks

---

## Definition of Done

`docker compose up --scale [service]=3` starts successfully. `docker compose ps` shows all replicas as `(healthy)`. k6 scaling comparison shows measurable improvement. Replica failure test shows no dropped requests.
