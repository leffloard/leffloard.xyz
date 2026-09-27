import "server-only";
import { ObjectId, type Db } from "mongodb";
import type { Money } from "@/lib/money";
import type { RevisionStatus } from "@/lib/work/options";
import { now } from "@/server/clock";
import { inTransaction } from "@/server/db/transaction";
import type { ProjectDoc, RevisionDoc, RevisionPolicy } from "@/server/projects/types";
import { projects, revisions } from "@/server/work/collections";

// Revision rounds. A project includes a number of rounds; each round asked for after those is billable
// at the project's extra-round price. The project keeps the count, and the count and the round are
// written together in a transaction, so two requests at the same moment can't both be "round 2".

export type NewRevision = {
  title: string;
  details: string;
  inquiryId?: ObjectId | null;
  requestedAt?: Date;
  // Asked for by the client in their portal. A round that turns out billable is written only if they agreed
  // to the extra-round price as it is now (the count or the price may have changed since their page loaded).
  fromPortal?: { chargeAgreed: boolean; agreedPrice: Money | null };
};

function samePrice(a: Money | null, b: Money | null): boolean {
  return a === null || b === null ? a === b : a.amountMinor === b.amountMinor && a.currency === b.currency;
}

// A round the client would have to pay for, but didn't agree to.
export class RevisionChargeError extends Error {
  constructor(readonly price: Money | null) {
    super("This round is beyond the included ones.");
    this.name = "RevisionChargeError";
  }
}

export async function addRevision(
  db: Db,
  projectId: ObjectId,
  input: NewRevision,
  at: Date = now(),
): Promise<RevisionDoc | null> {
  return inTransaction(db, async (session) => {
    const project = await projects(db).findOneAndUpdate(
      { _id: projectId },
      { $inc: { revisionsUsed: 1, revisionSeq: 1 }, $set: { updatedAt: at } },
      {
        session,
        returnDocument: "after",
        projection: { clientId: 1, revisionsUsed: 1, revisionSeq: 1, revisionPolicy: 1 },
      },
    );
    if (!project) return null;
    const billable = project.revisionsUsed > project.revisionPolicy.included;
    const { extraPrice } = project.revisionPolicy;
    if (
      billable &&
      input.fromPortal &&
      !(input.fromPortal.chargeAgreed && samePrice(input.fromPortal.agreedPrice, extraPrice))
    ) {
      throw new RevisionChargeError(extraPrice);
    }
    const revision: RevisionDoc = {
      _id: new ObjectId(),
      projectId,
      clientId: project.clientId,
      number: project.revisionSeq,
      title: input.title,
      details: input.details,
      status: "open",
      billable,
      price: billable ? project.revisionPolicy.extraPrice : null,
      inquiryId: input.inquiryId ?? null,
      ...(input.fromPortal ? { fromPortal: true } : {}),
      taskId: null,
      requestedAt: input.requestedAt ?? at,
      completedAt: null,
      createdAt: at,
      updatedAt: at,
    };
    await revisions(db).insertOne(revision, { session });
    return revision;
  });
}

export async function getRevision(db: Db, id: ObjectId): Promise<RevisionDoc | null> {
  return revisions(db).findOne({ _id: id });
}

export async function listRevisions(db: Db, projectId: ObjectId): Promise<RevisionDoc[]> {
  return revisions(db).find({ projectId }).sort({ number: -1 }).limit(500).toArray();
}

export async function attachTask(db: Db, revisionId: ObjectId, taskId: ObjectId): Promise<void> {
  await revisions(db).updateOne({ _id: revisionId }, { $set: { taskId } });
}

export class CancelledRevisionError extends Error {
  constructor() {
    super("A cancelled round stays cancelled. Add a new round instead.");
    this.name = "CancelledRevisionError";
  }
}

// Cancelling gives the round back (it no longer counts); a cancelled round can't be reopened.
export async function setRevisionStatus(
  db: Db,
  id: ObjectId,
  status: RevisionStatus,
  at: Date = now(),
): Promise<RevisionDoc | null> {
  return inTransaction(db, async (session) => {
    const current = await revisions(db).findOne({ _id: id }, { session });
    if (!current) return null;
    if (current.status === status) return current;
    if (current.status === "cancelled") throw new CancelledRevisionError();
    const updated = await revisions(db).findOneAndUpdate(
      { _id: id, status: current.status },
      { $set: { status, completedAt: status === "done" ? at : null, updatedAt: at } },
      { session, returnDocument: "after" },
    );
    if (updated && status === "cancelled") {
      await projects(db).updateOne(
        { _id: current.projectId, revisionsUsed: { $gt: 0 } },
        { $inc: { revisionsUsed: -1 }, $set: { updatedAt: at } },
        { session },
      );
    }
    return updated;
  });
}

// Marks a round as included or extra by hand; an extra round takes the project's current price.
export async function setRevisionBillable(
  db: Db,
  id: ObjectId,
  billable: boolean,
  at: Date = now(),
): Promise<RevisionDoc | null> {
  const current = await revisions(db).findOne({ _id: id }, { projection: { projectId: 1 } });
  if (!current) return null;
  const project = await projects(db).findOne(
    { _id: current.projectId },
    { projection: { revisionPolicy: 1 } },
  );
  return revisions(db).findOneAndUpdate(
    { _id: id },
    {
      $set: {
        billable,
        price: billable ? (project?.revisionPolicy.extraPrice ?? null) : null,
        updatedAt: at,
      },
    },
    { returnDocument: "after" },
  );
}

export async function setRevisionPolicy(
  db: Db,
  projectId: ObjectId,
  policy: RevisionPolicy,
  at: Date = now(),
): Promise<ProjectDoc | null> {
  return projects(db).findOneAndUpdate(
    { _id: projectId },
    { $set: { revisionPolicy: policy, updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
}
