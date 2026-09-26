import { MAX_AMOUNT_MINOR, scaleMinor } from "@/lib/money";
import { invalid, type Checked } from "@/lib/intake/text";

// The arithmetic of quotes and invoices: line amounts, a discount, tax lines, the total, and a payment
// schedule split from it. Amounts are whole minor units; quantities are thousandths (1.5 is 1500) and rates
// are basis points (20% is 2000), so every step is exact integer math through scaleMinor() in lib/money.ts.

export type LineItem = {
  id: string;
  description: string;
  quantityMilli: number; // 1 is 1000
  unitMinor: number;
};

export type Discount = { kind: "percent"; basisPoints: number } | { kind: "amount"; amountMinor: number };

export type TaxLine = { label: string; basisPoints: number };

export type Totals = {
  subtotalMinor: number;
  discountMinor: number;
  taxes: (TaxLine & { amountMinor: number })[];
  totalMinor: number;
};

export type ScheduleStep = { label: string; basisPoints: number };

export const MAX_LINES = 50;
export const MAX_TAXES = 3;
export const MAX_STEPS = 5;
export const MAX_QUANTITY_MILLI = 100_000 * 1000;
const WHOLE = 10_000; // 100% in basis points

export function lineAmount(line: Pick<LineItem, "quantityMilli" | "unitMinor">): number {
  return scaleMinor(line.unitMinor, line.quantityMilli, 1000);
}

export function computeTotals(lines: LineItem[], discount: Discount | null, taxes: TaxLine[]): Totals {
  const subtotalMinor = lines.reduce((sum, line) => sum + lineAmount(line), 0);
  let discountMinor = 0;
  if (discount?.kind === "percent") discountMinor = scaleMinor(subtotalMinor, discount.basisPoints, WHOLE);
  if (discount?.kind === "amount") discountMinor = Math.min(discount.amountMinor, subtotalMinor);
  const taxable = subtotalMinor - discountMinor;
  const taxAmounts = taxes.map((tax) => ({
    ...tax,
    amountMinor: scaleMinor(taxable, tax.basisPoints, WHOLE),
  }));
  const totalMinor = taxable + taxAmounts.reduce((sum, tax) => sum + tax.amountMinor, 0);
  if (totalMinor > MAX_AMOUNT_MINOR) throw new RangeError("That total is too large.");
  return { subtotalMinor, discountMinor, taxes: taxAmounts, totalMinor };
}

// --- Payment schedules -----------------------------------------------------------------------------------------

export const SCHEDULES = {
  upfront: {
    label: "All before work starts",
    steps: [{ label: "Full payment", basisPoints: 10_000 }],
  },
  half: {
    label: "50% to start, 50% on delivery",
    steps: [
      { label: "Deposit", basisPoints: 5_000 },
      { label: "On delivery", basisPoints: 5_000 },
    ],
  },
  thirds: {
    label: "40% to start, 30% at the midpoint, 30% on delivery",
    steps: [
      { label: "Deposit", basisPoints: 4_000 },
      { label: "Midpoint", basisPoints: 3_000 },
      { label: "On delivery", basisPoints: 3_000 },
    ],
  },
} as const satisfies Record<string, { label: string; steps: ScheduleStep[] }>;

export type ScheduleKey = keyof typeof SCHEDULES;

// The published terms: under $500 paid upfront, up to $3,000 half and half, above that in three parts.
export function suggestedSchedule(totalUsdMinor: number): ScheduleKey {
  if (totalUsdMinor < 500_00) return "upfront";
  return totalUsdMinor <= 3_000_00 ? "half" : "thirds";
}

export function checkSchedule(steps: ScheduleStep[]): Checked<ScheduleStep[]> {
  if (steps.length < 1 || steps.length > MAX_STEPS) return invalid(`Use 1 to ${MAX_STEPS} payments.`);
  if (steps.some((step) => !Number.isInteger(step.basisPoints) || step.basisPoints <= 0)) {
    return invalid("Each payment needs a share above 0%.");
  }
  if (steps.reduce((sum, step) => sum + step.basisPoints, 0) !== WHOLE) {
    return invalid("The payments have to add up to 100%.");
  }
  return { ok: true, value: steps };
}

// Each payment's amount; the last one takes the rounding, so they always add up to the total.
export function splitSchedule(totalMinor: number, steps: ScheduleStep[]): number[] {
  const amounts = steps.map((step) => scaleMinor(totalMinor, step.basisPoints, WHOLE));
  const rest = totalMinor - amounts.slice(0, -1).reduce((sum, amount) => sum + amount, 0);
  return [...amounts.slice(0, -1), rest];
}

// What each scheduled payment comes to, as its invoice will ask it: its share of the amount before tax, with
// the document's taxes on that share, worked out exactly as an invoice works out its total. The last payment
// takes what's left of the total, so the payments always add up to it.
export function scheduleAmounts(
  totals: Pick<Totals, "subtotalMinor" | "discountMinor" | "totalMinor">,
  taxes: TaxLine[],
  steps: ScheduleStep[],
): number[] {
  const shares = splitSchedule(totals.subtotalMinor - totals.discountMinor, steps);
  const amounts = shares.map(
    (share) =>
      computeTotals([{ id: "share", description: "", quantityMilli: 1000, unitMinor: share }], null, taxes)
        .totalMinor,
  );
  if (amounts.length) {
    amounts[amounts.length - 1] =
      totals.totalMinor - amounts.slice(0, -1).reduce((sum, amount) => sum + amount, 0);
  }
  return amounts;
}

// --- Numbers, quantities and rates ---------------------------------------------------------------------------

const PREFIXES = { quote: "Q", invoice: "INV", credit: "CN" } as const;
export type NumberedKind = keyof typeof PREFIXES;

// "Q-2026-0003", "INV-2026-0007", "CN-2026-0001": one sequence per kind and year.
export function documentNumber(kind: NumberedKind, year: number, sequence: number): string {
  return `${PREFIXES[kind]}-${year}-${String(sequence).padStart(4, "0")}`;
}

export type ParsedNumber = { ok: true; value: number } | { ok: false; message: string };

// "1", "1.5", "0.25", "2.125": thousandths, above zero and at most 100,000.
export function parseQuantity(text: string): ParsedNumber {
  const raw = text.trim();
  if (!/^\d{1,6}(?:\.\d{1,3})?$/.test(raw)) {
    return { ok: false, message: "Use a number like 1, 2.5 or 0.25." };
  }
  const [whole = "0", fraction = ""] = raw.split(".");
  const milli = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
  if (milli <= 0) return { ok: false, message: "The quantity has to be above zero." };
  if (milli > MAX_QUANTITY_MILLI) return { ok: false, message: "At most 100,000." };
  return { ok: true, value: milli };
}

// "20", "12.5", "7.25" (%): basis points, above zero and at most 100%.
export function parsePercent(text: string): ParsedNumber {
  const raw = text.trim().replace(/%$/, "").trim();
  if (!/^\d{1,3}(?:\.\d{1,2})?$/.test(raw)) {
    return { ok: false, message: "Use a percentage like 20 or 12.5." };
  }
  const [whole = "0", fraction = ""] = raw.split(".");
  const basisPoints = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (basisPoints <= 0 || basisPoints > WHOLE) {
    return { ok: false, message: "Use a percentage above 0 and at most 100." };
  }
  return { ok: true, value: basisPoints };
}

// 1500 → "1.5".
export function formatQuantity(milli: number): string {
  const whole = Math.trunc(milli / 1000);
  const fraction = String(milli % 1000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

// 1250 → "12.5%".
export function formatPercent(basisPoints: number): string {
  const whole = Math.trunc(basisPoints / 100);
  const fraction = String(basisPoints % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${fraction ? `${whole}.${fraction}` : whole}%`;
}

// What's still owed on an invoice: its total less what was paid and what credit notes took off.
export function amountLeft(invoice: {
  totals: Pick<Totals, "totalMinor">;
  paidMinor: number;
  creditedMinor?: number;
}): number {
  return Math.max(0, invoice.totals.totalMinor - invoice.paidMinor - (invoice.creditedMinor ?? 0));
}
