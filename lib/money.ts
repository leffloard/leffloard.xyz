// Money is a whole number of minor units (cents, kuruş) with its currency, never a float. Every sum,
// product and rounding of money happens in this file, so the rules are decided once.

export const CURRENCIES = ["USD", "EUR", "TRY", "GBP"] as const;
export type Currency = (typeof CURRENCIES)[number];
export type Money = { amountMinor: number; currency: Currency };

export const DEFAULT_CURRENCY: Currency = "USD";

export const CURRENCY_LABELS: Record<Currency, string> = {
  USD: "US dollar ($)",
  EUR: "Euro (€)",
  TRY: "Turkish lira (₺)",
  GBP: "Pound sterling (£)",
};

// Every currency above has two decimal places.
const MINOR_PER_MAJOR = 100;
// A billion in major units: far from any real invoice, and far inside JavaScript's safe integers.
export const MAX_AMOUNT_MINOR = 1_000_000_000 * MINOR_PER_MAJOR;

export function isCurrency(value: unknown): value is Currency {
  return typeof value === "string" && (CURRENCIES as readonly string[]).includes(value);
}

export function money(amountMinor: number, currency: Currency): Money {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("Money amounts are whole minor units.");
  return { amountMinor, currency };
}

export type ParsedAmount = { ok: true; minor: number | null } | { ok: false; message: string };

// Digits with an optional dot and up to two decimals. Commas, spaces and underscores may group
// thousands ("1,250.50"); a comma is never a decimal separator, so "12,50" is refused, not misread.
const GROUPED = /^\d{1,3}(?:[, _]\d{3})+(?:\.\d{1,2})?$/;
const PLAIN = /^\d+(?:\.\d{1,2})?$/;

export function parseAmount(text: string): ParsedAmount {
  const raw = text.trim().replace(/^[$€₺£]\s*/, "");
  if (!raw) return { ok: true, minor: null };
  if (!GROUPED.test(raw) && !PLAIN.test(raw)) {
    return { ok: false, message: "Use digits and a dot for decimals, for example 1250 or 1,250.50." };
  }
  const [whole = "0", fraction = ""] = raw.replace(/[, _]/g, "").split(".");
  const minor = Number(whole) * MINOR_PER_MAJOR + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(minor) || minor > MAX_AMOUNT_MINOR) {
    return { ok: false, message: "That amount is too large." };
  }
  return { ok: true, minor };
}

// An amount as a plain decimal with its cents, for other systems' APIs: "925.00", "-12.50".
export function decimalAmount(amountMinor: number): string {
  if (!Number.isSafeInteger(amountMinor)) throw new RangeError("Money amounts are whole minor units.");
  const sign = amountMinor < 0 ? "-" : "";
  const minor = Math.abs(amountMinor);
  return `${sign}${Math.trunc(minor / MINOR_PER_MAJOR)}.${String(minor % MINOR_PER_MAJOR).padStart(2, "0")}`;
}

// A plain decimal from another system ("925", "925.3", 925.3) in minor units, exactly. Null for anything
// else: a negative or malformed amount, or one with fractions of a cent.
export function parseDecimalAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value.trim();
  const match = /^(\d{1,13})(?:\.(\d{1,20}))?$/.exec(text);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (/[1-9]/.test(fraction.slice(2))) return null;
  const minor = Number(match[1]) * MINOR_PER_MAJOR + Number(fraction.slice(0, 2).padEnd(2, "0"));
  return Number.isSafeInteger(minor) && minor <= MAX_AMOUNT_MINOR ? minor : null;
}

// The value a form field starts with: "1250" or "1250.50".
export function amountInput(value: Money | null | undefined): string {
  if (!value) return "";
  const sign = value.amountMinor < 0 ? "-" : "";
  const minor = Math.abs(value.amountMinor);
  const whole = Math.trunc(minor / MINOR_PER_MAJOR);
  const cents = minor % MINOR_PER_MAJOR;
  return `${sign}${whole}${cents ? `.${String(cents).padStart(2, "0")}` : ""}`;
}

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(currency: Currency, cents: boolean): Intl.NumberFormat {
  const key = `${currency}:${cents}`;
  let format = formatters.get(key);
  if (!format) {
    format = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: cents ? 2 : 0,
      maximumFractionDigits: cents ? 2 : 0,
    });
    formatters.set(key, format);
  }
  return format;
}

// "$1,250", "$1,250.50", "₺12,000": cents only when there are any.
export function formatMoney(value: Money): string {
  const cents = value.amountMinor % MINOR_PER_MAJOR !== 0;
  return formatter(value.currency, cents).format(value.amountMinor / MINOR_PER_MAJOR);
}

// Half away from zero, the way people round money by hand.
function roundHalfAway(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value));
}

// amountMinor × numerator ÷ denominator, rounded half away from zero, computed exactly (a quantity of 1.5
// is 1500/1000, 20% is 2000/10000). Large amounts times large factors would lose precision as floats.
export function scaleMinor(amountMinor: number, numerator: number, denominator: number): number {
  if (![amountMinor, numerator, denominator].every(Number.isSafeInteger) || denominator <= 0) {
    throw new RangeError("scaleMinor takes whole numbers and a positive denominator.");
  }
  const product = BigInt(amountMinor) * BigInt(numerator);
  const divisor = BigInt(denominator);
  const negative = product < 0n;
  const magnitude = negative ? -product : product;
  let quotient = magnitude / divisor;
  if ((magnitude % divisor) * 2n >= divisor) quotient += 1n;
  const result = Number(negative ? -quotient : quotient);
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_AMOUNT_MINOR) {
    throw new RangeError("That amount is too large.");
  }
  return result;
}

const plainFormatters = new Map<Currency, Intl.NumberFormat>();

// "USD 1,250.00", "TRY 12,000.00": always with cents and the currency's code, for documents (invoices and
// quotes are read by accountants, and a PDF font may lack a currency sign).
export function formatMoneyCode(value: Money): string {
  let format = plainFormatters.get(value.currency);
  if (!format) {
    format = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    plainFormatters.set(value.currency, format);
  }
  const sign = value.amountMinor < 0 ? "-" : "";
  return `${sign}${value.currency} ${format.format(Math.abs(value.amountMinor) / MINOR_PER_MAJOR)}`;
}

// What a stretch of time is worth at an hourly rate.
export function valueOfTime(rate: Money, seconds: number): Money {
  return money(roundHalfAway((rate.amountMinor * seconds) / 3600), rate.currency);
}

// What each hour earned: an amount spread over the time it took. Null before any time is tracked.
export function perHour(amount: Money, seconds: number): Money | null {
  if (seconds <= 0) return null;
  return money(roundHalfAway((amount.amountMinor * 3600) / seconds), amount.currency);
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) throw new Error(`Cannot add ${a.currency} to ${b.currency}.`);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

// Totals per currency, in the order each currency first appears.
export function totalsByCurrency(values: readonly Money[]): Money[] {
  const totals = new Map<Currency, number>();
  for (const value of values) {
    totals.set(value.currency, (totals.get(value.currency) ?? 0) + value.amountMinor);
  }
  return [...totals].map(([currency, amountMinor]) => money(amountMinor, currency));
}
