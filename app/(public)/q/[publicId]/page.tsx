import type { Metadata } from "next";
import { DocumentSheet } from "@/components/billing/document-sheet";
import { QuoteAnswer } from "@/components/site/billing/quote-answer";
import { PageIntro, Section } from "@/components/site/section";
import { site } from "@/content/site";
import { quoteState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn, wallDateTime } from "@/lib/intake/time";
import { ownerCookiePresent } from "@/server/auth/dal";
import { invoices } from "@/server/billing/collections";
import { PUBLIC_ID_PATTERN } from "@/server/billing/public-id";
import { markQuoteViewed, quoteByPublicId } from "@/server/billing/quotes";
import { getBillingSettings } from "@/server/billing/settings";
import { longDate, quoteView } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

// A client's link to their quote. The address is the key: never indexed, cached or sent on as a referrer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Quote",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Message({ title, intro }: { title: string; intro: string }) {
  return (
    <>
      <PageIntro label="Quote" title={title} intro={intro} />
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

export default async function QuoteLinkPage({ params }: { params: Promise<{ publicId: string }> }) {
  const publicId = (await params).publicId;
  const db = await getDb();
  const quote = PUBLIC_ID_PATTERN.test(publicId) ? await quoteByPublicId(db, publicId) : null;
  if (!quote || (quote.status === "draft" && !quote.number)) {
    return (
      <Message
        title="This link doesn't work."
        intro="It may have been copied incompletely. The full link is in the email."
      />
    );
  }
  if (quote.status === "draft") {
    return (
      <Message title="This quote is being updated." intro="You'll get the new version by email shortly." />
    );
  }
  if (quote.status === "withdrawn") {
    return <Message title="This quote was withdrawn." intro="Reply to its email if you'd like a new one." />;
  }
  const at = now();
  const state = quoteState(quote, todayIn(ADMIN_TIME_ZONE, at));
  if (state === "sent" && !(await ownerCookiePresent())) await markQuoteViewed(db, quote._id, at);
  const [settings, deposit] = await Promise.all([
    getBillingSettings(db),
    quote.depositInvoiceId
      ? invoices(db).findOne({ _id: quote.depositInvoiceId }, { projection: { publicId: 1 } })
      : null,
  ]);

  return (
    <>
      <PageIntro
        label={`Quote ${quote.number}`}
        title={quote.title}
        intro={`From ${settings.business.name}, for ${quote.recipient.name}.`}
      />
      <Section>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
          <DocumentSheet view={quoteView(quote, settings)} />
          <aside className="grid content-start gap-4">
            {state === "sent" ? (
              <QuoteAnswer publicId={quote.publicId} version={quote.version} name={quote.recipient.name} />
            ) : (
              <div role="status" className="rounded-3xl border border-line bg-surface p-6">
                <p className="text-lg font-semibold tracking-tight">
                  {state === "accepted"
                    ? "Accepted."
                    : state === "declined"
                      ? "Declined."
                      : "This quote has expired."}
                </p>
                <p className="mt-2 text-muted">
                  {state === "accepted"
                    ? `Accepted on ${longDate(wallDateTime(quote.answeredAt!, ADMIN_TIME_ZONE).date)}${quote.acceptedBy ? ` by ${quote.acceptedBy.name}` : ""}.`
                    : state === "declined"
                      ? "Thanks for letting me know."
                      : `It was valid until ${longDate(quote.validUntil!)}. Reply to its email and I'll send a new one.`}
                </p>
                {state === "accepted" && deposit ? (
                  <a
                    href={`/i/${deposit.publicId}`}
                    className="mt-5 inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-ink hover:bg-accent-hover"
                  >
                    See the first payment
                  </a>
                ) : null}
              </div>
            )}
            <a
              href={`/q/${quote.publicId}/pdf`}
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
