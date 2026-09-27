import { ObjectId } from "mongodb";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analytics/route";
import {
  analyticsDays,
  analyticsEvents,
  analyticsSalts,
  analyticsVitals,
} from "@/server/analytics/collections";
import { recordGoal } from "@/server/analytics/record";
import {
  analyticsReport,
  liveStats,
  rangeSpan,
  trafficSummary,
  vitalsReport,
} from "@/server/analytics/report";
import { computeDays, rollupDays } from "@/server/analytics/stats";
import { forgetSalts } from "@/server/analytics/visitor";
import { EXCLUDED_COLLECTIONS } from "@/server/backup/backup";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { clearEnvCache } from "@/server/env";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

// 14:00 in Istanbul on Saturday 26 September 2026.
const NOW = new Date("2026-09-26T11:00:00Z");
let clock = NOW;
const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// Each test uses its own addresses: the collector's rate limit lives in memory for the whole file.
let nextHost = 1;
const address = () => `198.51.100.${nextHost++}`;

beforeEach(async () => {
  await runMigrations(db());
  forgetSalts();
  clock = NOW;
  setClock(() => clock);
});

afterEach(() => {
  resetClock();
});

afterAll(async () => {
  await closeClient();
});

type Sent = { ip: string; agent?: string; headers?: Record<string, string> };

function send(body: unknown, { ip, agent = CHROME, headers = {} }: Sent): Promise<Response> {
  return POST(
    new Request("https://leffloard.test/api/analytics", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://leffloard.test",
        "sec-fetch-site": "same-origin",
        "x-forwarded-for": ip,
        "user-agent": agent,
        ...headers,
      },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const view = (path: string, extra: Record<string, unknown> = {}) => ({
  type: "view",
  path,
  entry: false,
  device: "desktop",
  ...extra,
});

async function events() {
  return analyticsEvents(db()).find().sort({ at: 1, _id: 1 }).toArray();
}

describe("the collector", () => {
  it("counts a page view with a visitor id, and stores no address", async () => {
    const ip = address();
    const response = await send(
      view("/work/tirego/", {
        entry: true,
        referrer: "https://news.ycombinator.com/item?id=1",
        campaign: "Launch",
      }),
      { ip },
    );
    expect(response.status).toBe(204);
    const [event, ...rest] = await events();
    expect(rest).toEqual([]);
    expect(event).toMatchObject({
      type: "view",
      day: "2026-09-26",
      path: "/work/tirego",
      entry: true,
      source: "news.ycombinator.com",
      campaign: "launch",
      country: null,
      device: "desktop",
      notFound: false,
      goal: null,
    });
    expect(event?.visitor).toMatch(/^[\w-]{22}$/);
    expect(JSON.stringify(event)).not.toContain(ip);
  });

  it("sees the same browser as one visitor within a day, and a stranger the next day", async () => {
    const ip = address();
    await send(view("/"), { ip });
    await send(view("/about"), { ip });
    await send(view("/"), { ip, agent: IPHONE });
    clock = new Date("2026-09-27T09:00:00Z");
    await send(view("/"), { ip });
    const [first, second, phone, nextDay] = await events();
    expect(second?.visitor).toBe(first?.visitor);
    expect(phone?.visitor).not.toBe(first?.visitor);
    expect(nextDay?.day).toBe("2026-09-27");
    expect(nextDay?.visitor).not.toBe(first?.visitor);
    // One salt a day, deleted an hour after its day ends in Istanbul.
    const salts = await analyticsSalts(db()).find().sort({ _id: 1 }).toArray();
    expect(salts.map((salt) => salt._id)).toEqual(["2026-09-26", "2026-09-27"]);
    expect(salts[0]?.expiresAt.toISOString()).toBe("2026-09-26T22:00:00.000Z");
  });

  it("drops what isn't counted, and always answers 204", async () => {
    const ip = address();
    const dropped: [unknown, Partial<Sent>][] = [
      [view("/"), { headers: { dnt: "1" } }],
      [view("/"), { headers: { "sec-gpc": "1" } }],
      [view("/"), { agent: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)" }],
      // The owner, signed in or previewing drafts.
      [view("/"), { headers: { cookie: "theme=dark; __Host-lf_session=abc" } }],
      [view("/"), { headers: { cookie: "__Host-lf_preview=abc" } }],
      [view("/"), { headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site" } }],
      [view("/"), { headers: { "content-type": "text/plain" } }],
      // Private pages and addresses that aren't pages.
      [view("/portal"), {}],
      [view("/q/4xY7abcdefghijklmnopqr"), {}],
      [view("/admin/inbox"), {}],
      [view("/api/health"), {}],
      [view("https://leffloard.test/"), {}],
      // Anything the tracker doesn't send.
      [{ ...view("/"), ip: "1.2.3.4" }, {}],
      [{ type: "goal", goal: "inquiry" }, {}],
      ["{not json", {}],
      [{ ...view("/"), $where: "1" }, {}],
    ];
    for (const [body, sent] of dropped) {
      const response = await send(body, { ip, ...sent });
      expect(response.status).toBe(204);
    }
    expect(await events()).toEqual([]);
  });

  it("treats a full page load from the site's own pages as the same visit", async () => {
    await send(view("/work", { entry: true, referrer: "https://leffloard.test/" }), { ip: address() });
    await send(view("/pricing", { entry: true, referrer: "https://leffloard.test/", source: "Newsletter" }), {
      ip: address(),
    });
    const [internal, tagged] = await events();
    expect(internal).toMatchObject({ entry: false, source: null, campaign: null });
    expect(tagged).toMatchObject({ entry: true, source: "newsletter" });
  });

  it("takes the country from Cloudflare only behind Cloudflare", async () => {
    await send(view("/"), { ip: address(), headers: { "cf-ipcountry": "TR" } });
    vi.stubEnv("CLIENT_IP_SOURCE", "cloudflare");
    clearEnvCache();
    try {
      const ip = address();
      await send(view("/"), { ip: "10.0.0.1", headers: { "cf-connecting-ip": ip, "cf-ipcountry": "TR" } });
      await send(view("/"), { ip: "10.0.0.1", headers: { "cf-connecting-ip": ip, "cf-ipcountry": "XX" } });
    } finally {
      vi.stubEnv("CLIENT_IP_SOURCE", "socket");
      clearEnvCache();
    }
    expect((await events()).map((event) => event.country)).toEqual([null, "TR", null]);
  });

  it("limits each address", async () => {
    const busy = address();
    for (let count = 0; count < 120; count++) await send(view("/"), { ip: busy });
    await send(view("/about"), { ip: busy });
    await send(view("/about"), { ip: address() });
    const counted = await events();
    expect(counted).toHaveLength(121);
    expect(counted.filter((event) => event.path === "/about")).toHaveLength(1);
  });

  it("counts an address outside the site's sections as a broken link, whatever the browser says", async () => {
    const ip = address();
    await send(view("/wp-login.php"), { ip });
    await send(view("/work/no-such-project", { notFound: true }), { ip });
    await send({ type: "vitals", path: "/wp-login.php", metrics: { LCP: 900 } }, { ip });
    expect((await events()).map((event) => [event.path, event.notFound])).toEqual([
      ["/wp-login.php", true],
      ["/work/no-such-project", true],
    ]);
    expect(await analyticsVitals(db()).countDocuments()).toBe(0);
  });

  it("stores loading timings without a visitor id", async () => {
    const ip = address();
    await send(
      { type: "vitals", path: "/", device: "mobile", metrics: { LCP: 1843.6, CLS: 0.01234 } },
      { ip },
    );
    await send({ type: "vitals", path: "/", metrics: {} }, { ip });
    await send({ type: "vitals", path: "/portal", metrics: { LCP: 900 } }, { ip });
    const stored = await analyticsVitals(db()).find().toArray();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ path: "/", device: "mobile", metrics: { LCP: 1844, CLS: 0.012 } });
    expect(Object.keys(stored[0] ?? {})).not.toContain("visitor");
  });
});

describe("goals", () => {
  const context = { siteUrl: "https://leffloard.test", ipSource: "socket" as const };

  it("are counted by the server with the visitor's id, unless the visitor opted out", async () => {
    const ip = address();
    await send(view("/contact"), { ip });
    const headers = (extra: Record<string, string> = {}) =>
      new Headers({ "x-forwarded-for": ip, "user-agent": CHROME, ...extra });
    expect(await recordGoal(db(), headers(), "inquiry", context)).toBe(true);
    expect(await recordGoal(db(), headers({ "sec-gpc": "1" }), "booking", context)).toBe(false);
    expect(await recordGoal(db(), headers({ "next-router-prefetch": "1" }), "cv", context)).toBe(false);
    const [page, goal, ...rest] = await events();
    expect(rest).toEqual([]);
    expect(goal).toMatchObject({ type: "goal", goal: "inquiry", path: null });
    expect(goal?.visitor).toBe(page?.visitor);
  });
});

describe("day sums and reports", () => {
  // Friday: two visitors from Hacker News and one direct; one sends a message.
  async function friday() {
    clock = new Date("2026-09-25T08:00:00Z");
    const [alice, bob, carol] = [address(), address(), address()];
    const hn = "https://news.ycombinator.com/";
    await send(view("/", { entry: true, referrer: hn }), { ip: alice });
    await send(view("/work"), { ip: alice });
    await send(view("/contact"), { ip: alice });
    await send(view("/", { entry: true, referrer: hn, device: "mobile" }), { ip: bob, agent: IPHONE });
    await send(view("/work/missing", { entry: true, notFound: true }), { ip: carol });
    await recordGoal(db(), new Headers({ "x-forwarded-for": alice, "user-agent": CHROME }), "inquiry", {
      siteUrl: "https://leffloard.test",
      ipSource: "socket",
    });
    return { alice };
  }

  it("sums up each finished day once", async () => {
    await friday();
    clock = NOW;
    await send(view("/"), { ip: address() });
    expect(await rollupDays(db(), NOW)).toBe(1);
    expect(await rollupDays(db(), NOW)).toBe(0);
    const day = await analyticsDays(db()).findOne({ _id: "2026-09-25" });
    expect(day).toMatchObject({ visitors: 3, views: 5, bounces: 2, converted: 1 });
    expect(day?.pages).toEqual([
      { key: "/", count: 2, visitors: 2 },
      { key: "/contact", count: 1, visitors: 1 },
      { key: "/work", count: 1, visitors: 1 },
    ]);
    expect(day?.notFound).toEqual([{ key: "/work/missing", count: 1, visitors: 1 }]);
    expect(day?.sources).toEqual([
      { key: "news.ycombinator.com", count: 2, visitors: 2 },
      { key: "", count: 1, visitors: 1 },
    ]);
    expect(day?.devices).toEqual([
      { key: "desktop", count: 4, visitors: 2 },
      { key: "mobile", count: 1, visitors: 1 },
    ]);
    expect(day?.countries).toEqual([{ key: "", count: 5, visitors: 3 }]);
    expect(day?.goals).toEqual([{ key: "inquiry", count: 1, visitors: 1 }]);
    // Today isn't summed until it's over.
    expect(await analyticsDays(db()).countDocuments()).toBe(1);
  });

  it("adds the stored sums and today's visits for a range, and compares with the period before", async () => {
    await friday();
    clock = NOW;
    await rollupDays(db(), NOW);
    await send(view("/"), { ip: address() });
    await send(view("/about"), { ip: address() });
    const report = await analyticsReport(db(), "7d", NOW);
    expect(report.span).toMatchObject({ from: "2026-09-20", to: "2026-09-26", previousFrom: "2026-09-13" });
    expect(report.current).toMatchObject({ visitors: 5, views: 7, converted: 1 });
    expect(report.previous).toEqual({ visitors: 0, views: 0, bounces: 0, converted: 0 });
    expect(report.unit).toBe("day");
    expect(report.series.map((point) => point.visitors)).toEqual([0, 0, 0, 0, 0, 3, 2]);

    const today = await analyticsReport(db(), "today", NOW);
    expect(today.current).toMatchObject({ visitors: 2, views: 2 });
    expect(today.previous.visitors).toBe(3);
    expect(today.series).toHaveLength(24);
    expect(today.series[14]).toMatchObject({ label: "14:00", visitors: 2 });

    const year = await analyticsReport(db(), "12m", NOW);
    expect(year.unit).toBe("month");
    expect(year.series).toHaveLength(12);
    expect(year.series.at(-1)).toMatchObject({ key: "2026-09", visitors: 5 });
  });

  it("keeps each day's lists short, however many addresses visitors make up", async () => {
    const at = new Date("2026-09-25T08:00:00Z");
    const event = (index: number, notFound: boolean) => ({
      _id: new ObjectId(),
      type: "view" as const,
      at,
      day: "2026-09-25",
      visitor: `v${index % 7}`,
      path: `/work/${"x".repeat(150)}-${index}`,
      entry: false,
      source: null,
      campaign: null,
      country: null,
      device: null,
      notFound,
      goal: null,
    });
    await analyticsEvents(db()).insertMany([
      ...Array.from({ length: 400 }, (_, index) => event(index, false)),
      ...Array.from({ length: 200 }, (_, index) => event(index, true)),
      { ...event(0, false), _id: new ObjectId(), path: "/work/popular" },
      { ...event(1, false), _id: new ObjectId(), path: "/work/popular" },
    ]);
    const day = (await computeDays(db(), ["2026-09-25"])).get("2026-09-25")!;
    expect(day.views).toBe(602);
    expect(day.pages).toHaveLength(100);
    expect(day.pages[0]).toEqual({ key: "/work/popular", count: 2, visitors: 2 });
    expect(day.notFound).toHaveLength(30);
    expect(await rollupDays(db(), NOW)).toBe(1);
    expect((await analyticsDays(db()).findOne({ _id: "2026-09-25" }))?.pages).toHaveLength(100);
  });

  it("works out the ranges", () => {
    expect(rangeSpan("today", "2026-09-26")).toMatchObject({
      previousFrom: "2026-09-25",
      previous: "yesterday",
    });
    expect(rangeSpan("30d", "2026-09-26")).toMatchObject({
      from: "2026-08-28",
      previousFrom: "2026-07-29",
      previousTo: "2026-08-27",
    });
    expect(rangeSpan("12m", "2026-09-26")).toMatchObject({
      from: "2025-10-01",
      previousFrom: "2024-10-01",
      previousTo: "2025-09-26",
    });
  });

  it("shows the last 30 minutes and the Today card", async () => {
    const reader = address();
    clock = new Date(NOW.getTime() - 40 * 60_000);
    await send(view("/blog"), { ip: address() });
    clock = new Date(NOW.getTime() - 5 * 60_000);
    await send(view("/"), { ip: reader });
    clock = NOW;
    await send(view("/work"), { ip: reader });
    const live = await liveStats(db(), NOW);
    expect(live).toMatchObject({ visitors: 1, views: 2 });
    expect(live.minutes).toHaveLength(30);
    expect(live.minutes[29]).toBe(1);
    expect(live.minutes[24]).toBe(1);
    expect(live.pages.map((page) => page.key).sort()).toEqual(["/", "/work"]);

    const traffic = await trafficSummary(db(), NOW);
    expect(traffic).toMatchObject({ visitors: 2, views: 3, live: 1 });
    expect(traffic.days).toHaveLength(14);
  });

  it("reads loading timings at the 75th percentile", async () => {
    const ip = address();
    for (const lcp of [1000, 2000, 3000, 5000]) {
      await send({ type: "vitals", path: "/", metrics: { LCP: lcp, CLS: 0 } }, { ip });
    }
    await send({ type: "vitals", path: "/work", metrics: { INP: 80 } }, { ip });
    const report = await vitalsReport(db(), "2026-09-01", NOW);
    const lcp = report.summaries.find((summary) => summary.name === "LCP");
    expect(lcp).toMatchObject({ p75: 3000, samples: 4, shares: { good: 0.5, improve: 0.25, poor: 0.25 } });
    expect(report.summaries.find((summary) => summary.name === "TTFB")).toMatchObject({
      p75: null,
      samples: 0,
    });
    expect(report.pages[0]).toMatchObject({ path: "/", samples: 4, p75: { LCP: 3000, CLS: 0 } });
  });

  it("keeps the day's salt out of backups", () => {
    expect(EXCLUDED_COLLECTIONS.has("analytics_salts")).toBe(true);
  });
});
