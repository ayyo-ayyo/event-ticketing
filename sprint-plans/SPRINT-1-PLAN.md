# Sprint 1 Plan — Group 9

**Sprint:** 1 — Foundation  
**Dates:** 04.07 → 04.14  
**Written:** 04.07 in class

---

## Goal

We need to start our 3 core services, which are the event catalog service, ticket purchase service, and payment service. Those core services will each expose a GET /health endpoint as well as have a health-check directive in our docker-compose.yml. 
Each of those core services should connect to its own database, which is the event catalog database, and the purchase database. 
We will have our ticket purchase endpoint. A ticket service would then cause a ticket purchase service to initiate payment with 
the payment service. Then we will create a k6 script for the Event Catalog endpoint as our main read endpoint. Finally, we will explain how to start the system and our endpoints in the README.md.

---

## Ownership

| Team Member | Files / Directories Owned This Sprint           |
| ----------- | ----------------------------------------------- |
| [Name]      | `[service-dir]/`, `[service-dir]/db/schema.sql` |
| [Name]      | `[service-dir]/`, `compose.yml` additions       |
| [Name]      | `k6/sprint-1.js`, `[worker-dir]/`               |

Each person must have meaningful commits in the paths they claim. Ownership is verified by:

```bash
git log --author="Name" --oneline -- path/to/directory/
```

---

## Tasks

## [Derek]
- [ ] Create a `docker-compose.yml` which starts all core services and their databases
    - [ ] Each service has a healthcheck directive 
    - [ ] don't need to have a separate payment database, Payment service will use Ticket Purchase DB

## [Mateus]
- [ ] Start Event Catalog Service 
    - [ ] connect to Event Catalog DB
    - [ ] have a Redis container running and allow this service to connect to it
    - [ ] expose one working endpoint (can be placeholder data)
    - [ ] expose a `GET /health endpoint` 
## [Michael]    
- [ ] Start Ticket Purchase Service - connect to Ticket Purchase DB
    - [ ] connect to Ticket Purchase DB
    - [ ] expose one working endpoint (can be placeholder data)
    - [ ] expose a `GET /health endpoint`

## [Brian]     
- [ ] Start Payment Service
    - [ ] connect to Ticket Purchase DB (the DB should have payment information)
    - [ ] expose one working endpoint (can be placeholder data)
    - [ ] expose a `GET /health endpoint`

## [Jimmy]
- [ ] Ticket Purchase Service to Payment Service synchronous service-to-service HTTP call (to initiate payment after a purchase)

## [Sean]
- [ ] Ticket Purchase Service to Event Catalog synchronous service-to-service HTTP call (to reference event listings for purchase)

## [Ayo]
- [ ] Explain docker compose and available endpoints in `README.md`

## [Lucky]
- [ ] Write a k6 test script that sends traffic to event catalog endpoint as a baseline measurement
    - [ ] Include output in sprint report

---

## Risks

[What could go wrong? What are you uncertain about? What will you do if a task takes longer than expected?]

There are some risks in the first sprint for our event ticketing platform. Although most of the tasks themselves are relatively straightforward, there are some time constraints, especially because we didn't really start the project until the Thursday class.
The main issue is that some of the tasks, like the HTTP calls, require other tasks to be finished beforehand. So, if these tasks, like the main services, aren't finished the downstream tasks can't be completed. However, if any of the group members are having trouble with their task, the rest of the group will be ready to help them out.

---

## Definition of Done

A TA can clone this repo, check out `sprint-1`, run `docker compose up`, and:

- `docker compose ps` shows every service as `(healthy)`
- `GET /health` on each service returns `200` with DB and Redis status
- The synchronous service-to-service call works end-to-end
- k6 baseline results are included in `SPRINT-1.md`
