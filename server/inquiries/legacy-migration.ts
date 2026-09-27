import "server-only";
import type { Db } from "mongodb";
import type { InquiryStatus } from "@/lib/intake/options";
import { legacyToInquiryInput, LEGACY_TYPES, type LegacyRequest, type LegacyType } from "@/lib/intake/legacy";
import { buildInquiry, inquiries, nextRef } from "@/server/inquiries/store";
import type { InquiryDoc, StatusChange } from "@/server/inquiries/types";

// Copies the v1 backend's `requests` collection into the inbox. The v1 collection is only read, never
// changed, so going back to v1 stays possible. Each request keeps its v1 id (as legacyId and publicId); a
// unique index on legacyId means running the copy again adds only what is new.

export type LegacyDoc = {
  id?: unknown;
  type?: unknown;
  name?: unknown;
  email?: unknown;
  contact_handle?: unknown;
  service?: unknown;
  subject?: unknown;
  message?: unknown;
  project_reference?: unknown;
  timezone?: unknown;
  preferred_date?: unknown;
  preferred_time?: unknown;
  duration_minutes?: unknown;
  status?: unknown;
  created_at?: unknown;
  updated_at?: unknown;
  admin_note?: unknown;
  scheduled_at?: unknown;
  history?: unknown;
};

const STATUS_MAP: Record<string, InquiryStatus> = {
  new: "new",
  confirmed: "confirmed",
  declined: "declined",
  completed: "done",
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value : null);

function date(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// The copy gets its reference number (ref) only when it is inserted.
export type Mapped =
  { ok: true; doc: InquiryDoc & { legacyId: string } } | { ok: false; id: string; problem: string };

// v1 documents were validated when they were stored, so this only checks what the inbox relies on.
export function mapLegacyDoc(source: LegacyDoc): Mapped {
  const id = text(source.id);
  if (!id) return { ok: false, id: "(no id)", problem: "has no id" };
  const type = source.type as LegacyType;
  if (!(LEGACY_TYPES as readonly unknown[]).includes(type))
    return { ok: false, id, problem: "has an unknown type" };
  const name = text(source.name);
  const email = text(source.email);
  const subject = text(source.subject);
  const message = text(source.message);
  const receivedAt = date(source.created_at);
  if (!name || !email || !subject || !message || !receivedAt) {
    return { ok: false, id, problem: "misses a name, email, subject, message or date" };
  }
  const status = STATUS_MAP[typeof source.status === "string" ? source.status : ""] ?? "new";
  const request: LegacyRequest = {
    type,
    name,
    email,
    contact_handle: text(source.contact_handle),
    service: text(source.service),
    subject,
    message,
    project_reference: text(source.project_reference),
    timezone: text(source.timezone),
    preferred_date: text(source.preferred_date),
    preferred_time: text(source.preferred_time),
    duration_minutes: typeof source.duration_minutes === "number" ? source.duration_minutes : null,
  };
  const history: StatusChange[] = Array.isArray(source.history)
    ? source.history.flatMap((entry: { status?: unknown; from?: unknown; at?: unknown }) => {
        const to = STATUS_MAP[String(entry?.status)];
        const from = STATUS_MAP[String(entry?.from)];
        const at = date(entry?.at);
        return to && from && at ? [{ at, status: to, from }] : [];
      })
    : [];
  const doc = buildInquiry(legacyToInquiryInput(request), "", {
    source: "legacy-import",
    status,
    receivedAt,
    updatedAt: date(source.updated_at) ?? receivedAt,
    publicId: id,
    legacyId: id,
    note: typeof source.admin_note === "string" ? source.admin_note : "",
    history,
    scheduledAt: date(source.scheduled_at),
  });
  return { ok: true, doc: { ...doc, legacyId: id } };
}

export type MigrationReport = {
  total: number;
  alreadyCopied: number;
  toCopy: number;
  copied: number;
  problems: { id: string; problem: string }[];
  byType: Record<string, number>;
  byStatus: Record<string, number>;
};

function emptyReport(): MigrationReport {
  return { total: 0, alreadyCopied: 0, toCopy: 0, copied: 0, problems: [], byType: {}, byStatus: {} };
}

// dry run: reports what would be copied, and writes nothing.
export async function migrateLegacy(db: Db, { apply }: { apply: boolean }): Promise<MigrationReport> {
  const report = emptyReport();
  const existing = new Set(
    (
      await inquiries(db)
        .find({ legacyId: { $exists: true } }, { projection: { legacyId: 1 } })
        .toArray()
    ).map((doc) => doc.legacyId),
  );
  const cursor = db
    .collection<LegacyDoc>("requests")
    .find({}, { projection: { _id: 0 } })
    .sort({ created_at: 1 });
  for await (const source of cursor) {
    report.total++;
    const mapped = mapLegacyDoc(source);
    if (!mapped.ok) {
      report.problems.push({ id: mapped.id, problem: mapped.problem });
      continue;
    }
    report.byType[mapped.doc.kind] = (report.byType[mapped.doc.kind] ?? 0) + 1;
    report.byStatus[mapped.doc.status] = (report.byStatus[mapped.doc.status] ?? 0) + 1;
    if (existing.has(mapped.doc.legacyId)) {
      report.alreadyCopied++;
      continue;
    }
    report.toCopy++;
    if (!apply) continue;
    const ref = await nextRef(db, mapped.doc.receivedAt);
    const result = await inquiries(db).updateOne(
      { legacyId: mapped.doc.legacyId },
      { $setOnInsert: { ...mapped.doc, ref } },
      { upsert: true },
    );
    if (result.upsertedCount === 1) report.copied++;
    else report.alreadyCopied++;
    existing.add(mapped.doc.legacyId);
  }
  return report;
}

export type VerifyReport = {
  total: number;
  matched: number;
  missing: string[];
  different: { id: string; fields: string[] }[];
};

// Every v1 request has a copy, with the same person, text and date.
export async function verifyLegacy(db: Db): Promise<VerifyReport> {
  const report: VerifyReport = { total: 0, matched: 0, missing: [], different: [] };
  const cursor = db.collection<LegacyDoc>("requests").find({}, { projection: { _id: 0 } });
  for await (const source of cursor) {
    report.total++;
    const mapped = mapLegacyDoc(source);
    if (!mapped.ok) continue;
    const copy = await inquiries(db).findOne({ legacyId: mapped.doc.legacyId });
    if (!copy) {
      report.missing.push(mapped.doc.legacyId);
      continue;
    }
    const fields: string[] = (["name", "email", "subject", "message", "kind"] as const).filter(
      (field) => copy[field] !== mapped.doc[field],
    );
    if (copy.receivedAt.getTime() !== mapped.doc.receivedAt.getTime()) fields.push("receivedAt");
    if (fields.length) report.different.push({ id: mapped.doc.legacyId, fields });
    else report.matched++;
  }
  return report;
}
