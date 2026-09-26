import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/lib/finance/options";
import { formatMoney, money, totalsByCurrency } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { longDate } from "@/server/billing/view";
import { getDb } from "@/server/db/client";
import { expenseMonths, listExpenses } from "@/server/finance/expenses";
import { monthLabel } from "@/server/finance/report";

export const metadata = { title: "Expenses" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const db = await getDb();
  const months = await expenseMonths(db);
  const asked = first(raw.month);
  const month = asked && /^\d{4}-\d{2}$/.test(asked) ? asked : null;
  const askedCategory = first(raw.category);
  const category = (EXPENSE_CATEGORIES as readonly string[]).includes(askedCategory ?? "")
    ? (askedCategory as ExpenseCategory)
    : null;
  const items = await listExpenses(db, { month, category });
  const totals = totalsByCurrency(items.map((item) => money(item.amountMinor, item.currency)));
  const href = (next: { month?: string | null; category?: string | null }) => {
    const params = new URLSearchParams();
    const nextMonth = next.month === undefined ? month : next.month;
    const nextCategory = next.category === undefined ? category : next.category;
    if (nextMonth) params.set("month", nextMonth);
    if (nextCategory) params.set("category", nextCategory);
    const query = params.toString();
    return query ? `/admin/finance/expenses?${query}` : "/admin/finance/expenses";
  };
  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs transition-colors",
      active ? "border-accent text-ink" : "border-line text-muted hover:text-ink",
    );

  return (
    <>
      <PageHeader
        title="Expenses"
        description="What the business spends: hosting, software, fees, hardware. Counted against income in the overview."
        action={
          <Link href="/admin/finance/expenses/new" className={buttonClasses("primary", "sm")}>
            Add an expense
          </Link>
        }
      />
      <nav aria-label="Months" className="mb-3 flex flex-wrap gap-2">
        <Link
          href={href({ month: null })}
          aria-current={!month ? "page" : undefined}
          className={chip(!month)}
        >
          Latest
        </Link>
        {months.slice(0, 18).map((key) => (
          <Link
            key={key}
            href={href({ month: key })}
            aria-current={month === key ? "page" : undefined}
            className={chip(month === key)}
          >
            {monthLabel(key)}
          </Link>
        ))}
      </nav>
      <nav aria-label="Categories" className="mb-5 flex flex-wrap gap-2">
        <Link
          href={href({ category: null })}
          aria-current={!category ? "page" : undefined}
          className={chip(!category)}
        >
          All categories
        </Link>
        {EXPENSE_CATEGORIES.map((key) => (
          <Link
            key={key}
            href={href({ category: key })}
            aria-current={category === key ? "page" : undefined}
            className={chip(category === key)}
          >
            {EXPENSE_CATEGORY_LABELS[key]}
          </Link>
        ))}
      </nav>
      {items.length ? (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {items.map((item) => (
              <li key={item._id.toHexString()}>
                <Link
                  href={`/admin/finance/expenses/${item._id.toHexString()}`}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-[13px] hover:bg-white/[0.03]"
                >
                  <span className="w-28 shrink-0 text-xs text-muted">{longDate(item.date)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{item.vendor}</span>
                    <span className="block truncate text-xs text-muted">
                      {item.description || item.reference || " "}
                    </span>
                  </span>
                  <Badge>{EXPENSE_CATEGORY_LABELS[item.category]}</Badge>
                  <span className="w-28 shrink-0 text-right font-mono tabular-nums">
                    {formatMoney(money(item.amountMinor, item.currency))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-right text-[13px] text-muted">
            {month ? `${monthLabel(month)}: ` : "Shown: "}
            <span className="font-mono text-ink tabular-nums">{totals.map(formatMoney).join(" + ")}</span>
          </p>
        </>
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-muted">
          No expenses {month ? `in ${monthLabel(month)}` : "yet"}.
        </p>
      )}
    </>
  );
}
