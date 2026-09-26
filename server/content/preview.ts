import "server-only";
import type { Db } from "mongodb";
import { cookies } from "next/headers";
import { cache } from "react";
import { cookieName } from "@/server/auth/cookies";
import { SESSION_IDLE_MS, sessions } from "@/server/auth/sessions";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { randomToken, sha256Hex } from "@/server/security/crypto";

// The owner's preview of drafts on the public pages. The admin (behind the sign-in and Cloudflare Access)
// hands out a key for an hour in a cookie; a public page shows drafts only while the cookie carries a key
// the database knows, and the admin session that asked for it is still signed in. Only the key's SHA-256
// is stored; an exit, an hour, or the end of that session (signing out, a revoked or idle session) ends it.

export const PREVIEW_MS = 60 * 60_000;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

type PreviewDoc = { _id: string; sessionId: string; createdAt: Date; expiresAt: Date };

export function contentPreviews(db: Db) {
  return db.collection<PreviewDoc>("content_previews");
}

export async function startPreview(db: Db, sessionId: string, at: Date = now()): Promise<string> {
  const token = randomToken();
  await contentPreviews(db).insertOne({
    _id: sha256Hex(token),
    sessionId,
    createdAt: at,
    expiresAt: new Date(at.getTime() + PREVIEW_MS),
  });
  return token;
}

export async function endPreview(db: Db, token: string | undefined): Promise<void> {
  if (token && TOKEN_PATTERN.test(token)) await contentPreviews(db).deleteOne({ _id: sha256Hex(token) });
}

export async function previewKeyValid(db: Db, token: string | undefined, at: Date = now()): Promise<boolean> {
  if (!token || !TOKEN_PATTERN.test(token)) return false;
  const preview = await contentPreviews(db).findOne({ _id: sha256Hex(token), expiresAt: { $gt: at } });
  if (!preview) return false;
  const session = await sessions(db).findOne(
    {
      _id: preview.sessionId,
      expiresAt: { $gt: at },
      lastSeenAt: { $gt: new Date(at.getTime() - SESSION_IDLE_MS) },
    },
    { projection: { _id: 1 } },
  );
  return session !== null;
}

// Whether this request is the owner's preview.
export const previewing = cache(async (): Promise<boolean> => {
  const token = (await cookies()).get(cookieName("preview"))?.value;
  if (!token) return false;
  return previewKeyValid(await getDb(), token);
});
