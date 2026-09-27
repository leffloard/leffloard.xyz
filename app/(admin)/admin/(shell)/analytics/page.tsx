import Link from "next/link";
import { AutoRefresh } from "@/components/admin/analytics/auto-refresh";
import { CountList, type ListRow } from "@/components/admin/analytics/count-list";
import { SparkBars, TrafficChart } from "@/components/admin/analytics/traffic-chart";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import {
  DEVICE_LABELS,
  formatVital,
  GOAL_LABELS,
  isRange,
  RANGE_LABELS,
  RANGES,
  rateVital,
  RATING_LABELS,
  VITAL_INFO,
  VITALS,
  type Device,
  type Goal,
  type VitalRating,
} from "@/lib/analytics/model";
import { ADMIN_TIME_ZONE, plural } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatDay } from "@/lib/work/dates";
import { requireAdmin } from "@/server/auth/dal";
import { analyticsReport, liveStats, vitalsReport } from "@/server/analytics/report";
import type { Count } from "@/server/analytics/types";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Analytics" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const regions = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string): string {
  if (!code) return "Unknown";
  try {
    return regions.of(code) ?? code;
  } catch {
    return code;
  }
}

const RATING_TONES = { good: "success", improve: "warning", poor: "danger" } as const;
const RATING_BARS: Record<VitalRating, string> = {
  good: "bg-success",
  improve: "bg-warning",
  poor: "bg-danger",
};

const share = (part: number, whole: number) => (whole > 0 ? Math.min(1, part / whole) : 0);
const percent = (value: number) => `${Math.round(value * 100)}%`;

function change(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const value = Math.round(((current - previous) / previous) * 100);
  return `${value > 0 ? "+" : ""}${value}%`;
}

function Figure({
  label,
  value,
  previous,
  delta,
}: {
  label: string;
  value: string;
  previous: string;
  delta: string | null;
}) {
  return (
    <Card>
      <CardBody className="grid gap-1">
        <p className="text-xs text-muted">{label}</p>
        <p className="font-mono text-xl font-semibold tracking-tight tabular-nums">{value}</p>
        <p className="text-xs text-muted">
          {previous}
          {delta ? <span className="ml-1.5 font-mono">({delta})</span> : null}
        </p>
      </CardBody>
    </Card>
  );
}

function rows(counts: Count[], label: (key: string) => string, detail?: (row: Count) => string): ListRow[] {
  return counts.map((row) => ({
    key: row.key || "(none)",
    label: label(row.key),
    value: row.count,
    detail: detail?.(row),
  }));
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const db = await getDb();
  const at = now();
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const asked = first((await searchParams).range);
  const range = isRange(asked) ? asked : "30d";
  const report = await analyticsReport(db, range, at);
  const [live, vitals] = await Promise.all([liveStats(db, at), vitalsReport(db, report.span.from, at)]);
  const { current, previous, span } = report;
  const previousLabel = span.previous.charAt(0).toUpperCase() + span.previous.slice(1);
  const visitorsLabel = (count: number) => plural(count, "visitor");

  return (
    <>
      <AutoRefresh seconds={30} />
      <PageHeader
        title="Analytics"
        description="Visits to the public site, counted without cookies. Your own visits while signed in aren't counted."
      />
      <nav aria-label="Range" className="mb-5 flex flex-wrap gap-2">
        {RANGES.map((option) => (
          <Link
            key={option}
            href={option === "30d" ? "/admin/analytics" : `/admin/analytics?range=${option}`}
            aria-current={range === option ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              range === option ? "border-accent text-ink" : "border-line text-muted hover:text-ink",
            )}
          >
            {RANGE_LABELS[option]}
          </Link>
        ))}
      </nav>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Figure
          label="Visitors"
          value={current.visitors.toLocaleString("en-US")}
          previous={`${previousLabel}: ${previous.visitors.toLocaleString("en-US")}`}
          delta={range === "today" ? null : change(current.visitors, previous.visitors)}
        />
        <Figure
          label="Page views"
          value={current.views.toLocaleString("en-US")}
          previous={`${previousLabel}: ${previous.views.toLocaleString("en-US")}`}
          delta={range === "today" ? null : change(current.views, previous.views)}
        />
        <Figure
          label="Left after one page"
          value={current.visitors ? percent(share(current.bounces, current.visitors)) : "–"}
          previous={`${previousLabel}: ${previous.visitors ? percent(share(previous.bounces, previous.visitors)) : "–"}`}
          delta={null}
        />
        <Figure
          label="Reached a goal"
          value={current.visitors ? percent(share(current.converted, current.visitors)) : "–"}
          previous={`${previousLabel}: ${previous.visitors ? percent(share(previous.converted, previous.visitors)) : "–"}`}
          delta={null}
        />
      </div>

      <Card className="mt-6">
        <CardHeader
          title={
            range === "today" ? "Today, hour by hour" : range === "12m" ? "Month by month" : "Day by day"
          }
          description={`${visitorsLabel(current.visitors)} and ${plural(current.views, "page view")}.`}
        />
        <CardBody>
          <TrafficChart
            points={report.series}
            summary={`Visitors and page views, ${RANGE_LABELS[range].toLowerCase()}: ${current.visitors} visitors, ${current.views} page views.`}
            caption="A visitor is counted once a day."
          />
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Right now"
          description={`${visitorsLabel(live.visitors)} and ${plural(live.views, "page view")} in the last 30 minutes.`}
        />
        <CardBody className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <SparkBars values={live.minutes} label="Page views per minute over the last 30 minutes." />
            <p className="mt-1 flex justify-between text-[11px] text-muted">
              <span>30 min ago</span>
              <span>now</span>
            </p>
          </div>
          {live.pages.length ? (
            <ul className="grid gap-1 text-[13px]">
              {live.pages.map((page) => (
                <li key={page.key} className="flex items-baseline justify-between gap-3">
                  <span className="truncate font-mono text-xs">{page.key}</span>
                  <span className="shrink-0 text-xs text-muted">{visitorsLabel(page.visitors)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">Nobody is reading the site right now.</p>
          )}
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <CountList
          title="Pages"
          rows={rows(
            current.pages,
            (key) => key,
            (row) => visitorsLabel(row.visitors),
          )}
          nameLabel="Page"
          valueLabel="Views"
          empty="No page views yet."
          mono
        />
        <CountList
          title="Sources"
          description="Where visits came from: a campaign tag, or the site with the link."
          rows={rows(
            current.sources,
            (key) => key || "Direct or unknown",
            (row) => visitorsLabel(row.visitors),
          )}
          nameLabel="Source"
          valueLabel="Visits"
          empty="No visits yet."
        />
        <CountList
          title="Campaigns"
          description={
            <>
              Links tagged with <code className="font-mono text-xs">?utm_campaign=</code>.
            </>
          }
          rows={rows(
            current.campaigns,
            (key) => key,
            (row) => visitorsLabel(row.visitors),
          )}
          nameLabel="Campaign"
          valueLabel="Visits"
          empty="No tagged links used yet."
        />
        <CountList
          title="Goals"
          description="Counted by the site when they happen."
          rows={current.goals.map((row) => ({
            key: row.key,
            label: GOAL_LABELS[row.key as Goal] ?? row.key,
            value: row.count,
            detail: current.visitors
              ? `${percent(share(row.visitors, current.visitors))} of visitors`
              : visitorsLabel(row.visitors),
          }))}
          nameLabel="Goal"
          valueLabel="Times"
          empty="No messages, bookings or CV downloads yet."
        />
        <CountList
          title="Countries"
          description="From Cloudflare, when the site runs behind it."
          rows={rows(current.countries, countryName, (row) => visitorsLabel(row.visitors))}
          nameLabel="Country"
          valueLabel="Views"
          empty="No page views yet."
        />
        <CountList
          title="Devices"
          description="By the width of the browser window."
          rows={rows(
            current.devices,
            (key) => DEVICE_LABELS[key as Device] ?? "Unknown",
            (row) => visitorsLabel(row.visitors),
          )}
          nameLabel="Device"
          valueLabel="Views"
          empty="No page views yet."
        />
        {current.notFound.length ? (
          <CountList
            title="Broken links"
            description="Addresses that showed the “page does not exist” page."
            rows={rows(
              current.notFound,
              (key) => key,
              (row) => visitorsLabel(row.visitors),
            )}
            nameLabel="Address"
            valueLabel="Views"
            empty=""
            mono
            className="md:col-span-2"
          />
        ) : null}
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Loading speed"
          description={`Measured in visitors' browsers since ${formatDay(vitals.from, today)}, at the 75th percentile: three in four page loads were at least this fast.`}
        />
        <CardBody className="grid gap-6">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {vitals.summaries.map((summary) => {
              const rating = summary.p75 === null ? null : rateVital(summary.name, summary.p75);
              return (
                <li key={summary.name} className="grid content-start gap-1.5">
                  <p className="text-xs text-muted" title={VITAL_INFO[summary.name].label}>
                    {summary.name}
                    <span className="sr-only"> ({VITAL_INFO[summary.name].label})</span>
                  </p>
                  <p className="font-mono text-lg font-semibold tabular-nums">
                    {summary.p75 === null ? "–" : formatVital(summary.name, summary.p75)}
                  </p>
                  {rating ? <Badge tone={RATING_TONES[rating]}>{RATING_LABELS[rating]}</Badge> : null}
                  {summary.samples ? (
                    <>
                      <div
                        aria-hidden
                        className="flex h-1.5 overflow-hidden rounded-full bg-line"
                        title="Good, needs improvement, poor"
                      >
                        {(["good", "improve", "poor"] as const).map((key) => (
                          <span
                            key={key}
                            className={RATING_BARS[key]}
                            style={{ width: `${summary.shares[key] * 100}%` }}
                          />
                        ))}
                      </div>
                      <p className="text-[11px] text-muted">
                        {percent(summary.shares.good)} good · {plural(summary.samples, "page load")}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted">No measurements yet.</p>
                  )}
                </li>
              );
            })}
          </ul>
          {vitals.pages.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-xs text-muted">
                    <th scope="col" className="pb-1.5 text-left font-normal">
                      Page
                    </th>
                    <th scope="col" className="pb-1.5 text-right font-normal">
                      Loads
                    </th>
                    {(["LCP", "INP", "CLS"] as const).map((name) => (
                      <th key={name} scope="col" className="pb-1.5 text-right font-normal">
                        {name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {vitals.pages.map((page) => (
                    <tr key={page.path}>
                      <td className="max-w-0 py-1.5 pr-3">
                        <span className="block truncate font-mono text-xs">{page.path}</span>
                      </td>
                      <td className="py-1.5 text-right font-mono text-xs tabular-nums">{page.samples}</td>
                      {(["LCP", "INP", "CLS"] as const).map((name) => {
                        const value = page.p75[name];
                        const rating = value === undefined ? null : rateVital(name, value);
                        return (
                          <td
                            key={name}
                            className={cn(
                              "py-1.5 pl-3 text-right font-mono text-xs whitespace-nowrap tabular-nums",
                              rating === "poor" && "text-danger",
                              rating === "improve" && "text-warning",
                            )}
                          >
                            {value === undefined ? "–" : formatVital(name, value)}
                            {rating && rating !== "good" ? (
                              <span className="sr-only"> ({RATING_LABELS[rating]})</span>
                            ) : null}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <p className="text-xs text-muted">
            {VITALS.map((name) => `${name}: ${VITAL_INFO[name].label}`).join(" · ")}.
          </p>
        </CardBody>
      </Card>
    </>
  );
}
