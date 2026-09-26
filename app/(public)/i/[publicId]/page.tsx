import type { Metadata } from "next";
import { DocumentSheet } from "@/components/billing/document-sheet";
import { PayCrypto } from "@/components/site/billing/pay-crypto";
import { PageIntro, Section } from "@/components/site/section";
import { site } from "@/content/site";
import { amountLeft } from "@/lib/billing/document";
import { invoiceState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn, wallDateTime } from "@/lib/intake/time";
import { formatMoney, money } from "@/lib/money";
import { ownerCookiePresent } from "@/server/auth/dal";
import { invoiceByPublicId, markInvoiceViewed } from "@/server/billing/invoices";
import { paymentsAvailable } from "@/server/billing/providers";
import { PUBLIC_ID_PATTERN } from "@/server/billing/public-id";
import { getBillingSettings } from "@/server/billing/settings";
import { invoiceView, longDate } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

// A client's link to an invoice: what's owed, how to pay it, a PDF. The address is the key: never indexed,
// cached or sent on as a referrer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Payment",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function InvoiceLinkPage({ params }: { params: Promise<{ publicId: string }> }) {
  const publicId = (await params).publicId;
  const db = await getDb();
  const invoice = PUBLIC_ID_PATTERN.test(publicId) ? await invoiceByPublicId(db, publicId) : null;
  if (!invoice) {
    return (
      <>
        <PageIntro
          label="Payment"
          title="This link doesn't work."
          intro="It may have been copied incompletely. The full link is in the email."
        />
        <Section>
          <p className="text-muted">
            Questions? Email{" "}
            <a href={`mailto:${site.email}`} className="text-ink underline underline-offset-4">
              {site.email}
            </a>
            .
          </p>
        </Section>
      </>
    );
  }
  const at = now();
  const state = invoiceState(invoice, todayIn(ADMIN_TIME_ZONE, at));
  if (!(await ownerCookiePresent())) await markInvoiceViewed(db, invoice._id, at);
  const settings = await getBillingSettings(db);
  const view = invoiceView(invoice, settings, getEnv().SITE_URL);
  const left = money(amountLeft(invoice), invoice.currency);
  const credit = invoice.kind === "credit";

  return (
    <>
      <PageIntro
        label={`${view.heading} ${view.number}`}
        title={invoice.title}
        intro={`From ${view.seller.name}, for ${invoice.recipient.name}.`}
      />
      <Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <DocumentSheet view={view} />
          <aside className="grid content-start gap-4">
            <div role="status" className="rounded-3xl border border-line bg-surface p-6">
              {credit ? (
                <p className="text-lg font-semibold tracking-tight">A credit note: nothing to pay.</p>
              ) : state === "paid" && invoice.paidMinor === 0 ? (
                <p className="text-lg font-semibold tracking-tight">
                  Settled by a credit note: nothing to pay.
                </p>
              ) : state === "paid" ? (
                <>
                  <p className="text-lg font-semibold tracking-tight">Paid. Thank you!</p>
                  {invoice.paidAt ? (
                    <p className="mt-2 text-muted">
                      Received on {longDate(wallDateTime(invoice.paidAt, ADMIN_TIME_ZONE).date)}.
                    </p>
                  ) : null}
                </>
              ) : state === "void" ? (
                <p className="text-lg font-semibold tracking-tight">
                  This document was cancelled: nothing to pay.
                </p>
              ) : (
                <>
                  <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
                    {state === "overdue" ? "Overdue" : "To pay"}
                  </p>
                  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{formatMoney(left)}</p>
                  {invoice.dueDate ? (
                    <p className="mt-1 text-sm text-muted">By {longDate(invoice.dueDate)}.</p>
                  ) : null}
                  {invoice.methods.includes("crypto") && paymentsAvailable().crypto ? (
                    <div className="mt-5">
                      <PayCrypto publicId={invoice.publicId} />
                    </div>
                  ) : null}
                  {invoice.methods.includes("bank") && invoice.bankAccount ? (
                    <p className="mt-4 text-sm text-muted">
                      By bank transfer: the account and the reference to use are on this page and in the PDF.
                    </p>
                  ) : null}
                </>
              )}
            </div>
            <a
              href={`/i/${invoice.publicId}/pdf`}
              className="text-sm text-muted underline underline-offset-4 hover:text-ink"
            >
              Download the PDF
            </a>
          </aside>
        </div>
      </Section>
    </>
  );
}
