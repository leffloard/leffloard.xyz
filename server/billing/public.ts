import "server-only";
import type { RateLimit } from "@/server/security/rate-limit";
import type { AnswerProblem } from "@/server/billing/quotes";

// Limits and messages of the clients' quote and invoice links.

export const ANSWER_LIMIT: RateLimit = { limit: 10, windowMs: 10 * 60_000 };
export const CHECKOUT_LIMIT: RateLimit = { limit: 10, windowMs: 10 * 60_000 };
// Each PDF is rendered on request.
export const PDF_LIMIT: RateLimit = { limit: 30, windowMs: 10 * 60_000 };

export const ANSWER_MESSAGES: Record<AnswerProblem["problem"], string> = {
  missing: "This quote isn't available any more.",
  changed: "The quote was updated since you opened it. Reload the page to see the new version.",
  expired: "This quote has expired. Reply to its email and I'll send a new one.",
  answered: "This quote was already answered.",
};
