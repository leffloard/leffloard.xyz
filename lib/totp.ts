import { createHmac, timingSafeEqual } from "node:crypto";
import { base32Decode } from "@/lib/base32";

// TOTP (RFC 6238) with the settings every authenticator app supports: HMAC-SHA1, 6 digits, 30 seconds.
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", key).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function totpStep(at: Date): number {
  return Math.floor(at.getTime() / 1000 / TOTP_PERIOD_SECONDS);
}

export function totpCode(secret: string, at: Date): string {
  return hotp(base32Decode(secret), totpStep(at));
}

/**
 * Checks a code against the current step and one step on either side (clock drift). Returns the matched
 * step, or null. Steps at or before `lastUsedStep` never match, so a code works only once.
 */
export function verifyTotp(
  secret: string,
  code: string,
  at: Date,
  options: { window?: number; lastUsedStep?: number | null } = {},
): number | null {
  const window = options.window ?? 1;
  const normalized = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(normalized)) return null;
  const key = base32Decode(secret);
  const current = totpStep(at);
  let matched: number | null = null;
  // Every candidate is compared, so the time taken does not reveal which step matched.
  for (let step = current - window; step <= current + window; step++) {
    const same = timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(normalized));
    if (same && matched === null && step > (options.lastUsedStep ?? -1)) matched = step;
  }
  return matched;
}

export function otpauthUri({
  secret,
  account,
  issuer,
}: {
  secret: string;
  account: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
