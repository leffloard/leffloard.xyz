import { notFound } from "next/navigation";
import { TaskBoard, type TaskCard } from "@/components/admin/work/task-board";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { dueLabel } from "@/lib/work/dates";
import { TASK_STATUS_LABELS, TASK_STATUSES } from "@/lib/work/options";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/projects/store";
import { projectBoard } from "@/server/tasks/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Project tasks" };

export default async function ProjectTasksPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const project = id ? await getProject(db, id) : null;
  if (!project) notFound();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const board = await projectBoard(db, project._id);
  const cards: TaskCard[] = TASK_STATUSES.flatMap((status) =>
    board[status].map((task) => ({
      id: task._id.toHexString(),
      column: status,
      label: task.title,
      href: `/admin/tasks/${task._id.toHexString()}`,
      due: task.due ? dueLabel(task.due, today) : null,
      flagged: task.flagged,
      repeats: task.recurrence !== null,
      checklist: task.checklistTotal ? `${task.checklistDone}/${task.checklistTotal}` : null,
    })),
  );

  return (
    <>
      <TaskBoard
        projectId={project._id.toHexString()}
        columns={TASK_STATUSES.map((status) => ({ id: status, title: TASK_STATUS_LABELS[status] }))}
        cards={cards}
      />
      <p className="mt-4 hidden text-xs text-muted lg:block">
        Keys: arrows move between cards, <kbd className="font-mono">Shift</kbd> + arrows move a card,{" "}
        <kbd className="font-mono">Enter</kbd> opens it. The Done column shows the latest 50.
      </p>
    </>
  );
}
