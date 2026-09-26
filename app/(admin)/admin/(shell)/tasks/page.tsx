import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { QuickAddTask } from "@/components/admin/work/quick-add-task";
import { TaskList } from "@/components/admin/work/task-list";
import { cn } from "@/components/ui/cn";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatWeekday } from "@/lib/work/dates";
import { TASK_VIEW_LABELS, TASK_VIEWS, type TaskView, type TaskWhen } from "@/lib/work/options";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { projectChoices } from "@/server/projects/store";
import { listTasks, taskCounts } from "@/server/tasks/store";
import { toTaskRow } from "@/server/tasks/view";

export const metadata = { title: "Tasks" };

const EMPTY: Record<TaskView, string> = {
  today: "Nothing due today. Enjoy it, or pull something from Anytime.",
  overdue: "Nothing overdue.",
  upcoming: "Nothing scheduled after today.",
  anytime: "No undated tasks.",
  someday: "Nothing parked for someday.",
  done: "Nothing finished yet.",
};

// The quick-add row starts with the date that fits the list you are looking at.
const DEFAULT_WHEN: Record<TaskView, TaskWhen> = {
  today: "today",
  overdue: "today",
  upcoming: "tomorrow",
  anytime: "none",
  someday: "someday",
  done: "none",
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const viewParam = first(raw.view) ?? "";
  const view = (TASK_VIEWS as readonly string[]).includes(viewParam) ? (viewParam as TaskView) : "today";
  const db = await getDb();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const [tasks, counts, projects] = await Promise.all([
    listTasks(db, view, today, { limit: view === "done" ? 100 : 500 }),
    taskCounts(db, today),
    projectChoices(db),
  ]);
  const rows = tasks.map((task) => toTaskRow(task, today));

  // Upcoming is easier to read by day.
  const groups: { title: string | null; rows: typeof rows }[] =
    view === "upcoming" && rows.length
      ? [...new Set(tasks.map((task) => task.due!))].map((due) => ({
          title: formatWeekday(due, today),
          rows: rows.filter((_, index) => tasks[index]!.due === due),
        }))
      : [{ title: null, rows }];

  return (
    <>
      <PageHeader title="Tasks" description={`Today is ${formatWeekday(today, today)}.`} />
      <div className="mb-5">
        <QuickAddTask
          key={view}
          defaultWhen={DEFAULT_WHEN[view]}
          projects={projects.map((project) => ({
            id: project.id,
            label: `${project.ref} · ${project.title}`,
          }))}
        />
      </div>
      <nav aria-label="Task lists" className="mb-5 flex gap-1 overflow-x-auto border-b border-line">
        {TASK_VIEWS.map((option) => (
          <Link
            key={option}
            href={option === "today" ? "/admin/tasks" : `/admin/tasks?view=${option}`}
            aria-current={view === option ? "page" : undefined}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] transition-colors",
              view === option ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {TASK_VIEW_LABELS[option]}
            {option !== "done" ? (
              <span
                className={cn(
                  "font-mono text-[11px]",
                  option === "overdue" && counts.overdue ? "text-danger" : "text-muted",
                )}
              >
                {counts[option]}
              </span>
            ) : null}
          </Link>
        ))}
      </nav>
      <div className="grid gap-6">
        {groups.map((group, index) => (
          <section key={group.title ?? "all"} aria-label={group.title ?? TASK_VIEW_LABELS[view]}>
            {group.title ? <h2 className="mb-2 text-[13px] font-semibold">{group.title}</h2> : null}
            <TaskList rows={group.rows} emptyText={EMPTY[view]} keyboard={index === 0} />
          </section>
        ))}
      </div>
      <p className="mt-6 hidden text-xs text-muted lg:block">
        Keys: <kbd className="font-mono">n</kbd> new task, <kbd className="font-mono">j</kbd> /{" "}
        <kbd className="font-mono">k</kbd> move, <kbd className="font-mono">x</kbd> done,{" "}
        <kbd className="font-mono">Enter</kbd> open.
      </p>
    </>
  );
}
