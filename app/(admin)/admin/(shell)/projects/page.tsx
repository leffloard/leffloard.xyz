import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { DueText } from "@/components/admin/work/due-text";
import { ProjectBoard, type ProjectCard } from "@/components/admin/work/project-board";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { inputClasses } from "@/components/ui/field";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { dueLabel } from "@/lib/work/dates";
import { BOARD_STAGES, PROJECT_STAGE_LABELS, type ProjectStage } from "@/lib/work/options";
import { requireAdmin } from "@/server/auth/dal";
import { getClient } from "@/server/clients/store";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import {
  boardProjects,
  listProjects,
  PROJECT_VIEWS,
  type ProjectListItem,
  type ProjectView,
} from "@/server/projects/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Projects" };

const VIEW_LABELS: Record<ProjectView, string> = {
  open: "Open",
  planned: "Planned",
  active: "In progress",
  review: "In review",
  delivered: "Delivered",
  paused: "Paused",
  cancelled: "Cancelled",
  all: "All",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// "1 of 2 rounds", or "3 rounds, 1 extra" once past the included ones.
function revisionsText(item: ProjectListItem): string | null {
  const { revisionsUsed: used } = item;
  const included = item.revisionPolicy.included;
  if (!used) return null;
  if (used <= included) return `${used} of ${included} rounds`;
  return `${used} rounds, ${used - included} extra`;
}

function stageTone(stage: ProjectStage) {
  if (stage === "delivered") return "success" as const;
  if (stage === "paused" || stage === "cancelled") return "neutral" as const;
  return "accent" as const;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const viewParam = first(raw.view);
  const board = !viewParam || viewParam === "board";
  const view = (PROJECT_VIEWS as readonly string[]).includes(viewParam ?? "")
    ? (viewParam as ProjectView)
    : "open";
  const q = first(raw.q)?.trim().slice(0, 200) || null;
  const clientId = parseId(first(raw.client));
  const db = await getDb();
  const at = now();
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const client = clientId ? await getClient(db, clientId) : null;

  const hrefFor = (next: string) => {
    const params = new URLSearchParams({ view: next });
    if (q) params.set("q", q);
    if (client) params.set("client", client._id.toHexString());
    return `/admin/projects?${params.toString()}`;
  };

  const header = (
    <PageHeader
      title="Projects"
      description={client ? `For ${client.name}.` : "Everything you are building, by stage."}
      action={
        <div className="flex flex-wrap gap-2">
          <nav aria-label="Project layout" className="flex rounded-md border border-line-strong p-0.5">
            {(["board", "list"] as const).map((layout) => {
              const active = layout === "board" ? board : !board;
              return (
                <Link
                  key={layout}
                  href={layout === "board" ? "/admin/projects" : hrefFor(view)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded px-3 py-1 text-[13px] capitalize",
                    active ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink",
                  )}
                >
                  {layout}
                </Link>
              );
            })}
          </nav>
          <Link
            href={client ? `/admin/projects/new?client=${client._id.toHexString()}` : "/admin/projects/new"}
            className={buttonClasses("primary", "sm")}
          >
            New project
          </Link>
        </div>
      }
    />
  );

  if (board) {
    const items = await boardProjects(db, at);
    const cards: ProjectCard[] = items.map((item) => ({
      id: item._id.toHexString(),
      column: item.stage,
      label: item.title,
      href: `/admin/projects/${item._id.toHexString()}`,
      ref: item.ref,
      clientName: item.clientName,
      due: item.dueDate && item.stage !== "delivered" ? dueLabel(item.dueDate, today) : null,
      openTasks: item.openTasks,
      revisions: revisionsText(item),
    }));
    return (
      <>
        {header}
        <ProjectBoard
          columns={BOARD_STAGES.map((stage) => ({ id: stage, title: PROJECT_STAGE_LABELS[stage] }))}
          cards={cards}
        />
        <p className="mt-4 hidden text-xs text-muted lg:block">
          Keys: arrows move between cards, <kbd className="font-mono">Shift</kbd> + arrows move a card,{" "}
          <kbd className="font-mono">Enter</kbd> opens it. Delivered projects leave the board after 30 days;
          paused and cancelled ones are in the{" "}
          <Link href={hrefFor("all")} className="underline">
            list
          </Link>
          .
        </p>
      </>
    );
  }

  const { items, counts } = await listProjects(db, { view, clientId: client?._id ?? null, q });
  return (
    <>
      {header}
      <form action="/admin/projects" className="mb-4 flex gap-2" role="search">
        <input type="hidden" name="view" value={view} />
        {client ? <input type="hidden" name="client" value={client._id.toHexString()} /> : null}
        <label htmlFor="project-search" className="sr-only">
          Search projects
        </label>
        <input
          id="project-search"
          name="q"
          type="search"
          defaultValue={q ?? ""}
          placeholder="Search title, reference or tag"
          className={cn(inputClasses, "h-9 min-w-0 flex-1")}
          maxLength={200}
        />
        <button type="submit" className={buttonClasses("secondary", "sm", "h-9")}>
          Search
        </button>
      </form>
      <nav aria-label="Project views" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {PROJECT_VIEWS.map((option) => (
          <Link
            key={option}
            href={hrefFor(option)}
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
          {q ? `Nothing matches “${q}”.` : "No projects here."}
        </p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
          {items.map((item) => {
            const due = item.dueDate && item.stage !== "delivered" ? dueLabel(item.dueDate, today) : null;
            const rounds = revisionsText(item);
            return (
              <li key={item._id.toHexString()}>
                <Link
                  href={`/admin/projects/${item._id.toHexString()}`}
                  className="grid gap-1 px-4 py-3 transition-colors hover:bg-white/[0.03] sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-5"
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="font-mono text-[11px] text-muted">{item.ref}</span>
                      <span className="truncate text-sm font-medium">{item.title}</span>
                    </span>
                    <span className="truncate text-xs text-muted">
                      {item.clientName}
                      {item.openTasks ? ` · ${item.openTasks} open tasks` : ""}
                      {rounds ? ` · ${rounds}` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3 text-xs sm:justify-end">
                    {due ? <DueText due={due} /> : null}
                    <Badge tone={stageTone(item.stage)}>{PROJECT_STAGE_LABELS[item.stage]}</Badge>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
