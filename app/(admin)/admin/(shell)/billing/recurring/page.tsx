import Link from "next/link";
import { DocumentList, type DocumentRow } from "@/components/admin/billing/document-list";
import { PageHeader } from "@/components/admin/shell";
import { buttonClasses } from "@/components/ui/button";
import { RECURRING_INTERVAL_LABELS } from "@/lib/billing/recurring";
import { formatMoney, money } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { listRecurring } from "@/server/billing/recurring";
import { longDate } from "@/server/billing/view";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Recurring invoices" };

export default async function RecurringPage() {
  await requireAdmin();
  const plans = await listRecurring(await getDb());
  const rows: DocumentRow[] = plans.map((plan) => {
    const state = plan.lastError
      ? "Needs attention"
      : plan.active
        ? "Active"
        : plan.nextOn
          ? "Paused"
          : "Ended";
    return {
      id: plan._id.toHexString(),
      href: `/admin/billing/recurring/${plan._id.toHexString()}`,
      number: RECURRING_INTERVAL_LABELS[plan.interval].replace("Every ", "Each "),
      title: plan.title,
      who: plan.recipient.company ? `${plan.recipient.name}, ${plan.recipient.company}` : plan.recipient.name,
      total: formatMoney(money(plan.totals.totalMinor, plan.currency)),
      state,
      tone: plan.lastError ? "danger" : plan.active ? "success" : "neutral",
      when: plan.active && plan.nextOn ? `next ${longDate(plan.nextOn)}` : `${plan.issuedCount} issued`,
    };
  });
  return (
    <>
      <PageHeader
        title="Recurring invoices"
        description="Care plans and hosting: issued on their date and emailed to the client, without you."
        action={
          <Link href="/admin/billing/recurring/new" className={buttonClasses("primary", "sm")}>
            New plan
          </Link>
        }
      />
      <DocumentList rows={rows} empty="No recurring invoices yet." />
    </>
  );
}
