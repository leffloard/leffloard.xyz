import "server-only";
import type { Db } from "mongodb";
import { DEFAULT_MONTHLY_BUDGET_MICROS } from "@/lib/ai/budget";
import type { AiModel } from "@/lib/ai/features";
import { aiSettings } from "@/server/ai/collections";
import { anthropicClient } from "@/server/ai/client";
import { now } from "@/server/clock";

// The assistant's settings. It starts switched off: the owner turns it on after adding the key and
// checking the budget.

export type AiSettings = {
  enabled: boolean;
  model: AiModel;
  monthlyBudgetMicros: number;
  fallbacks: boolean;
  autoTriage: boolean;
  version: number; // 0 until first saved
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  enabled: false,
  model: "claude-opus-5",
  monthlyBudgetMicros: DEFAULT_MONTHLY_BUDGET_MICROS,
  fallbacks: true,
  autoTriage: false,
  version: 0,
};

export async function getAiSettings(db: Db): Promise<AiSettings> {
  const doc = await aiSettings(db).findOne({ _id: "ai" });
  if (!doc) return DEFAULT_AI_SETTINGS;
  return {
    enabled: doc.enabled,
    model: doc.model,
    monthlyBudgetMicros: doc.monthlyBudgetMicros,
    fallbacks: doc.fallbacks,
    autoTriage: doc.autoTriage,
    version: doc.version,
  };
}

export type SavedSettings = { ok: true; settings: AiSettings } | { ok: false; reason: "conflict" };

// Saves the settings opened at `version` (0 before the first save); a newer save elsewhere wins.
export async function saveAiSettings(
  db: Db,
  input: Omit<AiSettings, "version">,
  version: number,
  at: Date = now(),
): Promise<SavedSettings> {
  if (version === 0) {
    const inserted = await aiSettings(db).updateOne(
      { _id: "ai" },
      { $setOnInsert: { ...input, version: 1, updatedAt: at } },
      { upsert: true },
    );
    if (inserted.upsertedCount !== 1) return { ok: false, reason: "conflict" };
    return { ok: true, settings: { ...input, version: 1 } };
  }
  const updated = await aiSettings(db).findOneAndUpdate(
    { _id: "ai", version },
    { $set: { ...input, updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!updated) return { ok: false, reason: "conflict" };
  return { ok: true, settings: { ...input, version: updated.version } };
}

// Why the assistant can't run now, in the owner's words; null when it can.
export type Availability = { ready: true } | { ready: false; reason: "no_key" | "off"; message: string };

export function availability(settings: AiSettings): Availability {
  if (!anthropicClient()) {
    return {
      ready: false,
      reason: "no_key",
      message:
        "The AI assistant needs an Anthropic API key: set ANTHROPIC_API_KEY on the server and restart.",
    };
  }
  if (!settings.enabled) {
    return {
      ready: false,
      reason: "off",
      message: "The AI assistant is switched off; turn it on in the AI settings.",
    };
  }
  return { ready: true };
}

// For pages: why the AI buttons are off, or null when they work.
export async function aiDisabledReason(db: Db): Promise<string | null> {
  const state = availability(await getAiSettings(db));
  return state.ready ? null : state.message;
}
