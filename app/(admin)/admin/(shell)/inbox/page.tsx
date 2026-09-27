import { TRIAGE_CATEGORY_LABELS } from "@/lib/ai/schemas";
import Link from "next/link";
import { InboxList, type InboxRow } from "@/components/admin/inbox/inbox-list";
import { PageHeader } from "@/components/admin/shell";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { inputClasses } from "@/components/ui/field";
import { formatDateTime, formatRelative } from "@/lib/format";
import { INQUIRY_KINDS, KIND_LABELS, STATUS_LABELS, type InquiryKind } from "@/lib/intake/options";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { INBOX_VIEWS, listInquiries, type InboxView } from "@/server/inquiries/store";

export const metadata = { title: "Inbox" };

const PAGE_SIZE = 25;

const VIEW_LABELS: Record<InboxView, string> = {
  inbox: "Inbox",
  new: "New",
  open: "Open",
  confirmed: "Confirmed",
  snoozed: "Snoozed",
  done: "Done",
  declined: "Declined",
  spam: "Spam",
  all: "All",
};

const KIND_FILTERS: { value: InquiryKind | null; label: string }[] = [
  { value: null, label: "All kinds" },
  { value: "brief", label: "Briefs" },
  { value: "question", label: "Questions" },
  { value: "revision", label: "Revisions" },
  { value: "call", label: "Calls" },
];

const EMPTY: Record<InboxView, string> = {
  inbox: "Nothing waiting. New messages from the contact form appear here.",
  new: "No new messages.",
  open: "No open conversations.",
  confirmed: "Nothing confirmed right now.",
  snoozed: "Nothing is snoozed.",
  done: "Nothing marked as done yet.",
  declined: "Nothing declined.",
  spam: "No spam. Spam is deleted after 30 days.",
  all: "No messages yet.",
};

type Params = { view: InboxView; kind: InquiryKind | null; q: string | null; page: number };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hrefFor({ view, kind, q, page }: Params): string {
  const params = new URLSearchParams();
  if (view !== "inbox") params.set("view", view);
  if (kind) params.set("kind", kind);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/inbox?${query}` : "/admin/inbox";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const viewParam = first(raw.view) ?? "";
  const kindParam = first(raw.kind) ?? "";
  const params: Params = {
    view: (INBOX_VIEWS as readonly string[]).includes(viewParam) ? (viewParam as InboxView) : "inbox",
    kind: (INQUIRY_KINDS as readonly string[]).includes(kindParam) ? (kindParam as InquiryKind) : null,
    q: first(raw.q)?.trim().slice(0, 200) || null,
    page: Math.min(Math.max(Number.parseInt(first(raw.page) ?? "1", 10) || 1, 1), 100_000),
  };
  const at = now();
  const { items, total, counts } = await listInquiries(await getDb(), { ...params, limit: PAGE_SIZE }, at);

  const rows: InboxRow[] = items.map((item) => ({
    id: item._id.toHexString(),
    ref: item.ref,
    kindLabel: KIND_LABELS[item.kind],
    status: item.status,
    statusLabel: STATUS_LABELS[item.status],
    name: item.name,
    subject: item.subject,
    snippet: item.snippet.replace(/\s+/g, " "),
    labels: item.labels,
    received: formatRelative(item.receivedAt, at),
    receivedTitle: formatDateTime(item.receivedAt),
    replied: item.replyCount > 0,
    snoozedUntil: item.snoozedUntil && item.snoozedUntil > at ? formatDateTime(item.snoozedUntil) : null,
    triage: item.triage?.category
      ? {
          label: `${TRIAGE_CATEGORY_LABELS[item.triage.category]}${item.triage.priority === "normal" ? "" : ` · ${item.triage.priority}`}`,
          tone:
            item.triage.category === "spam"
              ? "warning"
              : item.triage.priority === "high"
                ? "accent"
                : "neutral",
        }
      : null,
  }));
  const firstShown = total === 0 ? 0 : (params.page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(params.page * PAGE_SIZE, total);

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Project briefs, questions, revision requests and call requests from the site."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <form action="/admin/inbox" className="flex min-w-0 flex-1 gap-2" role="search">
          {params.view !== "inbox" ? <input type="hidden" name="view" value={params.view} /> : null}
          {params.kind ? <input type="hidden" name="kind" value={params.kind} /> : null}
          <label htmlFor="inbox-search" className="sr-only">
            Search messages
          </label>
          <input
            id="inbox-search"
            name="q"
            type="search"
            defaultValue={params.q ?? ""}
            placeholder="Search name, email, subject or reference  ( / )"
            className={cn(inputClasses, "h-9 min-w-0 flex-1")}
            maxLength={200}
          />
          <button type="submit" className={buttonClasses("secondary", "sm", "h-9")}>
            Search
          </button>
        </form>
      </div>

      <nav aria-label="Filter by kind" className="mb-3 flex flex-wrap gap-1.5">
        {KIND_FILTERS.map((filter) => {
          const active = params.kind === filter.value;
          return (
            <Link
              key={filter.label}
              href={hrefFor({ ...params, kind: filter.value, page: 1 })}
              aria-current={active ? "true" : undefined}
              className={cn(
                "rounded-full border px-3 py-1 text-xs transition-colors",
                active ? "border-accent/50 bg-accent/10 text-ink" : "border-line text-muted hover:text-ink",
              )}
            >
              {filter.label}
            </Link>
          );
        })}
      </nav>

      <nav aria-label="Inbox views" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {INBOX_VIEWS.map((view) => {
          const active = params.view === view;
          return (
            <Link
              key={view}
              href={hrefFor({ ...params, view, page: 1 })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
                active ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
              )}
            >
              {VIEW_LABELS[view]}
              <span className="font-mono text-[11px] text-muted">{counts[view]}</span>
            </Link>
          );
        })}
      </nav>

      <InboxList rows={rows} emptyText={params.q ? `Nothing matches “${params.q}”.` : EMPTY[params.view]} />

      {total > 0 ? (
        <div className="mt-4 flex items-center justify-between gap-3 text-[13px] text-muted">
          <p>
            {firstShown}–{lastShown} of {total}
          </p>
          <div className="flex gap-2">
            {params.page > 1 ? (
              <Link
                href={hrefFor({ ...params, page: params.page - 1 })}
                className={buttonClasses("secondary", "sm")}
              >
                Newer
              </Link>
            ) : null}
            {lastShown < total ? (
              <Link
                href={hrefFor({ ...params, page: params.page + 1 })}
                className={buttonClasses("secondary", "sm")}
              >
                Older
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}
      <p className="mt-6 hidden text-xs text-muted lg:block">
        Keys: <kbd className="font-mono">j</kbd> / <kbd className="font-mono">k</kbd> to move,{" "}
        <kbd className="font-mono">Enter</kbd> to open, <kbd className="font-mono">/</kbd> to search.
      </p>
    </>
  );
}
