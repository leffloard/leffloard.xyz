"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import { describeDuration } from "@/lib/duration";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import {
  dateSchema,
  durationSchema,
  fieldError,
  idSchema,
  optionalIdSchema,
  text,
  timeSchema,
} from "@/lib/forms";
import { adminAction } from "@/server/auth/action";
import {
  addEntry,
  deleteEntry,
  getEntry,
  startTimer,
  stopTimer,
  updateEntry,
  type StoppedTimer,
} from "@/server/time/store";

const NOT_FOUND = "This time entry no longer exists.";
const GONE = "That project or task no longer exists.";

const description = text({ maxLength: 300 }).transform((value) => value ?? "");

function stoppedNote(stopped: StoppedTimer | null): string {
  if (!stopped) return "";
  return stopped.kept
    ? ` The previous timer stopped with ${describeDuration(stopped.entry.seconds)}.`
    : " The previous timer ran under a minute, so it was dropped.";
}

export const startTimerAction = adminAction(
  z.object({ description, projectId: optionalIdSchema, taskId: optionalIdSchema }),
  async (input, { db }) => {
    const started = await startTimer(db, {
      description: input.description,
      projectId: input.projectId ? new ObjectId(input.projectId) : null,
      taskId: input.taskId ? new ObjectId(input.taskId) : null,
    });
    if (!started) return fail(GONE);
    refresh();
    return ok(null, `Timer started.${stoppedNote(started.stopped)}`);
  },
);

export const stopTimerAction = adminAction(z.object({}), async (_input, { db }) => {
  const stopped = await stopTimer(db);
  if (!stopped) return fail("No timer is running.");
  refresh();
  return ok(
    null,
    stopped.kept
      ? `Stopped: ${describeDuration(stopped.entry.seconds)} recorded.`
      : "Stopped. It ran under a minute, so nothing was recorded.",
  );
});

const entryFields = z.object({
  description,
  projectId: optionalIdSchema,
  billable: z.boolean(),
  date: dateSchema,
  startTime: timeSchema,
  duration: durationSchema(),
});

export const addEntryAction = adminAction(
  entryFields.extend({ taskId: optionalIdSchema }),
  async (input, { db }) => {
    if (!input.date) return fieldError("date", "Choose the day.");
    if (!input.duration) return fieldError("duration", "How long did it take?");
    const entry = await addEntry(
      db,
      {
        description: input.description,
        projectId: input.projectId ? new ObjectId(input.projectId) : null,
        taskId: input.taskId ? new ObjectId(input.taskId) : null,
        date: input.date,
        startTime: input.startTime,
        seconds: input.duration,
        billable: input.billable,
      },
      ADMIN_TIME_ZONE,
    );
    if (!entry) return fail(GONE);
    refresh();
    return ok(null, `${describeDuration(entry.seconds)} added.`);
  },
);

export const updateEntryAction = adminAction(entryFields.extend({ id: idSchema }), async (input, { db }) => {
  const id = new ObjectId(input.id);
  const current = await getEntry(db, id);
  if (!current) return fail(NOT_FOUND);
  if (!current.running) {
    if (!input.date) return fieldError("date", "Choose the day.");
    if (!input.duration) return fieldError("duration", "How long did it take?");
  }
  const entry = await updateEntry(
    db,
    id,
    {
      description: input.description,
      projectId: input.projectId ? new ObjectId(input.projectId) : null,
      billable: input.billable,
      date: input.date,
      startTime: input.startTime,
      seconds: input.duration,
    },
    ADMIN_TIME_ZONE,
  );
  if (!entry) return fail(GONE);
  refresh();
  return ok(null, "Entry saved.");
});

export const deleteEntryAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await deleteEntry(db, new ObjectId(input.id)))) return fail(NOT_FOUND);
  refresh();
  return ok(null, "Entry deleted.");
});
