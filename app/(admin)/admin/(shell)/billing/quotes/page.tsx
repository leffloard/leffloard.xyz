import Link from "next/link";
import { DocumentList, ViewTabs, type DocumentRow } from "@/components/admin/billing/document-list";
import { PageHeader } from "@/components/admin/shell";
import { buttonClasses } from "@/components/ui/button";
import { QUOTE_STATE_LABELS, quoteState, type QuoteState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE, formatDate } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatMoney, money } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { listQuotes, QUOTE_VIEWS, quoteCounts, type QuoteView } from "@/server/billing/quotes";
import { longDate } from "@/server/billing/view";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Quotes" };

const VIEW_LABELS: Record<QuoteView, string> = {
  open: "Sent",
  drafts: "Drafts",
  answered: "Answered",
  all: "All",
};

const TONES: Record<QuoteState, DocumentRow["tone"]> = {
  draft: "neutral",
  sent: "accent",
  accepted: "success",
  declined: "neutral",
  withdrawn: "neutral",
  expired: "warning",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function QuotesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const asked = first((await searchParams).view);
  const view = (QUOTE_VIEWS as readonly string[]).includes(asked ?? "") ? (asked as QuoteView) : "open";
  const db = await getDb();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const [items, counts] = await Promise.all([listQuotes(db, { view }), quoteCounts(db)]);
  const rows: DocumentRow[] = items.map((quote) => {
    const state = quoteState(quote, today);
    return {
      id: quote._id.toHexString(),
      href: `/admin/billing/quotes/${quote._id.toHexString()}`,
      number: quote.number ?? "Draft",
      title: quote.title,
      who: quote.recipient.company
        ? `${quote.recipient.name}, ${quote.recipient.company}`
        : quote.recipient.name,
      total: formatMoney(money(quote.totals.totalMinor, quote.currency)),
      state: QUOTE_STATE_LABELS[state],
      tone: TONES[state],
      when:
        state === "sent" && quote.validUntil
          ? `until ${longDate(quote.validUntil)}`
          : formatDate(quote.answeredAt ?? quote.updatedAt),
    };
  });
  return (
    <>
      <PageHeader
        title="Quotes"
        description="Written offers: the client accepts one from its link, and the project and first invoice follow."
        action={
          <Link href="/admin/billing/quotes/new" className={buttonClasses("primary", "sm")}>
            New quote
          </Link>
        }
      />
      <ViewTabs
        label="Quote lists"
        views={QUOTE_VIEWS}
        current={view}
        counts={counts}
        labels={VIEW_LABELS}
        hrefFor={(next) => (next === "open" ? "/admin/billing/quotes" : `/admin/billing/quotes?view=${next}`)}
      />
      <DocumentList
        rows={rows}
        empty={view === "open" ? "No quotes waiting for an answer." : "Nothing here."}
      />
    </>
  );
}
