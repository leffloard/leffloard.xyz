import { describe, expect, it } from "vitest";
import {
  checkSchedule,
  computeTotals,
  documentNumber,
  formatPercent,
  formatQuantity,
  lineAmount,
  parsePercent,
  parseQuantity,
  scheduleAmounts,
  SCHEDULES,
  splitSchedule,
  suggestedSchedule,
} from "@/lib/billing/document";
import { invoiceState, quoteState } from "@/lib/billing/options";
import { formatMoneyCode, MAX_AMOUNT_MINOR, money, scaleMinor } from "@/lib/money";

const line = (quantityMilli: number, unitMinor: number) => ({
  id: "l",
  description: "Work",
  quantityMilli,
  unitMinor,
});

describe("money scaling", () => {
  it("rounds half away from zero, exactly", () => {
    expect(scaleMinor(10_001, 5_000, 10_000)).toBe(5_001); // 50.005 → 50.01
    expect(scaleMinor(-10_001, 5_000, 10_000)).toBe(-5_001);
    expect(scaleMinor(10_000, 333, 1000)).toBe(3_330);
    expect(scaleMinor(100, 333, 1000)).toBe(33); // 33.3 cents
    // The product (9,007,289,326,692,547) is past 2^53, where floats skip integers; the result is exact.
    expect(scaleMinor(90_071_992_547, 100_001, 1_000_000)).toBe(9_007_289_327);
  });

  it("refuses fractions and amounts beyond the limit", () => {
    expect(() => scaleMinor(1.5, 1, 1)).toThrow(RangeError);
    expect(() => scaleMinor(MAX_AMOUNT_MINOR, 2, 1)).toThrow(RangeError);
  });

  it("writes amounts for documents with the currency's code", () => {
    expect(formatMoneyCode(money(125_050, "USD"))).toBe("USD 1,250.50");
    expect(formatMoneyCode(money(1_200_000, "TRY"))).toBe("TRY 12,000.00");
    expect(formatMoneyCode(money(-500, "EUR"))).toBe("-EUR 5.00");
  });
});

describe("document totals", () => {
  it("adds lines, takes the discount off, then adds each tax", () => {
    expect(lineAmount(line(1_500, 10_000))).toBe(15_000); // 1.5 × 100.00
    const totals = computeTotals(
      [line(2_000, 5_000), line(1_000, 3_000)], // 100.00 + 30.00
      { kind: "percent", basisPoints: 1_000 }, // 10%
      [{ label: "VAT", basisPoints: 2_000 }], // 20%
    );
    expect(totals).toEqual({
      subtotalMinor: 13_000,
      discountMinor: 1_300,
      taxes: [{ label: "VAT", basisPoints: 2_000, amountMinor: 2_340 }],
      totalMinor: 14_040,
    });
  });

  it("never discounts more than the subtotal", () => {
    expect(computeTotals([line(1_000, 5_000)], { kind: "amount", amountMinor: 9_000 }, []).totalMinor).toBe(
      0,
    );
  });
});

describe("payment schedules", () => {
  it("suggests the published terms by size", () => {
    expect(suggestedSchedule(49_999)).toBe("upfront");
    expect(suggestedSchedule(50_000)).toBe("half");
    expect(suggestedSchedule(300_000)).toBe("half");
    expect(suggestedSchedule(300_001)).toBe("thirds");
  });

  it("splits a total so the payments add up to it", () => {
    expect(splitSchedule(10_001, [...SCHEDULES.half.steps])).toEqual([5_001, 5_000]);
    const thirds = splitSchedule(100_003, [...SCHEDULES.thirds.steps]);
    expect(thirds).toEqual([40_001, 30_001, 30_001]);
    expect(thirds.reduce((sum, amount) => sum + amount, 0)).toBe(100_003);
  });

  it("gives each payment the amount its invoice will ask, adding up to the total", () => {
    // 1,234.55 plus 20% VAT, paid half and half.
    const taxes = [{ label: "VAT", basisPoints: 2_000 }];
    const totals = computeTotals([line(1_000, 123_455)], null, taxes);
    expect(totals.totalMinor).toBe(148_146);
    const amounts = scheduleAmounts(totals, taxes, [...SCHEDULES.half.steps]);
    // The deposit invoice: half of 1,234.55 before tax (617.28), with its VAT.
    expect(amounts[0]).toBe(computeTotals([line(1_000, 61_728)], null, taxes).totalMinor);
    expect(amounts).toEqual([74_074, 74_072]);
    expect(amounts.reduce((sum, amount) => sum + amount, 0)).toBe(totals.totalMinor);
    // Without taxes it is a plain split.
    const plain = computeTotals([line(1_000, 185_000)], null, []);
    expect(scheduleAmounts(plain, [], [...SCHEDULES.half.steps])).toEqual([92_500, 92_500]);
  });

  it("checks that the shares make 100%", () => {
    expect(checkSchedule([{ label: "All", basisPoints: 10_000 }]).ok).toBe(true);
    expect(checkSchedule([{ label: "Half", basisPoints: 5_000 }])).toEqual({
      ok: false,
      message: "The payments have to add up to 100%.",
    });
    expect(checkSchedule([]).ok).toBe(false);
  });
});

describe("numbers, quantities and rates", () => {
  it("numbers documents per kind and year", () => {
    expect(documentNumber("quote", 2026, 3)).toBe("Q-2026-0003");
    expect(documentNumber("invoice", 2026, 12_345)).toBe("INV-2026-12345");
    expect(documentNumber("credit", 2027, 1)).toBe("CN-2027-0001");
  });

  it("reads quantities in thousandths and rates in basis points", () => {
    expect(parseQuantity("1.5")).toEqual({ ok: true, value: 1_500 });
    expect(parseQuantity("0.25")).toEqual({ ok: true, value: 250 });
    expect(parseQuantity("0").ok).toBe(false);
    expect(parseQuantity("1,5").ok).toBe(false);
    expect(parseQuantity("100001").ok).toBe(false);
    expect(parsePercent("20")).toEqual({ ok: true, value: 2_000 });
    expect(parsePercent("12.5%")).toEqual({ ok: true, value: 1_250 });
    expect(parsePercent("101").ok).toBe(false);
    expect(formatQuantity(1_500)).toBe("1.5");
    expect(formatQuantity(2_000)).toBe("2");
    expect(formatPercent(1_250)).toBe("12.5%");
    expect(formatPercent(725)).toBe("7.25%");
  });
});

describe("states", () => {
  it("reads a sent quote past its date as expired, and an issued invoice past due as overdue", () => {
    expect(quoteState({ status: "sent", validUntil: "2026-10-01" }, "2026-10-01")).toBe("sent");
    expect(quoteState({ status: "sent", validUntil: "2026-10-01" }, "2026-10-02")).toBe("expired");
    expect(quoteState({ status: "accepted", validUntil: "2026-10-01" }, "2026-10-09")).toBe("accepted");
    expect(invoiceState({ status: "issued", dueDate: "2026-10-01" }, "2026-10-02")).toBe("overdue");
    expect(invoiceState({ status: "paid", dueDate: "2026-10-01" }, "2026-10-02")).toBe("paid");
  });
});
