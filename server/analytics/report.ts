import "server-only";
import type { Db } from "mongodb";
import { percentile } from "@/lib/analytics/clean";
import {
  rateVital,
  VITALS,
  VITALS_RETENTION_DAYS,
  type AnalyticsRange,
  type Vital,
  type VitalRating,
} from "@/lib/analytics/model";
import { ADMIN_TIME_ZONE, SHORT_MONTHS } from "@/lib/format";
import { addDays, todayIn, zonedInstant } from "@/lib/intake/time";
import { addMonths, daysBetween, formatDay } from "@/lib/work/dates";
import { analyticsEvents, analyticsVitals } from "@/server/analytics/collections";
import { dayStats, mergeDays, sortCounts } from "@/server/analytics/stats";
import type { Count, DayStats } from "@/server/analytics/types";

// What the Analytics page and the Today card show, read from the day sums and today's single visits.

export type Span = { from: string; to: string; previousFrom: string; previousTo: string; previous: string };

// A range ends today. The previous period is the one before it, of the same length; for twelve months, the
// same months a year before.
export function rangeSpan(range: AnalyticsRange, today: string): Span {
  if (range === "today") {
    const yesterday = addDays(today, -1);
    return { from: today, to: today, previousFrom: yesterday, previousTo: yesterday, previous: "yesterday" };
  }
  if (range === "12m") {
    const from = addMonths(`${today.slice(0, 7)}-01`, -11);
    return {
      from,
      to: today,
      previousFrom: addMonths(from, -12),
      previousTo: addMonths(today, -12),
      previous: "the same months a year before",
    };
  }
  const length = { "7d": 7, "30d": 30, "90d": 90 }[range];
  const from = addDays(today, -(length - 1));
  return {
    from,
    to: today,
    previousFrom: addDays(from, -length),
    previousTo: addDays(from, -1),
    previous: `the ${length} days before`,
  };
}

export function daysFrom(from: string, to: string): string[] {
  const count = daysBetween(from, to) + 1;
  return Array.from({ length: Math.max(0, count) }, (_, index) => addDays(from, index));
}

export type SeriesPoint = { key: string; label: string; visitors: number; views: number };
export type Totals = Pick<DayStats, "visitors" | "views" | "bounces" | "converted">;

export type AnalyticsReport = {
  range: AnalyticsRange;
  span: Span;
  current: DayStats;
  previous: Totals;
  series: SeriesPoint[];
  unit: "hour" | "day" | "month";
};

// Today's visitors and page views hour by hour, in the admin's time zone.
async function hourly(db: Db, today: string): Promise<SeriesPoint[]> {
  const rows = await analyticsEvents(db)
    .aggregate<{ _id: number; visitors: number; views: number }>([
      { $match: { day: today, type: "view" } },
      {
        $group: {
          _id: { hour: { $hour: { date: "$at", timezone: ADMIN_TIME_ZONE } }, visitor: "$visitor" },
          views: { $sum: 1 },
        },
      },
      { $group: { _id: "$_id.hour", visitors: { $sum: 1 }, views: { $sum: "$views" } } },
    ])
    .toArray();
  const byHour = new Map(rows.map((row) => [row._id, row]));
  return Array.from({ length: 24 }, (_, hour) => ({
    key: String(hour),
    label: `${String(hour).padStart(2, "0")}:00`,
    visitors: byHour.get(hour)?.visitors ?? 0,
    views: byHour.get(hour)?.views ?? 0,
  }));
}

export async function analyticsReport(db: Db, range: AnalyticsRange, at: Date): Promise<AnalyticsReport> {
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const span = rangeSpan(range, today);
  const days = daysFrom(span.from, span.to);
  const previousDays = daysFrom(span.previousFrom, span.previousTo);
  const stats = await dayStats(db, [...previousDays, ...days], today);
  const current = mergeDays(days.map((day) => stats.get(day)!));
  const previous = mergeDays(previousDays.map((day) => stats.get(day)!));

  let series: SeriesPoint[];
  let unit: AnalyticsReport["unit"];
  if (range === "today") {
    series = await hourly(db, today);
    unit = "hour";
  } else if (range === "12m") {
    const months = new Map<string, SeriesPoint>();
    for (const day of days) {
      const key = day.slice(0, 7);
      const point = months.get(key) ?? {
        key,
        label: `${SHORT_MONTHS[Number(key.slice(5)) - 1]} ${key.slice(2, 4)}`,
        visitors: 0,
        views: 0,
      };
      point.visitors += stats.get(day)!.visitors;
      point.views += stats.get(day)!.views;
      months.set(key, point);
    }
    series = [...months.values()];
    unit = "month";
  } else {
    series = days.map((day) => ({
      key: day,
      label: formatDay(day, today),
      visitors: stats.get(day)!.visitors,
      views: stats.get(day)!.views,
    }));
    unit = "day";
  }
  return {
    range,
    span,
    current,
    previous: {
      visitors: previous.visitors,
      views: previous.views,
      bounces: previous.bounces,
      converted: previous.converted,
    },
    series,
    unit,
  };
}

export type LiveStats = { visitors: number; views: number; minutes: number[]; pages: Count[] };

// The last 30 minutes: visitors, page views per minute (oldest first) and the pages being read.
export async function liveStats(db: Db, at: Date): Promise<LiveStats> {
  const since = new Date(at.getTime() - 30 * 60_000);
  const [facets] = await analyticsEvents(db)
    .aggregate<{
      visitors: { count: number }[];
      minutes: { _id: number; views: number }[];
      pages: { _id: string; count: number; visitors: number }[];
    }>([
      { $match: { at: { $gt: since, $lte: at }, type: "view" } },
      {
        $facet: {
          visitors: [{ $group: { _id: "$visitor" } }, { $count: "count" }],
          minutes: [
            {
              $group: {
                _id: { $floor: { $divide: [{ $subtract: [at, "$at"] }, 60_000] } },
                views: { $sum: 1 },
              },
            },
          ],
          pages: [
            { $group: { _id: { path: "$path", visitor: "$visitor" }, count: { $sum: 1 } } },
            { $group: { _id: "$_id.path", count: { $sum: "$count" }, visitors: { $sum: 1 } } },
            { $sort: { count: -1, visitors: -1, _id: 1 } },
            { $limit: 8 },
          ],
        },
      },
    ])
    .toArray();
  const minutes = Array.from({ length: 30 }, () => 0);
  let views = 0;
  for (const row of facets?.minutes ?? []) {
    const index = 29 - Math.min(29, Math.max(0, row._id));
    minutes[index] = (minutes[index] ?? 0) + row.views;
    views += row.views;
  }
  return {
    visitors: facets?.visitors[0]?.count ?? 0,
    views,
    minutes,
    pages: sortCounts(
      (facets?.pages ?? []).map((row) => ({ key: row._id, count: row.count, visitors: row.visitors })),
    ).slice(0, 8),
  };
}

export type VitalSummary = {
  name: Vital;
  p75: number | null;
  samples: number;
  shares: Record<VitalRating, number>; // fractions of the samples
};
export type VitalsPage = { path: string; samples: number; p75: Partial<Record<Vital, number>> };
export type VitalsReport = { from: string; summaries: VitalSummary[]; pages: VitalsPage[] };

const MAX_VITALS = 20_000;

// Loading timings at the 75th percentile, over the range (at most the 90 days they are kept), overall and
// for the pages with the most measurements.
export async function vitalsReport(db: Db, fromDay: string, at: Date): Promise<VitalsReport> {
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const oldest = addDays(today, -(VITALS_RETENTION_DAYS - 1));
  const from = fromDay < oldest ? oldest : fromDay;
  const since = zonedInstant(from, "00:00", ADMIN_TIME_ZONE) ?? new Date(0);
  const docs = await analyticsVitals(db)
    .find({ at: { $gte: since } }, { projection: { path: 1, metrics: 1 } })
    .sort({ at: -1 })
    .limit(MAX_VITALS)
    .toArray();

  const summaries = VITALS.map((name): VitalSummary => {
    const values = docs.flatMap((doc) => (doc.metrics[name] === undefined ? [] : [doc.metrics[name]]));
    const shares = { good: 0, improve: 0, poor: 0 };
    for (const value of values) shares[rateVital(name, value)] += 1;
    for (const rating of Object.keys(shares) as VitalRating[]) {
      shares[rating] = values.length ? shares[rating] / values.length : 0;
    }
    return { name, p75: percentile(values, 75), samples: values.length, shares };
  });

  const byPath = new Map<string, typeof docs>();
  for (const doc of docs) {
    const rows = byPath.get(doc.path);
    if (rows) rows.push(doc);
    else byPath.set(doc.path, [doc]);
  }
  const pages = [...byPath.entries()]
    .map(([path, rows]): VitalsPage => {
      const p75: Partial<Record<Vital, number>> = {};
      for (const name of VITALS) {
        const value = percentile(
          rows.flatMap((row) => (row.metrics[name] === undefined ? [] : [row.metrics[name]])),
          75,
        );
        if (value !== null) p75[name] = value;
      }
      return { path, samples: rows.filter((row) => row.metrics.LCP !== undefined).length, p75 };
    })
    .sort((a, b) => b.samples - a.samples || a.path.localeCompare(b.path))
    .slice(0, 8);
  return { from, summaries, pages };
}

export type TrafficSummary = {
  visitors: number;
  views: number;
  live: number;
  days: { day: string; label: string; visitors: number }[];
};

// For the Today page: today so far, the last 30 minutes and the last two weeks.
export async function trafficSummary(db: Db, at: Date): Promise<TrafficSummary> {
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const days = daysFrom(addDays(today, -13), today);
  const [stats, live] = await Promise.all([dayStats(db, days, today), liveStats(db, at)]);
  return {
    visitors: stats.get(today)!.visitors,
    views: stats.get(today)!.views,
    live: live.visitors,
    days: days.map((day) => ({ day, label: formatDay(day, today), visitors: stats.get(day)!.visitors })),
  };
}
