# Group 9 — Event Ticketing

**Course:** COMPSCI 426  
**Team:** Derek Barbosa, Sean Rodgers, Jimmy Jiang, Brian Nguyen, Maycol Meza, Mateus Andrade, Ayomide Olubanwo, Lucky Kovvuri 
**System:** Event Ticketing
**Repository:** GitHub URL — public fork of https://github.com/ayyo-ayyo/event-ticketing.git

---

## Team and Service Ownership

| Team Member | Services / Components Owned                            |
| ----------- | ------------------------------------------------------ |
| [Name]      | [e.g. `order-service/`, `order-service/db/schema.sql`] |
| [Name]      | [e.g. `restaurant-service/`, `redis/menu-cache`]       |
| [Name]      | [e.g. `dispatch-worker/`, `k6/`]                       |

> Ownership is verified by `git log --author`. Each person must have meaningful commits in the directories they claim.

---

## How to Start the System

```bash
# Start everything (builds images on first run)
docker compose up --build

# Start with service replicas (Sprint 4)
docker compose up --scale your-service=3

# Verify all services are healthy
docker compose ps

# Stream logs
docker compose logs -f

# Open a shell in the holmes investigation container
docker compose exec holmes bash
```

### Base URLs (development)

```
event-catalog-service  http://localhost:3003
ticket-purchase-service http://localhost:3002
payment-service http://localhost:3001
holmes                 (no port — access via exec)
```

> From inside holmes, services are reachable by name:
> `curl http://your-service:3000/health`
>
> See [holmes/README.md](holmes/README.md) for a full tool reference.

---

## System Overview

[One paragraph describing what your system does and how the services interact.
Include which service calls which, what queues exist, and how data flows.]

---

## API Reference

<!--
  Document every endpoint for every service.
  Follow the format described in the project documentation: compact code block notation, then an example curl and an example response. Add a level-2 heading per service, level-3 per endpoint.
-->

---

### [Service Name]

### Event Catalog Service

### GET /health

```
GET /health

  Returns the health status of this service and its dependencies.

  Responses:
    200  Service and all dependencies healthy
    503  One or more dependencies unreachable
```

**Example request:**

```bash
curl http://localhost:3003/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "db": "ok",
  "redis": "ok"
}
```

**Example response (503):**

```json
{
  "status": "unhealthy",
  "db": "ok",
  "redis": "error: connection refused"
}
```

### GET /events/:id

```
GET /events/:id

  Returns one event by id.
  Uses Redis cache for hot reads and falls back to placeholder data.

  Responses:
    200  Event payload returned
```

**Example request:**

```bash
curl http://localhost:3003/events/1
```

**Example response (200):**

```json
{
  "source": "placeholder",
  "event": {
    "id": "1",
    "title": "Placeholder Concert",
    "venue": "Downtown Arena",
    "date": "2026-10-31T20:00:00Z",
    "seatsAvailable": 240
  }
}
```

---

<!-- Add the rest of your endpoints below. One ### section per endpoint. -->


---

### Event Catalog Service

### GET /health

```
GET /health

  Returns the health status of this service and its dependencies (Postgres and Redis).

  Responses:
    200  Service and all dependencies healthy
    503  One or more dependencies unreachable
```

**Example request:**

```bash
curl http://localhost:3003/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "db": "ok",
  "redis": "ok"
}
```

**Example response (503):**

```json
{
  "status": "unhealthy",
  "db": "ok",
  "redis": "error: connect ECONNREFUSED"
}
```

### GET /events/:id

```
GET /events/:id

  Returns one event by id. Attempts to read from Redis cache and falls back
  to placeholder event data (until DB-backed listing is implemented).

  Responses:
    200  Event payload returned (source: cache | placeholder)
    500  Failed to fetch event
```

**Example request:**

```bash
curl http://localhost:3003/events/1
```

**Example response (placeholder, 200):**

```json
{
  "source": "placeholder",
  "event": {
    "id": "1",
    "title": "Placeholder Concert",
    "venue": "Downtown Arena",
    "date": "2026-10-31T20:00:00Z",
    "currency": "USD",
    "basePriceCents": 6500,
    "seatsAvailable": 240
  }
}
```

### GET /info

```
GET /info

  Simple service-to-service health/info endpoint used by other services
  to verify connectivity.

  Responses:
    200  Returns a short JSON message
```

**Example request:**

```bash
curl http://localhost:3003/info
```

**Example response (200):**

```json
{ "message": "Message from Event Catalog Service" }
```

---

### Ticket Purchase Service

### GET /

```
GET /

  Basic service info endpoint.

  Responses:
    200  Service information
```

**Example request:**

```bash
curl http://localhost:3002/
```

**Example response (200):**

```json
{
  "service": "ticket-purchase-service",
  "message": "running"
}
```

### GET /health

```
GET /health

  Returns health status for Postgres and Redis used by this service.

  Responses:
    200  Service and dependencies healthy
    503  One or more dependencies unreachable
```

**Example request:**

```bash
curl http://localhost:3002/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "ticket-purchase-service",
  "database": "up",
  "redis": "up"
}
```

### POST /purchases

```
POST /purchases

  Creates a purchase reservation and synchronously calls the Payment Service
  to process payment. Requires idempotency by `idempotencyKey`.

  Body (JSON):
    userId: string
    eventId: string
    quantity: integer
    unitTicketCents: integer
    idempotencyKey: string

  Responses:
    201  Purchase created and payment processed
    402  Purchase created but payment failed (declined)
    400  Missing or invalid request body
    502  Payment Service unreachable
    500  Internal server error
```

**Example request:**

```bash
curl -X POST http://localhost:3002/purchases \
  -H "Content-Type: application/json" \
  -d '{"userId":"u1","eventId":"e1","quantity":2,"unitTicketCents":6500,"idempotencyKey":"key-123"}'
```

**Example response (201):**

```json
{
  "message": "Purchase created and payment processed",
  "purchase": {
    "id": 1,
    "user_id": "u1",
    "event_id": "e1",
    "quantity": 2,
    "unit_ticket_cents": 6500,
    "reservation_status": "reserved",
    "payment_status": "paid",
    "idempotency_key": "key-123"
  },
  "payment": {
    "status": "success",
    "purchaseId": 1,
    "message": "Payment processed"
  }
}
```

**Example response (402 payment declined):**

```json
{
  "message": "Purchase created but payment failed",
  "purchase": { /* purchase record */ },
  "payment": {
    "status": "failed",
    "purchaseId": 1,
    "message": "Payment declined"
  }
}
```

---

### Payment Service

### GET /health

```
GET /health

  Returns health status for the payment service and its Postgres dependency.

  Responses:
    200  Service healthy
    503  Database unreachable
```

**Example request:**

```bash
curl http://localhost:3001/health
```

**Example response (200):**

```json
{
  "status": "healthy",
  "service": "payment-service",
  "database": "up"
}
```

### POST /payments

```
POST /payments

  Processes a payment for an existing purchase record.

  Body (JSON):
    purchaseId: integer

  Responses:
    200  Payment processed (success)
    402  Payment declined
    404  Purchase not found
    400  Missing purchaseId
    500  Internal server error
```

**Example request:**

```bash
curl -X POST http://localhost:3001/payments \
  -H "Content-Type: application/json" \
  -d '{"purchaseId":1}'
```

**Example response (200):**

```json
{
  "status": "success",
  "purchaseId": 1,
  "message": "Payment processed"
}
```

**Example response (402):**

```json
{
  "status": "failed",
  "purchaseId": 1,
  "message": "Payment declined"
}
```

## Sprint History

| Sprint | Tag        | Plan                                              | Report                                    |
| ------ | ---------- | ------------------------------------------------- | ----------------------------------------- |
| 1      | `sprint-1` | [SPRINT-1-PLAN.md](sprint-plans/SPRINT-1-PLAN.md) | [SPRINT-1.md](sprint-reports/SPRINT-1.md) |
| 2      | `sprint-2` | [SPRINT-2-PLAN.md](sprint-plans/SPRINT-2-PLAN.md) | [SPRINT-2.md](sprint-reports/SPRINT-2.md) |
| 3      | `sprint-3` | [SPRINT-3-PLAN.md](sprint-plans/SPRINT-3-PLAN.md) | [SPRINT-3.md](sprint-reports/SPRINT-3.md) |
| 4      | `sprint-4` | [SPRINT-4-PLAN.md](sprint-plans/SPRINT-4-PLAN.md) | [SPRINT-4.md](sprint-reports/SPRINT-4.md) |
