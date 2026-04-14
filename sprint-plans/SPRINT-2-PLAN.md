# Sprint 2 Plan — [Team Name]

**Sprint:** 2 — Async Pipelines and Caching  
**Dates:** 04.14 → 04.21  
**Written:** 04.14 in class

---

## Goal

[What will your team have working by end of sprint? Name the specific cache, queue, and worker you are adding.]
- Cache event details for event catalog
- Make Ticket Purchase idempotent
- Make Payment idempotent 
Get some of our workers and services running:
- Notification Service/Worker - also expose a GET /health endpoint that includes the current queue depth, the dead letter queue depth, and the timestamp of the last successfully processed job.
- Waitlist Worker - exposes GET /health endpoint that includes the current queue depth, the dead letter queue depth, and the timestamp of the last successfully processed job.
- Refund Service

- Async pipeline - a service pushes a message onto a Redis queue or pub/sub channel, and a worker consumes it and does something useful: Ticket Purchase Service pushes message onto Redis queue about waitlist entries, Waitlist Worker consumes it and When a ticket is released (cancellation or payment failure), the worker promotes the next waitlisted user and publishes a purchase event. Must handle poison pills — a malformed waitlist entry should be moved to a dead letter queue, not retried forever.

- and workers log their activities

- k6 load test cache
- k6 load test async
- README 
---

## Ownership

| Team Member | Files / Directories Owned This Sprint |
| ----------- | ------------------------------------- |
| [Name]      | `[path]` |
| [Name]      | `[path]` |
| [Name]      | `[path]` |

---

## Tasks

### [Name]

- [ ] Cache event details for event catalog

### [Name]

- [ ] Make Ticket Purchase idempotent

### [Name]

- [ ] Make Payment idempotent

### [Name]

- [ ] Get Notification Service/Worker running
    - [ ] also expose a GET /health endpoint that includes the current queue depth, the dead letter queue depth, and the timestamp of the last successfully processed job.
    - [ ] Workers log what they are doing so a TA can see the pipeline in action in the Docker Compose logs

### [Name]

- [ ] Waitlist Worker 
    - [ ] exposes GET /health endpoint that includes the current queue depth, the dead letter queue depth, and the timestamp of the last successfully processed job.
    - [ ] Workers log what they are doing so a TA can see the pipeline in action in the Docker Compose logs

### [Name]

- [ ] Refund Service 

### [Name]

- [ ] Async pipeline: Ticket Purchase Service pushes message onto Redis queue about waitlist entries, Waitlist Worker consumes it
    - [ ] When a ticket is released (cancellation or payment failure), the worker promotes the next waitlisted user and publishes a purchase event. Must handle poison pills — a malformed waitlist entry should be moved to a dead letter queue, not retried forever.

### [Name]

- [ ] k6 load test async
- [ ] k6 load test cache    

### [Name]

- [ ] README

---

## Risks

---

## Definition of Done

A TA can trigger an action, watch the queue flow in Docker Compose logs, hit the worker's `/health` to see queue depth and last-job-at, and review k6 results showing the caching improvement.
