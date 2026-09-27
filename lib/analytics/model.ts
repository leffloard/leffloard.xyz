// Visitor statistics for the public site: what the tracker sends, what is counted and how the numbers are
// read. Shared by the tracker in the browser, the collector and the admin pages.
//
// There are no cookies and no stored addresses. A visitor is a hash of a salt that changes every day, their
// address and their browser, so the same person is one visitor within a day and a stranger the next; the
// salt is deleted soon after its day ends.

export const ANALYTICS_PATH = "/api/analytics";
// Per address: someone reading quickly sends a page view every few seconds, and loading timings once a
// page load.
export const ANALYTICS_LIMIT = { limit: 120, windowMs: 10 * 60_000 };
// For the whole site, a day: far above what a personal site sees, and low enough that a flood can't fill a
// small database (about 5 MB a day at most).
export const ANALYTICS_DAILY_CAP = 20_000;

export const DEVICES = ["mobile", "tablet", "desktop"] as const;
export type Device = (typeof DEVICES)[number];
export const DEVICE_LABELS: Record<Device, string> = {
  mobile: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
};

// From the width of the browser window (the screen's own size is never sent).
export function deviceFor(width: number): Device {
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

// What visitors came to do, recorded by the server when it happens (never sent by the tracker).
export const GOALS = ["inquiry", "booking", "cv"] as const;
export type Goal = (typeof GOALS)[number];
export const GOAL_LABELS: Record<Goal, string> = {
  inquiry: "Sent a message",
  booking: "Booked a call",
  cv: "Downloaded the CV",
};

// Core Web Vitals and two loading timings, measured in visitors' browsers. A value at or under `good` is
// good, over `poor` is poor (Google's thresholds, read at the 75th percentile).
export const VITALS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;
export type Vital = (typeof VITALS)[number];
export const VITAL_INFO: Record<Vital, { label: string; good: number; poor: number; max: number }> = {
  LCP: { label: "Largest contentful paint", good: 2500, poor: 4000, max: 120_000 },
  INP: { label: "Interaction to next paint", good: 200, poor: 500, max: 60_000 },
  CLS: { label: "Cumulative layout shift", good: 0.1, poor: 0.25, max: 100 },
  FCP: { label: "First contentful paint", good: 1800, poor: 3000, max: 120_000 },
  TTFB: { label: "Time to first byte", good: 800, poor: 1800, max: 120_000 },
};

export type VitalRating = "good" | "improve" | "poor";
export const RATING_LABELS: Record<VitalRating, string> = {
  good: "Good",
  improve: "Needs improvement",
  poor: "Poor",
};

export function rateVital(name: Vital, value: number): VitalRating {
  const { good, poor } = VITAL_INFO[name];
  if (value <= good) return "good";
  return value <= poor ? "improve" : "poor";
}

// "1.84 s", "120 ms", "0.05".
export function formatVital(name: Vital, value: number): string {
  if (name === "CLS") return value.toFixed(value < 1 ? 2 : 1);
  if (value >= 1000) return `${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)} s`;
  return `${Math.round(value)} ms`;
}

export const RANGES = ["today", "7d", "30d", "90d", "12m"] as const;
export type AnalyticsRange = (typeof RANGES)[number];
export const RANGE_LABELS: Record<AnalyticsRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

export function isRange(value: unknown): value is AnalyticsRange {
  return typeof value === "string" && (RANGES as readonly string[]).includes(value);
}

// Single visits are kept this long; each finished day is also summed up, and the sums (which hold no
// visitor ids) are kept.
export const EVENT_RETENTION_DAYS = 60;
export const VITALS_RETENTION_DAYS = 90;
