import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceActions } from "@/components/admin/billing/document-actions";
import { DocumentEditor } from "@/components/admin/billing/document-editor";
import { PaymentsPanel } from "@/components/admin/billing/payments-panel";
import { RemindersSwitch } from "@/components/admin/billing/recurring-controls";
import { PageHeader } from "@/components/admin/shell";
import { DocumentSheet } from "@/components/billing/document-sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { INVOICE_STATE_LABELS, invoiceState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE, formatDateTime } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { amountInput, formatMoney, money } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { invoiceEditorValue } from "@/server/billing/editor";
import { getInvoice } from "@/server/billing/invoices";
import { paymentRows } from "@/server/billing/payment-rows";
import { amountLeft, paymentsFor } from "@/server/billing/payments";
import { nextReminderOn, REMINDER_DAYS } from "@/server/billing/reminders";
import { billingClients, billingProjects, serviceCatalog } from "@/server/billing/lookups";
import { paymentsAvailable } from "@/server/billing/providers";
import { getBillingSettings } from "@/server/billing/settings";
import { invoiceView, longDate } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Invoice" };

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const invoice = id ? await getInvoice(db, id) : null;
  if (!invoice) notFound();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const state = invoiceState(invoice, today);
  const hexId = invoice._id.toHexString();
  const draft = invoice.status === "draft";
  const credit = invoice.kind === "credit";
  const siteUrl = getEnv().SITE_URL;
  const [settings, clients, projects, payments] = await Promise.all([
    getBillingSettings(db),
    draft ? billingClients(db) : [],
    draft ? billingProjects(db) : [],
    paymentsFor(db, invoice._id),
  ]);
  const facts: [string, React.ReactNode][] = [];
  if (invoice.viewedAt) facts.push(["Opened by the client", formatDateTime(invoice.viewedAt)]);
  if (invoice.paidAt)
    facts.push([invoice.paidMinor > 0 ? "Paid" : "Settled", formatDateTime(invoice.paidAt)]);
  const creditedMinor = invoice.creditedMinor ?? 0;
  if (creditedMinor > 0) {
    facts.push(["Taken off by credit notes", formatMoney(money(creditedMinor, invoice.currency))]);
    // Paid, then credited: the client paid more than they now owe.
    const over = invoice.paidMinor + creditedMinor - invoice.totals.totalMinor;
    if (over > 0) {
      facts.push([
        "Paid more than owed",
        `${formatMoney(money(over, invoice.currency))}: refund it, or keep it as credit for the next invoice.`,
      ]);
    }
  }
  if (invoice.voidedAt)
    facts.push(["Voided", `${formatDateTime(invoice.voidedAt)}: ${invoice.voidReason ?? ""}`]);
  if (invoice.creditFor) {
    facts.push([
      "Corrects",
      <Link
        key="credit"
        href={`/admin/billing/invoices/${invoice.creditFor.toHexString()}`}
        className="text-accent hover:underline"
      >
        The original invoice
      </Link>,
    ]);
  }
  if (invoice.projectId) {
    facts.push([
      "Project",
      <Link
        key="project"
        href={`/admin/projects/${invoice.projectId.toHexString()}`}
        className="text-accent hover:underline"
      >
        Open the project
      </Link>,
    ]);
  }
  if (invoice.recurringId) {
    facts.push([
      "From the recurring plan",
      <Link
        key="recurring"
        href={`/admin/billing/recurring/${invoice.recurringId.toHexString()}`}
        className="text-accent hover:underline"
      >
        Open the plan
      </Link>,
    ]);
  }
  if (invoice.quoteId) {
    facts.push([
      "From the quote",
      <Link
        key="quote"
        href={`/admin/billing/quotes/${invoice.quoteId.toHexString()}`}
        className="text-accent hover:underline"
      >
        Open the quote
      </Link>,
    ]);
  }

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/billing/invoices"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Invoices
        </Link>
      </div>
      <PageHeader
        title={`${invoice.number ?? (credit ? "Draft credit note" : "Draft invoice")}: ${invoice.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                state === "paid"
                  ? "success"
                  : state === "overdue"
                    ? "danger"
                    : state === "issued"
                      ? "accent"
                      : "neutral"
              }
            >
              {credit && !draft ? "Credit note" : INVOICE_STATE_LABELS[state]}
            </Badge>
            {invoice.clientId ? (
              <Link
                href={`/admin/clients/${invoice.clientId.toHexString()}`}
                className="hover:text-ink hover:underline"
              >
                {invoice.recipient.name}
              </Link>
            ) : (
              <span>{invoice.recipient.name}</span>
            )}
          </span>
        }
      />
      <div className="mb-6">
        <InvoiceActions
          id={hexId}
          version={invoice.version}
          status={invoice.status}
          kind={invoice.kind}
          paid={invoice.paidMinor > 0 || (invoice.creditedMinor ?? 0) > 0}
          link={`${siteUrl}/i/${invoice.publicId}`}
          pdf={`/admin/billing/invoices/${hexId}/pdf`}
        />
      </div>
      {draft ? (
        <DocumentEditor
          kind={credit ? "credit" : "invoice"}
          id={hexId}
          version={invoice.version}
          initial={invoiceEditorValue(invoice)}
          clients={clients}
          projects={projects}
          catalog={await serviceCatalog()}
          cryptoReady={paymentsAvailable().crypto}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <DocumentSheet view={invoiceView(invoice, settings, siteUrl)} />
          <div className="grid content-start gap-6">
            {credit ? null : (
              <PaymentsPanel
                invoiceId={hexId}
                rows={paymentRows(payments)}
                canRecord={invoice.status === "issued"}
                left={amountInput(money(amountLeft(invoice), invoice.currency))}
                today={today}
              />
            )}
            {invoice.status === "issued" && !credit && invoice.dueDate ? (
              <Card className="self-start">
                <CardHeader
                  title="Reminders"
                  description={`Emailed ${REMINDER_DAYS.map((days) => `${days}`).join(", ")} days after the due date while it's unpaid.`}
                />
                <CardBody className="grid gap-3 text-[13px]">
                  <p>
                    {invoice.remindersSent} of {REMINDER_DAYS.length} sent
                    {invoice.remindersPaused
                      ? ". Stopped."
                      : nextReminderOn(invoice)
                        ? `. The next on ${longDate(nextReminderOn(invoice)!)}.`
                        : invoice.recipient.email
                          ? "."
                          : ". The invoice has no email address."}
                  </p>
                  {invoice.remindersSent < REMINDER_DAYS.length ? (
                    <RemindersSwitch id={hexId} paused={invoice.remindersPaused === true} />
                  ) : null}
                </CardBody>
              </Card>
            ) : null}
            {facts.length ? (
              <Card className="self-start">
                <CardHeader title="Details" />
                <CardBody>
                  <dl className="grid gap-3 text-[13px]">
                    {facts.map(([label, value]) => (
                      <div key={label}>
                        <dt className="text-xs text-muted">{label}</dt>
                        <dd className="break-words">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </CardBody>
              </Card>
            ) : null}
          </div>
        </div>
      )}
    </>
  );
}
