import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ipnSignatureValid, mapNowPaymentsStatus, minorUnits } from "@/server/billing/nowpayments";

const SECRET = "ipn-secret-for-tests";

// A callback as NOWPayments sends it, with a nested object like its "fee".
const BODY = {
  payment_status: "finished",
  payment_id: 5077125051,
  invoice_id: 4522625843,
  order_id: "INV-2026-0001:0123456789abcdef01234567",
  price_amount: 925,
  price_currency: "usd",
  pay_currency: "btc",
  actually_paid: 0.0141,
  updated_at: "2026-09-28T10:00:00.000Z",
  fee: { withdrawalFee: 0, serviceFee: 0.0001, currency: "btc", depositFee: 0 },
};

const sign = (text: string) => createHmac("sha512", SECRET).update(text).digest("hex");

function sortDeep(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortDeep((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

describe("NOWPayments callbacks", () => {
  it("accepts the signature in each form NOWPayments documents", () => {
    // Their SDK: every level sorted.
    expect(ipnSignatureValid(BODY, sign(JSON.stringify(sortDeep(BODY))), SECRET)).toBe(true);
    // Their docs' Node sample: the top level sorted (as a replacer, it also drops unknown nested keys).
    expect(ipnSignatureValid(BODY, sign(JSON.stringify(BODY, Object.keys(BODY).sort())), SECRET)).toBe(true);
    // Their PHP plugin: ksort on the top level only.
    const topSorted = Object.fromEntries(
      Object.keys(BODY)
        .sort()
        .map((key) => [key, BODY[key as keyof typeof BODY]]),
    );
    expect(ipnSignatureValid(BODY, sign(JSON.stringify(topSorted)), SECRET)).toBe(true);
  });

  it("refuses a wrong secret, a changed body, and a malformed header", () => {
    const good = sign(JSON.stringify(sortDeep(BODY)));
    expect(
      ipnSignatureValid(
        BODY,
        createHmac("sha512", "other")
          .update(JSON.stringify(sortDeep(BODY)))
          .digest("hex"),
        SECRET,
      ),
    ).toBe(false);
    expect(ipnSignatureValid({ ...BODY, price_amount: 1 }, good, SECRET)).toBe(false);
    expect(ipnSignatureValid(BODY, null, SECRET)).toBe(false);
    expect(ipnSignatureValid(BODY, "abc", SECRET)).toBe(false);
    expect(ipnSignatureValid([BODY], good, SECRET)).toBe(false);
  });

  it("counts only a finished payment as received", () => {
    expect(mapNowPaymentsStatus("finished")).toBe("confirmed");
    for (const waiting of ["waiting", "confirming", "confirmed", "sending"]) {
      expect(mapNowPaymentsStatus(waiting)).toBe("pending");
    }
    expect(mapNowPaymentsStatus("partially_paid")).toBe("review");
    expect(mapNowPaymentsStatus("expired")).toBe("failed");
    expect(mapNowPaymentsStatus("refunded")).toBe("refunded");
    expect(mapNowPaymentsStatus("mystery")).toBeNull();
  });

  it("reads amounts in minor units, exactly", () => {
    expect(minorUnits(925)).toBe(92_500);
    expect(minorUnits("925.5")).toBe(92_550);
    expect(minorUnits("925.500")).toBe(92_550);
    expect(minorUnits(1234.56)).toBe(123_456);
    // Not an amount we asked for: fractions of a cent, float noise, negatives, words.
    expect(minorUnits("925.505")).toBeNull();
    expect(minorUnits(0.1 + 0.2)).toBeNull();
    expect(minorUnits("abc")).toBeNull();
    expect(minorUnits(-1)).toBeNull();
    expect(minorUnits(1e21)).toBeNull();
    expect(minorUnits(null)).toBeNull();
  });
});
