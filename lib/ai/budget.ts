import { priceOf } from "@/lib/ai/pricing";

// The monthly budget: before each request the most it could cost is set aside, and a request that would
// go over what is left is not made. Afterwards the estimate is replaced by what it cost.

export const MICROS_PER_CENT = 10_000;
export const MAX_MONTHLY_BUDGET_MICROS = 1_000 * 1_000_000; // $1,000
export const DEFAULT_MONTHLY_BUDGET_MICROS = 15 * 1_000_000; // $15, the plan's suggestion

// Months follow Anthropic's billing: UTC. "2026-09".
export function monthKey(at: Date): string {
  return at.toISOString().slice(0, 7);
}

export function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year!, month! - 1, 1)),
  );
}

// The last day of a month, "2026-09-30".
export function lastDayOf(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year!, month!, 0)).toISOString().slice(0, 10);
}

// The most tokens a prompt can be: a token is at least one byte of its UTF-8 text (English runs nearer four
// bytes a token; Chinese or emoji much fewer), plus room for the request's framing.
export function maxInputTokens(bytes: number): number {
  return bytes + 200;
}

export function utf8Bytes(...texts: string[]): number {
  const encoder = new TextEncoder();
  return texts.reduce((sum, text) => sum + encoder.encode(text).length, 0);
}

// The most a request could cost: its whole prompt written to the cache (the dearest way to read it) and
// every allowed output token. With refusal fallbacks a second model may run the request again, so twice.
export function maxCostMicros(
  model: string,
  promptBytes: number,
  maxTokens: number,
  withFallback: boolean,
): number {
  const price = priceOf(model);
  const input = maxInputTokens(promptBytes) * price.input * 1.25;
  const output = maxTokens * price.output;
  return Math.ceil((input + output) * (withFallback ? 2 : 1));
}

// Whether a reservation fits: what was spent, what running requests have set aside, and this one.
export function fitsBudget(budget: number, spent: number, reserved: number, amount: number): boolean {
  return spent + reserved + amount <= budget;
}
