import "server-only";
import type { RateLimit } from "@/server/security/rate-limit";

// Limits of the client portal's endpoints, per address (and, for sign-in emails, per email address).

export const SIGN_IN_LIMIT: RateLimit = { limit: 5, windowMs: 15 * 60_000 };
export const SIGN_IN_EMAIL_LIMIT: RateLimit = { limit: 3, windowMs: 60 * 60_000 };
export const VERIFY_LIMIT: RateLimit = { limit: 20, windowMs: 10 * 60_000 };
export const PORTAL_POST_LIMIT: RateLimit = { limit: 30, windowMs: 10 * 60_000 };

export const PORTAL_MAX_BYTES = 16 * 1024;
