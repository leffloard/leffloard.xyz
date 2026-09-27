import "server-only";
import { MongoServerError, ObjectId, type Db, type Filter } from "mongodb";
import { addDays, zonedInstant } from "@/lib/intake/time";
import { now } from "@/server/clock";
import { projectLabels, type ProjectLabel } from "@/server/projects/store";
import type { TimeEntryDoc } from "@/server/time/types";
import { projects, tasks, timeEntries } from "@/server/work/collections";

// Time tracking: a timer (only one runs at a time) and entries added by hand.

const DUPLICATE_KEY = 11000;
// A timer stopped before this is dropped: it was started by mistake.
export const MIN_TIMER_SECONDS = 60;
const START_ATTEMPTS = 10;

type Owner = {
  projectId: ObjectId | null;
  clientId: ObjectId | null;
  taskId: ObjectId | null;
  hourly: boolean;
};

// The project and client an entry belongs to, from its task or project. Undefined when either is gone.
async function ownerOf(
  db: Db,
  projectId: ObjectId | null,
  taskId: ObjectId | null,
): Promise<Owner | undefined> {
  let project = projectId;
  if (taskId) {
    const task = await tasks(db).findOne({ _id: taskId }, { projection: { projectId: 1 } });
    if (!task) return undefined;
    project = task.projectId ?? project;
  }
  if (!project) return { projectId: null, clientId: null, taskId, hourly: false };
  const doc = await projects(db).findOne({ _id: project }, { projection: { clientId: 1, pricing: 1 } });
  if (!doc) return undefined;
  return { projectId: project, clientId: doc.clientId, taskId, hourly: doc.pricing === "hourly" };
}

export async function runningEntry(db: Db): Promise<TimeEntryDoc | null> {
  return timeEntries(db).findOne({ running: true });
}

export type StoppedTimer = { entry: TimeEntryDoc; kept: boolean };

// Stops the running timer, if there is one. A timer under a minute is dropped.
export async function stopTimer(db: Db, at: Date = now()): Promise<StoppedTimer | null> {
  const running = await runningEntry(db);
  if (!running) return null;
  const seconds = Math.max(0, Math.round((at.getTime() - running.startedAt.getTime()) / 1000));
  if (seconds < MIN_TIMER_SECONDS) {
    const dropped = await timeEntries(db).findOneAndDelete({ _id: running._id, running: true });
    return dropped ? { entry: dropped, kept: false } : null;
  }
  const entry = await timeEntries(db).findOneAndUpdate(
    { _id: running._id, running: true },
    { $set: { endedAt: at, seconds, updatedAt: at }, $unset: { running: "" } },
    { returnDocument: "after" },
  );
  return entry ? { entry, kept: true } : null;
}

export type TimerStart = { description: string; projectId: ObjectId | null; taskId: ObjectId | null };

/**
 * Starts a timer, stopping the one that runs. Two starts at the same moment can't both win: the unique
 * index on `running` refuses the second insert, which then stops the winner and tries again, so the last
 * start is the one that runs. Null when the task or project does not exist.
 */
export async function startTimer(
  db: Db,
  input: TimerStart,
  at: Date = now(),
): Promise<{ entry: TimeEntryDoc; stopped: StoppedTimer | null } | null> {
  const owner = await ownerOf(db, input.projectId, input.taskId);
  if (!owner) return null;
  let stopped: StoppedTimer | null = null;
  for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
    // After a lost race, wait a little (more each time, at random) so the starters don't collide again.
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, Math.random() * 20 * attempt));
    stopped = (await stopTimer(db, at)) ?? stopped;
    const entry: TimeEntryDoc = {
      _id: new ObjectId(),
      description: input.description,
      projectId: owner.projectId,
      clientId: owner.clientId,
      taskId: owner.taskId,
      startedAt: at,
      endedAt: null,
      seconds: 0,
      running: true,
      billable: owner.hourly,
      source: "timer",
      createdAt: at,
      updatedAt: at,
    };
    try {
      await timeEntries(db).insertOne(entry);
      return { entry, stopped };
    } catch (error) {
      if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
    }
  }
  throw new Error("Could not start the timer: another one kept starting at the same moment.");
}

export type ManualEntry = {
  description: string;
  projectId: ObjectId | null;
  taskId: ObjectId | null;
  date: string; // YYYY-MM-DD in `zone`
  startTime: string | null; // HH:MM; 09:00 when not given
  seconds: number;
  billable: boolean | null; // null: the project's default
};

function startOf(date: string, time: string | null, zone: string): Date | null {
  return zonedInstant(date, time ?? "09:00", zone);
}

export async function addEntry(
  db: Db,
  input: ManualEntry,
  zone: string,
  at: Date = now(),
): Promise<TimeEntryDoc | null> {
  const owner = await ownerOf(db, input.projectId, input.taskId);
  const startedAt = startOf(input.date, input.startTime, zone);
  if (!owner || !startedAt) return null;
  const entry: TimeEntryDoc = {
    _id: new ObjectId(),
    description: input.description,
    projectId: owner.projectId,
    clientId: owner.clientId,
    taskId: owner.taskId,
    startedAt,
    endedAt: new Date(startedAt.getTime() + input.seconds * 1000),
    seconds: input.seconds,
    billable: input.billable ?? owner.hourly,
    source: "manual",
    createdAt: at,
    updatedAt: at,
  };
  await timeEntries(db).insertOne(entry);
  return entry;
}

export type EntryEdit = {
  description: string;
  projectId: ObjectId | null;
  billable: boolean;
  // Only for stopped entries: when it happened and how long it took.
  date: string | null;
  startTime: string | null;
  seconds: number | null;
};

export async function updateEntry(
  db: Db,
  id: ObjectId,
  edit: EntryEdit,
  zone: string,
  at: Date = now(),
): Promise<TimeEntryDoc | null> {
  const current = await timeEntries(db).findOne({ _id: id });
  if (!current) return null;
  const sameProject = String(current.projectId) === String(edit.projectId);
  const owner = await ownerOf(db, edit.projectId, sameProject ? current.taskId : null);
  if (!owner) return null;
  const changes: Partial<TimeEntryDoc> = {
    description: edit.description,
    projectId: owner.projectId,
    clientId: owner.clientId,
    taskId: owner.taskId,
    billable: edit.billable,
    updatedAt: at,
  };
  if (!current.running && edit.date && edit.seconds) {
    const startedAt = startOf(edit.date, edit.startTime, zone);
    if (!startedAt) return null;
    changes.startedAt = startedAt;
    changes.seconds = edit.seconds;
    changes.endedAt = new Date(startedAt.getTime() + edit.seconds * 1000);
  }
  return timeEntries(db).findOneAndUpdate({ _id: id }, { $set: changes }, { returnDocument: "after" });
}

export async function deleteEntry(db: Db, id: ObjectId): Promise<TimeEntryDoc | null> {
  return timeEntries(db).findOneAndDelete({ _id: id });
}

export async function getEntry(db: Db, id: ObjectId): Promise<TimeEntryDoc | null> {
  return timeEntries(db).findOne({ _id: id });
}

export type EntryItem = TimeEntryDoc & { project: ProjectLabel | null; taskTitle: string | null };

async function withLabels(db: Db, docs: TimeEntryDoc[]): Promise<EntryItem[]> {
  const projectIds = [
    ...new Map(
      docs.filter((doc) => doc.projectId).map((doc) => [doc.projectId!.toHexString(), doc.projectId!]),
    ).values(),
  ];
  const taskIds = docs.flatMap((doc) => (doc.taskId ? [doc.taskId] : []));
  const [labels, taskDocs] = await Promise.all([
    projectLabels(db, projectIds),
    taskIds.length
      ? tasks(db)
          .find({ _id: { $in: taskIds } }, { projection: { title: 1 } })
          .toArray()
      : Promise.resolve([]),
  ]);
  const titles = new Map(taskDocs.map((task) => [task._id.toHexString(), task.title]));
  return docs.map((doc) => ({
    ...doc,
    project: doc.projectId ? (labels.get(doc.projectId.toHexString()) ?? null) : null,
    taskTitle: doc.taskId ? (titles.get(doc.taskId.toHexString()) ?? null) : null,
  }));
}

// Entries that started in a week (Monday to Sunday in `zone`), oldest first.
export async function weekEntries(db: Db, weekStart: string, zone: string): Promise<EntryItem[]> {
  const from = zonedInstant(weekStart, "00:00", zone);
  const to = zonedInstant(addDays(weekStart, 7), "00:00", zone);
  if (!from || !to) return [];
  const docs = await timeEntries(db)
    .find({ startedAt: { $gte: from, $lt: to } })
    .sort({ startedAt: 1, _id: 1 })
    .limit(2000)
    .toArray();
  return withLabels(db, docs);
}

export async function recentEntries(db: Db, filter: Filter<TimeEntryDoc>, limit = 50): Promise<EntryItem[]> {
  const docs = await timeEntries(db).find(filter).sort({ startedAt: -1, _id: -1 }).limit(limit).toArray();
  return withLabels(db, docs);
}

export type RunningTimer = {
  id: string;
  description: string;
  startedAt: Date;
  project: ProjectLabel | null;
  taskTitle: string | null;
};

// The running timer with its labels, for the shell.
export async function runningTimer(db: Db): Promise<RunningTimer | null> {
  const entry = await runningEntry(db);
  if (!entry) return null;
  const [item] = await withLabels(db, [entry]);
  return {
    id: entry._id.toHexString(),
    description: entry.description,
    startedAt: entry.startedAt,
    project: item?.project ?? null,
    taskTitle: item?.taskTitle ?? null,
  };
}
