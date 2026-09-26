import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "@/components/admin/shell";
import { StartTimerButton } from "@/components/admin/time/timer-widget";
import { Checklist, TaskEditor } from "@/components/admin/work/task-editor";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatDuration, formatHours } from "@/lib/duration";
import { ADMIN_TIME_ZONE, formatDateTime, formatRelative } from "@/lib/format";
import { todayIn, wallDateTime } from "@/lib/intake/time";
import { formatDay } from "@/lib/work/dates";
import { RECURRENCE_LABELS, TASK_STATUS_LABELS } from "@/lib/work/options";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getProject, projectChoices, trackedTime } from "@/server/projects/store";
import { getTask } from "@/server/tasks/store";
import { recentEntries, runningEntry } from "@/server/time/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Task" };

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const task = id ? await getTask(db, id) : null;
  if (!task) notFound();
  const at = now();
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const [project, choices, time, entries, running] = await Promise.all([
    task.projectId ? getProject(db, task.projectId) : null,
    projectChoices(db),
    trackedTime(db, { taskId: task._id }),
    recentEntries(db, { taskId: task._id }, 10),
    runningEntry(db),
  ]);
  const hexId = task._id.toHexString();
  const projects = choices.map((choice) => ({ id: choice.id, label: `${choice.ref} · ${choice.title}` }));
  if (project && !projects.some((option) => option.id === project._id.toHexString())) {
    projects.unshift({ id: project._id.toHexString(), label: `${project.ref} · ${project.title}` });
  }
  const back = project ? `/admin/projects/${project._id.toHexString()}/tasks` : "/admin/tasks";

  return (
    <>
      <div className="mb-4">
        <Link
          href={back}
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← {project ? `${project.ref} · ${project.title}` : "Tasks"}
        </Link>
      </div>
      <PageHeader
        title={task.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={task.status === "done" ? "success" : task.status === "doing" ? "accent" : "neutral"}>
              {TASK_STATUS_LABELS[task.status]}
            </Badge>
            {task.recurrence ? <Badge>{RECURRENCE_LABELS[task.recurrence]}</Badge> : null}
            {task.timesCompleted && task.recurrence ? <span>done {task.timesCompleted} times</span> : null}
            <span title={formatDateTime(task.createdAt)}>added {formatRelative(task.createdAt, at)}</span>
          </span>
        }
        action={
          <StartTimerButton
            description={task.title}
            projectId={task.projectId?.toHexString() ?? null}
            taskId={hexId}
            running={Boolean(running?.taskId?.equals(task._id))}
          />
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-6">
          <TaskEditor
            projects={projects}
            values={{
              id: hexId,
              title: task.title,
              notes: task.notes,
              projectId: task.projectId?.toHexString() ?? "",
              due: task.due ?? "",
              someday: task.someday,
              flagged: task.flagged,
              recurrence: task.recurrence ?? "",
              estimate: task.estimateSeconds ? formatDuration(task.estimateSeconds) : "",
              done: task.status === "done",
            }}
          />
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <Checklist taskId={hexId} items={task.checklist} />
          <Card>
            <CardHeader
              title="Time"
              description={
                time.seconds
                  ? `${formatHours(time.seconds)} tracked${task.estimateSeconds ? ` of ${formatHours(task.estimateSeconds)} estimated` : ""}.`
                  : "No time tracked on this task yet."
              }
            />
            {entries.length ? (
              <CardBody>
                <ul className="grid gap-1.5 text-[13px]">
                  {entries.map((entry) => (
                    <li key={entry._id.toHexString()} className="flex justify-between gap-3">
                      <span className="truncate text-muted">
                        {formatDay(wallDateTime(entry.startedAt, ADMIN_TIME_ZONE).date, today)} ·{" "}
                        {entry.description || "No description"}
                      </span>
                      <span className="font-mono tabular-nums">
                        {entry.running ? "…" : formatDuration(entry.seconds)}
                      </span>
                    </li>
                  ))}
                </ul>
              </CardBody>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
