import Link from "next/link";
import { notFound } from "next/navigation";
import { DocumentEditor } from "@/components/admin/billing/document-editor";
import { DocumentList, type DocumentRow } from "@/components/admin/billing/document-list";
import { RecurringControls } from "@/components/admin/billing/recurring-controls";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { INVOICE_STATE_LABELS, invoiceState } from "@/lib/billing/options";
import { periodLabel, RECURRING_INTERVAL_LABELS } from "@/lib/billing/recurring";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatMoney, money } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { recurringEditorValue } from "@/server/billing/editor";
import { billingClients, billingProjects, serviceCatalog } from "@/server/billing/lookups";
import { paymentsAvailable } from "@/server/billing/providers";
import { getRecurring, invoicesOfPlan } from "@/server/billing/recurring";
import { longDate } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Recurring invoice" };

export default async function RecurringPlanPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const plan = id ? await getRecurring(db, id) : null;
  if (!plan) notFound();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const [clients, projects, issued] = await Promise.all([
    billingClients(db),
    billingProjects(db),
    invoicesOfPlan(db, plan._id),
  ]);
  const ended = !plan.nextOn;
  const state = ended ? "Ended" : plan.active ? "Active" : "Paused";
  const rows: DocumentRow[] = issued.map((invoice) => {
    const current = invoiceState(invoice, today);
    return {
      id: invoice._id.toHexString(),
      href: `/admin/billing/invoices/${invoice._id.toHexString()}`,
      number: invoice.number ?? "Draft",
      title: invoice.title,
      who: invoice.period ? `for ${longDate(invoice.period)}` : "",
      total: formatMoney(money(invoice.totals.totalMinor, invoice.currency)),
      state: INVOICE_STATE_LABELS[current],
      tone: current === "paid" ? "success" : current === "overdue" ? "danger" : "accent",
      when: invoice.issueDate ? `issued ${longDate(invoice.issueDate)}` : "",
    };
  });

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/billing/recurring"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Recurring invoices
        </Link>
      </div>
      <PageHeader
        title={plan.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={plan.active ? "success" : "neutral"}>{state}</Badge>
            <span>
              {RECURRING_INTERVAL_LABELS[plan.interval]} ·{" "}
              {formatMoney(money(plan.totals.totalMinor, plan.currency))} · {plan.recipient.name}
            </span>
          </span>
        }
      />
      <div className="mb-6 grid gap-4">
        {plan.lastError ? (
          <Notice tone="error">
            The invoice due {plan.nextOn ? longDate(plan.nextOn) : ""} couldn&apos;t be issued:{" "}
            {plan.lastError} Fix it below; it goes out at the next run.
          </Notice>
        ) : null}
        <p className="text-[13px] text-muted">
          {plan.active && plan.nextOn
            ? `The next invoice, for ${periodLabel(plan.nextOn, plan.interval)}, is issued on ${longDate(plan.nextOn)}.`
            : ended
              ? "This plan has ended. Set a new date below to start it again."
              : "Paused: no invoices until you resume it."}{" "}
          {plan.issuedCount ? `${plan.issuedCount} issued so far.` : ""}
        </p>
        <RecurringControls
          id={plan._id.toHexString()}
          version={plan.version}
          active={plan.active}
          ended={ended}
        />
      </div>
      <div className="grid gap-6">
        <DocumentEditor
          kind="recurring"
          id={plan._id.toHexString()}
          version={plan.version}
          initial={recurringEditorValue(plan)}
          clients={clients}
          projects={projects}
          catalog={serviceCatalog()}
          cryptoReady={paymentsAvailable().crypto}
        />
        <Card>
          <CardHeader title="Invoices it issued" description="The latest 24." />
          <CardBody>
            <DocumentList rows={rows} empty="None yet." />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
