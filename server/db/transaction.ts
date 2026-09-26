import "server-only";
import type { ClientSession, Db } from "mongodb";

// Runs `work` in a transaction (the database is always a replica set: Atlas, and the local one). The
// driver retries it on transient errors, so `work` must be safe to run again from the start.
export async function inTransaction<T>(db: Db, work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = db.client.startSession();
  try {
    return await session.withTransaction(() => work(session));
  } finally {
    await session.endSession();
  }
}
