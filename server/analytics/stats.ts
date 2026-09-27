import "server-only";
import type { Db, Document } from "mongodb";
import { EVENT_RETENTION_DAYS } from "@/lib/analytics/model";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { addDays, todayIn } from "@/lib/intake/time";
import { analyticsDays, analyticsEvents } from "@/server/analytics/collections";
import { log } from "@/server/log";
import type { AnalyticsDayDoc, Count, DayStats } from "@/server/analytics/types";

// Each day's numbers, summed from its page views and goals. A finished day is summed once by the nightly
// job and read from analytics_days after that; today, and a day the job hasn't reached, are summed on the
// spot from the single visits.
//
// Visitor ids change every day, so the distinct visitors of each day added up are exactly the distinct
// visitors of a longer span, and the day sums can simply be added.

const LIST_LIMITS = {
  pages: 100,
  sources: 50,
  campaigns: 30,
  countries: 60,
  devices: 5,
  goals: 10,
  notFound: 30,
} as const;
type ListName = keyof typeof LIST_LIMITS;
const LISTS = Object.keys(LIST_LIMITS) as ListName[];

export function emptyDay(): DayStats {
  return {
    visitors: 0,
    views: 0,
    bounces: 0,
    converted: 0,
    pages: [],
    sources: [],
    campaigns: [],
    countries: [],
    devices: [],
    goals: [],
    notFound: [],
  };
}

export function sortCounts(rows: Count[]): Count[] {
  return rows.sort((a, b) => b.count - a.count || b.visitors - a.visitors || a.key.localeCompare(b.key));
}

// Per day and key: every matching event, and each visitor once. Only each day's top rows leave the
// database: visitors choose the paths and tags they send, so there is no limit to how many keys a day has,
// and every facet's answer together has to fit in one 16 MB document.
function breakdown(match: Document, key: unknown, limit: number): Document[] {
  return [
    { $match: match },
    { $group: { _id: { day: "$day", key, visitor: "$visitor" }, count: { $sum: 1 } } },
    {
      $group: {
        _id: { day: "$_id.day", key: "$_id.key" },
        count: { $sum: "$count" },
        visitors: { $sum: 1 },
      },
    },
    { $project: { _id: 0, day: "$_id.day", key: "$_id.key", count: 1, visitors: 1 } },
    {
      $group: {
        _id: "$day",
        rows: {
          $topN: {
            n: limit,
            sortBy: { count: -1, visitors: -1, key: 1 },
            output: { key: "$key", count: "$count", visitors: "$visitors" },
          },
        },
      },
    },
  ];
}

type TopRows = { _id: string; rows: { key: string | null; count: number; visitors: number }[] };
type Facets = Record<ListName, TopRows[]> & {
  totals: { _id: string; visitors: number; views: number; bounces: number }[];
  converted: { _id: string; converted: number }[];
};

export async function computeDays(db: Db, days: string[]): Promise<Map<string, DayStats>> {
  const result = new Map(days.map((day) => [day, emptyDay()]));
  if (days.length === 0) return result;
  const [facets] = await analyticsEvents(db)
    .aggregate<Facets>([
      { $match: { day: { $in: days } } },
      {
        $facet: {
          totals: [
            { $match: { type: "view" } },
            { $group: { _id: { day: "$day", visitor: "$visitor" }, views: { $sum: 1 } } },
            {
              $group: {
                _id: "$_id.day",
                visitors: { $sum: 1 },
                views: { $sum: "$views" },
                bounces: { $sum: { $cond: [{ $eq: ["$views", 1] }, 1, 0] } },
              },
            },
          ],
          converted: [
            { $match: { type: "goal" } },
            { $group: { _id: { day: "$day", visitor: "$visitor" } } },
            { $group: { _id: "$_id.day", converted: { $sum: 1 } } },
          ],
          pages: breakdown({ type: "view", notFound: false }, "$path", LIST_LIMITS.pages),
          notFound: breakdown({ type: "view", notFound: true }, "$path", LIST_LIMITS.notFound),
          sources: breakdown(
            { type: "view", entry: true },
            { $ifNull: ["$source", ""] },
            LIST_LIMITS.sources,
          ),
          campaigns: breakdown(
            { type: "view", entry: true, campaign: { $type: "string" } },
            "$campaign",
            LIST_LIMITS.campaigns,
          ),
          countries: breakdown({ type: "view" }, { $ifNull: ["$country", ""] }, LIST_LIMITS.countries),
          devices: breakdown({ type: "view" }, { $ifNull: ["$device", ""] }, LIST_LIMITS.devices),
          goals: breakdown({ type: "goal" }, "$goal", LIST_LIMITS.goals),
        },
      },
    ])
    .toArray();
  if (!facets) return result;
  for (const row of facets.totals) {
    const day = result.get(row._id);
    if (day) Object.assign(day, { visitors: row.visitors, views: row.views, bounces: row.bounces });
  }
  for (const row of facets.converted) {
    const day = result.get(row._id);
    if (day) day.converted = row.converted;
  }
  for (const list of LISTS) {
    for (const top of facets[list]) {
      const day = result.get(top._id);
      if (!day) continue;
      day[list] = sortCounts(
        top.rows.map((row) => ({ key: row.key ?? "", count: row.count, visitors: row.visitors })),
      );
    }
  }
  return result;
}

function toStats(doc: AnalyticsDayDoc): DayStats {
  const stats = emptyDay();
  stats.visitors = doc.visitors;
  stats.views = doc.views;
  stats.bounces = doc.bounces;
  stats.converted = doc.converted;
  for (const list of LISTS) stats[list] = doc[list] ?? [];
  return stats;
}

// The numbers of each day asked for: stored sums where the job made them, the single visits otherwise (for
// days they are still kept), and nothing for older days.
export async function dayStats(db: Db, days: string[], today: string): Promise<Map<string, DayStats>> {
  const stored = new Map(
    (
      await analyticsDays(db)
        .find({ _id: { $in: days } })
        .toArray()
    ).map((doc) => [doc._id, toStats(doc)]),
  );
  const oldest = addDays(today, -EVENT_RETENTION_DAYS);
  const missing = days.filter((day) => !stored.has(day) && day >= oldest && day <= today);
  const computed = await computeDays(db, missing);
  return new Map(days.map((day) => [day, stored.get(day) ?? computed.get(day) ?? emptyDay()]));
}

export function mergeCounts(lists: Count[][]): Count[] {
  const merged = new Map<string, Count>();
  for (const list of lists) {
    for (const row of list) {
      const current = merged.get(row.key);
      if (current) {
        current.count += row.count;
        current.visitors += row.visitors;
      } else {
        merged.set(row.key, { ...row });
      }
    }
  }
  return sortCounts([...merged.values()]);
}

export function mergeDays(days: DayStats[]): DayStats {
  const total = emptyDay();
  for (const day of days) {
    total.visitors += day.visitors;
    total.views += day.views;
    total.bounces += day.bounces;
    total.converted += day.converted;
  }
  for (const list of LISTS) total[list] = mergeCounts(days.map((day) => day[list]));
  return total;
}

// Sums up every finished day that has visits and no sums yet (normally just yesterday), one day at a time,
// so a day that can't be summed doesn't hold back the others. Run by the nightly "analytics" job; returns how
// many days it summed, and throws once the rest are done if one failed (the job then tries again).
export async function rollupDays(db: Db, at: Date): Promise<number> {
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const withVisits = (await analyticsEvents(db).distinct("day", {
    day: { $gte: addDays(today, -EVENT_RETENTION_DAYS), $lt: today },
  })) as string[];
  if (withVisits.length === 0) return 0;
  const done = new Set(
    (
      await analyticsDays(db)
        .find({ _id: { $in: withVisits } }, { projection: { _id: 1 } })
        .toArray()
    ).map((doc) => doc._id),
  );
  const todo = withVisits.filter((day) => !done.has(day)).sort();
  let summed = 0;
  const failed: string[] = [];
  for (const day of todo) {
    try {
      const stats = (await computeDays(db, [day])).get(day) ?? emptyDay();
      await analyticsDays(db).replaceOne({ _id: day }, { ...stats, rolledAt: at }, { upsert: true });
      summed += 1;
    } catch (error) {
      log.error({ err: error, day }, "summing up a day of visits failed");
      failed.push(day);
    }
  }
  if (failed.length) throw new Error(`The visits of ${failed.join(", ")} could not be summed up.`);
  return summed;
}
