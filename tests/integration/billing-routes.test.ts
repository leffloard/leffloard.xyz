import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as accept } from "@/app/api/quotes/[publicId]/accept/route";
import { POST as decline } from "@/app/api/quotes/[publicId]/decline/route";
import { SCHEDULES } from "@/lib/billing/document";
import { createQuote, sendQuote } from "@/server/billing/quotes";
import { saveBankAccounts, DEFAULT_BILLING } from "@/server/billing/settings";
import { invoices, quotes } from "@/server/billing/collections";
import { createClient } from "@/server/clients/store";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import type { OutboxDoc } from "@/server/notify/outbox";
import { clientInput } from "../helpers/work";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

vi.mock("@/server/notify/kick", () => ({ sendQueuedSoon: vi.fn() }));

const { db, url, name } = setupTestDb();
setupTestEnv({
  MONGO_URL: url,
  DB_NAME: name,
  EMAIL_DELIVERY: "log",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
});

// Monday 28 September 2026, 09:00 in Istanbul.
const NOW = new Date("2026-09-28T06:00:00Z");

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
});

afterEach(() => resetClock());

afterAll(async () => {
  await closeClient();
});

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://leffloard.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
      origin: "https://leffloard.test",
      "sec-fetch-site": "same-origin",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

async function sentQuote() {
  await saveBankAccounts(
    db(),
    [
      {
        id: "bank-1",
        label: "Dollars",
        holder: "Mert Kaan Koparan",
        bankName: "Example Bank",
        iban: "TR330006100519786457841326",
        swift: null,
        currency: null,
      },
    ],
    0,
    NOW,
  );
  const client = await createClient(db(), clientInput(), {}, NOW);
  const quote = await createQuote(
    db(),
    {
      title: "Shop rebuild",
      clientId: client._id,
      inquiryId: null,
      recipient: { name: "Ada Lovelace", company: null, email: "ada@example.com", address: "" },
      currency: "USD",
      lines: [{ id: randomUUID(), description: "Design and build", quantityMilli: 1000, unitMinor: 200_000 }],
      discount: null,
      taxes: [],
      notes: "",
      schedule: [...SCHEDULES.half.steps],
      timeline: "",
      revisionsIncluded: 2,
      extraRevisionMinor: null,
    },
    NOW,
  );
  const sent = await sendQuote(
    db(),
    quote._id,
    1,
    { quoteValidityDays: 14, business: DEFAULT_BILLING.business },
    "2026-09-28",
    NOW,
  );
  if (!sent.ok) throw new Error("not sent");
  return sent.quote;
}

const params = (publicId: string) => ({ params: Promise.resolve({ publicId }) });
const outbox = () => db().collection<OutboxDoc>("outbox").find().sort({ createdAt: 1, _id: 1 }).toArray();

describe("answering a quote from its link", () => {
  it("accepts the version the client read, tells the owner, and sends the first invoice", async () => {
    const quote = await sentQuote();
    const path = `/api/quotes/${quote.publicId}/accept`;

    const crossSite = await accept(
      post(
        path,
        { version: 2, name: "Ada", agree: true },
        { origin: "https://evil.example", "sec-fetch-site": "cross-site" },
      ),
      params(quote.publicId),
    );
    expect(crossSite.status).toBe(403);

    const unticked = await accept(
      post(path, { version: 2, name: " ", agree: false }),
      params(quote.publicId),
    );
    expect(unticked.status).toBe(422);
    expect((await unticked.json()).errors).toMatchObject({
      name: "Type your name.",
      agree: "Tick the box to accept the quote and its terms.",
    });

    const stale = await accept(post(path, { version: 1, name: "Ada", agree: true }), params(quote.publicId));
    expect(stale.status).toBe(409);
    expect((await stale.json()).problem).toBe("changed");

    const response = await accept(
      post(path, { version: 2, name: "Ada Lovelace", agree: true }),
      params(quote.publicId),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { invoiceUrl: string };
    const invoice = await invoices(db()).findOne({ quoteId: quote._id });
    expect(body.invoiceUrl).toBe(`/i/${invoice!.publicId}`);
    // NOWPayments isn't set up here, so the invoice offers bank transfer only.
    expect(invoice).toMatchObject({
      number: "INV-2026-0001",
      methods: ["bank"],
      totals: { totalMinor: 100_000 },
    });
    expect((await quotes(db()).findOne({ _id: quote._id }))?.acceptedBy).toEqual({
      name: "Ada Lovelace",
      ip: "203.0.113.9",
    });

    const sent = await outbox();
    expect(sent.map((item) => item.label)).toEqual([
      "Quote accepted: Q-2026-0001",
      "Payment request INV-2026-0001 to Ada Lovelace",
    ]);
    const email = sent[1]!.payload as { subject: string; text: string; to: { address: string }[] };
    expect(email.to[0]?.address).toBe("ada@example.com");
    expect(email.subject).toBe("Payment request INV-2026-0001: Deposit: Shop rebuild");
    expect(email.text).toContain(`https://leffloard.test/i/${invoice!.publicId}`);

    const again = await accept(post(path, { version: 2, name: "Ada", agree: true }), params(quote.publicId));
    expect(again.status).toBe(409);
    expect((await again.json()).problem).toBe("answered");
  });

  it("declines with a reason for the owner", async () => {
    const quote = await sentQuote();
    const response = await decline(
      post(`/api/quotes/${quote.publicId}/decline`, { version: 2, reason: "Over our budget this quarter." }),
      params(quote.publicId),
    );
    expect(response.status).toBe(200);
    expect((await quotes(db()).findOne({ _id: quote._id }))?.status).toBe("declined");
    const alert = (await outbox()).at(-1)!;
    expect(alert.label).toBe("Quote declined: Q-2026-0001");
    expect((alert.payload as { text: string }).text).toContain("Over our budget this quarter.");
  });

  it("finds nothing behind an unknown or malformed link", async () => {
    const unknown = "A".repeat(22);
    expect(
      (
        await accept(
          post(`/api/quotes/${unknown}/accept`, { version: 1, name: "X", agree: true }),
          params(unknown),
        )
      ).status,
    ).toBe(404);
    expect((await decline(post("/api/quotes/nope/decline", { version: 1 }), params("nope"))).status).toBe(
      404,
    );
  });
});
