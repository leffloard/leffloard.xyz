// Many visitors book the same three times at the same moment. Exactly three bookings may succeed, one per
// time; everyone else is told the time is gone (409). Checks that the slot locks hold under a real race.
//
//   k6 run -e BASE_URL=http://127.0.0.1:3100 load/booking-race.js
//
// Against a staging copy with its own database, never production (see load/README.md). TYPE is a public
// booking type that confirms without approval ("intro-call", which every new database starts with, by
// default). A type with other required questions needs their answers: -e ANSWERS='{"<question id>":"..."}'.

import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:3100";
const TYPE = __ENV.TYPE || "intro-call";
const VISITORS = Number(__ENV.VISITORS || 100);
const ANSWERS = JSON.parse(__ENV.ANSWERS || '{"q-intro-1":"A load test booking."}');

const booked = new Counter("booked");
const taken = new Counter("taken");

// "That time is gone" is an expected answer here, not a failed request.
http.setResponseCallback(http.expectedStatuses(201, 409));

export const options = {
  scenarios: {
    // Every visitor sends one booking, all at once.
    race: { executor: "per-vu-iterations", vus: VISITORS, iterations: 1, maxDuration: "1m" },
  },
  thresholds: {
    booked: ["count==3"],
    checks: ["rate==1"],
  },
};

// The first open time of three different days, so a daily limit can't leave fewer than three bookable.
export function setup() {
  const response = http.get(`${BASE_URL}/api/bookings/${TYPE}/slots`);
  if (response.status !== 200) throw new Error(`No open times for "${TYPE}": ${response.status}`);
  const firstOfDay = new Map();
  for (const start of response.json("slots")) {
    const day = start.slice(0, 10);
    if (!firstOfDay.has(day)) firstOfDay.set(day, start);
  }
  const slots = [...firstOfDay.values()].slice(0, 3);
  if (slots.length < 3) throw new Error("Fewer than three days have open times.");
  return { slots };
}

export default function book({ slots }) {
  const visitor = __VU;
  const response = http.post(
    `${BASE_URL}/api/bookings`,
    JSON.stringify({
      type: TYPE,
      start: slots[visitor % 3],
      name: `Load test ${visitor}`,
      email: `load-test-${visitor}@example.com`,
      timeZone: "Europe/Istanbul",
      notes: "",
      answers: ANSWERS,
      website: "",
      turnstileToken: "",
    }),
    {
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        // One address per visitor: the per-address booking limit is not what is tested here.
        "x-forwarded-for": `10.${Math.floor(visitor / 250)}.${visitor % 250}.1`,
      },
      tags: { name: "book" },
    },
  );
  if (response.status === 201) booked.add(1);
  if (response.status === 409) taken.add(1);
  check(response, { "booked, or told the time is gone": (r) => r.status === 201 || r.status === 409 });
}
