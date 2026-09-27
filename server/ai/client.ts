import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "@/server/env";

// The Anthropic client, made from ANTHROPIC_API_KEY (and ANTHROPIC_BASE_URL in the tests). Nothing else is
// read from the environment: no other token or profile can stand in for the key.

let cached: { key: string; baseURL: string | undefined; client: Anthropic } | null = null;
let replacement: Anthropic | null | undefined;

export function anthropicClient(): Anthropic | null {
  if (replacement !== undefined) return replacement;
  const env = getEnv();
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return null;
  if (!cached || cached.key !== key || cached.baseURL !== env.ANTHROPIC_BASE_URL) {
    cached = {
      key,
      baseURL: env.ANTHROPIC_BASE_URL,
      client: new Anthropic({
        apiKey: key,
        authToken: null,
        baseURL: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
        maxRetries: 1,
        timeout: 10 * 60_000,
      }),
    };
  }
  return cached.client;
}

// For tests: a client with a stubbed fetch, null for "no key", undefined to go back to the real one.
export function setAnthropicClientForTests(client: Anthropic | null | undefined): void {
  replacement = client;
}
