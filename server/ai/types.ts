import type { ObjectId } from "mongodb";
import type { AiFeature, AiModel } from "@/lib/ai/features";
import type { TokenUsage } from "@/lib/ai/pricing";
import type { ContentKind } from "@/lib/content/schemas";

// The AI assistant's settings, its runs and each month's totals.

export type AiSettingsDoc = {
  _id: "ai";
  enabled: boolean; // off: no request is made (the kill switch)
  model: AiModel;
  monthlyBudgetMicros: number; // USD micro-dollars
  fallbacks: boolean; // a declined request is retried on the model Anthropic recommends
  autoTriage: boolean; // new inbox messages are triaged as they arrive
  version: number;
  updatedAt: Date;
};

// What a run was about: shown on the usage page, and removed with it when that is deleted.
export type AiTarget =
  | { kind: "inquiry"; id: ObjectId }
  | { kind: "meeting"; id: ObjectId }
  | { kind: "content"; id: ObjectId | null; contentKind: ContentKind } // id null: not created yet
  | { kind: "week"; id: string }; // "2026-09-21", the week's Monday

export type AiRunStatus = "running" | "done" | "refused" | "failed";

export type AiRunDoc = {
  _id: ObjectId;
  feature: AiFeature;
  trigger: "owner" | "auto";
  target: AiTarget | null;
  // The client whose record the prompt included (meeting briefs): deleted with them. Runs about an inbox
  // message follow the message instead.
  clientId: ObjectId | null;
  // One running request per feature and target: a double click does not pay twice. Unset when it ends.
  lock?: string;
  month: string; // the budget month its reservation was taken from, and settled in ("2026-09")
  // What it was about was deleted while it ran: it settles its cost, then deletes itself.
  discard?: true;
  status: AiRunStatus;
  model: string; // asked for
  servedBy: string | null; // answered (differs when a fallback model took over)
  fallback: boolean;
  reservedMicros: number; // set aside before the request
  costMicros: number; // the estimate from the returned token counts
  usage: TokenUsage;
  stopReason: string | null;
  refusal: string | null; // the category, when the request was declined
  output: string | null; // the draft (JSON for structured answers)
  error: string | null;
  requestId: string | null; // Anthropic's request id, which its support asks for
  durationMs: number | null;
  createdAt: Date;
  finishedAt: Date | null;
  purgeAt: Date; // deleted by a TTL index (AI_RUN_RETENTION_DAYS)
};

export type FeatureTotals = { runs: number; costMicros: number };

// A day's count of something limited per day (automatic triage), claimed one at a time.
export type AiCounterDoc = { _id: string; count: number; expiresAt: Date };

// One month's spending, kept after its runs are gone. Reservations and totals change together in one
// conditional update, so two requests at once can't overspend.
export type AiMonthDoc = {
  _id: string; // "2026-09" (UTC)
  spentMicros: number;
  reservedMicros: number;
  runs: number;
  usage: TokenUsage;
  byFeature: Partial<Record<AiFeature, FeatureTotals>>;
  expenseId: ObjectId | null; // recorded in the finance expenses
  updatedAt: Date;
};
