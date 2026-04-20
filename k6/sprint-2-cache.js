// Sprint 2 — Async and Cache load test
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

// ── Configuration ─────────────────────────────────────────────────────────────
// Update this URL to point to your main read endpoint.
// From inside the holmes container, use the service name (not localhost).
const ids = [1,2,3,4,5,6,7,8,9,10];

export const options = {
  stages: [
    { duration: "20s", target: 25 }, // ramp up to 20 VUs
    { duration: "20s", target: 50 }, // ramp up to 50 VUs
    { duration: "20s", target: 50 }, // sustain
    { duration: "20s", target: 0  }, // ramp down
  ],
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1000"], // 95% of requests under 500ms
    http_req_failed: ["rate<0.10"],            // less than 1% error rate
  },
};

export default function () {
  const id = ids[Math.floor(Math.random() * ids.length)];
  const res = http.get(`http://event-catalog-service:3003/events/${id}`);

  const ok = check(res, {
    "status is 200": (r) => r.status === 200,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  errorRate.add(!ok);
  sleep(0.5);
}

// export const options = {
//   stages: [
//     { duration: '10s', target: 100 },  // warm-up: same load as Scenario 2
//     { duration: '20s', target: 300 },   // ramp: increasing pressure
//     { duration: '20s', target: 500 },   // ramp: heavy pressure
//     { duration: '20s', target: 800 },   // ramp: extreme pressure
//     { duration: '10s', target: 0 },     // cool-down
//   ],

//   // Thresholds define pass/fail criteria. k6 will report whether the system
//   // met these targets. These are intentionally set to values that should be
//   // achievable at low VU counts but will likely fail under extreme load.
//   thresholds: {
//     http_req_duration: ['p(95)<2000'],  // p95 latency under 2 seconds
//     http_req_failed: ['rate<0.10'],     // fewer than 10% of requests fail
//   },
// };

// const targetUrl = __ENV.TARGET_URL || 'http://caddy/';

// export default function () {
//   const res = http.get(targetUrl);

//   // check() records pass/fail rates in k6 output so you can see at what
//   // point responses stop being successful.
//   check(res, {
//     'status is 200': (r) => r.status === 200,
//     'response has hostname': (r) => {
//       try {
//         return JSON.parse(r.body).hostname !== undefined;
//       } catch {
//         return false;
//       }
//     },
//   });
// }
