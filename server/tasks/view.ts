import "server-only";
import type { TaskRow } from "@/components/admin/work/task-list";
import { dueLabel } from "@/lib/work/dates";
import type { TaskListItem } from "@/server/tasks/store";

// A task as the admin's lists show it.
export function toTaskRow(task: TaskListItem, today: string): TaskRow {
  return {
    id: task._id.toHexString(),
    title: task.title,
    done: task.status === "done",
    due: task.due ? dueLabel(task.due, today) : null,
    flagged: task.flagged,
    repeats: task.recurrence !== null,
    checklist: task.checklistTotal ? `${task.checklistDone}/${task.checklistTotal}` : null,
    project: task.project
      ? { id: task.project.id, label: `${task.project.ref} · ${task.project.title}` }
      : null,
  };
}
