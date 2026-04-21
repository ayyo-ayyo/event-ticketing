// Sprint 2 — Cache load test
//
// Run from inside the holmes container:
//   docker compose exec holmes bash
//   k6 run /workspace/k6/sprint-2-cache.js
//
// Or from your host machine if k6 is installed:
//   k6 run k6/sprint-2.js
//

import http from "k6/http";
import { check, sleep } from "k6";
import { Rate } from "k6/metrics";

const errorRate = new Rate("errors");
const cacheHitRate = new Rate("cache_hits");

// ── Configuration ─────────────────────────────────────────────────────────────
// Update this URL to point to your main read endpoint.
// From inside the holmes container, use the service name (not localhost).

const ids = [1,2,3,4,5,6,7,8,9,10];
export const options = {
  stages: [
    { duration: "20s", target: 50 }, // ramp up to 50 VUs
    { duration: "20s", target: 100 }, // ramp up to 100 VUs
    { duration: "20s", target: 100 }, // sustain
    { duration: "20s", target: 0  }, // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(50)<500", "p(95)<500", "p(99)<1000"], // 95% of requests under 500ms
    http_req_failed: ["rate<0.10"],            // less than 10% error rate
    cache_hits: ["rate>.99"]
  },
};

// Warming the cache
export function setup() {
  for (let id of ids) {
    http.get(`http://event-catalog-service:3001/events/${id}`);
  }
}

export default function () {
  const id = ids[Math.floor(Math.random() * ids.length)];
  const res = http.get(`http://event-catalog-service:3001/events/${id}`);
  const body = JSON.parse(res.body);
  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
    "from the cache": (r) => body.source === "cache",
  });

  cacheHitRate.add(body.source === "cache");
  errorRate.add(!ok);
  sleep(0.5);
}
