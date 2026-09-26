import "server-only";
import { MongoServerError, ObjectId, type Db } from "mongodb";
import { now } from "@/server/clock";
import { privacyRequests } from "@/server/portal/collections";
import type { PrivacyRequestDoc, PrivacyRequestKind } from "@/server/portal/types";
import { clients } from "@/server/work/collections";

// Clients' data requests from the portal: a copy of their data, or its deletion. One open request of each kind
// per client (a unique index); the owner answers within 30 days (see the privacy notice) and marks it done.

const DUPLICATE_KEY = 11000;

export async function requestPrivacyAction(
  db: Db,
  clientId: ObjectId,
  kind: PrivacyRequestKind,
  note: string,
  at: Date = now(),
): Promise<{ request: PrivacyRequestDoc; created: boolean }> {
  const doc: PrivacyRequestDoc = {
    _id: new ObjectId(),
    clientId,
    kind,
    note,
    status: "open",
    createdAt: at,
    resolvedAt: null,
    resolution: null,
  };
  try {
    await privacyRequests(db).insertOne(doc);
    return { request: doc, created: true };
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
    const open = await privacyRequests(db).findOne({ clientId, kind, status: "open" });
    if (!open) throw error;
    return { request: open, created: false };
  }
}

export async function resolvePrivacyRequest(
  db: Db,
  id: ObjectId,
  status: "done" | "declined",
  resolution: string,
  at: Date = now(),
): Promise<PrivacyRequestDoc | null> {
  return privacyRequests(db).findOneAndUpdate(
    { _id: id, status: "open" },
    { $set: { status, resolution, resolvedAt: at } },
    { returnDocument: "after" },
  );
}

export async function privacyRequestsFor(db: Db, clientId: ObjectId): Promise<PrivacyRequestDoc[]> {
  return privacyRequests(db).find({ clientId }).sort({ createdAt: -1 }).limit(50).toArray();
}

export const ANSWER_WITHIN_DAYS = 30;

export type OpenPrivacyRequest = {
  id: string;
  clientId: string;
  clientName: string;
  kind: PrivacyRequestKind;
  answerBy: Date; // 30 days after it was made (KVKK Article 13)
};

// The requests waiting for an answer, oldest first, with their clients' names (for Today).
export async function openPrivacyRequests(db: Db, limit = 20): Promise<OpenPrivacyRequest[]> {
  const docs = await privacyRequests(db)
    .find({ status: "open" })
    .sort({ createdAt: 1 })
    .limit(limit)
    .toArray();
  if (!docs.length) return [];
  const names = new Map(
    (
      await clients(db)
        .find({ _id: { $in: docs.map((doc) => doc.clientId) } }, { projection: { name: 1 } })
        .toArray()
    ).map((client) => [client._id.toHexString(), client.name]),
  );
  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    clientId: doc.clientId.toHexString(),
    clientName: names.get(doc.clientId.toHexString()) ?? "A deleted client",
    kind: doc.kind,
    answerBy: new Date(doc.createdAt.getTime() + ANSWER_WITHIN_DAYS * 86_400_000),
  }));
}
