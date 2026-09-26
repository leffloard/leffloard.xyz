import Link from "next/link";
import { notFound } from "next/navigation";
import { QuoteActions } from "@/components/admin/billing/document-actions";
import { DocumentEditor } from "@/components/admin/billing/document-editor";
import { PageHeader } from "@/components/admin/shell";
import { DocumentSheet } from "@/components/billing/document-sheet";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { QUOTE_STATE_LABELS, quoteState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE, formatDateTime } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { quoteEditorValue } from "@/server/billing/editor";
import { billingClients, serviceCatalog } from "@/server/billing/lookups";
import { getQuote } from "@/server/billing/quotes";
import { getBillingSettings } from "@/server/billing/settings";
import { quoteView } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Quote" };

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const quote = id ? await getQuote(db, id) : null;
  if (!quote) notFound();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const state = quoteState(quote, today);
  const hexId = quote._id.toHexString();
  const draft = quote.status === "draft";
  const [settings, clients] = await Promise.all([getBillingSettings(db), draft ? billingClients(db) : []]);
  const history: [string, React.ReactNode][] = [];
  if (quote.sentAt) history.push(["Sent", formatDateTime(quote.sentAt)]);
  if (quote.viewedAt) history.push(["Opened by the client", formatDateTime(quote.viewedAt)]);
  if (quote.acceptedBy && quote.answeredAt) {
    history.push(["Accepted", `${formatDateTime(quote.answeredAt)} by ${quote.acceptedBy.name}`]);
  }
  if (quote.status === "declined" && quote.answeredAt)
    history.push(["Declined", formatDateTime(quote.answeredAt)]);
  if (quote.declineReason) history.push(["Their reason", quote.declineReason]);
  if (quote.projectId) {
    history.push([
      "Project",
      <Link
        key="project"
        href={`/admin/projects/${quote.projectId.toHexString()}`}
        className="text-accent hover:underline"
      >
        Open the project
      </Link>,
    ]);
  }
  if (quote.depositInvoiceId) {
    history.push([
      "First invoice",
      <Link
        key="invoice"
        href={`/admin/billing/invoices/${quote.depositInvoiceId.toHexString()}`}
        className="text-accent hover:underline"
      >
        Open the invoice
      </Link>,
    ]);
  }

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/billing/quotes"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Quotes
        </Link>
      </div>
      <PageHeader
        title={`${quote.number ?? "Draft quote"}: ${quote.title}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                state === "accepted"
                  ? "success"
                  : state === "sent"
                    ? "accent"
                    : state === "expired"
                      ? "warning"
                      : "neutral"
              }
            >
              {QUOTE_STATE_LABELS[state]}
            </Badge>
            <Link
              href={`/admin/clients/${quote.clientId.toHexString()}`}
              className="hover:text-ink hover:underline"
            >
              {quote.recipient.name}
            </Link>
          </span>
        }
      />
      <div className="mb-6">
        <QuoteActions
          id={hexId}
          version={quote.version}
          status={quote.status}
          numbered={quote.number !== null}
          link={`${getEnv().SITE_URL}/q/${quote.publicId}`}
          pdf={`/admin/billing/quotes/${hexId}/pdf`}
        />
      </div>
      {draft ? (
        <DocumentEditor
          kind="quote"
          id={hexId}
          version={quote.version}
          initial={quoteEditorValue(quote)}
          clients={clients}
          catalog={await serviceCatalog()}
          cryptoReady={false}
        />
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
          <DocumentSheet view={quoteView(quote, settings)} />
          <Card className="self-start">
            <CardHeader title="History" />
            <CardBody>
              <dl className="grid gap-3 text-[13px]">
                {history.map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
