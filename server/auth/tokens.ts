import "server-only";
import type { Db, ObjectId } from "mongodb";
import { now } from "@/server/clock";
import type { AuthTokenDoc, AuthTokenPurpose } from "@/server/auth/types";
import { randomToken, sha256Hex } from "@/server/security/crypto";

// Short-lived, single-purpose tokens for the steps between "password accepted" and "signed in", and for
// WebAuthn challenges. Only the SHA-256 of the token is stored; the token travels in an httpOnly cookie.

export const MAX_TOKEN_ATTEMPTS = 5;

export function authTokens(db: Db) {
  return db.collection<AuthTokenDoc>("auth_tokens");
}

export async function createAuthToken(
  db: Db,
  input: {
    purpose: AuthTokenPurpose;
    ttlMs: number;
    userId?: ObjectId | null;
    sessionId?: string | null;
    data?: AuthTokenDoc["data"];
  },
): Promise<{ token: string; doc: AuthTokenDoc }> {
  const token = randomToken();
  const at = now();
  const doc: AuthTokenDoc = {
    _id: sha256Hex(token),
    purpose: input.purpose,
    userId: input.userId ?? null,
    sessionId: input.sessionId ?? null,
    data: input.data ?? {},
    attempts: 0,
    createdAt: at,
    expiresAt: new Date(at.getTime() + input.ttlMs),
  };
  await authTokens(db).insertOne(doc);
  return { token, doc };
}

export async function findAuthToken(
  db: Db,
  token: string | undefined,
  purpose: AuthTokenPurpose,
): Promise<AuthTokenDoc | null> {
  if (!token || token.length > 100) return null;
  return authTokens(db).findOne({
    _id: sha256Hex(token),
    purpose,
    expiresAt: { $gt: now() },
    attempts: { $lt: MAX_TOKEN_ATTEMPTS },
  });
}

// Takes the token out of the database: whoever deletes it first may use it, so it works exactly once.
export async function consumeAuthToken(
  db: Db,
  token: string | undefined,
  purpose: AuthTokenPurpose,
): Promise<AuthTokenDoc | null> {
  if (!token || token.length > 100) return null;
  return authTokens(db).findOneAndDelete({
    _id: sha256Hex(token),
    purpose,
    expiresAt: { $gt: now() },
    attempts: { $lt: MAX_TOKEN_ATTEMPTS },
  });
}

// Counts a wrong code; returns how many tries are left (0 means the token is used up).
export async function recordTokenAttempt(db: Db, tokenId: string): Promise<number> {
  const doc = await authTokens(db).findOneAndUpdate(
    { _id: tokenId },
    { $inc: { attempts: 1 } },
    { returnDocument: "after", projection: { attempts: 1 } },
  );
  const left = MAX_TOKEN_ATTEMPTS - (doc?.attempts ?? MAX_TOKEN_ATTEMPTS);
  if (left <= 0) await authTokens(db).deleteOne({ _id: tokenId });
  return Math.max(0, left);
}

export async function deleteAuthToken(db: Db, tokenId: string): Promise<void> {
  await authTokens(db).deleteOne({ _id: tokenId });
}
