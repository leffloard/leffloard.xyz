import "server-only";
import { aiRuns } from "@/server/ai/collections";
import { deleteRunsForClient } from "@/server/ai/ledger";
import { invoices, payments, quotes } from "@/server/billing/collections";
import { portalLinks, portalSessions, privacyRequests, projectUpdates } from "@/server/portal/collections";
import { ObjectId, type ClientSession, type Db, type Document, type Filter } from "mongodb";
import type { InquiryKind } from "@/lib/intake/options";
import { DEFAULT_CURRENCY, type Currency } from "@/lib/money";
import { containsPattern, equalsIgnoringCase } from "@/lib/search";
import {
  CLIENT_STATUSES,
  CONTACT_KINDS,
  OPEN_STAGES,
  type ActivityKind,
  type ClientStatus,
} from "@/lib/work/options";
import { meetings } from "@/server/calendar/settings";
import type { MeetingStatus } from "@/server/calendar/types";
import type { ActivityDoc, ClientDoc } from "@/server/clients/types";
import { now } from "@/server/clock";
import { inTransaction } from "@/server/db/transaction";
import { inquiries } from "@/server/inquiries/store";
import type { Delivery, InquiryDoc } from "@/server/inquiries/types";
import {
  activities,
  clients,
  projects,
  revisions,
  tasks,
  timeEntries,
  type UpdateOutcome,
} from "@/server/work/collections";

// Clients: the people and companies you work for, their log, and the inbox messages linked to them.

export type ClientInput = {
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  location: string | null;
  timeZone: string | null;
  currency: Currency;
  status: ClientStatus;
  tags: string[];
  notes: string;
  source: string | null;
};

function emailKey(email: string | null): string | null {
  return email ? email.toLowerCase() : null;
}

export async function createClient(
  db: Db,
  input: ClientInput,
  options: { inquiryId?: ObjectId | null; lastContactAt?: Date | null } = {},
  at: Date = now(),
): Promise<ClientDoc> {
  const doc: ClientDoc = {
    _id: new ObjectId(),
    ...input,
    emailKey: emailKey(input.email),
    inquiryId: options.inquiryId ?? null,
    createdAt: at,
    updatedAt: at,
    lastContactAt: options.lastContactAt ?? null,
    version: 1,
  };
  await clients(db).insertOne(doc);
  return doc;
}

export async function getClient(db: Db, id: ObjectId): Promise<ClientDoc | null> {
  return clients(db).findOne({ _id: id });
}

// Saves the edit form. `version` is the one the form was opened with: a save over a newer change fails
// instead of silently undoing it.
export async function updateClient(
  db: Db,
  id: ObjectId,
  version: number,
  input: ClientInput,
  at: Date = now(),
): Promise<UpdateOutcome<ClientDoc>> {
  const doc = await clients(db).findOneAndUpdate(
    { _id: id, version },
    { $set: { ...input, emailKey: emailKey(input.email), updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
  if (doc) return { ok: true, doc };
  const exists = await clients(db).countDocuments({ _id: id }, { limit: 1 });
  return { ok: false, reason: exists ? "conflict" : "missing" };
}

export async function setClientStatus(
  db: Db,
  id: ObjectId,
  status: ClientStatus,
  at: Date = now(),
): Promise<ClientDoc | null> {
  return clients(db).findOneAndUpdate(
    { _id: id },
    { $set: { status, updatedAt: at }, $inc: { version: 1 } },
    { returnDocument: "after" },
  );
}

// Marks a client as being worked for, when a project starts. Archived clients keep their status.
export async function markActive(
  db: Db,
  id: ObjectId,
  at: Date = now(),
  session?: ClientSession,
): Promise<void> {
  await clients(db).updateOne(
    { _id: id, status: { $in: ["lead", "past"] } },
    { $set: { status: "active", updatedAt: at }, $inc: { version: 1 } },
    { session },
  );
}

export async function touchClient(
  db: Db,
  id: ObjectId,
  at: Date = now(),
  contactAt?: Date,
  session?: ClientSession,
): Promise<void> {
  await clients(db).updateOne(
    { _id: id },
    contactAt ? { $set: { updatedAt: at }, $max: { lastContactAt: contactAt } } : { $set: { updatedAt: at } },
    { session },
  );
}

// --- Lists and pickers -----------------------------------------------------------------------------------

export const CLIENT_VIEWS = ["all", ...CLIENT_STATUSES] as const;
export type ClientView = (typeof CLIENT_VIEWS)[number];

export type ClientListItem = Pick<
  ClientDoc,
  "_id" | "name" | "company" | "email" | "status" | "tags" | "lastContactAt" | "updatedAt"
> & { openProjects: number };

export type ClientQuery = { view: ClientView; q: string | null; page: number; limit: number };

const SEARCH_FIELDS = ["name", "company", "email", "tags", "location"] as const;

export async function listClients(
  db: Db,
  query: ClientQuery,
): Promise<{ items: ClientListItem[]; total: number; counts: Record<ClientView, number> }> {
  const pattern = containsPattern(query.q);
  const base: Filter<ClientDoc> = pattern
    ? { $or: SEARCH_FIELDS.map((field) => ({ [field]: pattern })) }
    : {};
  const byStatus = await clients(db)
    .aggregate<{ _id: ClientStatus; n: number }>([
      { $match: base },
      { $group: { _id: "$status", n: { $sum: 1 } } },
    ])
    .toArray();
  const counts = Object.fromEntries(CLIENT_VIEWS.map((view) => [view, 0])) as Record<ClientView, number>;
  for (const row of byStatus) counts[row._id] = row.n;
  counts.all = CLIENT_STATUSES.filter((status) => status !== "archived").reduce(
    (sum, status) => sum + counts[status],
    0,
  );

  const viewFilter: Filter<ClientDoc> =
    query.view === "all" ? { status: { $ne: "archived" } } : { status: query.view };
  const filter: Filter<ClientDoc> = { $and: [base, viewFilter] };
  const limit = Math.min(Math.max(query.limit, 1), 100);
  const page = Math.max(query.page, 1);
  const [total, items] = await Promise.all([
    clients(db).countDocuments(filter),
    clients(db)
      .aggregate<ClientListItem>([
        { $match: filter },
        { $sort: { updatedAt: -1, _id: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $lookup: {
            from: "projects",
            let: { client: "$_id" },
            pipeline: [
              { $match: { $expr: { $eq: ["$clientId", "$$client"] }, stage: { $in: OPEN_STAGES } } },
              { $count: "n" },
            ],
            as: "open",
          },
        },
        {
          $project: {
            name: 1,
            company: 1,
            email: 1,
            status: 1,
            tags: 1,
            lastContactAt: 1,
            updatedAt: 1,
            openProjects: { $ifNull: [{ $first: "$open.n" }, 0] },
          },
        },
      ] as Document[])
      .toArray(),
  ]);
  return { items, total, counts };
}

export type ClientChoice = { id: string; name: string; company: string | null };

// For selects: every client that is not archived, by name.
export async function clientChoices(db: Db): Promise<ClientChoice[]> {
  const docs = await clients(db)
    .find({ status: { $ne: "archived" } }, { projection: { name: 1, company: 1 } })
    .collation({ locale: "en", strength: 2 })
    .sort({ name: 1 })
    .limit(1000)
    .toArray();
  return docs.map((doc) => ({ id: doc._id.toHexString(), name: doc.name, company: doc.company }));
}

export async function findClientsByEmail(db: Db, email: string): Promise<ClientDoc[]> {
  return clients(db).find({ emailKey: email.toLowerCase() }).sort({ updatedAt: -1 }).limit(5).toArray();
}

// --- The client's log ------------------------------------------------------------------------------------

export async function addActivity(
  db: Db,
  input: { clientId: ObjectId; projectId: ObjectId | null; kind: ActivityKind; body: string; at: Date },
  createdAt: Date = now(),
): Promise<ActivityDoc | null> {
  const client = await clients(db).findOne({ _id: input.clientId }, { projection: { _id: 1 } });
  if (!client) return null;
  const doc: ActivityDoc = { _id: new ObjectId(), ...input, createdAt };
  await activities(db).insertOne(doc);
  await touchClient(db, input.clientId, createdAt, CONTACT_KINDS.includes(input.kind) ? input.at : undefined);
  return doc;
}

export async function deleteActivity(db: Db, id: ObjectId): Promise<boolean> {
  return (await activities(db).deleteOne({ _id: id })).deletedCount === 1;
}

// --- Inbox messages ------------------------------------------------------------------------------------------

const UNLINKED = { $or: [{ clientId: null }, { clientId: { $exists: false } }] };

// Links every message from the client's address that is not linked yet (spam aside).
async function linkMessagesFrom(db: Db, client: ClientDoc, at: Date): Promise<number> {
  if (!client.email) return 0;
  const filter: Filter<InquiryDoc> = {
    $and: [{ email: equalsIgnoringCase(client.email) }, { status: { $ne: "spam" } }, UNLINKED],
  };
  const latest = await inquiries(db)
    .find(filter, { projection: { receivedAt: 1 } })
    .sort({ receivedAt: -1 })
    .limit(1)
    .next();
  const result = await inquiries(db).updateMany(filter, { $set: { clientId: client._id } });
  if (latest) await touchClient(db, client._id, at, latest.receivedAt);
  return result.modifiedCount;
}

// A new client from an inbox message: the sender's details, linked to their messages.
export async function createClientFromInquiry(
  db: Db,
  inquiry: InquiryDoc,
  at: Date = now(),
): Promise<ClientDoc> {
  const client = await createClient(
    db,
    {
      name: inquiry.name,
      company: inquiry.company,
      email: inquiry.email,
      phone: null,
      website: null,
      location: null,
      timeZone: inquiry.call?.timeZone ?? null,
      currency: DEFAULT_CURRENCY,
      status: "lead",
      tags: [],
      notes: inquiry.contact ? `Other contact: ${inquiry.contact}` : "",
      source: "Contact form",
    },
    { inquiryId: inquiry._id, lastContactAt: inquiry.receivedAt },
    at,
  );
  await inquiries(db).updateOne({ _id: inquiry._id }, { $set: { clientId: client._id } });
  await linkMessagesFrom(db, client, at);
  return client;
}

export async function linkInquiry(
  db: Db,
  inquiryId: ObjectId,
  clientId: ObjectId,
  at: Date = now(),
): Promise<InquiryDoc | null> {
  const client = await clients(db).findOne({ _id: clientId }, { projection: { _id: 1 } });
  if (!client) return null;
  const inquiry = await inquiries(db).findOneAndUpdate(
    { _id: inquiryId },
    { $set: { clientId } },
    { returnDocument: "after" },
  );
  if (inquiry) await touchClient(db, clientId, at, inquiry.receivedAt);
  return inquiry;
}

export async function unlinkInquiry(db: Db, inquiryId: ObjectId): Promise<boolean> {
  return (await inquiries(db).updateOne({ _id: inquiryId }, { $set: { clientId: null } })).matchedCount === 1;
}

// A new message from a known client's address is linked as it arrives. Two clients with the same
// address are left for the owner to choose.
export async function linkToKnownClient(db: Db, inquiry: InquiryDoc): Promise<ObjectId | null> {
  if (inquiry.status === "spam") return null;
  const matches = await clients(db)
    .find({ emailKey: inquiry.email.toLowerCase() }, { projection: { _id: 1 } })
    .limit(2)
    .toArray();
  if (matches.length !== 1) return null;
  const clientId = matches[0]!._id;
  await inquiries(db).updateOne({ _id: inquiry._id }, { $set: { clientId } });
  await touchClient(db, clientId, inquiry.receivedAt, inquiry.receivedAt);
  return clientId;
}

export type LinkedMessage = Pick<InquiryDoc, "_id" | "ref" | "kind" | "status" | "subject" | "receivedAt">;

export async function linkedInquiries(db: Db, clientId: ObjectId, limit = 50): Promise<LinkedMessage[]> {
  return inquiries(db)
    .find({ clientId }, { projection: { ref: 1, kind: 1, status: 1, subject: 1, receivedAt: 1 } })
    .sort({ receivedAt: -1 })
    .limit(limit)
    .toArray();
}

// --- Timeline ------------------------------------------------------------------------------------------------

export type TimelineEntry =
  | { type: "activity"; at: Date; id: string; kind: ActivityKind; body: string; projectId: string | null }
  | { type: "message"; at: Date; id: string; ref: string; subject: string; kind: InquiryKind }
  | { type: "email"; at: Date; inquiryId: string; subject: string; delivery: Delivery }
  | { type: "project"; at: Date; id: string; ref: string; title: string; event: "started" | "delivered" }
  | {
      type: "revision";
      at: Date;
      projectId: string;
      projectRef: string;
      number: number;
      title: string;
    }
  | { type: "meeting"; at: Date; id: string; title: string; status: MeetingStatus };

// Everything that happened with a client, newest first.
export async function clientTimeline(db: Db, clientId: ObjectId, limit = 100): Promise<TimelineEntry[]> {
  const [activityDocs, messageDocs, projectDocs, revisionDocs, meetingDocs] = await Promise.all([
    activities(db).find({ clientId }).sort({ at: -1 }).limit(limit).toArray(),
    inquiries(db)
      .find({ clientId }, { projection: { ref: 1, kind: 1, subject: 1, receivedAt: 1, replies: 1 } })
      .sort({ receivedAt: -1 })
      .limit(limit)
      .toArray(),
    projects(db)
      .find({ clientId }, { projection: { ref: 1, title: 1, createdAt: 1, deliveredAt: 1 } })
      .toArray(),
    revisions(db)
      .find({ clientId }, { projection: { projectId: 1, number: 1, title: 1, requestedAt: 1 } })
      .sort({ requestedAt: -1 })
      .limit(limit)
      .toArray(),
    meetings(db)
      .find({ clientId }, { projection: { title: 1, startsAt: 1, status: 1 } })
      .sort({ startsAt: -1 })
      .limit(limit)
      .toArray(),
  ]);
  const refs = new Map(projectDocs.map((project) => [project._id.toHexString(), project.ref]));
  const entries: TimelineEntry[] = [];
  for (const activity of activityDocs) {
    entries.push({
      type: "activity",
      at: activity.at,
      id: activity._id.toHexString(),
      kind: activity.kind,
      body: activity.body,
      projectId: activity.projectId?.toHexString() ?? null,
    });
  }
  for (const message of messageDocs) {
    const id = message._id.toHexString();
    entries.push({
      type: "message",
      at: message.receivedAt,
      id,
      ref: message.ref,
      subject: message.subject,
      kind: message.kind,
    });
    for (const reply of message.replies ?? []) {
      entries.push({
        type: "email",
        at: reply.createdAt,
        inquiryId: id,
        subject: reply.kind === "reply" ? reply.subject : `Status email: ${reply.subject}`,
        delivery: reply.delivery,
      });
    }
  }
  for (const project of projectDocs) {
    const id = project._id.toHexString();
    entries.push({
      type: "project",
      at: project.createdAt,
      id,
      ref: project.ref,
      title: project.title,
      event: "started",
    });
    if (project.deliveredAt) {
      entries.push({
        type: "project",
        at: project.deliveredAt,
        id,
        ref: project.ref,
        title: project.title,
        event: "delivered",
      });
    }
  }
  for (const revision of revisionDocs) {
    const projectId = revision.projectId.toHexString();
    entries.push({
      type: "revision",
      at: revision.requestedAt,
      projectId,
      projectRef: refs.get(projectId) ?? "",
      number: revision.number,
      title: revision.title,
    });
  }
  for (const meeting of meetingDocs) {
    // Placed at the meeting's time, so the next call sits at the top.
    entries.push({
      type: "meeting",
      at: meeting.startsAt,
      id: meeting._id.toHexString(),
      title: meeting.title,
      status: meeting.status,
    });
  }
  return entries.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
}

// --- Privacy: export and delete ----------------------------------------------------------------------------

// Everything stored about a client, for a copy on request or before deleting.
export async function exportClient(db: Db, clientId: ObjectId, at: Date = now()) {
  const client = await clients(db).findOne({ _id: clientId }, { projection: { emailKey: 0, version: 0 } });
  if (!client) return null;
  const projectDocs = await projects(db)
    .find({ clientId }, { projection: { rank: 0, version: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
  const inProject = {
    $or: [{ clientId }, { projectId: { $in: projectDocs.map((project) => project._id) } }],
  };
  const [
    revisionDocs,
    taskDocs,
    timeDocs,
    activityDocs,
    messageDocs,
    meetingDocs,
    updateDocs,
    requestDocs,
    sessionDocs,
    quoteDocs,
    invoiceDocs,
  ] = await Promise.all([
    revisions(db).find(inProject).sort({ requestedAt: 1 }).toArray(),
    tasks(db)
      .find(inProject, { projection: { rank: 0 } })
      .sort({ createdAt: 1 })
      .toArray(),
    timeEntries(db).find(inProject).sort({ startedAt: 1 }).toArray(),
    activities(db).find({ clientId }).sort({ at: 1 }).toArray(),
    inquiries(db)
      .find({ clientId }, { projection: { purgeAt: 0 } })
      .sort({ receivedAt: 1 })
      .toArray(),
    // Without the secrets of their manage links.
    meetings(db)
      .find({ clientId }, { projection: { manageTokenHash: 0, manageTokenSealed: 0, purgeAt: 0 } })
      .sort({ startsAt: 1 })
      .toArray(),
    projectUpdates(db).find(inProject).sort({ createdAt: 1 }).toArray(),
    privacyRequests(db).find({ clientId }).sort({ createdAt: 1 }).toArray(),
    // Where they are signed in to the portal, without the sessions' keys.
    portalSessions(db)
      .find({ clientId }, { projection: { _id: 0, clientId: 0 } })
      .sort({ createdAt: 1 })
      .toArray(),
    quotes(db)
      .find({ clientId, status: { $ne: "draft" } }, { projection: { publicId: 0 } })
      .sort({ createdAt: 1 })
      .toArray(),
    invoices(db)
      .find({ clientId, status: { $ne: "draft" } }, { projection: { publicId: 0 } })
      .sort({ createdAt: 1 })
      .toArray(),
  ]);
  // Drafts the AI assistant wrote (kept 90 days): about them, their messages and their meetings.
  const aiDocs = await aiRuns(db)
    .find(
      {
        $or: [
          { clientId },
          { "target.kind": "inquiry", "target.id": { $in: messageDocs.map((message) => message._id) } },
          { "target.kind": "meeting", "target.id": { $in: meetingDocs.map((meeting) => meeting._id) } },
        ],
      },
      { projection: { feature: 1, status: 1, output: 1, createdAt: 1 } },
    )
    .sort({ createdAt: 1 })
    .toArray();
  const paymentDocs = await payments(db)
    .find({ invoiceId: { $in: invoiceDocs.map((invoice) => invoice._id) } }, { projection: { provider: 0 } })
    .sort({ createdAt: 1 })
    .toArray();
  return {
    exportedAt: at.toISOString(),
    client,
    projects: projectDocs,
    revisions: revisionDocs,
    tasks: taskDocs,
    timeEntries: timeDocs,
    log: activityDocs,
    messages: messageDocs,
    meetings: meetingDocs,
    projectUpdates: updateDocs,
    dataRequests: requestDocs,
    portalSessions: sessionDocs,
    quotes: quoteDocs,
    invoices: invoiceDocs,
    payments: paymentDocs,
    aiDrafts: aiDocs,
  };
}

export type DeletedClient = {
  projects: number;
  revisions: number;
  tasks: number;
  timeEntries: number;
  log: number;
  messagesUnlinked: number;
  meetingsUnlinked: number;
  portal: number; // sessions, sign-in links and project updates
  dataRequests: number; // answered by this deletion; the audit log keeps the record
  aiDrafts: number;
};

// Deletes a client with their projects, revision rounds, tasks, time, log, portal and the AI drafts that
// used their record, all or nothing. Their inbox messages and meetings stay (they follow their own
// retention, with the AI drafts about them) but are no longer linked; quotes, invoices and payments stay as
// tax law requires.
export async function deleteClient(db: Db, clientId: ObjectId): Promise<DeletedClient | null> {
  return inTransaction(db, async (session) => {
    const client = await clients(db).findOne({ _id: clientId }, { session, projection: { _id: 1 } });
    if (!client) return null;
    const projectIds = (
      await projects(db)
        .find({ clientId }, { session, projection: { _id: 1 } })
        .toArray()
    ).map((project) => project._id);
    const inProject = { $or: [{ clientId }, { projectId: { $in: projectIds } }] };
    const deleted: DeletedClient = {
      projects: (await projects(db).deleteMany({ clientId }, { session })).deletedCount,
      revisions: (await revisions(db).deleteMany(inProject, { session })).deletedCount,
      tasks: (await tasks(db).deleteMany(inProject, { session })).deletedCount,
      timeEntries: (await timeEntries(db).deleteMany(inProject, { session })).deletedCount,
      log: (await activities(db).deleteMany({ clientId }, { session })).deletedCount,
      messagesUnlinked: (
        await inquiries(db).updateMany({ clientId }, { $set: { clientId: null } }, { session })
      ).modifiedCount,
      meetingsUnlinked: (
        await meetings(db).updateMany({ clientId }, { $set: { clientId: null } }, { session })
      ).modifiedCount,
      portal:
        (await portalSessions(db).deleteMany({ clientId }, { session })).deletedCount +
        (await portalLinks(db).deleteMany({ clientId }, { session })).deletedCount +
        (await projectUpdates(db).deleteMany(inProject, { session })).deletedCount,
      dataRequests: (await privacyRequests(db).deleteMany({ clientId }, { session })).deletedCount,
      aiDrafts: await deleteRunsForClient(db, clientId, session),
    };
    await clients(db).deleteOne({ _id: clientId }, { session });
    return deleted;
  });
}
