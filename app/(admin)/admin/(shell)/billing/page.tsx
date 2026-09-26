import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { amountLeft } from "@/lib/billing/document";
import { invoiceState, quoteState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE, plural } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatMoney, money, totalsByCurrency, type Money } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { listInvoices } from "@/server/billing/invoices";
import { listQuotes } from "@/server/billing/quotes";
import { longDate } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Billing" };

function Amounts({ values }: { values: Money[] }) {
  if (!values.length) return <p className="text-2xl font-semibold tracking-tight">–</p>;
  return (
    <ul className="grid gap-0.5">
      {values.map((value) => (
        <li key={value.currency} className="font-mono text-xl font-semibold tabular-nums">
          {formatMoney(value)}
        </li>
      ))}
    </ul>
  );
}

export default async function BillingPage() {
  await requireAdmin();
  const db = await getDb();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const [open, sent] = await Promise.all([
    listInvoices(db, { view: "open" }),
    listQuotes(db, { view: "open" }),
  ]);
  const unpaid = open.filter((invoice) => invoice.kind === "invoice");
  const owed = (items: typeof unpaid) =>
    totalsByCurrency(items.map((invoice) => money(amountLeft(invoice), invoice.currency)));
  const overdue = unpaid.filter((invoice) => invoiceState(invoice, today) === "overdue");
  const waiting = sent.filter((quote) => quoteState(quote, today) === "sent");

  return (
    <>
      <PageHeader
        title="Billing"
        description="What clients owe you, and the quotes they haven't answered yet."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/admin/billing/quotes/new" className={buttonClasses("secondary", "sm")}>
              New quote
            </Link>
            <Link href="/admin/billing/invoices/new" className={buttonClasses("primary", "sm")}>
              New invoice
            </Link>
          </div>
        }
      />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <Card>
          <CardHeader title="Waiting to be paid" description={plural(unpaid.length, "invoice")} />
          <CardBody>
            <Amounts values={owed(unpaid)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Overdue"
            description={overdue.length ? plural(overdue.length, "invoice") : "Nothing late."}
          />
          <CardBody className={overdue.length ? "text-danger" : undefined}>
            <Amounts values={owed(overdue)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader
            title="Quotes out"
            description={`${plural(waiting.length, "quote")} waiting for an answer`}
          />
          <CardBody>
            <Amounts
              values={totalsByCurrency(
                waiting.map((quote) => money(quote.totals.totalMinor, quote.currency)),
              )}
            />
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Unpaid invoices"
          description="The oldest due date first."
          action={
            <Link
              href="/admin/billing/invoices"
              className="text-[13px] text-accent underline-offset-4 hover:underline"
            >
              All invoices
            </Link>
          }
        />
        {unpaid.length ? (
          <ul className="divide-y divide-line">
            {unpaid.slice(0, 10).map((invoice) => {
              const late = invoiceState(invoice, today) === "overdue";
              return (
                <li key={invoice._id.toHexString()}>
                  <Link
                    href={`/admin/billing/invoices/${invoice._id.toHexString()}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px] hover:bg-white/[0.03]"
                  >
                    <span className="w-28 shrink-0 font-mono text-[12px]">{invoice.number}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {invoice.recipient.name} · {invoice.title}
                    </span>
                    <span className="font-mono tabular-nums">
                      {formatMoney(money(amountLeft(invoice), invoice.currency))}
                    </span>
                    {late ? <Badge tone="danger">overdue</Badge> : null}
                    <span className="w-36 shrink-0 text-right text-xs text-muted">
                      {invoice.dueDate ? `due ${longDate(invoice.dueDate)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <CardBody>
            <p className="text-[13px] text-muted">Nothing is waiting to be paid.</p>
          </CardBody>
        )}
      </Card>
    </>
  );
}
