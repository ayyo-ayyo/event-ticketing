// Sprint 2 — Async load test
//
// Run from inside the holmes container:
//   docker compose exec holmes bash
//   k6 run /workspace/k6/sprint-2-async.js
//
// Or from your host machine if k6 is installed:
//   k6 run k6/sprint-2.js
//

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");
const duplicateRate = new Rate("duplicates");

// ── Configuration ─────────────────────────────────────────────────────────────
// Update this URL to point to your main read endpoint.
// From inside the holmes container, use the service name (not localhost).

export const options = {
  scenarios: {burst:{
    executor: "constant-arrival-rate",
    timeUnit: "1s",
    rate: 50,
    duration: "30s",
    preAllocatedVUs: 50,
    maxVUs: 50,
    },},
  thresholds: {
    http_req_duration: ["p(50)<500", "p(95)<500", "p(99)<1000"], // 95% of requests under 500ms
    http_req_failed: ["rate<0.10"],            // less than 10% error rate
  },
};

function addEvent(idempotencyKey){
    return JSON.stringify({
    userId: Math.floor(Math.random() * 500),
    eventId: Math.floor(Math.random() * 10) + 1,
    quantity: Math.floor(Math.random() * 500),
    unitTicketCents: Math.floor(Math.random() * 500),
    idempotencyKey, 
    })
}

export default function () {
  const idempotencyKey = `key-${Math.floor(Math.random() * 500)}`;
  const res = http.post(`http://ticket-purchase-service:3002/purchases`, addEvent(idempotencyKey), {
    headers: { "Content-Type": "application/json" },
  });  

  let isDuplicate = false;

  try {
    const body = JSON.parse(res.body);
    if (body.message && body.message.includes("Duplicate")) {
      isDuplicate = true;
    }
  } catch(e){}

  const ok = check(res, {
    "status is valid": (r) => [200, 201, 402].includes(r.status),
    "response time < 1s": (r) => r.timings.duration < 1000,
  });

  duplicateRate.add(isDuplicate);
  errorRate.add(!ok);
  sleep(0.5);
}
