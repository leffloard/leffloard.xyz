// A flood of forged NOWPayments callbacks. Each is refused (401 bad signature, or 429 once an address sends
// too many), quickly, and never with a server error; the log of rejected callbacks stays capped (500 a day).
// That a real payment is applied exactly once, however often and in whatever order its callbacks come (a
// shuffled flood of 500 included), is covered by the integration tests (tests/integration/payments.test.ts):
// real callbacks need the IPN secret and payments that NOWPayments' API knows about.
//
//   k6 run -e BASE_URL=http://127.0.0.1:3100 load/ipn-flood.js

import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3100";

export const options = {
  scenarios: {
    flood: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 50),
      timeUnit: "1s",
      duration: __ENV.DURATION || "30s",
      preAllocatedVUs: 20,
      maxVUs: 100,
    },
  },
  thresholds: {
    "http_req_duration{name:ipn}": ["p(95)<200"],
    checks: ["rate==1"],
  },
};

export default function forgeCallback() {
  const body = JSON.stringify({
    payment_id: 5_600_000_000 + __ITER,
    payment_status: "finished",
    order_id: `INV-2026-${String(__ITER % 9999).padStart(4, "0")}:forged`,
    actually_paid: 1_000_000,
  });
  const response = http.post(`${BASE_URL}/api/payments/nowpayments`, body, {
    headers: {
      "content-type": "application/json",
      "x-nowpayments-sig": "0".repeat(128),
      // A few senders, so both the signature check and the per-address limit are exercised.
      "x-forwarded-for": `10.8.0.${__VU % 5}`,
    },
    tags: { name: "ipn" },
  });
  check(response, { "refused, without a server error": (r) => r.status === 401 || r.status === 429 });
}
