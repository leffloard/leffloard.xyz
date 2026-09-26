import "server-only";
import type { EntryRowData } from "@/components/admin/time/entries";
import { formatDuration } from "@/lib/duration";
import { wallDateTime } from "@/lib/intake/time";
import type { EntryItem } from "@/server/time/store";

// A time entry as the admin's lists show it, in the owner's time zone.
export function toEntryRow(entry: EntryItem, zone: string): EntryRowData {
  const start = wallDateTime(entry.startedAt, zone);
  const end = entry.endedAt ? wallDateTime(entry.endedAt, zone) : null;
  const id = entry._id.toHexString();
  const running = Boolean(entry.running);
  return {
    id,
    running,
    description: entry.description,
    project: entry.project
      ? { id: entry.project.id, label: `${entry.project.ref} · ${entry.project.title}` }
      : null,
    task: entry.taskId && entry.taskTitle ? { id: entry.taskId.toHexString(), title: entry.taskTitle } : null,
    range: `${start.time}–${end ? end.time : "now"}`,
    duration: running ? "…" : formatDuration(entry.seconds),
    billable: entry.billable,
    values: {
      id,
      running,
      description: entry.description,
      projectId: entry.projectId?.toHexString() ?? "",
      taskId: entry.taskId?.toHexString() ?? "",
      date: start.date,
      startTime: start.time,
      duration: running ? "" : formatDuration(entry.seconds),
      billable: entry.billable,
    },
  };
}
