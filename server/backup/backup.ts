import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { BSON, type Db } from "mongodb";
import packageJson from "@/package.json";
import { now } from "@/server/clock";
import {
  backupFileName,
  encryptor,
  FILE_EXTENSION,
  headerLine,
  newHeader,
  type BackupManifest,
} from "@/server/backup/format";

// Writes an encrypted copy of the database: every collection except short-lived security state, the
// delivery log, the migration records (a restore runs the migrations, which also rebuild the indexes) and
// the visitor statistics' daily salt (a copy would let a day's visitor ids be linked to addresses).

export const EXCLUDED_COLLECTIONS: ReadonlySet<string> = new Set([
  "sessions",
  "auth_tokens",
  "portal_sessions",
  "portal_links",
  "content_previews",
  "rate_limits",
  "login_lockouts",
  "idempotency_keys",
  "locks",
  "csp_reports",
  "analytics_salts",
  "outbox",
  "jobs",
  "schema_migrations",
]);

export type BackupResult = {
  file: string;
  name: string;
  bytes: number;
  documents: number;
  collections: Record<string, number>;
};

export async function backupCollections(db: Db): Promise<string[]> {
  const collections = await db.listCollections({}, { nameOnly: true }).toArray();
  return collections
    .map((collection) => collection.name)
    .filter((name) => !name.startsWith("system.") && !EXCLUDED_COLLECTIONS.has(name))
    .sort();
}

export async function createBackup(
  db: Db,
  { dir, key, keep, at = now() }: { dir: string; key: Buffer; keep: number; at?: Date },
): Promise<BackupResult> {
  await mkdir(dir, { recursive: true });
  const header = newHeader({ database: db.databaseName, createdAt: at, app: packageJson.version, key });
  const name = backupFileName(db.databaseName, at);
  const target = path.join(dir, name);
  const partial = `${target}.partial`;
  const collections = await backupCollections(db);
  const counts: Record<string, number> = {};
  let documents = 0;

  async function* lines(): AsyncGenerator<string> {
    for (const collection of collections) {
      counts[collection] = 0;
      for await (const doc of db.collection(collection).find({}, { sort: { _id: 1 } })) {
        counts[collection]++;
        documents++;
        yield `${JSON.stringify({ c: collection, d: BSON.EJSON.serialize(doc, { relaxed: false }) })}\n`;
      }
    }
    const manifest: BackupManifest = { collections: counts, documents, finishedAt: now().toISOString() };
    yield `${JSON.stringify({ manifest })}\n`;
  }

  const cipher = encryptor(key, header);
  // The GCM tag exists once the cipher has finished; it goes at the very end of the file.
  const appendTag = new Transform({
    transform(chunk, _encoding, done) {
      done(null, chunk);
    },
    flush(done) {
      done(null, cipher.getAuthTag());
    },
  });
  const out = createWriteStream(partial, { mode: 0o600 });
  out.write(headerLine(header));
  try {
    await pipeline(Readable.from(lines()), createGzip({ level: 6 }), cipher, appendTag, out);
    await rename(partial, target);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
  const { size } = await stat(target);
  await pruneBackups(dir, db.databaseName, keep);
  return { file: target, name, bytes: size, documents, collections: counts };
}

export type BackupFile = { name: string; bytes: number; modifiedAt: Date };

// Newest first. Only this database's backups, so a staging copy can share the folder.
export async function listBackups(dir: string, database: string): Promise<BackupFile[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const prefix = `leffloard-${database}-`;
  const files = await Promise.all(
    names
      .filter((name) => name.startsWith(prefix) && name.endsWith(FILE_EXTENSION))
      .map(async (name) => {
        const info = await stat(path.join(dir, name));
        return { name, bytes: info.size, modifiedAt: info.mtime };
      }),
  );
  return files.sort((a, b) => b.name.localeCompare(a.name));
}

export async function pruneBackups(dir: string, database: string, keep: number): Promise<string[]> {
  const removed = (await listBackups(dir, database)).slice(Math.max(keep, 1)).map((file) => file.name);
  for (const name of removed) await rm(path.join(dir, name), { force: true });
  return removed;
}
