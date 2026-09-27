import Link from "next/link";
import { AiExpenseButton } from "@/components/admin/ai/expense-button";
import { AiSettingsForm } from "@/components/admin/ai/settings-form";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { MICROS_PER_CENT, monthKey, monthLabel } from "@/lib/ai/budget";
import { AI_FEATURE_LABELS, AI_FEATURES, AI_RUN_RETENTION_DAYS } from "@/lib/ai/features";
import { addTokens, cacheHitRate, formatUsd, NO_TOKENS, type TokenUsage } from "@/lib/ai/pricing";
import { isListKind, KIND_LABELS } from "@/lib/content/schemas";
import { formatDateTime, formatRelative } from "@/lib/format";
import { decimalAmount } from "@/lib/money";
import { anthropicClient } from "@/server/ai/client";
import { getMonth, listMonths, listRuns, sweepStaleRuns } from "@/server/ai/ledger";
import { getAiSettings } from "@/server/ai/settings";
import type { AiRunDoc, AiRunStatus, AiTarget } from "@/server/ai/types";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

export const metadata = { title: "AI assistant" };

const STATUS: Record<AiRunStatus, { label: string; tone: "accent" | "success" | "warning" | "danger" }> = {
  running: { label: "running", tone: "accent" },
  done: { label: "done", tone: "success" },
  refused: { label: "declined", tone: "warning" },
  failed: { label: "failed", tone: "danger" },
};

const count = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

function tokens(usage: TokenUsage): string {
  const cached = usage.cacheRead ? ` · ${count.format(usage.cacheRead)} from cache` : "";
  const written = usage.cacheWrite5m + usage.cacheWrite1h;
  return `${count.format(usage.input + usage.cacheRead + written)} in${cached} · ${count.format(usage.output)} out`;
}

function percent(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

function targetLink(target: AiTarget | null): { href: string; label: string } | null {
  if (!target) return null;
  switch (target.kind) {
    case "inquiry":
      return { href: `/admin/inbox/${String(target.id)}`, label: "Inbox message" };
    case "meeting":
      return { href: `/admin/calendar/meetings/${String(target.id)}`, label: "Meeting" };
    case "week":
      return { href: "/admin", label: `Week of ${target.id}` };
    case "content": {
      const kind = KIND_LABELS[target.contentKind].one;
      if (!isListKind(target.contentKind))
        return { href: `/admin/content/${target.contentKind}`, label: kind };
      return target.id
        ? { href: `/admin/content/${target.contentKind}/${String(target.id)}`, label: kind }
        : { href: `/admin/content/${target.contentKind}`, label: `New ${kind.toLowerCase()}` };
    }
  }
}

export default async function AiPage() {
  await requireAdmin();
  const db = await getDb();
  const at = now();
  await sweepStaleRuns(db, at);
  const month = monthKey(at);
  const [settings, current, months, runs] = await Promise.all([
    getAiSettings(db),
    getMonth(db, month),
    listMonths(db, 12),
    listRuns(db, 40),
  ]);
  const keySet = anthropicClient() !== null;
  const spent = current?.spentMicros ?? 0;
  const reserved = current?.reservedMicros ?? 0;
  const budget = settings.monthlyBudgetMicros;
  const used = budget ? Math.min(100, Math.round(((spent + reserved) / budget) * 100)) : 100;
  const usage = current?.usage ?? NO_TOKENS;
  const featureRows = AI_FEATURES.map((feature) => ({ feature, ...current?.byFeature[feature] })).filter(
    (row) => row.runs,
  );

  return (
    <>
      <PageHeader
        title="AI assistant"
        description="Claude drafts; you decide. Nothing it writes is sent or published without your click."
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader
              title={monthLabel(month)}
              description="Worked out from the token counts Anthropic returns: close to the bill, which is in Anthropic's console."
            />
            <CardBody className="grid gap-4 text-[13px]">
              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-2xl font-semibold tracking-tight">{formatUsd(spent)}</span>
                  <span className="text-muted">of {formatUsd(budget)} this month</span>
                </div>
                <div
                  className="h-2 overflow-hidden rounded-full bg-white/[0.06]"
                  role="meter"
                  aria-label="Budget used"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={used}
                >
                  <div
                    className={`h-full rounded-full ${used >= 90 ? "bg-danger" : used >= 70 ? "bg-warning" : "bg-accent"}`}
                    style={{ width: `${used}%` }}
                  />
                </div>
                {reserved > 0 ? (
                  <p className="text-xs text-muted">
                    {formatUsd(reserved)} is set aside for requests running now.
                  </p>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Requests</dt>
                  <dd className="text-base">{current?.runs ?? 0}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Read from cache</dt>
                  <dd className="text-base">{percent(cacheHitRate(usage))}</dd>
                </div>
                <div className="col-span-2">
                  <dt className="text-xs text-muted">Tokens</dt>
                  <dd>{tokens(usage)}</dd>
                </div>
              </dl>
              {featureRows.length ? (
                <table className="w-full text-left">
                  <caption className="sr-only">This month by feature</caption>
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-1 font-normal">Feature</th>
                      <th className="py-1 text-right font-normal">Requests</th>
                      <th className="py-1 text-right font-normal">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {featureRows.map((row) => (
                      <tr key={row.feature}>
                        <td className="py-1.5">{AI_FEATURE_LABELS[row.feature]}</td>
                        <td className="py-1.5 text-right">{row.runs}</td>
                        <td className="py-1.5 text-right">{formatUsd(row.costMicros ?? 0)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Recent requests"
              description={`Drafts are kept ${AI_RUN_RETENTION_DAYS} days; the monthly totals stay.`}
            />
            <CardBody>
              {runs.length === 0 ? (
                <p className="text-[13px] text-muted">
                  Nothing yet. The AI buttons are in the inbox, on quotes, meetings, Today and the content
                  editor.
                </p>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {runs.map((run) => (
                    <RunRow key={run._id.toHexString()} run={run} at={at} />
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <AiSettingsForm
            keySet={keySet}
            initial={{
              enabled: settings.enabled,
              model: settings.model,
              budget: decimalAmount(Math.round(settings.monthlyBudgetMicros / MICROS_PER_CENT)),
              fallbacks: settings.fallbacks,
              autoTriage: settings.autoTriage,
              version: settings.version,
            }}
          />
          <Card>
            <CardHeader title="Months" description="Past months can go into the finance expenses." />
            <CardBody>
              {months.length === 0 ? (
                <p className="text-[13px] text-muted">No usage yet.</p>
              ) : (
                <ul className="divide-y divide-line text-[13px]">
                  {months.map((row) => (
                    <li key={row._id} className="grid gap-1 py-2 first:pt-0 last:pb-0">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="font-medium">{monthLabel(row._id)}</span>
                        <span>{formatUsd(row.spentMicros)}</span>
                      </div>
                      <p className="text-xs text-muted">
                        {row.runs} requests · {percent(cacheHitRate(addTokens(NO_TOKENS, row.usage)))} from
                        cache
                      </p>
                      {row._id < month && row.spentMicros > 0 ? (
                        row.expenseId ? (
                          <Link
                            href="/admin/finance/expenses"
                            className="text-xs text-accent underline underline-offset-2"
                          >
                            In the expenses
                          </Link>
                        ) : (
                          <AiExpenseButton month={row._id} />
                        )
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function RunRow({ run, at }: { run: AiRunDoc; at: Date }) {
  const status = STATUS[run.status];
  const target = targetLink(run.target);
  return (
    <li className="grid gap-1 py-2.5 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{AI_FEATURE_LABELS[run.feature]}</span>
        <Badge tone={status.tone}>{status.label}</Badge>
        {run.trigger === "auto" ? <Badge>automatic</Badge> : null}
        {run.fallback ? <Badge tone="warning">fallback model</Badge> : null}
        {target ? (
          <Link href={target.href} className="text-xs text-accent underline underline-offset-2">
            {target.label}
          </Link>
        ) : null}
        <span className="ml-auto text-xs text-muted" title={formatDateTime(run.createdAt)}>
          {formatRelative(run.createdAt, at)}
        </span>
      </div>
      <p className="text-xs text-muted">
        {run.servedBy ?? run.model} · {tokens(run.usage)} · {formatUsd(run.costMicros)}
        {run.durationMs !== null ? ` · ${(run.durationMs / 1000).toFixed(1)} s` : ""}
      </p>
      {run.error ? <p className="text-xs text-danger">{run.error}</p> : null}
      {run.refusal ? (
        <p className="text-xs text-warning">Declined by Claude&apos;s safety checks ({run.refusal}).</p>
      ) : null}
      {run.output && run.status === "done" ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted hover:text-ink">The draft</summary>
          <pre className="mt-1.5 max-h-72 overflow-auto rounded-md border border-line bg-surface-2/60 p-2.5 font-sans text-[13px] leading-6 break-words whitespace-pre-wrap">
            {run.output}
          </pre>
        </details>
      ) : null}
    </li>
  );
}
