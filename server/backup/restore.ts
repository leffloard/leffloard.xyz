import "server-only";
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { BSON, type Db, type Document } from "mongodb";
import {
  BackupError,
  decryptor,
  keyId,
  parseHeader,
  TAG_BYTES,
  type BackupHeader,
  type BackupLine,
  type BackupManifest,
} from "@/server/backup/format";

// Reads a backup back. The whole file is decrypted and checked first, into a private temporary file, so
// nothing is restored from a file that fails the check (GCM only proves integrity at the very end).

export type OpenedBackup = {
  header: BackupHeader;
  lines: () => AsyncGenerator<BackupLine>;
  close: () => Promise<void>;
};

const COLLECTION_NAME = /^(?!system\.)[A-Za-z0-9_.-]{1,120}$/;

function damaged(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  const message = error instanceof Error ? error.message : "";
  return (
    /unable to authenticate|bad decrypt/i.test(message) || (typeof code === "string" && code.startsWith("Z_"))
  );
}

export async function openBackup(file: string, key: Buffer): Promise<OpenedBackup> {
  const handle = await open(file, "r");
  let header: BackupHeader;
  let start: number;
  let end: number;
  const tag = Buffer.alloc(TAG_BYTES);
  try {
    const { size } = await handle.stat();
    const probe = Buffer.alloc(Math.min(4096, size));
    await handle.read(probe, 0, probe.length, 0);
    const newline = probe.indexOf(0x0a);
    if (newline === -1) throw new BackupError("This is not a leffloard.xyz backup file.");
    header = parseHeader(probe.subarray(0, newline).toString("utf8"));
    if (header.keyId !== keyId(key)) {
      throw new BackupError(
        `This backup was made with another BACKUP_KEY (key ${header.keyId}; this server has ${keyId(key)}).`,
      );
    }
    start = newline + 1;
    end = size - TAG_BYTES;
    if (end <= start) throw new BackupError("The backup file is cut short.");
    await handle.read(tag, 0, TAG_BYTES, end);
  } finally {
    await handle.close();
  }

  const plain = path.join(tmpdir(), `leffloard-restore-${randomUUID()}.ndjson`);
  try {
    await pipeline(
      createReadStream(file, { start, end: end - 1 }),
      decryptor(key, header, tag),
      createGunzip(),
      createWriteStream(plain, { mode: 0o600 }),
    );
  } catch (error) {
    await rm(plain, { force: true });
    if (damaged(error)) throw new BackupError("The backup is damaged or was changed: it fails its check.");
    throw error;
  }

  return {
    header,
    async *lines() {
      const reader = createInterface({ input: createReadStream(plain), crlfDelay: Number.POSITIVE_INFINITY });
      for await (const line of reader) if (line) yield JSON.parse(line) as BackupLine;
    },
    close: () => rm(plain, { force: true }),
  };
}

export type RestoreReport = {
  collections: Record<string, number>;
  documents: number;
  manifest: BackupManifest | null;
  matches: boolean;
};

async function nonEmptyCollections(db: Db): Promise<string[]> {
  const names = (await db.listCollections({}, { nameOnly: true }).toArray())
    .map((collection) => collection.name)
    .filter((name) => !name.startsWith("system."));
  const found: string[] = [];
  for (const name of names) if ((await db.collection(name).estimatedDocumentCount()) > 0) found.push(name);
  return found;
}

// Loads a checked backup into a database: an empty one, or one whose contents are replaced on purpose.
// Run the migrations afterwards; they rebuild the indexes.
export async function restoreInto(
  db: Db,
  backup: OpenedBackup,
  { replace }: { replace: boolean },
): Promise<RestoreReport> {
  const existing = await nonEmptyCollections(db);
  if (existing.length && !replace) {
    throw new BackupError(
      `The database ${db.databaseName} is not empty (${existing.slice(0, 4).join(", ")}${existing.length > 4 ? ", …" : ""}). ` +
        "Restore into an empty database, or replace its contents on purpose.",
    );
  }
  if (replace) {
    const names = (await db.listCollections({}, { nameOnly: true }).toArray())
      .map((collection) => collection.name)
      .filter((name) => !name.startsWith("system."));
    for (const name of names) await db.collection(name).drop();
  }

  const collections: Record<string, number> = {};
  let manifest: BackupManifest | null = null;
  let batch: Document[] = [];
  let current: string | null = null;
  const flush = async () => {
    if (current && batch.length) await db.collection(current).insertMany(batch, { ordered: false });
    batch = [];
  };
  for await (const line of backup.lines()) {
    if ("manifest" in line) {
      manifest = line.manifest;
      continue;
    }
    if (!COLLECTION_NAME.test(line.c))
      throw new BackupError(`The backup names an invalid collection: ${line.c}`);
    if (line.c !== current) {
      await flush();
      current = line.c;
    }
    batch.push(BSON.EJSON.deserialize(line.d as Document, { relaxed: false }));
    collections[line.c] = (collections[line.c] ?? 0) + 1;
    if (batch.length >= 500) await flush();
  }
  await flush();

  const documents = Object.values(collections).reduce((sum, count) => sum + count, 0);
  const matches =
    manifest !== null &&
    manifest.documents === documents &&
    Object.entries(manifest.collections).every(([name, count]) => (collections[name] ?? 0) === count);
  return { collections, documents, manifest, matches };
}
