import "server-only";
import { MongoServerError, type Db } from "mongodb";
import { now } from "@/server/clock";
import { sha256Hex } from "@/server/security/crypto";

// Idempotency-Key support for public form posts: a form that is sent twice (double click, a retry after a
// dropped connection) creates one record, and the second request gets the first answer. Only successful
// answers are kept, for 24 hours; after an error the same key can be used again.

export type StoredResponse = { status: number; body: unknown };

type KeyDoc = { _id: string; state: "running" | "done"; response: StoredResponse | null; expiresAt: Date };

const KEEP_MS = 24 * 3600_000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;
const DUPLICATE_KEY = 11000;

export function readIdempotencyKey(headers: Headers): string | null {
  const key = headers.get("idempotency-key")?.trim();
  return key && KEY_PATTERN.test(key) ? key : null;
}

export type IdempotentResult = StoredResponse & { replayed: boolean };

export async function idempotent(
  db: Db,
  scope: string,
  key: string | null,
  run: () => Promise<StoredResponse>,
): Promise<IdempotentResult> {
  if (!key) return { ...(await run()), replayed: false };
  const keys = db.collection<KeyDoc>("idempotency_keys");
  const id = sha256Hex(`${scope}:${key}`);
  try {
    await keys.insertOne({
      _id: id,
      state: "running",
      response: null,
      expiresAt: new Date(now().getTime() + KEEP_MS),
    });
  } catch (error) {
    if (!(error instanceof MongoServerError && error.code === DUPLICATE_KEY)) throw error;
    const existing = await keys.findOne({ _id: id });
    if (existing?.state === "done" && existing.response) return { ...existing.response, replayed: true };
    return {
      status: 409,
      body: { error: "The same form is still being sent. Wait a moment and check before sending it again." },
      replayed: true,
    };
  }
  let response: StoredResponse;
  try {
    response = await run();
  } catch (error) {
    await keys.deleteOne({ _id: id });
    throw error;
  }
  if (response.status >= 200 && response.status < 300) {
    await keys.updateOne({ _id: id }, { $set: { state: "done", response } });
  } else {
    await keys.deleteOne({ _id: id });
  }
  return { ...response, replayed: false };
}
