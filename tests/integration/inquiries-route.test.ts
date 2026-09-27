import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/inquiries/route";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { clearEnvCache } from "@/server/env";
import { block } from "@/server/inquiries/blocklist";
import type { InquiryDoc } from "@/server/inquiries/types";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

vi.mock("@/server/notify/kick", () => ({ sendQueuedSoon: vi.fn() }));
vi.mock("@/server/analytics/kick", () => ({ goalSoon: vi.fn() }));
vi.mock("@/server/ai/kick", () => ({ triageSoon: vi.fn() }));

const { db, url, name } = setupTestDb();
setupTestEnv({
  MONGO_URL: url,
  DB_NAME: name,
  EMAIL_DELIVERY: "log",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
});

beforeEach(async () => {
  await runMigrations(db());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeClient();
});

const brief = (overrides: Record<string, unknown> = {}) => ({
  kind: "brief",
  service: "discord-bots",
  subject: "Moderation bot",
  message: "It should warn, mute and log.",
  budget: "500-1500",
  timeline: "1-month",
  links: "",
  company: "",
  name: "Alan Turing",
  email: "alan@example.com",
  contact: "",
  aiOptOut: true,
  website: "",
  turnstileToken: "",
  ...overrides,
});

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("https://leffloard.test/api/inquiries", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": "203.0.113.5",
        origin: "https://leffloard.test",
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const inquiries = () => db().collection<InquiryDoc>("inquiries").find().toArray();

function withTurnstile(answer: Record<string, unknown>): string[] {
  vi.stubEnv("TURNSTILE_SITE_KEY", "0x4AAAAAAA-site-key");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "0x4AAAAAAA-real-looking-secret");
  clearEnvCache();
  const tokens: string[] = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    tokens.push(new URLSearchParams(String(init.body)).get("response") ?? "");
    return Response.json(answer);
  });
  return tokens;
}

function withoutTurnstile(): void {
  vi.stubEnv("TURNSTILE_SITE_KEY", "");
  vi.stubEnv("TURNSTILE_SECRET_KEY", "");
  clearEnvCache();
}

describe("POST /api/inquiries", () => {
  it("stores a project brief and queues the alert", async () => {
    const response = await post(brief());
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    const [stored] = await inquiries();
    expect(stored).toMatchObject({
      kind: "brief",
      source: "form",
      status: "new",
      service: "discord-bots",
      budget: "500-1500",
      timeline: "1-month",
      links: null,
      company: null,
      aiOptOut: true,
    });
    const outbox = await db().collection("outbox").find().toArray();
    expect(outbox.map((item) => item.channel)).toEqual(["email"]);
  });

  it("answers 422 with a message per field", async () => {
    const response = await post(brief({ email: "nope", service: "" }));
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Check the highlighted fields.",
      errors: { email: "Please enter a valid email address.", service: "Choose the kind of project." },
    });
    expect(await inquiries()).toEqual([]);
  });

  it("refuses what is not a JSON form from this site", async () => {
    expect((await post(brief(), { "content-type": "text/plain" })).status).toBe(415);
    expect((await post("{broken")).status).toBe(400);
    expect((await post({ ...brief(), $where: "1" })).status).toBe(400);
    expect((await post({ ...brief(), nested: { "a.b": 1 } })).status).toBe(400);
    const crossSite = await post(brief(), { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    expect(crossSite.status).toBe(403);
    expect(await inquiries()).toEqual([]);
  });

  it("drops what the honeypot catches, with the usual answer", async () => {
    const response = await post(brief({ website: "https://spam.example" }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ ok: true });
    expect(await inquiries()).toEqual([]);
  });

  it("stores a form sent twice with the same Idempotency-Key once", async () => {
    const key = { "idempotency-key": "form-3f7a9c1e2b" };
    const first = await post(brief(), key);
    const second = await post(brief(), key);
    expect([first.status, second.status]).toEqual([201, 201]);
    expect(await inquiries()).toHaveLength(1);
    expect((await post(brief(), { "idempotency-key": "form-other-key-1" })).status).toBe(201);
    expect(await inquiries()).toHaveLength(2);
  });

  it("limits each address to five messages every ten minutes", async () => {
    for (let count = 0; count < 5; count++) expect((await post(brief())).status).toBe(201);
    const refused = await post(brief());
    expect(refused.status).toBe(429);
    const body = (await refused.json()) as { retryAfter: number };
    expect(body.retryAfter).toBeGreaterThan(0);
    expect(refused.headers.get("retry-after")).toBe(String(body.retryAfter));
  });

  it("checks the Turnstile token when the bot check is configured", async () => {
    const tokens = withTurnstile({ success: true, hostname: "leffloard.test", action: "contact" });
    try {
      expect((await post(brief({ turnstileToken: "token-1" }))).status).toBe(201);
      expect(tokens).toEqual(["token-1"]);
    } finally {
      withoutTurnstile();
    }
  });

  it("refuses a failed bot check, stores nothing, and lets the same form be sent again", async () => {
    withTurnstile({ success: false, "error-codes": ["invalid-input-response"] });
    try {
      const key = { "idempotency-key": "form-retry-after-failure" };
      const refused = await post(brief({ turnstileToken: "bad" }), key);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "turnstile" });
      expect(await inquiries()).toEqual([]);
      withTurnstile({ success: true, hostname: "leffloard.test", action: "contact" });
      expect((await post(brief({ turnstileToken: "good" }), key)).status).toBe(201);
      expect(await inquiries()).toHaveLength(1);
    } finally {
      withoutTurnstile();
    }
  });

  it("files a blocked sender's message as spam without alerts", async () => {
    await block(db(), "email", "alan@example.com");
    expect((await post(brief())).status).toBe(201);
    const [stored] = await inquiries();
    expect(stored?.status).toBe("spam");
    expect(await db().collection("outbox").countDocuments()).toBe(0);
  });
});
