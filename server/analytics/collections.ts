import "server-only";
import type { Db } from "mongodb";
import type {
  AnalyticsDayDoc,
  AnalyticsEventDoc,
  AnalyticsSaltDoc,
  AnalyticsVitalsDoc,
} from "@/server/analytics/types";

export function analyticsEvents(db: Db) {
  return db.collection<AnalyticsEventDoc>("analytics_events");
}
export function analyticsSalts(db: Db) {
  return db.collection<AnalyticsSaltDoc>("analytics_salts");
}
export function analyticsVitals(db: Db) {
  return db.collection<AnalyticsVitalsDoc>("analytics_vitals");
}
export function analyticsDays(db: Db) {
  return db.collection<AnalyticsDayDoc>("analytics_days");
}
