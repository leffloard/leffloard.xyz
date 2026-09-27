import "server-only";
import { ObjectId, type Db } from "mongodb";
import { now } from "@/server/clock";
import type { AuditAction, AuditDoc } from "@/server/auth/types";
import { log } from "@/server/log";

export type AuditInput = {
  action: AuditAction;
  actorId?: ObjectId | null;
  ip?: string;
  userAgent?: string;
  details?: AuditDoc["details"];
};

// Security-relevant events, kept in the database for the admin's activity page. Never pass secrets.
export async function audit(db: Db, input: AuditInput): Promise<void> {
  const doc: AuditDoc = {
    _id: new ObjectId(),
    at: now(),
    action: input.action,
    actorId: input.actorId ?? null,
    ip: input.ip ?? "unknown",
    userAgent: (input.userAgent ?? "").slice(0, 300),
    details: input.details ?? {},
  };
  try {
    await db.collection<AuditDoc>("audit_log").insertOne(doc);
  } catch (error) {
    // The event still reaches the log file; the action it describes should not fail because of it.
    log.error({ err: error, action: doc.action }, "audit log write failed");
  }
  if (doc.action === "auth.login.locked" || doc.action === "auth.access.denied") {
    log.warn({ action: doc.action, ip: doc.ip, details: doc.details }, "security event");
  }
}

export async function recentAudit(
  db: Db,
  { limit = 50, before, prefix }: { limit?: number; before?: Date; prefix?: string } = {},
): Promise<AuditDoc[]> {
  const filter: Record<string, unknown> = {};
  if (before) filter.at = { $lt: before };
  if (prefix) filter.action = { $regex: `^${prefix.replace(/[^a-z_.]/g, "").replaceAll(".", "\\.")}` };
  return db
    .collection<AuditDoc>("audit_log")
    .find(filter)
    .sort({ at: -1 })
    .limit(Math.min(Math.max(limit, 1), 200))
    .toArray();
}
