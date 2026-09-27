import { addDays, isCalendarDate } from "@/lib/intake/time";
import { scaleMinor, type Currency } from "@/lib/money";
import { daysBetween, weekdayIndex } from "@/lib/work/dates";

// Exchange rates from the daily bulletin of TCMB (the Central Bank of the Republic of Türkiye): its forex
// buying rates, in ten-thousandths of a lira per unit ("41.5012" is 415012), so every conversion is exact.
// A day's transactions use the bulletin of the last business day before it: TCMB announces the rates at
// 15:30 for the next day, which is also how Turkish bookkeeping values foreign-currency amounts.

export const RATE_SCALE = 10_000;
export const RATE_CURRENCIES = ["USD", "EUR", "GBP"] as const satisfies readonly Currency[];
export type Rates = Partial<Record<Currency, number>>;
export type Bulletin = { date: string; rates: Rates };

// How far back a bulletin still counts for a day (a long holiday has no bulletins for about a week).
export const BULLETIN_MAX_AGE_DAYS = 10;

// "41.5012" as 415012. Null for anything that isn't a plain decimal with at most four places.
export function scaledRate(text: string): number | null {
  const match = /^(\d{1,6})(?:\.(\d{1,4}))?$/.exec(text.trim());
  if (!match) return null;
  const value = Number(match[1]) * RATE_SCALE + Number((match[2] ?? "").padEnd(4, "0"));
  return value > 0 ? value : null;
}

// "41.5012" from 415012.
export function formatRate(scaled: number, decimal: "." | "," = "."): string {
  const whole = Math.floor(scaled / RATE_SCALE);
  const fraction = String(scaled % RATE_SCALE).padStart(4, "0");
  return `${whole}${decimal}${fraction}`;
}

// A bulletin's date and forex buying rates, from TCMB's XML (today.xml, or a day's file in the archive).
export function parseTcmbBulletin(xml: string): Bulletin | null {
  const header = /<Tarih_Date\b[^>]*\bTarih="(\d{2})\.(\d{2})\.(\d{4})"/.exec(xml);
  if (!header) return null;
  const date = `${header[3]}-${header[2]}-${header[1]}`;
  if (!isCalendarDate(date)) return null;
  const rates: Rates = {};
  for (const [, attributes, body] of xml.matchAll(/<Currency\b([^>]*)>([\s\S]*?)<\/Currency>/g)) {
    const code = /\bCurrencyCode="([A-Z]{3})"/.exec(attributes!)?.[1];
    if (!code || !(RATE_CURRENCIES as readonly string[]).includes(code)) continue;
    // Some currencies are quoted per 100 units; the ones used here are per unit.
    if ((/<Unit>\s*(\d+)\s*<\/Unit>/.exec(body!)?.[1] ?? "1") !== "1") continue;
    const buying = /<ForexBuying>([^<]*)<\/ForexBuying>/.exec(body!)?.[1];
    const scaled = buying ? scaledRate(buying) : null;
    if (scaled !== null) rates[code as Currency] = scaled;
  }
  return Object.keys(rates).length ? { date, rates } : null;
}

// The lira's rate is the scale itself; others come from the bulletin.
function rateOf(currency: Currency, rates: Rates): number | null {
  return currency === "TRY" ? RATE_SCALE : (rates[currency] ?? null);
}

// An amount in another currency, through the lira (EUR to USD is EUR→TRY→USD). Null without a rate.
export function convertMinor(amountMinor: number, from: Currency, to: Currency, rates: Rates): number | null {
  if (from === to) return amountMinor;
  const numerator = rateOf(from, rates);
  const denominator = rateOf(to, rates);
  if (numerator === null || denominator === null) return null;
  return scaleMinor(amountMinor, numerator, denominator);
}

// The bulletins on record, and the weekdays known to have had none (holidays).
export type RateBook = { bulletins: Bulletin[]; empty: ReadonlySet<string> };

// The bulletin a day's transactions use: the latest one dated before the day, if recent enough, and only if
// every weekday between the two is known to have had no bulletin. Otherwise the right bulletin is missing (the
// server was off when it came out), and using an older one would silently give the wrong rate.
// `book.bulletins` is sorted by date, oldest first.
export function bulletinFor(book: RateBook, day: string): Bulletin | null {
  const { bulletins } = book;
  let low = 0;
  let high = bulletins.length - 1;
  let found: Bulletin | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const candidate = bulletins[middle]!;
    if (candidate.date < day) {
      found = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  if (!found || daysBetween(found.date, day) > BULLETIN_MAX_AGE_DAYS) return null;
  for (let between = addDays(found.date, 1); between < day; between = addDays(between, 1)) {
    if (weekdayIndex(between) < 5 && !book.empty.has(between)) return null;
  }
  return found;
}
