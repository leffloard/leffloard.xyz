// The booking page's open times under steady load: 95% of answers within 300 ms.
//
//   k6 run -e BASE_URL=http://127.0.0.1:3100 load/slots.js

import http from "k6/http";
import { check } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3100";
const TYPE = __ENV.TYPE || "intro-call";

export const options = {
  scenarios: {
    slots: {
      executor: "constant-arrival-rate",
      rate: Number(__ENV.RATE || 20),
      timeUnit: "1s",
      duration: __ENV.DURATION || "1m",
      preAllocatedVUs: 20,
      maxVUs: 50,
    },
  },
  thresholds: {
    "http_req_duration{name:slots}": ["p(95)<300"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

export default function listSlots() {
  const response = http.get(`${BASE_URL}/api/bookings/${TYPE}/slots`, {
    // Many visitors, each within the per-address limit.
    headers: { "x-forwarded-for": `10.9.${__VU % 250}.${__ITER % 250}` },
    tags: { name: "slots" },
  });
  check(response, { "open times listed": (r) => r.status === 200 && Array.isArray(r.json("slots")) });
}
