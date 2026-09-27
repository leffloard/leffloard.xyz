import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// 256-bit random value, URL-safe. Used for session and link tokens.
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

// Constant-time comparison of two strings of any length (both sides are hashed first).
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
}
