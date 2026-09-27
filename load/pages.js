// Visitors reading the public site: pages render per request from the in-memory content snapshot, so this
// is the server's everyday load. 95% within 800 ms, no errors.
//
//   k6 run -e BASE_URL=http://127.0.0.1:3100 load/pages.js

import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3100";
const PAGES = ["/", "/work", "/services", "/pricing", "/about", "/cv", "/blog", "/contact", "/book"];

export const options = {
  scenarios: {
    readers: {
      executor: "ramping-vus",
      startVUs: 1,
      stages: [
        { duration: __ENV.RAMP || "30s", target: Number(__ENV.VUS || 50) },
        { duration: __ENV.HOLD || "1m", target: Number(__ENV.VUS || 50) },
        { duration: "10s", target: 0 },
      ],
    },
  },
  thresholds: {
    "http_req_duration{kind:page}": ["p(95)<800"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

export default function readPage() {
  const path = PAGES[Math.floor(Math.random() * PAGES.length)];
  const response = http.get(`${BASE_URL}${path}`, { tags: { name: path, kind: "page" } });
  check(response, {
    "page served": (r) => r.status === 200,
    "with its nonce policy": (r) => /'nonce-/.test(r.headers["Content-Security-Policy"] || ""),
  });
  sleep(1 + Math.random() * 2);
}
