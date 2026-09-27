"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import {
  dateSchema,
  durationSchema,
  fieldError,
  idSchema,
  notesText,
  optionalIdSchema,
  requiredText,
} from "@/lib/forms";
import { addDays, todayIn } from "@/lib/intake/time";
import { formatWeekday, weekdayIndex } from "@/lib/work/dates";
import { RECURRENCES, TASK_STATUS_LABELS, TASK_STATUSES, TASK_WHEN, type TaskWhen } from "@/lib/work/options";
import { adminAction } from "@/server/auth/action";
import { now } from "@/server/clock";
import {
  addChecklistItem,
  createTask,
  deleteTask,
  MAX_CHECKLIST_ITEMS,
  moveTask,
  removeChecklistItem,
  setChecklistItemDone,
  setFlagged,
  setTaskDone,
  updateTask,
  type MoveOutcome,
} from "@/server/tasks/store";

const NOT_FOUND = "This task no longer exists.";
const MAX_ESTIMATE_SECONDS = 1000 * 3600;

function today(): string {
  return todayIn(ADMIN_TIME_ZONE, now());
}

// "When" in the quick-add row, as a due date or "someday".
function schedule(when: TaskWhen, date: string | null, day: string) {
  switch (when) {
    case "today":
      return { due: day, someday: false };
    case "tomorrow":
      return { due: addDays(day, 1), someday: false };
    case "next-week":
      return { due: addDays(day, 7 - weekdayIndex(day)), someday: false };
    case "someday":
      return { due: null, someday: true };
    case "date":
      return { due: date, someday: false };
    case "none":
      return { due: null, someday: false };
  }
}

export const createTaskAction = adminAction(
  z
    .object({
      title: requiredText(300, "Write the task first."),
      projectId: optionalIdSchema,
      status: z.enum(TASK_STATUSES).default("todo"),
      when: z.enum(TASK_WHEN).default("none"),
      date: dateSchema.default(null),
    })
    .refine((input) => input.when !== "date" || input.date !== null, {
      path: ["date"],
      message: "Choose the date.",
    }),
  async (input, { db }) => {
    const day = today();
    const task = await createTask(db, {
      title: input.title,
      projectId: input.projectId ? new ObjectId(input.projectId) : null,
      status: input.status,
      ...schedule(input.when, input.date, day),
    });
    if (!task) return fieldError("projectId", "That project no longer exists.");
    refresh();
    return ok({ id: task._id.toHexString() }, "Task added.");
  },
);

export const updateTaskAction = adminAction(
  z.object({
    id: idSchema,
    title: requiredText(300, "The task needs a title."),
    notes: notesText(20_000),
    projectId: optionalIdSchema,
    due: dateSchema,
    someday: z.boolean().default(false),
    flagged: z.boolean().default(false),
    recurrence: z.enum([...RECURRENCES, ""]).transform((value) => value || null),
    estimate: durationSchema(MAX_ESTIMATE_SECONDS),
  }),
  async (input, { db }) => {
    const task = await updateTask(db, new ObjectId(input.id), {
      title: input.title,
      notes: input.notes,
      projectId: input.projectId ? new ObjectId(input.projectId) : null,
      due: input.due,
      someday: input.someday,
      flagged: input.flagged,
      recurrence: input.recurrence,
      estimateSeconds: input.estimate,
    });
    if (!task) return fail("This task or its project no longer exists.");
    refresh();
    return ok(null, "Task saved.");
  },
);

function moved(outcome: MoveOutcome, day: string): string {
  if (outcome.repeatsOn) return `Done. It repeats on ${formatWeekday(outcome.repeatsOn, day)}.`;
  return outcome.task.status === "done" ? "Done." : `Moved to ${TASK_STATUS_LABELS[outcome.task.status]}.`;
}

// From a board: a status and a place in its column.
export const moveTaskAction = adminAction(
  z.object({
    id: idSchema,
    status: z.enum(TASK_STATUSES),
    after: z.union([idSchema, z.literal("top"), z.literal("end")]).default("top"),
  }),
  async (input, { db }) => {
    const day = today();
    const after = input.after === "top" ? null : input.after === "end" ? "end" : new ObjectId(input.after);
    const outcome = await moveTask(db, new ObjectId(input.id), { status: input.status, afterId: after }, day);
    if (!outcome) return fail(NOT_FOUND);
    refresh();
    // The board announces the move itself; only a repeating task needs a word about where it went.
    return ok(null, outcome.repeatsOn ? moved(outcome, day) : undefined);
  },
);

export const setTaskDoneAction = adminAction(
  z.object({ id: idSchema, done: z.boolean() }),
  async (input, { db }) => {
    const day = today();
    const outcome = await setTaskDone(db, new ObjectId(input.id), input.done, day);
    if (!outcome) return fail(NOT_FOUND);
    refresh();
    return ok(null, input.done ? moved(outcome, day) : "Back on the list.");
  },
);

export const setFlaggedAction = adminAction(
  z.object({ id: idSchema, flagged: z.boolean() }),
  async (input, { db }) => {
    if (!(await setFlagged(db, new ObjectId(input.id), input.flagged))) return fail(NOT_FOUND);
    refresh();
    return ok(null, input.flagged ? "Flagged." : "Flag removed.");
  },
);

export const deleteTaskAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  const task = await deleteTask(db, new ObjectId(input.id));
  if (!task) return fail(NOT_FOUND);
  redirect(task.projectId ? `/admin/projects/${task.projectId.toHexString()}/tasks` : "/admin/tasks");
});

// --- Checklist ------------------------------------------------------------------------------------------------

export const addChecklistItemAction = adminAction(
  z.object({ id: idSchema, text: requiredText(300, "Write the step first.") }),
  async (input, { db }) => {
    const result = await addChecklistItem(db, new ObjectId(input.id), input.text);
    if (result === "full") return fail(`A checklist can have up to ${MAX_CHECKLIST_ITEMS} steps.`);
    if (!result) return fail(NOT_FOUND);
    refresh();
    return ok(null);
  },
);

export const setChecklistItemDoneAction = adminAction(
  z.object({ id: idSchema, itemId: z.uuid(), done: z.boolean() }),
  async (input, { db }) => {
    if (!(await setChecklistItemDone(db, new ObjectId(input.id), input.itemId, input.done)))
      return fail("That step no longer exists.");
    refresh();
    return ok(null);
  },
);

export const removeChecklistItemAction = adminAction(
  z.object({ id: idSchema, itemId: z.uuid() }),
  async (input, { db }) => {
    if (!(await removeChecklistItem(db, new ObjectId(input.id), input.itemId)))
      return fail("That step no longer exists.");
    refresh();
    return ok(null);
  },
);
