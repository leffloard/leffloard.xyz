import { createHmac, randomUUID } from "node:crypto";
import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as checkout } from "@/app/api/invoices/[publicId]/checkout/route";
import { POST as ipn } from "@/app/api/payments/nowpayments/route";
import { reconcileCryptoPayments } from "@/server/billing/ipn";
import { nowPaymentsConfig } from "@/server/billing/nowpayments";
import { invoices, payments } from "@/server/billing/collections";
import { createInvoice, issueInvoice, type InvoiceInput } from "@/server/billing/invoices";
import {
  applyProviderStatus,
  openCryptoAttempt,
  recordBankPayment,
  refundPayment,
  resolveReview,
} from "@/server/billing/payments";
import { getBillingSettings, saveBankAccounts } from "@/server/billing/settings";
import type { InvoiceDoc, PaymentDoc } from "@/server/billing/types";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { readChannels } from "@/server/notify/channels";
import type { OutboxDoc } from "@/server/notify/outbox";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

vi.mock("@/server/notify/kick", () => ({ sendQueuedSoon: vi.fn() }));

const SECRET = "ipn-secret-for-tests";
const API = "https://np.test/v1";
const { db, url, name } = setupTestDb();
setupTestEnv({
  MONGO_URL: url,
  DB_NAME: name,
  EMAIL_DELIVERY: "log",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
  NOWPAYMENTS_API_KEY: "api-key-for-tests",
  NOWPAYMENTS_IPN_SECRET: SECRET,
  NOWPAYMENTS_API_URL: API,
});

// Monday 28 September 2026, 09:00 in Istanbul.
const NOW = new Date("2026-09-28T06:00:00Z");
const TODAY = "2026-09-28";

// NOWPayments' API as a stub of fetch: the invoices it made, and its payments as each test sets them.
const remote = {
  payments: new Map<string, Record<string, unknown>>(),
  invoices: [] as Record<string, unknown>[],
  down: false,
};

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
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
    NOW,
  );
  remote.payments.clear();
  remote.invoices = [];
  remote.down = false;
  vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
    if (remote.down) throw new TypeError("fetch failed");
    if (new Headers(init?.headers).get("x-api-key") !== "api-key-for-tests") {
      return new Response("unauthorized", { status: 401 });
    }
    const address = String(input);
    if (address === `${API}/invoice` && init?.method === "POST") {
      remote.invoices.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      const id = String(4_500_000_000 + remote.invoices.length);
      return Response.json({ id, invoice_url: `https://nowpayments.test/payment/?iid=${id}` });
    }
    const found = /\/payment\/(\d+)$/.exec(address);
    const payment = found ? remote.payments.get(found[1]!) : undefined;
    return payment ? Response.json(payment) : new Response("not found", { status: 404 });
  });
});

afterEach(() => {
  resetClock();
  vi.unstubAllGlobals();
});

afterAll(async () => {
  await closeClient();
});

async function issued(overrides: Partial<InvoiceInput> = {}): Promise<InvoiceDoc> {
  const draft = await createInvoice(
    db(),
    {
      title: "Deposit: Shop rebuild",
      clientId: null,
      projectId: null,
      recipient: { name: "Ada Lovelace", company: null, email: "ada@example.com", address: "" },
      currency: "USD",
      lines: [{ id: randomUUID(), description: "Deposit", quantityMilli: 1000, unitMinor: 92_500 }],
      discount: null,
      taxes: [],
      notes: "",
      methods: ["bank", "crypto"],
      ...overrides,
    },
    {},
    NOW,
  );
  const result = await issueInvoice(db(), draft._id, 1, await getBillingSettings(db()), TODAY, NOW);
  if (!result.ok) throw new Error(`The invoice was not issued: ${result.reason}`);
  return result.invoice;
}

function startCheckout(invoice: InvoiceDoc): Promise<Response> {
  const request = new Request(`https://leffloard.test/api/invoices/${invoice.publicId}/checkout`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9",
      origin: "https://leffloard.test",
      "sec-fetch-site": "same-origin",
    },
    body: "{}",
  });
  return checkout(request, { params: Promise.resolve({ publicId: invoice.publicId }) });
}

// The invoice's crypto checkout, opened the way a client does.
async function checkoutOf(invoice: InvoiceDoc): Promise<PaymentDoc> {
  expect((await startCheckout(invoice)).status).toBe(200);
  return (await payments(db()).findOne({ invoiceId: invoice._id, method: "crypto", status: "pending" }))!;
}

// A callback signed the way NOWPayments' plugins do it: the body's JSON with its keys sorted.
function callback(body: Record<string, unknown>, secret = SECRET): Promise<Response> {
  const sorted = Object.fromEntries(
    Object.keys(body)
      .sort()
      .map((key) => [key, body[key]]),
  );
  const request = new Request("https://leffloard.test/api/payments/nowpayments", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "198.51.100.20",
      "x-nowpayments-sig": createHmac("sha512", secret).update(JSON.stringify(sorted)).digest("hex"),
    },
    body: JSON.stringify(body),
  });
  return ipn(request);
}

// A payment as NOWPayments' API reports it, for the given checkout.
function nowPayment(
  invoice: InvoiceDoc,
  attempt: PaymentDoc,
  paymentId: number,
  status: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    payment_id: paymentId,
    invoice_id: Number(attempt.provider?.invoiceId),
    payment_status: status,
    order_id: `${invoice.number}:${attempt._id.toHexString()}`,
    price_amount: attempt.amountMinor / 100,
    price_currency: attempt.currency.toLowerCase(),
    pay_amount: 925.3,
    pay_currency: "usdttrc20",
    actually_paid: status === "finished" ? 925.3 : 0,
    updated_at: `2026-09-28T06:${String(10 + remote.payments.size).padStart(2, "0")}:00.000Z`,
    ...extra,
  };
}

// NOWPayments' API reports the payment, and then calls back about it.
async function report(payment: Record<string, unknown>): Promise<unknown> {
  remote.payments.set(String(payment.payment_id), payment);
  return (await callback(payment)).json();
}

const outboxLabels = async () =>
  (await db().collection<OutboxDoc>("outbox").find().sort({ _id: 1 }).toArray()).map((item) => item.label);

describe("bank transfers", () => {
  it("count towards the invoice until it's paid, never beyond, and can be refunded", async () => {
    const invoice = await issued();
    const part = await recordBankPayment(
      db(),
      invoice._id,
      { amountMinor: 50_000, receivedOn: TODAY, reference: "EFT 1" },
      NOW,
    );
    expect(part.ok && part.invoice).toMatchObject({ status: "issued", paidMinor: 50_000 });
    const tooMuch = await recordBankPayment(
      db(),
      invoice._id,
      { amountMinor: 50_000, receivedOn: TODAY, reference: "" },
      NOW,
    );
    expect(tooMuch).toMatchObject({ ok: false, reason: "invalid" });
    const rest = await recordBankPayment(
      db(),
      invoice._id,
      { amountMinor: 42_500, receivedOn: TODAY, reference: "EFT 2" },
      NOW,
    );
    if (!rest.ok) throw new Error(rest.message);
    expect(rest.invoice).toMatchObject({ status: "paid", paidMinor: 92_500, paidAt: NOW });
    expect(
      await recordBankPayment(db(), invoice._id, { amountMinor: 1, receivedOn: TODAY, reference: "" }, NOW),
    ).toMatchObject({ ok: false, reason: "invalid" });

    const refunded = await refundPayment(db(), rest.payment._id, "Sent back by EFT.", NOW);
    expect(refunded.ok && refunded.invoice).toMatchObject({
      status: "issued",
      paidMinor: 50_000,
      paidAt: null,
    });
    expect(refunded.ok && refunded.payment).toMatchObject({
      status: "refunded",
      reviewReason: "Sent back by EFT.",
    });
    expect(await refundPayment(db(), rest.payment._id, "Again", NOW)).toMatchObject({ ok: false });
  });

  it("can't be recorded on a credit note or a missing invoice", async () => {
    const note = await issued();
    await invoices(db()).updateOne({ _id: note._id }, { $set: { kind: "credit" } });
    expect(
      await recordBankPayment(db(), note._id, { amountMinor: 100, receivedOn: TODAY, reference: "" }, NOW),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      await recordBankPayment(
        db(),
        new ObjectId(),
        { amountMinor: 100, receivedOn: TODAY, reference: "" },
        NOW,
      ),
    ).toMatchObject({ ok: false, reason: "missing" });
  });
});

describe("crypto checkouts", () => {
  it("open one payment page per invoice, however often the client clicks", async () => {
    const invoice = await issued();
    const first = await startCheckout(invoice);
    expect(await first.json()).toEqual({ url: "https://nowpayments.test/payment/?iid=4500000001" });
    expect(remote.invoices).toEqual([
      expect.objectContaining({
        price_amount: 925,
        price_currency: "usd",
        order_id: expect.stringMatching(/^INV-2026-0001:[a-f0-9]{24}$/),
        ipn_callback_url: "https://leffloard.test/api/payments/nowpayments",
        success_url: `https://leffloard.test/pay/return?i=${invoice.publicId}`,
        cancel_url: `https://leffloard.test/i/${invoice.publicId}`,
      }),
    ]);
    const again = await startCheckout(invoice);
    expect(await again.json()).toEqual({ url: "https://nowpayments.test/payment/?iid=4500000001" });
    expect(remote.invoices).toHaveLength(1);

    // Clicks at the same moment share one checkout: the database allows one open per invoice.
    const other = await issued();
    const attempts = await Promise.all([1, 2, 3].map(() => openCryptoAttempt(db(), other, NOW)));
    expect(new Set(attempts.map((attempt) => attempt.payment._id.toHexString())).size).toBe(1);
    expect(attempts.filter((attempt) => attempt.fresh)).toHaveLength(1);
  });

  it("start again once the amount changed, or when a page was never made", async () => {
    const invoice = await issued();
    const first = await checkoutOf(invoice);
    await recordBankPayment(
      db(),
      invoice._id,
      { amountMinor: 20_000, receivedOn: TODAY, reference: "" },
      NOW,
    );
    const second = await checkoutOf((await invoices(db()).findOne({ _id: invoice._id }))!);
    expect(second.amountMinor).toBe(72_500);
    expect(await payments(db()).findOne({ _id: first._id })).toMatchObject({
      status: "failed",
      reviewReason: "Replaced by a newer checkout.",
    });

    // A checkout whose page was never made (the server stopped half way).
    const stuck = await issued();
    const { payment } = await openCryptoAttempt(db(), stuck, NOW);
    expect(await startCheckout(stuck)).toHaveProperty("status", 409);
    setClock(() => new Date(NOW.getTime() + 3 * 60_000));
    expect(await startCheckout(stuck)).toHaveProperty("status", 200);
    expect((await payments(db()).findOne({ _id: payment._id }))?.status).toBe("failed");
  });

  it("are refused when crypto isn't offered or the invoice is paid, and fail over to the bank", async () => {
    const bankOnly = await issued({ methods: ["bank"] });
    expect((await startCheckout(bankOnly)).status).toBe(409);

    const paid = await issued();
    await recordBankPayment(db(), paid._id, { amountMinor: 92_500, receivedOn: TODAY, reference: "" }, NOW);
    expect((await startCheckout(paid)).status).toBe(409);

    const invoice = await issued();
    remote.down = true;
    const failed = await startCheckout(invoice);
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({
      error: "Crypto payment is unavailable right now. Please pay by bank transfer.",
    });
    expect(await payments(db()).findOne({ invoiceId: invoice._id })).toMatchObject({ status: "failed" });
    remote.down = false;
    expect((await startCheckout(invoice)).status).toBe(200);
  });
});

describe("NOWPayments callbacks", () => {
  it("confirm a finished payment once, and tell both sides", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    const finished = nowPayment(invoice, attempt, 6_000_000_001, "finished");
    remote.payments.set("6000000001", finished);

    // A forged callback changes nothing, and is kept for a week as a trace.
    const forged = await callback(finished, "not-the-secret");
    expect(forged.status).toBe(401);
    expect((await invoices(db()).findOne({ _id: invoice._id }))?.status).toBe("issued");
    expect(await db().collection("payment_events").findOne({ outcome: "rejected" })).toMatchObject({
      signatureOk: false,
      purgeAt: new Date(NOW.getTime() + 7 * 86_400_000),
    });

    expect(await report(finished)).toEqual({ ok: true, outcome: "confirmed" });
    expect(await invoices(db()).findOne({ _id: invoice._id })).toMatchObject({
      status: "paid",
      paidMinor: 92_500,
    });
    expect(await payments(db()).findOne({ _id: attempt._id })).toMatchObject({
      status: "confirmed",
      confirmedAt: NOW,
      provider: {
        invoiceId: "4500000001",
        paymentId: "6000000001",
        payCurrency: "usdttrc20",
        actuallyPaid: "925.3",
        lastStatus: "finished",
      },
    });
    expect(await outboxLabels()).toEqual([
      "Receipt for INV-2026-0001 to Ada Lovelace",
      "Payment received: INV-2026-0001",
    ]);

    // The same callback again, and a late one from before it finished: nothing more happens.
    expect(await (await callback(finished)).json()).toEqual({ ok: true, outcome: "duplicate" });
    const late = await callback({
      ...finished,
      payment_status: "confirming",
      updated_at: "2026-09-28T05:59:00.000Z",
    });
    expect(await late.json()).toEqual({ ok: true, outcome: "ignored" });
    expect((await invoices(db()).findOne({ _id: invoice._id }))?.paidMinor).toBe(92_500);
    expect(await outboxLabels()).toHaveLength(2);
  });

  it("go by NOWPayments' API, not by what the callback claims", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    remote.payments.set("6000000001", nowPayment(invoice, attempt, 6_000_000_001, "waiting"));
    // Signed with the secret, but the API says the payment is still waiting.
    const claim = nowPayment(invoice, attempt, 6_000_000_001, "finished");
    expect(await (await callback(claim)).json()).toEqual({ ok: true, outcome: "pending" });
    expect((await invoices(db()).findOne({ _id: invoice._id }))?.paidMinor).toBe(0);

    // A payment for an order that isn't ours.
    expect(
      await report({ ...nowPayment(invoice, attempt, 6_000_000_002, "finished"), order_id: "elsewhere-42" }),
    ).toEqual({ ok: true, outcome: "ignored" });
    expect((await invoices(db()).findOne({ _id: invoice._id }))?.paidMinor).toBe(0);
  });

  it("put a part payment, or one that doesn't match its checkout, in front of the owner", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    const part = nowPayment(invoice, attempt, 6_000_000_002, "partially_paid", {
      pay_amount: 0.0141,
      actually_paid: 0.007,
      pay_currency: "btc",
    });
    expect(await report(part)).toEqual({ ok: true, outcome: "review" });
    const held = (await payments(db()).findOne({ _id: attempt._id }))!;
    expect(held.status).toBe("review");
    expect(held.reviewReason).toContain("Part paid: 0.007 of 0.0141 btc.");
    expect((await outboxLabels()).at(-1)).toBe("Payment to review: INV-2026-0001");

    // The owner counts what arrived.
    const resolved = await resolveReview(db(), attempt._id, { confirm: true, amountMinor: 46_000 }, NOW);
    expect(resolved.ok && resolved.invoice).toMatchObject({ status: "issued", paidMinor: 46_000 });
    expect(await resolveReview(db(), attempt._id, { confirm: false }, NOW)).toMatchObject({
      ok: false,
      reason: "conflict",
    });

    // "Finished", but for another amount than the checkout's: held back all the same.
    const other = await issued();
    const second = await checkoutOf(other);
    const wrong = { ...nowPayment(other, second, 6_000_000_003, "finished"), price_amount: 9.25 };
    expect(await report(wrong)).toEqual({ ok: true, outcome: "review" });
    expect((await payments(db()).findOne({ _id: second._id }))?.reviewReason).toBe(
      "NOWPayments reports finished, but the amount is 9.25.",
    );
    expect((await invoices(db()).findOne({ _id: other._id }))?.paidMinor).toBe(0);
    const failed = await resolveReview(db(), second._id, { confirm: false }, NOW);
    expect(failed.ok && failed.payment.status).toBe("failed");
  });

  it("hold back money the invoice no longer needs", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    // Part of it came by bank transfer while the client was on NOWPayments' page.
    await recordBankPayment(
      db(),
      invoice._id,
      { amountMinor: 10_000, receivedOn: TODAY, reference: "" },
      NOW,
    );
    expect(await report(nowPayment(invoice, attempt, 6_000_000_004, "finished"))).toEqual({
      ok: true,
      outcome: "review",
    });
    expect(await payments(db()).findOne({ _id: attempt._id })).toMatchObject({
      status: "review",
      confirmedAt: null,
      reviewReason: "More than what's left to pay: the invoice was partly paid another way meanwhile.",
    });
    expect((await invoices(db()).findOne({ _id: invoice._id }))?.paidMinor).toBe(10_000);
  });

  it("follow the client switching coins, and keep a second payment apart", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    // The client picks bitcoin, then switches to USDT: NOWPayments makes a payment for each.
    for (const id of [6_000_000_010, 6_000_000_011]) {
      expect(await report(nowPayment(invoice, attempt, id, "waiting"))).toEqual({
        ok: true,
        outcome: "pending",
      });
    }
    // The abandoned bitcoin payment expires: the checkout follows the USDT one and stays open.
    expect(await report(nowPayment(invoice, attempt, 6_000_000_010, "expired"))).toEqual({
      ok: true,
      outcome: "ignored",
    });
    expect((await payments(db()).findOne({ _id: attempt._id }))?.status).toBe("pending");
    expect(await report(nowPayment(invoice, attempt, 6_000_000_011, "finished"))).toEqual({
      ok: true,
      outcome: "confirmed",
    });

    // The client pays again on the same page: a record of its own, for the owner to refund or count.
    for (const status of ["partially_paid", "finished"]) {
      expect(await report(nowPayment(invoice, attempt, 6_000_000_012, status))).toEqual({
        ok: true,
        outcome: "review",
      });
    }
    const records = await payments(db())
      .find({ invoiceId: invoice._id })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    expect(records.map((record) => [record.status, record.provider?.paymentId])).toEqual([
      ["confirmed", "6000000011"],
      ["review", "6000000012"],
    ]);
    expect(records[1]).toMatchObject({
      provider: { invoiceId: "4500000001", lastStatus: "finished" },
      reviewReason: expect.stringContaining("A second payment arrived through the same checkout"),
    });
    expect((await invoices(db()).findOne({ _id: invoice._id }))?.paidMinor).toBe(92_500);
  });

  it("are taken again when NOWPayments retries after a failure", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    const finished = nowPayment(invoice, attempt, 6_000_000_020, "finished");
    remote.payments.set("6000000020", finished);
    remote.down = true;
    const failed = await callback(finished);
    expect(failed.status).toBe(500);
    expect(await db().collection("payment_events").findOne({ paymentId: "6000000020" })).toMatchObject({
      outcome: "error",
      detail: expect.stringContaining("NOWPayments did not answer"),
    });
    remote.down = false;
    expect(await (await callback(finished)).json()).toEqual({ ok: true, outcome: "confirmed" });
    expect(await (await callback(finished)).json()).toEqual({ ok: true, outcome: "duplicate" });
  });

  it("apply each payment once, whatever order its callbacks arrive in", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    remote.payments.set("6000000030", nowPayment(invoice, attempt, 6_000_000_030, "finished"));
    const bodies = ["waiting", "confirming", "confirmed", "sending", "finished"].map((status, index) => ({
      ...nowPayment(invoice, attempt, 6_000_000_030, status),
      updated_at: `2026-09-28T06:3${index}:00.000Z`,
    }));
    const responses = await Promise.all([...bodies, ...bodies].reverse().map((body) => callback(body)));
    const outcomes = await Promise.all(
      responses.map(async (response) => ((await response.json()) as { outcome: string }).outcome),
    );
    expect(outcomes.filter((outcome) => outcome === "confirmed")).toHaveLength(1);
    // A repeat that arrives while its first copy is being handled is asked to come back later ("busy").
    expect(
      outcomes.filter((outcome) => !["confirmed", "ignored", "duplicate", "busy"].includes(outcome)),
    ).toEqual([]);
    expect(await invoices(db()).findOne({ _id: invoice._id })).toMatchObject({
      status: "paid",
      paidMinor: 92_500,
    });
    expect(await payments(db()).countDocuments({ invoiceId: invoice._id })).toBe(1);
    expect(await outboxLabels()).toHaveLength(2);
  });

  it("never move a confirmed payment back", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    const update = {
      paymentId: "6000000040",
      payCurrency: "btc",
      actuallyPaid: "0.01",
      lastStatus: "finished",
    };
    const confirmed = await applyProviderStatus(db(), attempt._id, { ...update, status: "confirmed" }, NOW);
    expect(confirmed.kind).toBe("confirmed");
    for (const status of ["pending", "failed", "review"] as const) {
      expect((await applyProviderStatus(db(), attempt._id, { ...update, status }, NOW)).kind).toBe(
        "unchanged",
      );
    }
    expect((await payments(db()).findOne({ _id: attempt._id }))?.status).toBe("confirmed");
  });

  it("take a callback again when its first handling stopped half way, but not while it's still going", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    const finished = nowPayment(invoice, attempt, 6_000_000_050, "finished");
    remote.payments.set("6000000050", finished);
    const key = `nowpayments:6000000050:finished:${String(finished.updated_at)}`;
    const events = db().collection<{ _id: string; [field: string]: unknown }>("payment_events");

    // Stored a moment ago and still being handled (by another request): NOWPayments should come back.
    await events.insertOne({ _id: key, outcome: "received", receivedAt: new Date(NOW.getTime() - 30_000) });
    const busy = await callback(finished);
    expect(busy.status).toBe(503);
    expect(await busy.json()).toEqual({ ok: false, outcome: "busy" });

    // Stored long ago and never finished (the server restarted): handled now.
    await events.updateOne({ _id: key }, { $set: { receivedAt: new Date(NOW.getTime() - 5 * 60_000) } });
    expect(await (await callback(finished)).json()).toEqual({ ok: true, outcome: "confirmed" });
    expect((await invoices(db()).findOne({ _id: invoice._id }))?.status).toBe("paid");
  });

  it("are not needed to settle a payment: a job reads pending ones from NOWPayments", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    // NOWPayments said "waiting", then the "finished" callback never arrived.
    expect(await report(nowPayment(invoice, attempt, 6_000_000_060, "waiting"))).toEqual({
      ok: true,
      outcome: "pending",
    });
    remote.payments.set("6000000060", nowPayment(invoice, attempt, 6_000_000_060, "finished"));
    const config = nowPaymentsConfig()!;
    const notify = { siteUrl: "https://leffloard.test", channels: readChannels() };
    // Not while it's recent: its callbacks may still be on their way.
    expect(await reconcileCryptoPayments(db(), config, notify, NOW)).toEqual({ checked: 0, settled: 0 });
    const later = new Date(NOW.getTime() + 15 * 60_000);
    expect(await reconcileCryptoPayments(db(), config, notify, later)).toEqual({ checked: 1, settled: 1 });
    expect(await invoices(db()).findOne({ _id: invoice._id })).toMatchObject({
      status: "paid",
      paidMinor: 92_500,
    });
    expect((await outboxLabels()).filter((label) => label.startsWith("Receipt"))).toHaveLength(1);
  });

  it("keep a payment on its own record after the owner failed the checkout", async () => {
    const invoice = await issued();
    const attempt = await checkoutOf(invoice);
    // A part payment puts the checkout in review; a second payment gets a record of its own.
    await report(nowPayment(invoice, attempt, 6_000_000_070, "partially_paid"));
    expect(await report(nowPayment(invoice, attempt, 6_000_000_071, "confirming"))).toEqual({
      ok: true,
      outcome: "ignored",
    });
    expect(await report(nowPayment(invoice, attempt, 6_000_000_071, "finished"))).toEqual({
      ok: true,
      outcome: "review",
    });
    // The owner marks the checkout's part payment failed (refunded it, say).
    await resolveReview(db(), attempt._id, { confirm: false }, NOW);
    // The second payment's next callback updates its own record, and never errors.
    const again = await report({
      ...nowPayment(invoice, attempt, 6_000_000_071, "finished"),
      updated_at: "2026-09-28T07:00:00.000Z",
    });
    expect(again).toEqual({ ok: true, outcome: "review" });
    const records = await payments(db())
      .find({ invoiceId: invoice._id })
      .sort({ createdAt: 1, _id: 1 })
      .toArray();
    expect(records.map((record) => [record.status, record.provider?.paymentId])).toEqual([
      ["failed", "6000000070"],
      ["review", "6000000071"],
    ]);
  });
});
