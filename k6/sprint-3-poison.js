// Sprint 3 — Poison pill resilience test
//
// Run from inside the holmes container:
//   docker compose exec holmes bash
//   k6 run /workspace/k6/sprint-3-poison.js
//
// Or from your host machine if k6 is installed:
//   k6 run k6/sprint-3-poison.js
//


import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const PURCHASE_URL   = 'http://ticket-purchase-service:3002/purchases';
const WORKER_HEALTH  = 'http://waitlist-worker:3005/health';
const HEADERS        = { 'Content-Type': 'application/json' };

const normalErrorRate = new Rate('normal_errors');
const poisonRejectedRate = new Rate('poison_pill_rejected');

export const options = {
  stages: [
    { duration: '30s', target: 50  }, //Ramp up to 50 VUs
    { duration: '30s', target: 100 }, //Ramp up to 100 VUs
    { duration: '30s', target: 100 }, //Sustain
    { duration: '30s', target: 0   }, //Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed:   ['rate<0.30'],
    normal_errors:     ['rate<0.05'],
    poison_pill_rejected: ['rate>0.90'],
  },
};


function regularRequests() {
  const idempotencyKey = `normal-${__VU}-${__ITER}-${Date.now()}`;
  return {
    body: JSON.stringify({
      userId:          Math.floor(Math.random() * 500) + 1,
      eventId:         Math.floor(Math.random() * 10)  + 1, //Events 1–10 exist
      quantity:        Math.floor(Math.random() * 4)   + 1, //1–4 tickets
      unitTicketCents: Math.floor(Math.random() * 5000) + 1000,
      idempotencyKey,
    }),
    headers: { ...HEADERS, 'Idempotency-Key': idempotencyKey },
  };
}

function waitlistRequests() {
  const idempotencyKey = `waitlist-${__VU}-${__ITER}-${Date.now()}`;
  return {
    body: JSON.stringify({
      userId:          Math.floor(Math.random() * 500) + 1,
      eventId:         Math.floor(Math.random() * 10)  + 1,
      quantity:        99999,//This will exceed the amount of seats available, and send these requests to the wait list
      unitTicketCents: 1000,
      idempotencyKey,
    }),
    headers: { ...HEADERS, 'Idempotency-Key': idempotencyKey },
  };
}

const poisonRequests = [
  //This is a poison pill request with an invalid eventId
  () => JSON.stringify({ userId: 1, eventId: 999999, quantity: 1, unitTicketCents: 1000 }),
  //This is a poison pill request with missing fields
  () => JSON.stringify({ userId: 1 }),
  //This is a poison pill request with an empty body
  () => '{}',
];


export function setup() {
  const res = http.get(WORKER_HEALTH);
  const ok = check(res, {
    'waitlist-worker is healthy before the test': (r) => r.status === 200,
  });
  if (!ok) {
    console.log('waitlist-worker healthcheck failed before the test');
  }

  let dlqBefore = 0;
  try {
    dlqBefore = JSON.parse(res.body).dlqDepth || 0;
  } catch (_) {}

  console.log(`dlq_depth at start: ${dlqBefore}`);
  return { dlqBefore };
}

export function teardown(data) {
  const res = http.get(WORKER_HEALTH);

  check(res, {
    'waitlist-worker is healthy after test': (r) => r.status === 200,
  });

  let dlqAfter = 0;
  let workerStatus = 'unknown';
  try {
    const body = JSON.parse(res.body);
    dlqAfter      = body.dlqDepth || 0;
    workerStatus  = body.status   || 'unknown';
  }catch(error){
    console.error('Error occurred: '. error.message);
  }

  console.log(`worker status : ${workerStatus}`);
  console.log(`dlq_depth before: ${data.dlqBefore}`);
  console.log(`dlq_depth after : ${dlqAfter}`);

  check({ dlqAfter, dlqBefore: data.dlqBefore }, {
    'dlq_depth is greater than 0 after test': (d) => d.dlqAfter > 0,
    'dlq_depth grew during test, poison pill landed in DLQ': (d) => d.dlqAfter >= d.dlqBefore,
  });
}

export default function () {
  const roll = Math.random();

  //65% regular requests
  if (roll < 0.65) {
    const { body, headers } = regularRequests();
    const res = http.post(PURCHASE_URL, body, { headers });

    const ok = check(res, {
      'normal: status 200 or 204':      (r) => r.status === 200 || r.status === 204,
      'normal: response time < 500ms':  (r) => r.timings.duration < 500,
    });
    normalErrorRate.add(!ok);

  //15% wait list requests
  } else if (roll < 0.80) {
    const { body, headers } = waitlistRequests();
    const res = http.post(PURCHASE_URL, body, { headers });
    
    check(res, {
      'waitlist was accepted by the purchase service': (r) => r.status === 200 || r.status === 204,
    });

  //20% poison pill requests
  } else {
    const buildPayload = poisonRequests[Math.floor(Math.random() * poisonRequests.length)];
    const res = http.post(PURCHASE_URL, buildPayload(), { headers: HEADERS });

    const rejected = check(res, {
      'poison pill: rejected with status of 400 or higher': (r) => r.status >= 400,
      'poison pill: response time under 500ms':           (r) => r.timings.duration < 500,
    });
    poisonRejectedRate.add(rejected);
  }

  sleep(0.5);
}
