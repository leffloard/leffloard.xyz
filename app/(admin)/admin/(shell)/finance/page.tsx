import Link from "next/link";
import { RefreshRatesButton } from "@/components/admin/finance/finance-controls";
import { MonthChart } from "@/components/admin/finance/month-chart";
import { PageHeader } from "@/components/admin/shell";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { Notice } from "@/components/ui/notice";
import { ADMIN_TIME_ZONE, plural } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatMoney, money, type Currency } from "@/lib/money";
import { addMonths } from "@/lib/work/dates";
import { requireAdmin } from "@/server/auth/dal";
import { getBillingSettings } from "@/server/billing/settings";
import { longDate } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { financeReport } from "@/server/finance/report";

export const metadata = { title: "Finance" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The span a period covers: the last 12 months (this month included), or a calendar year up to today.
function span(period: string, today: string): { from: string; to: string; label: string } {
  if (/^\d{4}$/.test(period) && period <= today.slice(0, 4)) {
    const to = period === today.slice(0, 4) ? today : `${period}-12-31`;
    return { from: `${period}-01-01`, to, label: period };
  }
  return { from: `${addMonths(`${today.slice(0, 7)}-01`, -11)}`, to: today, label: "the last 12 months" };
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: "danger" | "success" }) {
  return (
    <Card>
      <CardBody className="grid gap-1">
        <p className="text-xs text-muted">{label}</p>
        <p
          className={cn(
            "font-mono text-xl font-semibold tracking-tight tabular-nums",
            tone === "danger" && "text-danger",
            tone === "success" && "text-success",
          )}
        >
          {value}
        </p>
      </CardBody>
    </Card>
  );
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const db = await getDb();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const year = today.slice(0, 4);
  const period = first((await searchParams).period) ?? "12m";
  const { from, to, label } = span(period, today);
  const settings = await getBillingSettings(db);
  const base: Currency = settings.baseCurrency;
  const report = await financeReport(db, { from, to, today, base });
  const format = (minor: number) => formatMoney(money(minor, base));
  const periods = [
    { key: "12m", label: "Last 12 months" },
    { key: year, label: year },
    { key: String(Number(year) - 1), label: String(Number(year) - 1) },
  ];
  const current = periods.some((option) => option.key === period) ? period : "12m";
  const topCategory = Math.max(1, ...report.expenseByCategory.map((row) => row.baseMinor));
  const topClient = Math.max(1, ...report.byClient.map((row) => row.baseMinor));

  return (
    <>
      <PageHeader
        title="Finance"
        description={`Money in and out over ${label}, in ${base} at TCMB's rate of each day.`}
        action={
          <Link href="/admin/finance/expenses/new" className={buttonClasses("secondary", "sm")}>
            Add an expense
          </Link>
        }
      />
      <nav aria-label="Period" className="mb-5 flex flex-wrap gap-2">
        {periods.map((option) => (
          <Link
            key={option.key}
            href={option.key === "12m" ? "/admin/finance" : `/admin/finance?period=${option.key}`}
            aria-current={current === option.key ? "page" : undefined}
            className={cn(
              "rounded-full border px-3 py-1 text-xs transition-colors",
              current === option.key ? "border-accent text-ink" : "border-line text-muted hover:text-ink",
            )}
          >
            {option.label}
          </Link>
        ))}
      </nav>

      {report.missing.length ? (
        <div className="mb-6 grid gap-3">
          <Notice tone="warning">
            {plural(report.missing.length, "day")} with payments or expenses in another currency{" "}
            {report.missing.length === 1 ? "has" : "have"} no exchange rate yet (
            {report.missing
              .slice(0, 3)
              .map((item) => `${longDate(item.date)}, ${item.currency}`)
              .join("; ")}
            {report.missing.length > 3 ? "…" : ""}). {report.missing.length === 1 ? "It's" : "They're"} left
            out of the totals in {base} until the rates are fetched.
          </Notice>
          <RefreshRatesButton />
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Figure label="Income" value={format(report.incomeMinor)} />
        <Figure label="Expenses" value={format(report.expenseMinor)} />
        <Figure
          label="Profit, before tax"
          value={format(report.profitMinor)}
          tone={report.profitMinor < 0 ? "danger" : undefined}
        />
        <Figure label="Owed to you now" value={report.owedMinor === null ? "–" : format(report.owedMinor)} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Month by month" />
        <CardBody className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <MonthChart
            summary={`Income and expenses per month over ${label}: income ${format(report.incomeMinor)}, expenses ${format(report.expenseMinor)}.`}
            months={report.months.map((month) => ({
              key: month.key,
              short: month.label.slice(0, 3),
              income: month.incomeMinor,
              expense: month.expenseMinor,
            }))}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th scope="col" className="py-2 pr-3 font-normal">
                    Month
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Income
                  </th>
                  <th scope="col" className="py-2 pr-3 text-right font-normal">
                    Expenses
                  </th>
                  <th scope="col" className="py-2 text-right font-normal">
                    Profit
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...report.months].reverse().map((month) => (
                  <tr key={month.key}>
                    <th scope="row" className="py-1.5 pr-3 text-left font-normal">
                      {month.label}
                    </th>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {format(month.incomeMinor)}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono tabular-nums">
                      {format(month.expenseMinor)}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 text-right font-mono tabular-nums",
                        month.profitMinor < 0 && "text-danger",
                      )}
                    >
                      {format(month.profitMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="What came in, by client" description="The top eight." />
          <CardBody>
            {report.byClient.length ? (
              <ul className="grid gap-3 text-[13px]">
                {report.byClient.map((row) => (
                  <li key={row.key} className="grid gap-1">
                    <span className="flex justify-between gap-3">
                      <span className="truncate">{row.name}</span>
                      <span className="font-mono tabular-nums">{format(row.baseMinor)}</span>
                    </span>
                    <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className="block h-full rounded-full bg-accent"
                        style={{ width: `${Math.max(2, (Math.max(0, row.baseMinor) / topClient) * 100)}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No payments in this period.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="What went out, by category"
            action={
              <Link
                href="/admin/finance/expenses"
                className="text-[13px] text-accent underline-offset-4 hover:underline"
              >
                All expenses
              </Link>
            }
          />
          <CardBody>
            {report.expenseByCategory.length ? (
              <ul className="grid gap-3 text-[13px]">
                {report.expenseByCategory.map((row) => (
                  <li key={row.category} className="grid gap-1">
                    <span className="flex justify-between gap-3">
                      <span className="truncate">{row.label}</span>
                      <span className="font-mono tabular-nums">{format(row.baseMinor)}</span>
                    </span>
                    <span aria-hidden className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <span
                        className="block h-full rounded-full bg-muted/60"
                        style={{ width: `${Math.max(2, (row.baseMinor / topCategory) * 100)}%` }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">No expenses in this period.</p>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Owed to you, by how late"
          description="Unpaid invoices today, valued at today's rate."
          action={
            <Link
              href="/admin/billing/invoices"
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              Unpaid invoices
            </Link>
          }
        />
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th scope="col" className="px-5 py-2 font-normal">
                  Age
                </th>
                <th scope="col" className="px-5 py-2 text-right font-normal">
                  Invoices
                </th>
                <th scope="col" className="px-5 py-2 text-right font-normal">
                  Amounts
                </th>
                <th scope="col" className="px-5 py-2 text-right font-normal">
                  In {base}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {report.aging.map((row) => (
                <tr
                  key={row.bucket}
                  className={row.bucket !== "current" && row.count ? "text-danger" : undefined}
                >
                  <th scope="row" className="px-5 py-2 text-left font-normal">
                    {row.label}
                  </th>
                  <td className="px-5 py-2 text-right tabular-nums">{row.count}</td>
                  <td className="px-5 py-2 text-right font-mono tabular-nums">
                    {row.byCurrency.length ? row.byCurrency.map(formatMoney).join(" + ") : "–"}
                  </td>
                  <td className="px-5 py-2 text-right font-mono tabular-nums">
                    {row.baseMinor === null ? "no rate yet" : format(row.baseMinor)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
