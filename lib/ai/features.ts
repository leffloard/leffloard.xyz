// The AI assistant's features, and how much each one may think and write. Shared by the server and the
// admin pages. Every feature writes a draft: nothing it produces is sent or published without the owner.

export const AI_FEATURES = ["triage", "reply", "quote", "brief", "weekly", "rewrite", "casestudy"] as const;
export type AiFeature = (typeof AI_FEATURES)[number];

export const AI_FEATURE_LABELS: Record<AiFeature, string> = {
  triage: "Inbox triage",
  reply: "Reply draft",
  quote: "Quote draft",
  brief: "Meeting brief",
  weekly: "Weekly review",
  rewrite: "Content rewrite",
  casestudy: "Case-study draft",
};

export type AiEffort = "low" | "medium" | "high";

// Effort is the model's thoroughness, and most of the cost: sorting a message runs low, writing medium, and
// the long case study high. `maxTokens` caps thinking and text together.
export const AI_FEATURE_LIMITS: Record<AiFeature, { effort: AiEffort; maxTokens: number }> = {
  triage: { effort: "low", maxTokens: 8_000 },
  reply: { effort: "medium", maxTokens: 16_000 },
  quote: { effort: "medium", maxTokens: 16_000 },
  brief: { effort: "medium", maxTokens: 16_000 },
  weekly: { effort: "medium", maxTokens: 16_000 },
  rewrite: { effort: "medium", maxTokens: 16_000 },
  casestudy: { effort: "high", maxTokens: 32_000 },
};

// The drafts that stream into the page as they are written (the others return a structured answer).
export const STREAMED_FEATURES = ["reply", "brief", "weekly", "rewrite", "casestudy"] as const;
export type StreamedFeature = (typeof STREAMED_FEATURES)[number];

export function isStreamedFeature(feature: string): feature is StreamedFeature {
  return (STREAMED_FEATURES as readonly string[]).includes(feature);
}

export const AI_MODELS = ["claude-opus-5", "claude-sonnet-5"] as const;
export type AiModel = (typeof AI_MODELS)[number];

export const AI_MODEL_LABELS: Record<AiModel, string> = {
  "claude-opus-5": "Claude Opus 5: $5 in, $25 out per million tokens",
  "claude-sonnet-5": "Claude Sonnet 5: $2 in, $10 out per million tokens",
};

// Automatic triage of new messages stops for the day after this many, whatever the budget says.
export const AUTO_TRIAGE_PER_DAY = 20;

// How long a run's draft is kept (the monthly totals stay).
export const AI_RUN_RETENTION_DAYS = 90;
