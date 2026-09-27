import type { ObjectId } from "mongodb";
import type { Device, Goal, Vital } from "@/lib/analytics/model";

// A page view, or a goal a visitor reached. Kept EVENT_RETENTION_DAYS; the visitor id means nothing once
// its day's salt is gone.
export type AnalyticsEventDoc = {
  _id: ObjectId;
  type: "view" | "goal";
  at: Date;
  day: string; // in the admin's time zone, "2026-09-26"
  visitor: string;
  path: string | null; // views only
  entry: boolean; // the first page of a visit from elsewhere
  source: string | null; // entries: utm_source, else the referring site
  campaign: string | null; // entries: utm_campaign
  country: string | null; // "TR", from Cloudflare
  device: Device | null;
  notFound: boolean;
  goal: Goal | null;
};

export type AnalyticsSaltDoc = { _id: string; salt: string; expiresAt: Date };

// One page load's loading timings, sent when the visitor leaves the page (or in parts, as they come).
export type AnalyticsVitalsDoc = {
  _id: ObjectId;
  at: Date;
  day: string;
  path: string;
  device: Device | null;
  metrics: Partial<Record<Vital, number>>;
};

// A key's count: page views for pages, visits for sources and campaigns, reached goals for goals.
export type Count = { key: string; count: number; visitors: number };

export type DayStats = {
  visitors: number;
  views: number;
  bounces: number; // visitors who saw one page
  converted: number; // visitors who reached a goal
  pages: Count[];
  sources: Count[]; // "" is a visit without a referrer or campaign
  campaigns: Count[];
  countries: Count[]; // "" is unknown
  devices: Count[];
  goals: Count[];
  notFound: Count[];
};

// A finished day's sums.
export type AnalyticsDayDoc = DayStats & { _id: string; rolledAt: Date };
