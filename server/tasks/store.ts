import "server-only";
import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type Filter } from "mongodb";
import { nextOccurrence } from "@/lib/work/dates";
import type { Recurrence, TaskStatus, TaskView } from "@/lib/work/options";
import { now } from "@/server/clock";
import { rankFor } from "@/server/db/ordering";
import { projectLabels, type ProjectLabel } from "@/server/projects/store";
import type { ChecklistItem, TaskDoc } from "@/server/tasks/types";
import { projects, tasks, timeEntries } from "@/server/work/collections";

// Tasks: the owner's to-do list, on its own or inside a project (where they form the project's board).

export const MAX_CHECKLIST_ITEMS = 50;

export type NewTask = {
  title: string;
  notes?: string;
  projectId?: ObjectId | null;
  status?: TaskStatus;
  due?: string | null;
  someday?: boolean;
  flagged?: boolean;
  recurrence?: Recurrence | null;
  estimateSeconds?: number | null;
  revisionId?: ObjectId | null;
};

function listScope(projectId: ObjectId | null, status: TaskStatus): Filter<TaskDoc> {
  return { projectId, status };
}

async function clientOf(db: Db, projectId: ObjectId | null): Promise<ObjectId | null | undefined> {
  if (!projectId) return null;
  const project = await projects(db).findOne({ _id: projectId }, { projection: { clientId: 1 } });
  return project ? project.clientId : undefined;
}

// Null when the project does not exist.
export async function createTask(db: Db, input: NewTask, at: Date = now()): Promise<TaskDoc | null> {
  const projectId = input.projectId ?? null;
  const clientId = await clientOf(db, projectId);
  if (clientId === undefined) return null;
  const status = input.status ?? "todo";
  const due = input.due ?? null;
  const doc: TaskDoc = {
    _id: new ObjectId(),
    title: input.title,
    notes: input.notes ?? "",
    projectId,
    clientId,
    revisionId: input.revisionId ?? null,
    status,
    rank: await rankFor(tasks(db), listScope(projectId, status), null, "end"),
    due,
    someday: due ? false : (input.someday ?? false),
    flagged: input.flagged ?? false,
    recurrence: input.recurrence ?? null,
    estimateSeconds: input.estimateSeconds ?? null,
    checklist: [],
    createdAt: at,
    updatedAt: at,
    completedAt: status === "done" ? at : null,
    timesCompleted: 0,
  };
  await tasks(db).insertOne(doc);
  return doc;
}

export async function getTask(db: Db, id: ObjectId): Promise<TaskDoc | null> {
  return tasks(db).findOne({ _id: id });
}

export type TaskEdit = {
  title: string;
  notes: string;
  projectId: ObjectId | null;
  due: string | null;
  someday: boolean;
  flagged: boolean;
  recurrence: Recurrence | null;
  estimateSeconds: number | null;
};

// Null when the task or the new project does not exist.
export async function updateTask(
  db: Db,
  id: ObjectId,
  edit: TaskEdit,
  at: Date = now(),
): Promise<TaskDoc | null> {
  const current = await tasks(db).findOne({ _id: id }, { projection: { projectId: 1, status: 1 } });
  if (!current) return null;
  const clientId = await clientOf(db, edit.projectId);
  if (clientId === undefined) return null;
  const changes: Partial<TaskDoc> = {
    ...edit,
    someday: edit.due ? false : edit.someday,
    clientId,
    updatedAt: at,
  };
  const moved = String(current.projectId) !== String(edit.projectId);
  if (moved) {
    changes.rank = await rankFor(tasks(db), listScope(edit.projectId, current.status), id, "end");
    await timeEntries(db).updateMany({ taskId: id }, { $set: { projectId: edit.projectId, clientId } });
  }
  return tasks(db).findOneAndUpdate({ _id: id }, { $set: changes }, { returnDocument: "after" });
}

export type MoveOutcome = { task: TaskDoc; repeatsOn: string | null };

/**
 * Moves a task to a status and a place in that list: right after `afterId`, at the top (`null`) or at
 * the bottom (`"end"`). Finishing a repeating task moves it to its next date instead, unticked.
 */
export async function moveTask(
  db: Db,
  id: ObjectId,
  target: { status: TaskStatus; afterId: ObjectId | null | "end" },
  today: string,
  at: Date = now(),
): Promise<MoveOutcome | null> {
  const current = await tasks(db).findOne({ _id: id });
  if (!current) return null;
  const finishing = target.status === "done" && current.status !== "done";

  if (finishing && current.recurrence) {
    const due = nextOccurrence(current.due, current.recurrence, today);
    const status: TaskStatus = "todo";
    const rank =
      current.status === status
        ? current.rank
        : await rankFor(tasks(db), listScope(current.projectId, status), id, "end");
    // The status in the filter makes a double click count once.
    const task = await tasks(db).findOneAndUpdate(
      { _id: id, status: current.status, due: current.due },
      {
        $set: {
          status,
          rank,
          due,
          someday: false,
          checklist: current.checklist.map((item) => ({ ...item, done: false })),
          completedAt: at,
          updatedAt: at,
        },
        $inc: { timesCompleted: 1 },
      },
      { returnDocument: "after" },
    );
    return task ? { task, repeatsOn: due } : { task: (await getTask(db, id))!, repeatsOn: null };
  }

  const rank = await rankFor(tasks(db), listScope(current.projectId, target.status), id, target.afterId);
  const changes: Partial<TaskDoc> = { status: target.status, rank, updatedAt: at };
  if (finishing) {
    changes.completedAt = at;
    changes.timesCompleted = current.timesCompleted + 1;
  } else if (target.status !== "done" && current.status === "done") {
    changes.completedAt = null;
  }
  const task = await tasks(db).findOneAndUpdate({ _id: id }, { $set: changes }, { returnDocument: "after" });
  return task ? { task, repeatsOn: null } : null;
}

// Ticking a task off a list puts it at the top of the done list; unticking puts it back at the bottom.
export async function setTaskDone(
  db: Db,
  id: ObjectId,
  done: boolean,
  today: string,
  at: Date = now(),
): Promise<MoveOutcome | null> {
  return moveTask(
    db,
    id,
    done ? { status: "done", afterId: null } : { status: "todo", afterId: "end" },
    today,
    at,
  );
}

export async function setFlagged(db: Db, id: ObjectId, flagged: boolean, at: Date = now()) {
  return tasks(db).findOneAndUpdate(
    { _id: id },
    { $set: { flagged, updatedAt: at } },
    { returnDocument: "after" },
  );
}

export async function setDue(db: Db, id: ObjectId, due: string | null, someday: boolean, at: Date = now()) {
  return tasks(db).findOneAndUpdate(
    { _id: id },
    { $set: { due, someday: due ? false : someday, updatedAt: at } },
    { returnDocument: "after" },
  );
}

// Time tracked on a task stays, without the link.
export async function deleteTask(db: Db, id: ObjectId): Promise<TaskDoc | null> {
  const task = await tasks(db).findOneAndDelete({ _id: id });
  if (task) await timeEntries(db).updateMany({ taskId: id }, { $set: { taskId: null } });
  return task;
}

// --- Checklist ------------------------------------------------------------------------------------------------

export async function addChecklistItem(
  db: Db,
  id: ObjectId,
  text: string,
  at: Date = now(),
): Promise<TaskDoc | null | "full"> {
  const item: ChecklistItem = { id: randomUUID(), text, done: false };
  const updated = await tasks(db).findOneAndUpdate(
    { _id: id, [`checklist.${MAX_CHECKLIST_ITEMS - 1}`]: { $exists: false } },
    { $push: { checklist: item }, $set: { updatedAt: at } },
    { returnDocument: "after" },
  );
  if (updated) return updated;
  return (await tasks(db).countDocuments({ _id: id }, { limit: 1 })) ? "full" : null;
}

export async function setChecklistItemDone(
  db: Db,
  id: ObjectId,
  itemId: string,
  done: boolean,
  at: Date = now(),
): Promise<TaskDoc | null> {
  return tasks(db).findOneAndUpdate(
    { _id: id, "checklist.id": itemId },
    { $set: { "checklist.$.done": done, updatedAt: at } },
    { returnDocument: "after" },
  );
}

export async function removeChecklistItem(
  db: Db,
  id: ObjectId,
  itemId: string,
  at: Date = now(),
): Promise<TaskDoc | null> {
  return tasks(db).findOneAndUpdate(
    { _id: id, "checklist.id": itemId },
    { $pull: { checklist: { id: itemId } }, $set: { updatedAt: at } },
    { returnDocument: "after" },
  );
}

// --- Views ------------------------------------------------------------------------------------------------

export type TaskListItem = Pick<
  TaskDoc,
  | "_id"
  | "title"
  | "status"
  | "due"
  | "someday"
  | "flagged"
  | "recurrence"
  | "projectId"
  | "completedAt"
  | "revisionId"
> & { checklistDone: number; checklistTotal: number; project: ProjectLabel | null };

const OPEN = { status: { $ne: "done" as const } };

function viewQuery(view: TaskView, today: string): { filter: Filter<TaskDoc>; sort: Record<string, 1 | -1> } {
  switch (view) {
    case "today":
      return { filter: { ...OPEN, due: { $ne: null, $lte: today } }, sort: { due: 1, rank: 1, _id: 1 } };
    case "overdue":
      return { filter: { ...OPEN, due: { $ne: null, $lt: today } }, sort: { due: 1, rank: 1, _id: 1 } };
    case "upcoming":
      return { filter: { ...OPEN, due: { $gt: today } }, sort: { due: 1, rank: 1, _id: 1 } };
    case "anytime":
      return { filter: { ...OPEN, due: null, someday: false }, sort: { flagged: -1, createdAt: 1, _id: 1 } };
    case "someday":
      return { filter: { ...OPEN, due: null, someday: true }, sort: { createdAt: 1, _id: 1 } };
    case "done":
      return { filter: { status: "done" }, sort: { completedAt: -1, _id: -1 } };
  }
}

async function withProjects(db: Db, docs: TaskDoc[]): Promise<TaskListItem[]> {
  const ids = [
    ...new Map(
      docs.filter((doc) => doc.projectId).map((doc) => [doc.projectId!.toHexString(), doc.projectId!]),
    ).values(),
  ];
  const labels = await projectLabels(db, ids);
  return docs.map((doc) => ({
    _id: doc._id,
    title: doc.title,
    status: doc.status,
    due: doc.due,
    someday: doc.someday,
    flagged: doc.flagged,
    recurrence: doc.recurrence,
    projectId: doc.projectId,
    completedAt: doc.completedAt,
    revisionId: doc.revisionId,
    checklistDone: doc.checklist.filter((item) => item.done).length,
    checklistTotal: doc.checklist.length,
    project: doc.projectId ? (labels.get(doc.projectId.toHexString()) ?? null) : null,
  }));
}

export async function listTasks(
  db: Db,
  view: TaskView,
  today: string,
  { projectId, limit = 200 }: { projectId?: ObjectId | null; limit?: number } = {},
): Promise<TaskListItem[]> {
  const { filter, sort } = viewQuery(view, today);
  if (projectId) filter.projectId = projectId;
  const docs = await tasks(db).find(filter).sort(sort).limit(limit).toArray();
  return withProjects(db, docs);
}

export async function taskCounts(db: Db, today: string): Promise<Record<TaskView, number>> {
  const views: TaskView[] = ["today", "overdue", "upcoming", "anytime", "someday"];
  const counts = await Promise.all(
    views.map((view) => tasks(db).countDocuments(viewQuery(view, today).filter)),
  );
  const result = { done: 0 } as Record<TaskView, number>;
  views.forEach((view, index) => (result[view] = counts[index]!));
  return result;
}

export type BoardTasks = Record<TaskStatus, TaskListItem[]>;

// A project's board: every open task, and the most recent finished ones.
export async function projectBoard(db: Db, projectId: ObjectId, doneLimit = 50): Promise<BoardTasks> {
  const [open, done] = await Promise.all([
    tasks(db)
      .find({ projectId, status: { $ne: "done" } })
      .sort({ rank: 1, _id: 1 })
      .limit(500)
      .toArray(),
    tasks(db).find({ projectId, status: "done" }).sort({ rank: 1, _id: 1 }).limit(doneLimit).toArray(),
  ]);
  const items = await withProjects(db, [...open, ...done]);
  return {
    todo: items.filter((item) => item.status === "todo"),
    doing: items.filter((item) => item.status === "doing"),
    done: items.filter((item) => item.status === "done"),
  };
}

export type TaskChoice = { id: string; title: string; projectId: string | null };

// For the timer: open tasks, with their project.
export async function taskChoices(db: Db, limit = 300): Promise<TaskChoice[]> {
  const docs = await tasks(db)
    .find({ status: { $ne: "done" } }, { projection: { title: 1, projectId: 1 } })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .toArray();
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    title: doc.title,
    projectId: doc.projectId?.toHexString() ?? null,
  }));
}
