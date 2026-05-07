// Sprint 4 — Replica failure resilience test
//
// Purpose:
//  - Generate sustained load against a replicated service and observe
//    whether the surviving replicas absorb traffic when one replica is
//    stopped (killed) during the run.
//
// Manual replica test flow:
// remove container_name: ticket-purchase-service (compose.yml) to allow multiple replicas
// remove ports: - "3002:3002" (compose.yml) to avoid host port conflicts when scaling
// docker compose up --scale ticket-purchase-service=3 --build -d
// docker compose ps
// docker compose exec holmes k6 run /workspace/k6/sprint-4-replica.js
// docker stop event-ticketing-ticket-purchase-service-1
//
// Example idea:
//   docker compose ps
//   docker stop <one-ticket-purchase-container>
//   docker compose exec holmes k6 run /workspace/k6/sprint-4-replica.js
//
// Notes:
// - This script does not kill containers itself; it polls the target
//   health endpoint and records errors/latency so you can annotate the
//   k6 output with the moment you stopped a replica.
// - Adjust `TARGET_*` constants below to match a different service.

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

// Target endpoints (change if needed)
const PURCHASE_URL = 'http://ticket-purchase-service:3002/purchases';
const HEALTH_URL   = 'http://ticket-purchase-service:3002/health';
const HEADERS      = { 'Content-Type': 'application/json' };

const errorRate = new Rate('errors');
const latency   = new Trend('http_req_duration_ms');

export const options = {
  stages: [
    { duration: '30s', target: 50 },  // ramp up to 50 VUs
    { duration: '60s', target: 100 }, // sustain — kill a replica during this window
    { duration: '30s', target: 0 },   // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    errors: ['rate<0.10'],
  },
};

function purchasePayload() {
  const idempotencyKey = `replica-${__VU}-${__ITER}-${Date.now()}`;
  return {
    body: JSON.stringify({
      userId: Math.floor(Math.random() * 500) + 1,
      eventId: Math.floor(Math.random() * 10) + 1,
      quantity: Math.floor(Math.random() * 4) + 1,
      unitTicketCents: Math.floor(Math.random() * 5000) + 1000,
      idempotencyKey,
    }),
    headers: { ...HEADERS, 'Idempotency-Key': idempotencyKey },
  };
}

export function setup() {
  const res = http.get(HEALTH_URL);
  const ok = check(res, { 'service healthy at start': (r) => r.status === 200 });
  if (!ok) console.log('Healthcheck failed at setup:', res.status);
  return { startHealth: res.status };
}

export default function () {
  // Send one purchase per iteration and poll health occasionally
  const { body, headers } = purchasePayload();
  const res = http.post(PURCHASE_URL, body, { headers });

  const ok = check(res, {
    'purchase: status 200 or 204': (r) => r.status === 200 || r.status === 204,
  });

  errorRate.add(!ok);
  latency.add(res.timings.duration);

  // Poll health at lower frequency to track service state
  if (__ITER % 10 === 0) {
    const h = http.get(HEALTH_URL);
    check(h, { 'health endpoint up': (r) => r.status === 200 });
  }

  sleep(0.5);
}

export function teardown(data) {
  const res = http.get(HEALTH_URL);
  const alive = res.status === 200;
  console.log('health at teardown:', res.status, 'alive:', alive);
}
