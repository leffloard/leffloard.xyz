// What a Claude request costs, worked out from the token counts the API returns. Amounts are micro-dollars
// (1 USD = 1,000,000), so a month's total is a whole number; 1 USD per million tokens is 1 micro-dollar per
// token. The totals are the site's own estimate: Anthropic's console is the bill.

export type Price = {
  input: number; // USD per million tokens
  output: number;
  cacheRead: number;
};

// Cache writes cost 1.25× the input price for 5-minute entries and 2× for 1-hour ones.
const PRICES: Record<string, Price> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1 },
};

// A model not listed here (a newer fallback, say) is counted at the dearest rates, so the budget errs high.
const UNKNOWN: Price = { input: 10, output: 50, cacheRead: 1 };

export function priceOf(model: string): Price {
  if (PRICES[model]) return PRICES[model];
  const known = Object.keys(PRICES).find((id) => model.startsWith(`${id}-`));
  return known ? PRICES[known]! : UNKNOWN;
}

export type TokenUsage = {
  input: number; // not read from or written to the cache
  output: number; // thinking included
  cacheRead: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
};

export const NO_TOKENS: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 };

export function addTokens(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite5m: a.cacheWrite5m + b.cacheWrite5m,
    cacheWrite1h: a.cacheWrite1h + b.cacheWrite1h,
  };
}

// In hundredths of a micro-dollar per token, so the sum is exact before it is rounded up once.
const hundredths = (usdPerMillion: number) => Math.round(usdPerMillion * 100);

export function costMicros(model: string, usage: TokenUsage): number {
  const price = priceOf(model);
  const input = hundredths(price.input);
  const total =
    usage.input * input +
    usage.output * hundredths(price.output) +
    usage.cacheRead * hundredths(price.cacheRead) +
    usage.cacheWrite5m * Math.round(input * 1.25) +
    usage.cacheWrite1h * input * 2;
  return Math.ceil(total / 100);
}

// The usage fields of an API response (top level, or one attempt in `iterations`).
export type ApiUsage = {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_creation?: { ephemeral_5m_input_tokens: number; ephemeral_1h_input_tokens: number } | null;
};

export function tokenUsage(usage: ApiUsage): TokenUsage {
  const written = usage.cache_creation_input_tokens ?? 0;
  const oneHour = usage.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return {
    input: usage.input_tokens ?? 0,
    output: usage.output_tokens ?? 0,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    // Without the breakdown every write counts as a 5-minute one (the only kind this site asks for).
    cacheWrite5m: Math.max(0, written - oneHour),
    cacheWrite1h: oneHour,
  };
}

export type Attempt = { model: string; usage: TokenUsage };

type Iteration = ApiUsage & { type?: string; model?: string | null };

// Every attempt a response was billed for. With refusal fallbacks one request can run on several models:
// `usage.iterations` lists each attempt (the top-level usage covers only the one that answered).
export function billedAttempts(
  message: { model: string; usage: ApiUsage & { iterations?: Iteration[] | null } },
  requestedModel: string,
): Attempt[] {
  const iterations = (message.usage.iterations ?? []).filter(
    (entry) => typeof entry.input_tokens === "number" || typeof entry.output_tokens === "number",
  );
  if (!iterations.length)
    return [{ model: message.model || requestedModel, usage: tokenUsage(message.usage) }];
  return iterations.map((entry) => ({ model: entry.model || requestedModel, usage: tokenUsage(entry) }));
}

export function attemptsCost(attempts: Attempt[]): number {
  return attempts.reduce((sum, attempt) => sum + costMicros(attempt.model, attempt.usage), 0);
}

// "$0.0123" below a dollar (small runs stay visible), "$12.40" above.
export function formatUsd(micros: number): string {
  const dollars = micros / 1_000_000;
  if (dollars !== 0 && Math.abs(dollars) < 1) return `$${dollars.toFixed(4)}`;
  return `$${dollars.toFixed(2)}`;
}

// The share of input tokens served from the cache.
export function cacheHitRate(usage: TokenUsage): number | null {
  const input = usage.input + usage.cacheRead + usage.cacheWrite5m + usage.cacheWrite1h;
  return input ? usage.cacheRead / input : null;
}
