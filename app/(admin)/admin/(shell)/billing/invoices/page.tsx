import Link from "next/link";
import { DocumentList, ViewTabs, type DocumentRow } from "@/components/admin/billing/document-list";
import { PageHeader } from "@/components/admin/shell";
import { buttonClasses } from "@/components/ui/button";
import { INVOICE_STATE_LABELS, invoiceState, type InvoiceState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE, formatDate } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatMoney, money } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { INVOICE_VIEWS, invoiceCounts, listInvoices, type InvoiceView } from "@/server/billing/invoices";
import { longDate } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Invoices" };

const VIEW_LABELS: Record<InvoiceView, string> = {
  open: "Unpaid",
  drafts: "Drafts",
  paid: "Paid",
  all: "All",
};

const TONES: Record<InvoiceState, DocumentRow["tone"]> = {
  draft: "neutral",
  issued: "accent",
  overdue: "danger",
  paid: "success",
  void: "neutral",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function InvoicesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const asked = first((await searchParams).view);
  const view = (INVOICE_VIEWS as readonly string[]).includes(asked ?? "") ? (asked as InvoiceView) : "open";
  const db = await getDb();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const [items, counts] = await Promise.all([listInvoices(db, { view }), invoiceCounts(db)]);
  const rows: DocumentRow[] = items.map((invoice) => {
    const state = invoiceState(invoice, today);
    const credit = invoice.kind === "credit";
    return {
      id: invoice._id.toHexString(),
      href: `/admin/billing/invoices/${invoice._id.toHexString()}`,
      number: invoice.number ?? "Draft",
      title: credit ? `Credit: ${invoice.title}` : invoice.title,
      who: invoice.recipient.company
        ? `${invoice.recipient.name}, ${invoice.recipient.company}`
        : invoice.recipient.name,
      total: `${credit ? "-" : ""}${formatMoney(money(invoice.totals.totalMinor, invoice.currency))}`,
      state: credit && state !== "draft" ? "Credit note" : INVOICE_STATE_LABELS[state],
      tone: credit ? "neutral" : TONES[state],
      when:
        invoice.dueDate && state !== "paid" && !credit
          ? `due ${longDate(invoice.dueDate)}`
          : formatDate(invoice.paidAt ?? invoice.updatedAt),
    };
  });
  return (
    <>
      <PageHeader
        title="Invoices"
        description="Payment requests and invoices: numbered when issued, then fixed."
        action={
          <Link href="/admin/billing/invoices/new" className={buttonClasses("primary", "sm")}>
            New invoice
          </Link>
        }
      />
      <ViewTabs
        label="Invoice lists"
        views={INVOICE_VIEWS}
        current={view}
        counts={counts}
        labels={VIEW_LABELS}
        hrefFor={(next) =>
          next === "open" ? "/admin/billing/invoices" : `/admin/billing/invoices?view=${next}`
        }
      />
      <DocumentList rows={rows} empty={view === "open" ? "Nothing waiting to be paid." : "Nothing here."} />
    </>
  );
}
