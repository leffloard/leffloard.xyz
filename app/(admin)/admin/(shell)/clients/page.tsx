import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { inputClasses } from "@/components/ui/field";
import { formatDateTime, formatRelative } from "@/lib/format";
import { CLIENT_STATUS_LABELS } from "@/lib/work/options";
import { requireAdmin } from "@/server/auth/dal";
import { CLIENT_VIEWS, listClients, type ClientView } from "@/server/clients/store";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";

export const metadata = { title: "Clients" };

const PAGE_SIZE = 50;

const VIEW_LABELS: Record<ClientView, string> = {
  all: "All",
  lead: "Leads",
  active: "Active",
  past: "Past",
  archived: "Archived",
};

const EMPTY: Record<ClientView, string> = {
  all: "No clients yet. Add one, or make the sender of an inbox message a client.",
  lead: "No leads.",
  active: "No active clients.",
  past: "No past clients.",
  archived: "Nothing archived.",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function hrefFor(view: ClientView, q: string | null, page = 1): string {
  const params = new URLSearchParams();
  if (view !== "all") params.set("view", view);
  if (q) params.set("q", q);
  if (page > 1) params.set("page", String(page));
  const query = params.toString();
  return query ? `/admin/clients?${query}` : "/admin/clients";
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const viewParam = first(raw.view) ?? "";
  const view = (CLIENT_VIEWS as readonly string[]).includes(viewParam) ? (viewParam as ClientView) : "all";
  const q = first(raw.q)?.trim().slice(0, 200) || null;
  const page = Math.min(Math.max(Number.parseInt(first(raw.page) ?? "1", 10) || 1, 1), 10_000);
  const at = now();
  const { items, total, counts } = await listClients(await getDb(), { view, q, page, limit: PAGE_SIZE });

  return (
    <>
      <PageHeader
        title="Clients"
        description="The people and companies you work for."
        action={
          <Link href="/admin/clients/new" className={buttonClasses("primary", "sm")}>
            Add client
          </Link>
        }
      />

      <form action="/admin/clients" className="mb-4 flex gap-2" role="search">
        {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
        <label htmlFor="client-search" className="sr-only">
          Search clients
        </label>
        <input
          id="client-search"
          name="q"
          type="search"
          defaultValue={q ?? ""}
          placeholder="Search name, company, email, tag or place"
          className={cn(inputClasses, "h-9 min-w-0 flex-1")}
          maxLength={200}
        />
        <button type="submit" className={buttonClasses("secondary", "sm", "h-9")}>
          Search
        </button>
      </form>

      <nav aria-label="Client views" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {CLIENT_VIEWS.map((option) => (
          <Link
            key={option}
            href={hrefFor(option, q)}
            aria-current={view === option ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
              view === option ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {VIEW_LABELS[option]}
            <span className="font-mono text-[11px] text-muted">{counts[option]}</span>
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line-strong px-5 py-10 text-center text-sm text-muted">
          {q ? `Nothing matches “${q}”.` : EMPTY[view]}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((client) => (
            <li key={client._id.toHexString()}>
              <Link
                href={`/admin/clients/${client._id.toHexString()}`}
                className="grid gap-1 px-4 py-3 transition-colors hover:bg-white/[0.03] focus-visible:bg-white/[0.05] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
              >
                <span className="grid min-w-0 gap-0.5">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate text-sm font-medium">{client.name}</span>
                    {client.company ? (
                      <span className="truncate text-[13px] text-muted">{client.company}</span>
                    ) : null}
                  </span>
                  <span className="truncate text-xs text-muted">
                    {client.email ?? "No email"}
                    {client.tags.length ? ` · ${client.tags.join(", ")}` : ""}
                  </span>
                </span>
                <span className="flex flex-wrap items-center gap-2 text-xs text-muted sm:justify-end">
                  {client.openProjects ? (
                    <span>
                      {client.openProjects} open {client.openProjects === 1 ? "project" : "projects"}
                    </span>
                  ) : null}
                  {client.lastContactAt ? (
                    <span title={formatDateTime(client.lastContactAt)}>
                      contact {formatRelative(client.lastContactAt, at)}
                    </span>
                  ) : null}
                  <Badge
                    tone={
                      client.status === "active" ? "success" : client.status === "lead" ? "accent" : "neutral"
                    }
                  >
                    {CLIENT_STATUS_LABELS[client.status]}
                  </Badge>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {total > PAGE_SIZE ? (
        <div className="mt-4 flex justify-end gap-2">
          {page > 1 ? (
            <Link href={hrefFor(view, q, page - 1)} className={buttonClasses("secondary", "sm")}>
              Previous
            </Link>
          ) : null}
          {page * PAGE_SIZE < total ? (
            <Link href={hrefFor(view, q, page + 1)} className={buttonClasses("secondary", "sm")}>
              Next
            </Link>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
