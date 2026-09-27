import "server-only";
import type { Db } from "mongodb";
import type { AiCounterDoc, AiMonthDoc, AiRunDoc, AiSettingsDoc } from "@/server/ai/types";

export function aiSettings(db: Db) {
  return db.collection<AiSettingsDoc>("settings");
}
export function aiRuns(db: Db) {
  return db.collection<AiRunDoc>("ai_runs");
}
export function aiMonths(db: Db) {
  return db.collection<AiMonthDoc>("ai_months");
}
export function aiCounters(db: Db) {
  return db.collection<AiCounterDoc>("ai_counters");
}
