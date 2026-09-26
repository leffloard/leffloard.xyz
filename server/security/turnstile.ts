import "server-only";
import { randomUUID } from "node:crypto";
import { getEnv } from "@/server/env";

const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// Cloudflare's documented test secrets (always pass / always fail / token already spent).
const TEST_SECRETS = /^[123]x0000000000000000000000000000000AA$/;

export type TurnstileResult = { ok: true; skipped: boolean } | { ok: false; reason: string };

type SiteverifyResponse = {
  success?: boolean;
  hostname?: string;
  action?: string;
  "error-codes"?: string[];
};

/**
 * Checks a Turnstile token with Cloudflare. Without TURNSTILE_SECRET_KEY (development) the check is
 * skipped. Fails closed: if Cloudflare cannot be reached, the form is refused.
 */
export async function verifyTurnstile(
  { token, ip, action }: { token: string | null | undefined; ip: string; action: string },
  fetchImpl: typeof fetch = fetch,
): Promise<TurnstileResult> {
  const { TURNSTILE_SECRET_KEY: secret, SITE_URL } = getEnv();
  if (!secret) return { ok: true, skipped: true };
  if (!token || token.length > 2048) return { ok: false, reason: "missing-token" };

  const body = new URLSearchParams({ secret, response: token, idempotency_key: randomUUID() });
  if (ip !== "unknown") body.set("remoteip", ip);

  let data: SiteverifyResponse;
  try {
    const response = await fetchImpl(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(5_000),
    });
    data = (await response.json()) as SiteverifyResponse;
  } catch {
    return { ok: false, reason: "unreachable" };
  }

  if (!data.success) return { ok: false, reason: data["error-codes"]?.join(",") || "failed" };
  if (!TEST_SECRETS.test(secret)) {
    if (data.hostname !== new URL(SITE_URL).hostname) return { ok: false, reason: "hostname-mismatch" };
    if (data.action !== action) return { ok: false, reason: "action-mismatch" };
  }
  return { ok: true, skipped: false };
}
