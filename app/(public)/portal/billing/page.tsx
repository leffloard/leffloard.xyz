import type { Metadata } from "next";
import { PageIntro, Section } from "@/components/site/section";
import { Badge } from "@/components/ui/badge";
import { amountLeft } from "@/lib/billing/document";
import { INVOICE_STATE_LABELS, invoiceState, QUOTE_STATE_LABELS, quoteState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatMoney, money } from "@/lib/money";
import { longDate } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { requirePortalClient } from "@/server/portal/dal";
import { portalDocuments } from "@/server/portal/views";

export const metadata: Metadata = { title: "Invoices" };

const row = "flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line py-4 first:border-t-0";

export default async function PortalBillingPage() {
  const { client } = await requirePortalClient();
  const { invoices, quotes } = await portalDocuments(await getDb(), client._id);
  const today = todayIn(ADMIN_TIME_ZONE, now());
  return (
    <>
      <PageIntro
        label="Client portal"
        title="Invoices and quotes"
        intro="Each opens with its PDF; unpaid invoices show how to pay them."
      />
      <Section label="Invoices" title="Invoices">
        {invoices.length ? (
          <ul>
            {invoices.map((invoice) => {
              const state = invoiceState(invoice, today);
              const credit = invoice.kind === "credit";
              const left = amountLeft(invoice);
              return (
                <li key={invoice._id.toHexString()} className={row}>
                  <a href={`/i/${invoice.publicId}`} className="min-w-0 flex-1">
                    <span className="block font-medium underline-offset-4 hover:underline">
                      {invoice.title}
                    </span>
                    <span className="block text-sm text-muted">
                      {invoice.number}
                      {invoice.issueDate ? ` · ${longDate(invoice.issueDate)}` : ""}
                    </span>
                  </a>
                  <Badge
                    tone={
                      state === "paid"
                        ? "success"
                        : state === "overdue"
                          ? "danger"
                          : credit || state === "void"
                            ? "neutral"
                            : "accent"
                    }
                  >
                    {credit ? "Credit note" : state === "issued" ? "To pay" : INVOICE_STATE_LABELS[state]}
                  </Badge>
                  <span className="w-32 text-right font-mono tabular-nums">
                    {credit ? "-" : ""}
                    {formatMoney(
                      money(
                        state === "issued" || state === "overdue" ? left : invoice.totals.totalMinor,
                        invoice.currency,
                      ),
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted">No invoices yet.</p>
        )}
      </Section>
      <Section label="Quotes" title="Quotes">
        {quotes.length ? (
          <ul>
            {quotes.map((quote) => {
              const state = quoteState(quote, today);
              return (
                <li key={quote._id.toHexString()} className={row}>
                  <a href={`/q/${quote.publicId}`} className="min-w-0 flex-1">
                    <span className="block font-medium underline-offset-4 hover:underline">
                      {quote.title}
                    </span>
                    <span className="block text-sm text-muted">
                      {quote.number}
                      {quote.validUntil && state === "sent"
                        ? ` · valid until ${longDate(quote.validUntil)}`
                        : ""}
                    </span>
                  </a>
                  <Badge tone={state === "accepted" ? "success" : state === "sent" ? "accent" : "neutral"}>
                    {QUOTE_STATE_LABELS[state]}
                  </Badge>
                  <span className="w-32 text-right font-mono tabular-nums">
                    {formatMoney(money(quote.totals.totalMinor, quote.currency))}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted">No quotes yet.</p>
        )}
      </Section>
    </>
  );
}
