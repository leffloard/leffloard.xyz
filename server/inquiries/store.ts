import "server-only";
import { randomUUID } from "node:crypto";
import { ObjectId, type Db, type Document, type Filter } from "mongodb";
import type { InquiryInput } from "@/lib/intake/form";
import { INQUIRY_STATUSES, type InquiryKind, type InquiryStatus } from "@/lib/intake/options";
import { escapeRegex } from "@/lib/search";
import { now } from "@/server/clock";
import type { InquiryDoc, InquirySource, ReplyEntry, StatusChange } from "@/server/inquiries/types";

// Reading and changing inquiries. The only module that queries the collection; pages and actions call
// these functions with validated values.

export const RETENTION_MS = 730 * 24 * 3600_000; // 24 months, as the privacy notice says
export const SPAM_RETENTION_MS = 30 * 24 * 3600_000;
const ACTIVE: InquiryStatus[] = ["new", "open", "confirmed"];

export function inquiries(db: Db) {
  return db.collection<InquiryDoc>("inquiries");
}

export function purgeDate(status: InquiryStatus, at: Date): Date {
  return new Date(at.getTime() + (status === "spam" ? SPAM_RETENTION_MS : RETENTION_MS));
}

export function parseInquiryId(id: string): ObjectId | null {
  return /^[a-f0-9]{24}$/.test(id) ? new ObjectId(id) : null;
}

// "INQ-2026-0007": numbered per year of receipt.
export async function nextRef(db: Db, at: Date): Promise<string> {
  const year = at.getUTCFullYear();
  const counter = await db
    .collection<{ _id: string; seq: number }>("counters")
    .findOneAndUpdate(
      { _id: `inquiry-${year}` },
      { $inc: { seq: 1 } },
      { upsert: true, returnDocument: "after" },
    );
  return `INQ-${year}-${String(counter?.seq ?? 1).padStart(4, "0")}`;
}

export type InsertOptions = {
  source: InquirySource;
  status?: InquiryStatus;
  receivedAt?: Date;
  updatedAt?: Date;
  publicId?: string;
  legacyId?: string;
  note?: string;
  history?: StatusChange[];
  scheduledAt?: Date | null;
};

export function buildInquiry(input: InquiryInput, ref: string, options: InsertOptions): InquiryDoc {
  const receivedAt = options.receivedAt ?? now();
  const updatedAt = options.updatedAt ?? receivedAt;
  const status = options.status ?? "new";
  const doc: InquiryDoc = {
    _id: new ObjectId(),
    publicId: options.publicId ?? randomUUID(),
    ref,
    kind: input.kind,
    status,
    source: options.source,
    name: input.name,
    email: input.email,
    contact: input.contact,
    company: input.company,
    service: input.service,
    subject: input.subject,
    message: input.message,
    budget: input.budget,
    timeline: input.timeline,
    links: input.links,
    projectReference: input.projectReference,
    call: input.call,
    scheduledAt: options.scheduledAt ?? null,
    aiOptOut: input.aiOptOut,
    note: options.note ?? "",
    labels: [],
    snoozedUntil: null,
    history: options.history ?? [],
    replies: [],
    receivedAt,
    updatedAt,
    lastActivityAt: updatedAt,
    purgeAt: purgeDate(status, updatedAt),
  };
  if (options.legacyId) doc.legacyId = options.legacyId;
  return doc;
}

export async function insertInquiry(
  db: Db,
  input: InquiryInput,
  options: InsertOptions,
): Promise<InquiryDoc> {
  const receivedAt = options.receivedAt ?? now();
  const doc = buildInquiry(input, await nextRef(db, receivedAt), { ...options, receivedAt });
  await inquiries(db).insertOne(doc);
  return doc;
}

export async function getInquiry(db: Db, id: ObjectId): Promise<InquiryDoc | null> {
  return inquiries(db).findOne({ _id: id });
}

// --- The inbox list ---------------------------------------------------------------------------------------

export const INBOX_VIEWS = [
  "inbox",
  "new",
  "open",
  "confirmed",
  "snoozed",
  "done",
  "declined",
  "spam",
  "all",
] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

export type InboxQuery = {
  view: InboxView;
  kind: InquiryKind | null;
  q: string | null;
  page: number;
  limit: number;
};

export type InboxItem = Pick<
  InquiryDoc,
  "_id" | "ref" | "kind" | "status" | "name" | "email" | "subject" | "labels" | "receivedAt" | "snoozedUntil"
> & { snippet: string; replyCount: number };

export type InboxCounts = Record<InboxView, number>;

export { escapeRegex };

const SEARCH_FIELDS = ["name", "email", "subject", "projectReference", "company", "ref"] as const;

function viewFilter(view: InboxView, at: Date): Filter<InquiryDoc> {
  const awake = { $or: [{ snoozedUntil: null }, { snoozedUntil: { $lte: at } }] };
  switch (view) {
    case "inbox":
      return { status: { $in: ACTIVE }, ...awake };
    case "snoozed":
      return { status: { $in: ACTIVE }, snoozedUntil: { $gt: at } };
    case "all":
      return { status: { $ne: "spam" } };
    default:
      return { status: view };
  }
}

export async function listInquiries(
  db: Db,
  query: InboxQuery,
  at: Date = now(),
): Promise<{ items: InboxItem[]; total: number; counts: InboxCounts }> {
  const base: Filter<InquiryDoc> = {};
  if (query.kind) base.kind = query.kind;
  const search = query.q?.trim().slice(0, 200);
  if (search) {
    const pattern = { $regex: escapeRegex(search), $options: "i" };
    base.$or = SEARCH_FIELDS.map((field) => ({ [field]: pattern }));
  }

  const [facets] = await inquiries(db)
    .aggregate<{
      byStatus: { _id: InquiryStatus; count: number }[];
      inbox: { n: number }[];
      snoozed: { n: number }[];
    }>([
      { $match: base },
      {
        $facet: {
          byStatus: [{ $group: { _id: "$status", count: { $sum: 1 } } }],
          inbox: [{ $match: viewFilter("inbox", at) }, { $count: "n" }],
          snoozed: [{ $match: viewFilter("snoozed", at) }, { $count: "n" }],
        },
      },
    ] as Document[])
    .toArray();
  const counts = Object.fromEntries(INBOX_VIEWS.map((view) => [view, 0])) as InboxCounts;
  for (const row of facets?.byStatus ?? []) {
    if ((INQUIRY_STATUSES as readonly string[]).includes(row._id)) counts[row._id] = row.count;
  }
  counts.inbox = facets?.inbox[0]?.n ?? 0;
  counts.snoozed = facets?.snoozed[0]?.n ?? 0;
  counts.all = INQUIRY_STATUSES.filter((status) => status !== "spam").reduce(
    (sum, status) => sum + counts[status],
    0,
  );

  // $and, because the search and the view may both use $or.
  const filter: Filter<InquiryDoc> = { $and: [base, viewFilter(query.view, at)] };
  const limit = Math.min(Math.max(query.limit, 1), 100);
  const page = Math.max(query.page, 1);
  const [total, items] = await Promise.all([
    inquiries(db).countDocuments(filter),
    inquiries(db)
      .aggregate<InboxItem>([
        { $match: filter },
        { $sort: { receivedAt: -1, _id: -1 } },
        { $skip: (page - 1) * limit },
        { $limit: limit },
        {
          $project: {
            ref: 1,
            kind: 1,
            status: 1,
            name: 1,
            email: 1,
            subject: 1,
            labels: 1,
            receivedAt: 1,
            snoozedUntil: 1,
            snippet: { $substrCP: ["$message", 0, 160] },
            replyCount: { $size: { $ifNull: ["$replies", []] } },
          },
        },
      ] as Document[])
      .toArray(),
  ]);
  return { items, total, counts };
}

export async function countNew(db: Db): Promise<number> {
  return inquiries(db).countDocuments({ status: "new" });
}

export async function latestInquiries(db: Db, limit = 5, at: Date = now()): Promise<InboxItem[]> {
  return (await listInquiries(db, { view: "inbox", kind: null, q: null, page: 1, limit }, at)).items;
}

// --- Changes -------------------------------------------------------------------------------------------------

function touch(status: InquiryStatus, at: Date) {
  return { updatedAt: at, lastActivityAt: at, purgeAt: purgeDate(status, at) };
}

// Records the change in the history. Returns the updated inquiry, or null when it does not exist.
export async function changeStatus(
  db: Db,
  id: ObjectId,
  status: InquiryStatus,
  at: Date = now(),
): Promise<InquiryDoc | null> {
  const current = await getInquiry(db, id);
  if (!current || current.status === status) return current;
  const updated = await inquiries(db).findOneAndUpdate(
    { _id: id, status: current.status },
    {
      $set: { status, ...touch(status, at) },
      $push: { history: { at, status, from: current.status } },
    },
    { returnDocument: "after" },
  );
  // Someone else changed it at the same moment: theirs stands, and the caller sees it.
  return updated ?? getInquiry(db, id);
}

export async function setNote(
  db: Db,
  id: ObjectId,
  note: string,
  at: Date = now(),
): Promise<InquiryDoc | null> {
  return inquiries(db).findOneAndUpdate(
    { _id: id },
    { $set: { note, updatedAt: at } },
    { returnDocument: "after" },
  );
}

export async function setLabels(
  db: Db,
  id: ObjectId,
  labels: string[],
  at: Date = now(),
): Promise<InquiryDoc | null> {
  return inquiries(db).findOneAndUpdate(
    { _id: id },
    { $set: { labels, updatedAt: at } },
    { returnDocument: "after" },
  );
}

export async function snooze(
  db: Db,
  id: ObjectId,
  until: Date | null,
  at: Date = now(),
): Promise<InquiryDoc | null> {
  return inquiries(db).findOneAndUpdate(
    { _id: id },
    { $set: { snoozedUntil: until, updatedAt: at } },
    { returnDocument: "after" },
  );
}

export class NotACallError extends Error {
  constructor() {
    super("Only call requests can be scheduled.");
    this.name = "NotACallError";
  }
}

export async function setSchedule(
  db: Db,
  id: ObjectId,
  scheduledAt: Date | null,
  at: Date = now(),
): Promise<InquiryDoc | null> {
  const current = await getInquiry(db, id);
  if (!current) return null;
  if (scheduledAt && current.kind !== "call") throw new NotACallError();
  return inquiries(db).findOneAndUpdate(
    { _id: id },
    { $set: { scheduledAt, ...touch(current.status, at) } },
    { returnDocument: "after" },
  );
}

export async function addReply(db: Db, id: ObjectId, reply: ReplyEntry): Promise<InquiryDoc | null> {
  const current = await getInquiry(db, id);
  if (!current) return null;
  return inquiries(db).findOneAndUpdate(
    { _id: id },
    { $push: { replies: reply }, $set: touch(current.status, reply.createdAt) },
    { returnDocument: "after" },
  );
}

export async function deleteInquiry(db: Db, id: ObjectId): Promise<boolean> {
  const result = await inquiries(db).deleteOne({ _id: id });
  return result.deletedCount === 1;
}

export async function listLabels(db: Db): Promise<string[]> {
  const labels = await inquiries(db).distinct("labels");
  return (labels as string[]).sort();
}
