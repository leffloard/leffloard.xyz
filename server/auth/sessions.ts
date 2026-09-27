import "server-only";
import type { Db, ObjectId } from "mongodb";
import { now } from "@/server/clock";
import type { AuthMethod, SessionDoc } from "@/server/auth/types";
import { randomToken, sha256Hex } from "@/server/security/crypto";

export const SESSION_IDLE_MS = 30 * 60_000;
export const SESSION_MAX_MS = 12 * 60 * 60_000;
export const SUDO_MS = 10 * 60_000;
const TOUCH_EVERY_MS = 60_000;

export function sessions(db: Db) {
  return db.collection<SessionDoc>("sessions");
}

export async function createSession(
  db: Db,
  input: { userId: ObjectId; ip: string; userAgent: string; methods: AuthMethod[] },
): Promise<{ token: string; session: SessionDoc }> {
  const token = randomToken();
  const at = now();
  const session: SessionDoc = {
    _id: sha256Hex(token),
    userId: input.userId,
    createdAt: at,
    lastSeenAt: at,
    expiresAt: new Date(at.getTime() + SESSION_MAX_MS),
    // Signing in counts as confirming it's you for the next few minutes.
    sudoUntil: new Date(at.getTime() + SUDO_MS),
    ip: input.ip,
    userAgent: input.userAgent.slice(0, 300),
    methods: input.methods,
  };
  await sessions(db).insertOne(session);
  return { token, session };
}

// The session for a cookie token, if it is still valid: under 12 hours old and used in the last 30 minutes.
export async function findValidSession(db: Db, token: string | undefined): Promise<SessionDoc | null> {
  if (!token || token.length > 100) return null;
  const at = now();
  const session = await sessions(db).findOne({
    _id: sha256Hex(token),
    expiresAt: { $gt: at },
    lastSeenAt: { $gt: new Date(at.getTime() - SESSION_IDLE_MS) },
  });
  if (session && at.getTime() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await sessions(db).updateOne({ _id: session._id }, { $set: { lastSeenAt: at } });
    session.lastSeenAt = at;
  }
  return session;
}

export function hasSudo(session: Pick<SessionDoc, "sudoUntil">): boolean {
  return session.sudoUntil !== null && session.sudoUntil > now();
}

export async function grantSudo(db: Db, sessionId: string): Promise<Date> {
  const until = new Date(now().getTime() + SUDO_MS);
  await sessions(db).updateOne({ _id: sessionId }, { $set: { sudoUntil: until } });
  return until;
}

export async function listSessions(db: Db, userId: ObjectId): Promise<SessionDoc[]> {
  const at = now();
  return sessions(db)
    .find({
      userId,
      expiresAt: { $gt: at },
      lastSeenAt: { $gt: new Date(at.getTime() - SESSION_IDLE_MS) },
    })
    .sort({ lastSeenAt: -1 })
    .toArray();
}

export async function revokeSession(db: Db, userId: ObjectId, sessionId: string): Promise<boolean> {
  const result = await sessions(db).deleteOne({ _id: sessionId, userId });
  return result.deletedCount === 1;
}

export async function revokeOtherSessions(db: Db, userId: ObjectId, keepSessionId: string): Promise<number> {
  const result = await sessions(db).deleteMany({ userId, _id: { $ne: keepSessionId } });
  return result.deletedCount;
}

export async function revokeAllSessions(db: Db, userId: ObjectId): Promise<number> {
  const result = await sessions(db).deleteMany({ userId });
  return result.deletedCount;
}
