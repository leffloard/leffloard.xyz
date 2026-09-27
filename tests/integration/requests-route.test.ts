import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/requests/route";
import { addDays, todayIn } from "@/lib/intake/time";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { clearEnvCache } from "@/server/env";
import { block } from "@/server/inquiries/blocklist";
import type { InquiryDoc } from "@/server/inquiries/types";
import type { OutboxDoc } from "@/server/notify/outbox";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

// The v1 request API, ported from tests/test_requests_api.py. See tests/legacy-parity.md.

vi.mock("@/server/notify/kick", () => ({ sendQueuedSoon: vi.fn() }));
vi.mock("@/server/analytics/kick", () => ({ goalSoon: vi.fn() }));
vi.mock("@/server/ai/kick", () => ({ triageSoon: vi.fn() }));

const { db, url, name } = setupTestDb();
const CHANNELS = {
  SMTP_HOST: "smtp.leffloard.test",
  SMTP_USERNAME: "mailer@leffloard.test",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
  DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/1/token",
};
setupTestEnv({ MONGO_URL: url, DB_NAME: name, ...CHANNELS });

beforeEach(async () => {
  await runMigrations(db());
});

afterAll(async () => {
  await closeClient();
});

const futureDate = () => addDays(todayIn("Europe/Istanbul", new Date()), 7);

const appointment = (overrides: Record<string, unknown> = {}) => ({
  type: "appointment",
  name: "Ada Lovelace",
  email: "ada@example.com",
  contact_handle: "ada#0001",
  service: "Web Development",
  subject: "Kickoff call",
  message: "Let's plan the new landing page.",
  preferred_date: futureDate(),
  preferred_time: "14:30",
  timezone: "Europe/Istanbul",
  duration_minutes: 45,
  website: "",
  ...overrides,
});

const inquiry = (overrides: Record<string, unknown> = {}) => ({
  type: "inquiry",
  name: "Alan Turing",
  email: "alan@example.com",
  subject: "Discord bot pricing",
  message: "How much would a moderation bot cost?",
  ...overrides,
});

function post(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return POST(
    new Request("https://leffloard.test/api/requests", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.5", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const stored = (publicId: string) => db().collection<InquiryDoc>("inquiries").findOne({ publicId });
const storedCount = () => db().collection("inquiries").countDocuments();
const outboxItems = () => db().collection<OutboxDoc>("outbox").find().sort({ createdAt: 1 }).toArray();

async function fieldErrors(response: Response): Promise<Record<string, string>> {
  expect(response.status).toBe(422);
  const { detail } = (await response.json()) as { detail: { field: string; message: string }[] };
  for (const item of detail) expect(Object.keys(item).sort()).toEqual(["field", "message"]);
  return Object.fromEntries(detail.map((item) => [item.field, item.message]));
}

function withEnv(overrides: Record<string, string>): void {
  for (const [key, value] of Object.entries(overrides)) vi.stubEnv(key, value);
  clearEnvCache();
}

describe("POST /api/requests", () => {
  it("stores an appointment and answers like v1", async () => {
    const response = await post(appointment({ extra_field: "ignored" }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; status: string; created_at: string };
    expect(Object.keys(body).sort()).toEqual(["created_at", "id", "status"]);
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(body.status).toBe("new");
    expect(body.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);
    expect(Math.abs(Date.now() - Date.parse(body.created_at))).toBeLessThan(10_000);

    const doc = await stored(body.id);
    expect(doc).toMatchObject({
      publicId: body.id,
      kind: "call",
      status: "new",
      source: "legacy-api",
      name: "Ada Lovelace",
      email: "ada@example.com",
      contact: "ada#0001",
      service: "websites",
      subject: "Kickoff call",
      message: "Let's plan the new landing page.",
      projectReference: null,
      call: { timeZone: "Europe/Istanbul", date: futureDate(), time: "14:30", duration: 45 },
      scheduledAt: null,
      note: "",
      history: [],
      replies: [],
      aiOptOut: false,
    });
    expect(doc?.ref).toMatch(/^INQ-\d{4}-0001$/);
    expect(doc?.receivedAt.toISOString().replace("Z", "+00:00")).toBe(body.created_at);
    expect(doc).not.toHaveProperty("extra_field");
    expect(doc).not.toHaveProperty("website");
  });

  it("stores a question with only the required fields", async () => {
    const { id } = (await (await post(inquiry())).json()) as { id: string };
    expect(await stored(id)).toMatchObject({ kind: "question", contact: null, service: null, call: null });
  });

  it("answers a filled honeypot with a fake success, and stores and sends nothing", async () => {
    const response = await post(appointment({ website: "https://spam.example" }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string; status: string };
    expect(body.status).toBe("new");
    expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await storedCount()).toBe(0);
    expect(await outboxItems()).toEqual([]);
  });

  it("treats a blank honeypot as empty, and never stores it", async () => {
    const response = await post(inquiry({ website: "   " }));
    expect(response.status).toBe(201);
    expect(await stored(((await response.json()) as { id: string }).id)).not.toHaveProperty("website");
  });

  it("explains a body that is not a JSON object", async () => {
    expect(await fieldErrors(await post("{not json"))).toEqual({
      body: "The request body must be valid JSON.",
    });
    expect(await fieldErrors(await post(["not", "an", "object"]))).toEqual({
      body: "The request body must be a JSON object.",
    });
    expect(await fieldErrors(await post("null"))).toEqual({
      body: "The request body must be a JSON object.",
    });
  });

  it("lists every field problem with v1's 422 format", async () => {
    const errors = await fieldErrors(await post({}));
    expect(Object.keys(errors)).toEqual(["type", "name", "email", "subject", "message"]);
    expect(errors.name).toBe("Please enter your name.");
    expect(await storedCount()).toBe(0);
  });

  it("allows five requests per address every ten minutes; refused ones don't count", async () => {
    for (let count = 0; count < 3; count++) expect((await post({})).status).toBe(422);
    for (let count = 0; count < 5; count++) expect((await post(inquiry())).status).toBe(201);
    const refused = await post(inquiry());
    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ detail: "Too many requests. Please try again later." });
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await storedCount()).toBe(5);
    // Another address is not affected.
    expect((await post(inquiry(), { "x-forwarded-for": "198.51.100.7" })).status).toBe(201);
  });

  it("behind Cloudflare, keys the limit on CF-Connecting-IP, not on a forged X-Forwarded-For", async () => {
    withEnv({ CLIENT_IP_SOURCE: "cloudflare" });
    try {
      for (let index = 0; index < 5; index++) {
        const response = await post(inquiry(), {
          "cf-connecting-ip": "198.51.100.66",
          "x-forwarded-for": `203.0.113.${index}`,
        });
        expect(response.status).toBe(201);
      }
      const spoofed = await post(inquiry(), {
        "cf-connecting-ip": "198.51.100.66",
        "x-forwarded-for": "10.9.99.1",
      });
      expect(spoofed.status).toBe(429);
      expect((await post(inquiry(), { "cf-connecting-ip": "198.51.100.67" })).status).toBe(201);
    } finally {
      withEnv({ CLIENT_IP_SOURCE: "socket" });
    }
  });

  it("queues a Discord alert and an owner email for each new request", async () => {
    const { id } = (await (await post(appointment())).json()) as { id: string };
    const doc = await stored(id);
    const items = await outboxItems();
    expect(items.map((item) => [item.channel, item.dedupeKey, item.status])).toEqual([
      ["discord", `inquiry:${doc!._id.toHexString()}:discord`, "pending"],
      ["email", `inquiry:${doc!._id.toHexString()}:email`, "pending"],
    ]);
    const [discord, email] = items;
    if (discord?.channel !== "discord" || email?.channel !== "email") throw new Error("unexpected channels");
    expect(discord.payload.embeds[0]?.title).toBe("New call request");
    expect(email.payload.to).toEqual([{ address: "owner@leffloard.test" }]);
    expect(email.payload.subject).toBe("New call request from Ada Lovelace: Kickoff call");
    // The webhook address stays in the configuration; the outbox never stores it.
    expect(JSON.stringify(items)).not.toContain("discord.test/api/webhooks");
  });

  it.each([
    [{ DISCORD_WEBHOOK_URL: "" }, ["email"]],
    [{ SMTP_HOST: "" }, ["discord"]],
    [{ NOTIFY_EMAIL_TO: "" }, ["discord"]],
    [{ DISCORD_WEBHOOK_URL: "", SMTP_HOST: "" }, []],
  ])("skips channels that are not configured: %j", async (overrides, channels) => {
    withEnv(overrides);
    try {
      expect((await post(inquiry())).status).toBe(201);
      expect((await outboxItems()).map((item) => item.channel)).toEqual(channels);
    } finally {
      withEnv(CHANNELS);
    }
  });

  it("files a blocked sender's request as spam, without alerts, and answers as usual", async () => {
    await block(db(), "domain", "someone@spam.example");
    const response = await post(inquiry({ email: "bot@spam.example" }));
    expect(response.status).toBe(201);
    expect(await stored(((await response.json()) as { id: string }).id)).toMatchObject({ status: "spam" });
    expect(await outboxItems()).toEqual([]);
  });

  it("refuses cross-site posts and huge bodies", async () => {
    expect((await post(inquiry(), { origin: "https://evil.example" })).status).toBe(403);
    expect((await post(inquiry({ message: "x".repeat(70_000) }))).status).toBe(413);
    expect(await storedCount()).toBe(0);
  });
});
