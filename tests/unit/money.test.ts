import { describe, expect, it } from "vitest";
import {
  addMoney,
  amountInput,
  formatMoney,
  isCurrency,
  money,
  parseAmount,
  perHour,
  totalsByCurrency,
  valueOfTime,
} from "@/lib/money";

describe("parseAmount", () => {
  it.each([
    ["1250", 125_000],
    ["1,250", 125_000],
    ["1 250.5", 125_050],
    ["1_250.05", 125_005],
    ["$1,250.50", 125_050],
    ["₺ 12000", 1_200_000],
    ["0.5", 50],
    ["12345678", 1_234_567_800],
    ["  99.99 ", 9_999],
  ])("reads %j as %d minor units", (text, minor) => {
    expect(parseAmount(text)).toEqual({ ok: true, minor });
  });

  it("reads empty text as no amount", () => {
    expect(parseAmount("   ")).toEqual({ ok: true, minor: null });
  });

  it.each(["12,50", "1.250,50", "1,2500", "-5", "1e3", "abc", "1.234", ".5", "12.", "1,,250"])(
    "refuses %j",
    (text) => {
      expect(parseAmount(text).ok).toBe(false);
    },
  );

  it("refuses amounts above a billion", () => {
    expect(parseAmount("1000000000.01")).toEqual({ ok: false, message: "That amount is too large." });
    expect(parseAmount("1000000000")).toEqual({ ok: true, minor: 100_000_000_000 });
  });
});

describe("formatting", () => {
  it("shows cents only when there are any", () => {
    expect(formatMoney(money(125_000, "USD"))).toBe("$1,250");
    expect(formatMoney(money(125_050, "USD"))).toBe("$1,250.50");
    expect(formatMoney(money(1_200_000, "TRY"))).toBe("₺12,000");
    expect(formatMoney(money(4_000, "EUR"))).toBe("€40");
    expect(formatMoney(money(-1_999, "GBP"))).toBe("-£19.99");
  });

  it("gives form fields a plain value", () => {
    expect(amountInput(money(125_000, "USD"))).toBe("1250");
    expect(amountInput(money(125_005, "USD"))).toBe("1250.05");
    expect(amountInput(money(-50, "USD"))).toBe("-0.50");
    expect(amountInput(null)).toBe("");
  });
});

describe("arithmetic", () => {
  it("values time at an hourly rate, rounding half away from zero", () => {
    expect(valueOfTime(money(5_000, "USD"), 5_400)).toEqual(money(7_500, "USD"));
    // $33.33/h for 20 minutes is 1111 cents exactly; 1 second of $1/h is 0.0277… of a cent.
    expect(valueOfTime(money(3_333, "USD"), 1_200)).toEqual(money(1_111, "USD"));
    expect(valueOfTime(money(100, "USD"), 18)).toEqual(money(1, "USD")); // 0.5 cent rounds up
    expect(valueOfTime(money(100, "USD"), 17)).toEqual(money(0, "USD"));
  });

  it("spreads an amount over the hours it took", () => {
    expect(perHour(money(120_000, "USD"), 20 * 3600)).toEqual(money(6_000, "USD"));
    expect(perHour(money(100_000, "USD"), 3 * 3600)).toEqual(money(33_333, "USD"));
    expect(perHour(money(100_000, "USD"), 0)).toBeNull();
  });

  it("adds within one currency only", () => {
    expect(addMoney(money(150, "USD"), money(250, "USD"))).toEqual(money(400, "USD"));
    expect(() => addMoney(money(1, "USD"), money(1, "EUR"))).toThrow(/USD to EUR/);
  });

  it("totals per currency", () => {
    expect(totalsByCurrency([money(100, "USD"), money(500, "TRY"), money(250, "USD")])).toEqual([
      money(350, "USD"),
      money(500, "TRY"),
    ]);
  });

  it("rejects fractional minor units", () => {
    expect(() => money(1.5, "USD")).toThrow(RangeError);
  });

  it("knows its currencies", () => {
    expect(isCurrency("TRY")).toBe(true);
    expect(isCurrency("try")).toBe(false);
    expect(isCurrency("BTC")).toBe(false);
  });
});
