import { randomUUID } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { BSON } from "mongodb";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AVAILABILITY } from "@/lib/booking/availability";
import { todayIn } from "@/lib/intake/time";
import { createOwner } from "@/server/auth/users";
import { createInvoice, issueInvoice } from "@/server/billing/invoices";
import { getBillingSettings, saveBankAccounts } from "@/server/billing/settings";
import { createMeeting } from "@/server/calendar/meetings";
import { createClient } from "@/server/clients/store";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { setPortalAccess } from "@/server/portal/access";
import { clientInput } from "../helpers/work";
import { setupTestDb } from "../integration/db";
import { setupTestEnv } from "../integration/env";

// Hostile input on every route handler that takes a post (or a put, patch or delete): operator keys,
// prototype pollution, wrong types, deep nesting, huge and broken bodies, and posts from other sites. None may
// fail with a 500, change a stored document, or pollute an object prototype. The handlers are found by
// loading every route file and looking at what it exports. The database holds an owner, a client with the
// portal on, a message, a meeting and an issued invoice, so an operator that matched records would show.

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: () => undefined,
    has: () => false,
    set: () => undefined,
    delete: () => undefined,
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/server", async (original) => ({ ...(await original<object>()), after: vi.fn() }));
vi.mock("@/server/notify/kick", () => ({ sendQueuedSoon: vi.fn() }));
vi.mock("@/server/ai/kick", () => ({ triageSoon: vi.fn() }));
vi.mock("@/server/analytics/kick", () => ({ goalSoon: vi.fn() }));

const { db, url, name } = setupTestDb();
setupTestEnv({
  MONGO_URL: url,
  DB_NAME: name,
  EMAIL_DELIVERY: "log",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
  NOWPAYMENTS_API_KEY: "security-test-key",
  NOWPAYMENTS_IPN_SECRET: "security-test-secret",
  NOWPAYMENTS_API_URL: "http://127.0.0.1:9/v1",
});

const APP = path.resolve("app");

type Handler = (request: Request, context?: unknown) => Promise<Response>;
type Endpoint = { file: string; method: string; handler: Handler };

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return routeFiles(full);
    return /^route\.(ts|tsx|js|mjs)$/.test(entry) ? [full] : [];
  });
}

const MUTATING = ["POST", "PUT", "PATCH", "DELETE"];

async function endpoints(): Promise<Endpoint[]> {
  const found: Endpoint[] = [];
  for (const file of routeFiles(APP)) {
    const exports = (await import(file)) as Record<string, unknown>;
    for (const method of MUTATING) {
      if (typeof exports[method] === "function")
        found.push({ file, method, handler: exports[method] as Handler });
    }
  }
  return found;
}

const label = (endpoint: Endpoint) => `${endpoint.method} ${path.relative(APP, endpoint.file)}`;
const isCatchAll = (file: string) => file.includes("[[...");

// The address, and every [param] filled with something that finds nothing.
function addressOf(file: string): string {
  const segments = path
    .relative(APP, path.dirname(file))
    .split(path.sep)
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .map((segment) => (segment.startsWith("[") ? "AAAAAAAAAAAAAAAAAAAAAA" : segment));
  return `https://leffloard.test/${segments.join("/")}`;
}

function context(file: string) {
  const params = Object.fromEntries(
    [...file.matchAll(/\[(\[?\.\.\.)?(\w+)\]?\]/g)].map((match) =>
      match[1] ? [match[2], ["x"]] : [match[2], "AAAAAAAAAAAAAAAAAAAAAA"],
    ),
  );
  return { params: Promise.resolve(params) };
}

function request(endpoint: Endpoint, body: string, headers: Record<string, string> = {}): Request {
  return new Request(addressOf(endpoint.file), {
    method: endpoint.method,
    headers: {
      "content-type": "application/json",
      origin: "https://leffloard.test",
      "sec-fetch-site": "same-origin",
      "x-forwarded-for": "198.51.100.44",
      "user-agent":
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36",
      ...headers,
    },
    body,
  });
}

// The status a handler answers with; notFound() is thrown, as Next.js handles it.
async function statusOf(endpoint: Endpoint, incoming: Request): Promise<number> {
  try {
    return (await endpoint.handler(incoming, context(endpoint.file))).status;
  } catch (error) {
    return (error as { digest?: string }).digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK;404") ? 404 : 500;
  }
}

let depth = '"end"';
for (let level = 0; level < 300; level++) depth = `{"a":${depth}}`;

// Raw JSON text, so "__proto__" arrives as an own key the way an attacker would send it. The seeded client's
// address is in some of them, so a lookup an operator could widen has a record to find.
const CORPUS: [string, string][] = [
  ["null", "null"],
  ["an array", "[1, 2, 3]"],
  ["a string", '"hello"'],
  ["a number", "42"],
  ["broken JSON", '{"name":'],
  ["an empty object", "{}"],
  ["operators", '{"email":{"$gt":""},"name":{"$ne":null},"token":{"$ne":null},"$where":"sleep(100)"}'],
  ["an operator with a known address", '{"email":{"$in":["grace@example.com"]},"clientId":{"$exists":true}}'],
  ["dotted keys", '{"profile.name":"x","a.b.c":1}'],
  ["__proto__", '{"__proto__":{"polluted":true},"name":"x"}'],
  ["constructor.prototype", '{"constructor":{"prototype":{"polluted":true}}}'],
  ["wrong types", '{"email":["grace@example.com"],"name":{"x":1},"message":123,"token":{"$regex":".*"}}'],
  ["control and bidi characters", '{"name":"\\u0000\\u202e<script>alert(1)</script>","email":"a@b.test"}'],
  ["deep nesting", depth],
  ["a huge body", JSON.stringify({ message: "x".repeat(2 * 1024 * 1024) })],
];

// Collections a refused request may still touch: counters, replays and the security log. Forged payment
// callbacks are logged in payment_events, checked on their own below.
const MAY_CHANGE = new Set([
  "rate_limits",
  "idempotency_keys",
  "audit_log",
  "login_lockouts",
  "payment_events",
]);

// Every stored document, as canonical Extended JSON per collection.
async function snapshot(): Promise<Map<string, string>> {
  const names = (await db().listCollections({}, { nameOnly: true }).toArray())
    .map((entry) => entry.name)
    .filter((name) => !MAY_CHANGE.has(name));
  return new Map(
    await Promise.all(
      names.map(async (name) => {
        const docs = await db().collection(name).find().sort({ _id: 1 }).toArray();
        return [name, BSON.EJSON.stringify(docs, { relaxed: false })] as const;
      }),
    ),
  );
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter(
    (name) => before.get(name) !== after.get(name),
  );
}

async function seed(): Promise<void> {
  const at = new Date();
  await createOwner(db(), {
    email: "owner@leffloard.test",
    name: "Owner",
    password: "purple kettle on the balcony",
  });
  const client = await createClient(
    db(),
    clientInput({ name: "Grace Hopper", email: "grace@example.com" }),
    {},
    at,
  );
  await setPortalAccess(db(), client._id, true, at);
  const { POST: inquiries } = (await import("@/app/api/inquiries/route")) as { POST: Handler };
  const message = await inquiries(
    new Request("https://leffloard.test/api/inquiries", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://leffloard.test",
        "sec-fetch-site": "same-origin",
        "x-forwarded-for": "198.51.100.45",
      },
      body: JSON.stringify({
        kind: "question",
        subject: "Pricing",
        message: "Do you build Telegram bots too?",
        name: "Grace Hopper",
        email: "grace@example.com",
        contact: "",
        aiOptOut: false,
        website: "",
        turnstileToken: "",
      }),
    }),
  );
  expect(message.status).toBe(201);
  await createMeeting(
    db(),
    {
      bookingTypeId: null,
      title: "Intro call",
      // In three days, on a quarter hour.
      startsAt: new Date(Math.ceil((at.getTime() + 3 * 86_400_000) / 900_000) * 900_000),
      durationMinutes: 30,
      timeZone: "Europe/London",
      status: "confirmed",
      name: "Grace Hopper",
      email: "grace@example.com",
      notes: "",
      answers: [],
      location: { kind: "jitsi", details: "" },
      clientId: client._id,
      source: "booking",
    },
    DEFAULT_AVAILABILITY,
    { enforceCap: false },
    at,
  );
  await saveBankAccounts(
    db(),
    [
      {
        id: "bank-1",
        label: "Any currency",
        holder: "Mert Kaan Koparan",
        bankName: "Example Bank",
        iban: "TR330006100519786457841326",
        swift: null,
        currency: null,
      },
    ],
    0,
    at,
  );
  const draft = await createInvoice(
    db(),
    {
      title: "Deposit",
      clientId: client._id,
      projectId: null,
      recipient: { name: "Grace Hopper", company: null, email: "grace@example.com", address: "" },
      currency: "USD",
      lines: [{ id: randomUUID(), description: "Deposit", quantityMilli: 1000, unitMinor: 50_000 }],
      discount: null,
      taxes: [],
      notes: "",
      methods: ["bank", "crypto"],
    },
    {},
    at,
  );
  const issued = await issueInvoice(
    db(),
    draft._id,
    1,
    await getBillingSettings(db()),
    todayIn("Europe/Istanbul", at),
    at,
  );
  expect(issued.ok).toBe(true);
}

beforeEach(async () => {
  await runMigrations(db());
  await seed();
});

afterAll(async () => {
  await closeClient();
});

describe("route handlers that take data", () => {
  it("are found", async () => {
    const found = await endpoints();
    expect(found.length).toBeGreaterThan(20);
    expect(found.some((endpoint) => endpoint.file.includes(`${path.sep}(admin)${path.sep}`))).toBe(true);
  });

  it("answer hostile bodies without a 500, a change or a polluted prototype", async () => {
    const before = await snapshot();
    const failures: string[] = [];
    for (const endpoint of await endpoints()) {
      for (const [kind, body] of CORPUS) {
        const status = await statusOf(endpoint, request(endpoint, body));
        if (status >= 500) failures.push(`${label(endpoint)} (${kind}): ${status}`);
      }
      const wrongType = await statusOf(
        endpoint,
        request(endpoint, "name=x", { "content-type": "text/plain" }),
      );
      if (wrongType >= 500) failures.push(`${label(endpoint)} (text/plain): ${wrongType}`);
    }
    expect(failures).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(changed(before, await snapshot())).toEqual([]);
    // Forged payment callbacks are logged for the owner (and capped a day), never taken as payments.
    const events = await db().collection("payment_events").find().toArray();
    expect(events.every((event) => event.signatureOk === false && event.outcome === "rejected")).toBe(true);
  });

  it("refuse posts from other sites, and change nothing", async () => {
    // Posted by others, and checked another way: NOWPayments signs its callbacks, browsers send CSP reports.
    const others = ["api/payments/nowpayments/route.ts", "api/csp-report/route.ts"].map((file) =>
      path.join(APP, file),
    );
    const before = await snapshot();
    const accepted: string[] = [];
    const body = JSON.stringify({
      kind: "question",
      name: "Mallory",
      email: "grace@example.com",
      subject: "Hello",
      message: "A message from another site.",
      type: "view",
      path: "/",
      entry: true,
    });
    for (const endpoint of await endpoints()) {
      if (others.includes(endpoint.file) || isCatchAll(endpoint.file)) continue;
      const status = await statusOf(
        endpoint,
        request(endpoint, body, { origin: "https://evil.example", "sec-fetch-site": "cross-site" }),
      );
      // The statistics' beacon answers 204 to everything; the admin's routes may refuse for the session first.
      const expected = endpoint.file.endsWith(`analytics${path.sep}route.ts`)
        ? [204]
        : endpoint.file.includes(`${path.sep}(admin)${path.sep}`)
          ? [401, 403]
          : [403];
      if (!expected.includes(status)) accepted.push(`${label(endpoint)}: ${status}`);
    }
    expect(accepted).toEqual([]);
    expect(changed(before, await snapshot())).toEqual([]);
  });
});
