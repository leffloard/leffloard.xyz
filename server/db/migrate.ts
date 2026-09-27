import "server-only";
import { randomUUID } from "node:crypto";
import { MongoServerError, type Db } from "mongodb";
import { now } from "@/server/clock";
import { migrations as defaultMigrations, type Migration } from "@/server/db/migrations";

const LOCK_ID = "migrations";
const LOCK_TTL_MS = 10 * 60 * 1000;
const DUPLICATE_KEY = 11000;

type LockDoc = { _id: string; owner: string; expiresAt: Date };
type MigrationRecord = { _id: string; name: string; appliedAt: Date; durationMs: number };

export class MigrationLockedError extends Error {
  constructor() {
    super("Another process is running the migrations. Try again in a moment.");
    this.name = "MigrationLockedError";
  }
}

export async function pendingMigrations(db: Db, all: Migration[] = defaultMigrations): Promise<Migration[]> {
  const applied = await db
    .collection<MigrationRecord>("schema_migrations")
    .find({}, { projection: { _id: 1 } })
    .toArray();
  const done = new Set(applied.map((record) => record._id));
  return all.filter((migration) => !done.has(migration.id));
}

export async function runMigrations(db: Db, all: Migration[] = defaultMigrations): Promise<string[]> {
  const owner = randomUUID();
  const locks = db.collection<LockDoc>("locks");
  try {
    // Takes the lock if it is free or its holder died (expired); a live holder makes the
    // upsert collide on _id.
    await locks.updateOne(
      { _id: LOCK_ID, expiresAt: { $lt: now() } },
      { $set: { owner, expiresAt: new Date(now().getTime() + LOCK_TTL_MS) } },
      { upsert: true },
    );
  } catch (error) {
    if (error instanceof MongoServerError && error.code === DUPLICATE_KEY) throw new MigrationLockedError();
    throw error;
  }

  try {
    const applied: string[] = [];
    for (const migration of await pendingMigrations(db, all)) {
      const started = now().getTime();
      await migration.up(db);
      await db.collection<MigrationRecord>("schema_migrations").insertOne({
        _id: migration.id,
        name: migration.name,
        appliedAt: now(),
        durationMs: now().getTime() - started,
      });
      applied.push(migration.id);
    }
    return applied;
  } finally {
    await locks.deleteOne({ _id: LOCK_ID, owner });
  }
}
