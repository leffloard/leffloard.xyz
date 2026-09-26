import "server-only";
import { randomUUID } from "node:crypto";
import { ObjectId, type ClientSession, type Db, type Document, type Filter } from "mongodb";
import type { Currency, Money } from "@/lib/money";
import { containsPattern } from "@/lib/search";
import {
  BOARD_STAGES,
  OPEN_STAGES,
  PROJECT_STAGES,
  type PricingModel,
  type ProjectStage,
} from "@/lib/work/options";
import { markActive, touchClient } from "@/server/clients/store";
import { now } from "@/server/clock";
import { rankFor } from "@/server/db/ordering";
import { inTransaction } from "@/server/db/transaction";
import type { Milestone, ProjectDoc, ProjectLink, RevisionPolicy } from "@/server/projects/types";
import {
  activities,
  clients,
  projects,
  revisions,
  tasks,
  timeEntries,
  type UpdateOutcome,
} from "@/server/work/collections";

// Projects: one piece of work for a client, from the first plan to delivery.

export type ProjectInput = {
  clientId: ObjectId;
  title: string;
  service: string | null;
  summary: string;
  startDate: string | null;
  dueDate: string | null;
  estimateSeconds: number | null;
  currency: Currency;
  pricing: PricingModel;
  budget: Money | null;
  hourlyRate: Money | null;
  revisionPolicy: RevisionPolicy;
  tags: string[];
};

export const MAX_MILESTONES = 30;
export const MAX_LINKS = 20;

// "PRJ-001", "PRJ-042", "PRJ-1234": one sequence for all projects.
export async function nextProjectRef(db: Db, session?: ClientSession): Promise<string> {
  const counter = await db
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: "project" },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after", session },
    );
  return `PRJ-${String(counter?.seq ?? 1).padStart(3, "0")}`;
}

function stageScope(stage: ProjectStage): Filter<ProjectDoc> {
  return { stage };
}

export async function createProject(
  db: Db,
  input: ProjectInput,
  options: {
    stage?: ProjectStage;
    inquiryId?: ObjectId | null;
    milestones?: ProjectDoc["milestones"];
    session?: ClientSession; // inside a larger transaction (an accepted quote)
  } = {},
  at: Date = now(),
): Promise<ProjectDoc | null> {
  const { session } = options;
  const client = await clients(db).findOne({ _id: input.clientId }, { projection: { _id: 1 }, session });
  if (!client) return null;
  const stage = options.stage ?? "planned";
  const doc: ProjectDoc = {
    _id: new ObjectId(),
    ref: await nextProjectRef(db, session),
    ...input,
    stage,
    // New projects go to the top of their column.
    rank: await rankFor(projects(db), stageScope(stage), null, null),
    revisionsUsed: 0,
    revisionSeq: 0,
    milestones: options.milestones ?? [],
    links: [],
    inquiryId: options.inquiryId ?? null,
    createdAt: at,
    updatedAt: at,
    stageChangedAt: at,
    deliveredAt: stage === "delivered" ? at : null,
    version: 1,
  };
  await projects(db).insertOne(doc, { session });
  await markActive(db, input.clientId, at, session);
  await touchClient(db, input.clientId, at, undefined, session);
  return doc;
}

export async function getProject(db: Db, id: ObjectId): Promise<ProjectDoc | null> {
  return projects(db).findOne({ _id: id });
}

export async function updateProject(
  db: Db,
  id: ObjectId,
  version: number,
  input: ProjectInput,
  at: Date = now(),
): Promise<UpdateOutcome<ProjectDoc>> {
  const client = await clients(db).findOne({ _id: input.clientId }, { projection: { _id: 1 } });
  if (!client) return { ok: false, reason: "missing" };
  const current = await projects(db).findOne({ _id: id }, { projection: { clientId: 1 } });
  if (!current) return { ok: false, reason: "missing" };
  const doc = await projects(db).findOneAndUpdate(
    { _id: id, version },
    { $set: { ...input, updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (!doc) return { ok: false, reason: "conflict" };
  if (!current.clientId.equals(input.clientId)) {
    // The project moved to another client: its tasks, rounds and time follow.
    const moved = { projectId: id };
    await tasks(db).updateMany(moved, { $set: { clientId: input.clientId } });
    await revisions(db).updateMany(moved, { $set: { clientId: input.clientId } });
    await timeEntries(db).updateMany(moved, { $set: { clientId: input.clientId } });
    await markActive(db, input.clientId, at);
  }
  return { ok: true, doc };
}

/**
 * Moves a project to a stage and a place in that column: right after `afterId`, at the top (`null`) or
 * at the bottom (`"end"`).
 */
export async function moveProject(
  db: Db,
  id: ObjectId,
  stage: ProjectStage,
  afterId: ObjectId | null | "end",
  at: Date = now(),
): Promise<ProjectDoc | null> {
  const current = await projects(db).findOne({ _id: id }, { projection: { stage: 1, deliveredAt: 1 } });
  if (!current) return null;
  const rank = await rankFor(projects(db), stageScope(stage), id, afterId);
  const changes: Partial<ProjectDoc> = { stage, rank, updatedAt: at };
  if (current.stage !== stage) {
    changes.stageChangedAt = at;
    changes.deliveredAt = stage === "delivered" ? at : null;
  }
  return projects(db).findOneAndUpdate({ _id: id }, { $set: changes }, { returnDocument: "after" });
}

// --- Lists -----------------------------------------------------------------------------------------------

export const PROJECT_VIEWS = ["open", ...PROJECT_STAGES, "all"] as const;
export type ProjectView = (typeof PROJECT_VIEWS)[number];

export type ProjectListItem = Pick<
  ProjectDoc,
  | "_id"
  | "ref"
  | "title"
  | "stage"
  | "clientId"
  | "service"
  | "dueDate"
  | "startDate"
  | "updatedAt"
  | "rank"
  | "revisionsUsed"
  | "revisionPolicy"
  | "tags"
  | "pricing"
> & { clientName: string; openTasks: number };

const LIST_PROJECTION = {
  ref: 1,
  title: 1,
  stage: 1,
  clientId: 1,
  service: 1,
  dueDate: 1,
  startDate: 1,
  updatedAt: 1,
  rank: 1,
  revisionsUsed: 1,
  revisionPolicy: 1,
  tags: 1,
  pricing: 1,
} as const;

// `head` picks and orders the projects (match, sort, limit); the client's name and the number of open
// tasks are added to each.
async function withListDetails(db: Db, head: Document[]): Promise<ProjectListItem[]> {
  return projects(db)
    .aggregate<ProjectListItem>([
      ...head,
      { $project: LIST_PROJECTION },
      { $lookup: { from: "clients", localField: "clientId", foreignField: "_id", as: "client" } },
      {
        $lookup: {
          from: "tasks",
          let: { project: "$_id" },
          pipeline: [
            { $match: { $expr: { $eq: ["$projectId", "$$project"] }, status: { $ne: "done" } } },
            { $count: "n" },
          ],
          as: "open",
        },
      },
      {
        $set: {
          clientName: { $ifNull: [{ $first: "$client.name" }, "Unknown client"] },
          openTasks: { $ifNull: [{ $first: "$open.n" }, 0] },
        },
      },
      { $unset: ["client", "open"] },
    ])
    .toArray();
}

export async function listProjects(
  db: Db,
  query: { view: ProjectView; clientId?: ObjectId | null; q?: string | null },
): Promise<{ items: ProjectListItem[]; counts: Record<ProjectView, number> }> {
  const base: Filter<ProjectDoc> = {};
  if (query.clientId) base.clientId = query.clientId;
  const pattern = containsPattern(query.q);
  if (pattern) base.$or = [{ title: pattern }, { ref: pattern }, { tags: pattern }];

  const byStage = await projects(db)
    .aggregate<{ _id: ProjectStage; n: number }>([
      { $match: base },
      { $group: { _id: "$stage", n: { $sum: 1 } } },
    ])
    .toArray();
  const counts = Object.fromEntries(PROJECT_VIEWS.map((view) => [view, 0])) as Record<ProjectView, number>;
  for (const row of byStage) {
    counts[row._id] = row.n;
    counts.all += row.n;
    if (OPEN_STAGES.includes(row._id)) counts.open += row.n;
  }

  const viewFilter: Filter<ProjectDoc> =
    query.view === "all"
      ? {}
      : query.view === "open"
        ? { stage: { $in: OPEN_STAGES } }
        : { stage: query.view };
  const match = { $match: { $and: [base, viewFilter] } };
  // Open work by due date (undated last), everything else newest first.
  const items = await withListDetails(
    db,
    query.view === "open"
      ? [
          match,
          { $set: { dueSort: { $ifNull: ["$dueDate", "9999-12-31"] } } },
          { $sort: { dueSort: 1, updatedAt: -1, _id: 1 } },
          { $limit: 200 },
        ]
      : [match, { $sort: { updatedAt: -1, _id: -1 } }, { $limit: 200 }],
  );
  return { items, counts };
}

// The board: its columns in rank order. Delivered projects stay on it for 30 days.
export async function boardProjects(db: Db, at: Date = now()): Promise<ProjectListItem[]> {
  const recently = new Date(at.getTime() - 30 * 86_400_000);
  return withListDetails(db, [
    {
      $match: {
        $or: [
          { stage: { $in: BOARD_STAGES.filter((stage) => stage !== "delivered") } },
          { stage: "delivered", deliveredAt: { $gte: recently } },
        ],
      },
    },
    { $sort: { rank: 1, _id: 1 } },
    { $limit: 500 },
  ]);
}

export async function projectsForClient(db: Db, clientId: ObjectId): Promise<ProjectListItem[]> {
  return withListDetails(db, [{ $match: { clientId } }, { $sort: { createdAt: -1 } }, { $limit: 100 }]);
}

export type ProjectChoice = { id: string; ref: string; title: string; clientName: string; hourly: boolean };

// For selects: projects with work left, newest first.
export async function projectChoices(db: Db): Promise<ProjectChoice[]> {
  const items = await withListDetails(db, [
    { $match: { stage: { $in: OPEN_STAGES } } },
    { $sort: { updatedAt: -1 } },
    { $limit: 300 },
  ]);
  return items.map((item) => ({
    id: item._id.toHexString(),
    ref: item.ref,
    title: item.title,
    clientName: item.clientName,
    hourly: item.pricing === "hourly",
  }));
}

export type ProjectLabel = { id: string; ref: string; title: string; clientName: string };

// Names for project ids shown in task and time lists.
export async function projectLabels(db: Db, ids: ObjectId[]): Promise<Map<string, ProjectLabel>> {
  if (ids.length === 0) return new Map();
  const items = await withListDetails(db, [{ $match: { _id: { $in: ids } } }]);
  return new Map(
    items.map((item) => [
      item._id.toHexString(),
      { id: item._id.toHexString(), ref: item.ref, title: item.title, clientName: item.clientName },
    ]),
  );
}

// --- Milestones and links --------------------------------------------------------------------------------------

export async function addMilestone(
  db: Db,
  id: ObjectId,
  input: { title: string; dueDate: string | null },
  at: Date = now(),
): Promise<ProjectDoc | null | "full"> {
  const milestone: Milestone = { id: randomUUID(), ...input, done: false, doneAt: null };
  const updated = await projects(db).findOneAndUpdate(
    { _id: id, [`milestones.${MAX_MILESTONES - 1}`]: { $exists: false } },
    { $push: { milestones: milestone }, $set: { updatedAt: at } },
    { returnDocument: "after" },
  );
  if (updated) return updated;
  return (await projects(db).countDocuments({ _id: id }, { limit: 1 })) ? "full" : null;
}

export async function setMilestoneDone(
  db: Db,
  id: ObjectId,
  milestoneId: string,
  done: boolean,
  at: Date = now(),
): Promise<ProjectDoc | null> {
  return projects(db).findOneAndUpdate(
    { _id: id, "milestones.id": milestoneId },
    {
      $set: { "milestones.$.done": done, "milestones.$.doneAt": done ? at : null, updatedAt: at },
    },
    { returnDocument: "after" },
  );
}

export async function removeMilestone(
  db: Db,
  id: ObjectId,
  milestoneId: string,
  at: Date = now(),
): Promise<ProjectDoc | null> {
  return projects(db).findOneAndUpdate(
    { _id: id, "milestones.id": milestoneId },
    { $pull: { milestones: { id: milestoneId } }, $set: { updatedAt: at } },
    { returnDocument: "after" },
  );
}

export async function addLink(
  db: Db,
  id: ObjectId,
  input: { label: string; url: string },
  at: Date = now(),
): Promise<ProjectDoc | null | "full"> {
  const link: ProjectLink = { id: randomUUID(), ...input };
  const updated = await projects(db).findOneAndUpdate(
    { _id: id, [`links.${MAX_LINKS - 1}`]: { $exists: false } },
    { $push: { links: link }, $set: { updatedAt: at } },
    { returnDocument: "after" },
  );
  if (updated) return updated;
  return (await projects(db).countDocuments({ _id: id }, { limit: 1 })) ? "full" : null;
}

export async function removeLink(
  db: Db,
  id: ObjectId,
  linkId: string,
  at: Date = now(),
): Promise<ProjectDoc | null> {
  return projects(db).findOneAndUpdate(
    { _id: id, "links.id": linkId },
    { $pull: { links: { id: linkId } }, $set: { updatedAt: at } },
    { returnDocument: "after" },
  );
}

// --- Numbers ---------------------------------------------------------------------------------------------------

export type TrackedTime = { seconds: number; billableSeconds: number };

export async function trackedTime(db: Db, filter: Filter<Document>): Promise<TrackedTime> {
  const [row] = await timeEntries(db)
    .aggregate<TrackedTime>([
      { $match: { ...filter, endedAt: { $ne: null } } },
      {
        $group: {
          _id: null,
          seconds: { $sum: "$seconds" },
          billableSeconds: { $sum: { $cond: ["$billable", "$seconds", 0] } },
        },
      },
    ])
    .toArray();
  return { seconds: row?.seconds ?? 0, billableSeconds: row?.billableSeconds ?? 0 };
}

export type ProjectNumbers = TrackedTime & { tasks: { todo: number; doing: number; done: number } };

export async function projectNumbers(db: Db, id: ObjectId): Promise<ProjectNumbers> {
  const [time, byStatus] = await Promise.all([
    trackedTime(db, { projectId: id }),
    tasks(db)
      .aggregate<{ _id: "todo" | "doing" | "done"; n: number }>([
        { $match: { projectId: id } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ])
      .toArray(),
  ]);
  const counts = { todo: 0, doing: 0, done: 0 };
  for (const row of byStatus) counts[row._id] = row.n;
  return { ...time, tasks: counts };
}

// --- Delete ----------------------------------------------------------------------------------------------------

export type DeletedProject = { tasks: number; revisions: number; timeEntries: number };

// Deletes a project with its tasks, revision rounds and time, all or nothing. Notes in the client's log
// that mention it stay, without the link.
export async function deleteProject(db: Db, id: ObjectId): Promise<DeletedProject | null> {
  return inTransaction(db, async (session) => {
    const project = await projects(db).findOne({ _id: id }, { session, projection: { _id: 1 } });
    if (!project) return null;
    const deleted: DeletedProject = {
      tasks: (await tasks(db).deleteMany({ projectId: id }, { session })).deletedCount,
      revisions: (await revisions(db).deleteMany({ projectId: id }, { session })).deletedCount,
      timeEntries: (await timeEntries(db).deleteMany({ projectId: id }, { session })).deletedCount,
    };
    await activities(db).updateMany({ projectId: id }, { $set: { projectId: null } }, { session });
    await projects(db).deleteOne({ _id: id }, { session });
    return deleted;
  });
}
