import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Binary, MongoClient, ObjectId, type Db } from "mongodb";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBackup, listBackups, pruneBackups } from "@/server/backup/backup";
import { BackupError, keyId } from "@/server/backup/format";
import { openBackup, restoreInto } from "@/server/backup/restore";
import { runMigrations } from "@/server/db/migrate";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db, url } = setupTestDb();

const KEY = Buffer.alloc(32, 9);
let dir = "";
let client: MongoClient;
let target: Db;

beforeAll(async () => {
  client = await new MongoClient(url).connect();
});

afterAll(async () => {
  await client.close();
});

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "leffloard-backup-test-"));
  target = client.db(`restore_${randomBytes(4).toString("hex")}`);
  await runMigrations(db());
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
  await target.dropDatabase();
});

const userId = new ObjectId();

async function seed(): Promise<void> {
  await db()
    .collection("users")
    .insertOne({
      _id: userId,
      email: "owner@example.com",
      createdAt: new Date("2026-01-02T03:04:05.678Z"),
      totp: { secret: "v1.abc.def.ghi", lastUsedStep: 123 },
    });
  await db()
    .collection("passkeys")
    .insertOne({
      _id: "cred-1" as unknown as ObjectId,
      userId,
      publicKey: new Binary(Buffer.from([1, 2, 3])),
    });
  await db()
    .collection("notes")
    .insertMany(Array.from({ length: 1200 }, (_, index) => ({ n: index, text: `Message ${index} — Şükrü` })));
  await db()
    .collection("sessions")
    .insertOne({ _id: "secret-session" as unknown as ObjectId, userId });
  await db()
    .collection("rate_limits")
    .insertOne({ _id: "intake:1.2.3.4" as unknown as ObjectId, hits: [] });
}

describe("backups", () => {
  it("round-trip every kept collection with its exact types, and leave out short-lived state", async () => {
    await seed();
    const result = await createBackup(db(), {
      dir,
      key: KEY,
      keep: 14,
      at: new Date("2026-09-26T03:15:00Z"),
    });
    expect(result.name).toBe(`leffloard-${db().databaseName}-20260926T031500Z.lfbak`);
    expect(result.collections).toMatchObject({ users: 1, passkeys: 1, notes: 1200 });
    expect(result.collections).not.toHaveProperty("sessions");
    expect(result.collections).not.toHaveProperty("rate_limits");
    expect(result.collections).not.toHaveProperty("schema_migrations");

    // Nothing readable in the file but the header.
    const raw = await readFile(result.file);
    expect(raw.toString("latin1")).not.toContain("owner@example.com");
    expect(raw.toString("utf8").split("\n")[0]).toContain(`"keyId":"${keyId(KEY)}"`);

    const backup = await openBackup(result.file, KEY);
    try {
      const report = await restoreInto(target, backup, { replace: false });
      expect(report.matches).toBe(true);
      expect(report.documents).toBe(1202);
    } finally {
      await backup.close();
    }
    const user = await target.collection("users").findOne({ _id: userId });
    expect(user?.createdAt).toEqual(new Date("2026-01-02T03:04:05.678Z"));
    expect(user?.totp).toEqual({ secret: "v1.abc.def.ghi", lastUsedStep: 123 });
    const passkey = await target.collection("passkeys").findOne({});
    expect(passkey?.publicKey).toBeInstanceOf(Binary);
    expect(Buffer.from((passkey?.publicKey as Binary).buffer)).toEqual(Buffer.from([1, 2, 3]));
    expect(await target.collection("notes").countDocuments()).toBe(1200);
    expect(await target.collection("sessions").countDocuments()).toBe(0);
    // The migrations rebuild the indexes of the restored copy.
    expect(await runMigrations(target)).toContain("0004");
  });

  it("refuse a changed file before writing anything", async () => {
    await seed();
    const { file } = await createBackup(db(), { dir, key: KEY, keep: 14 });
    const raw = await readFile(file);
    const middle = Math.floor(raw.length / 2);
    raw[middle] = raw[middle]! ^ 0xff;
    await writeFile(file, raw);
    await expect(openBackup(file, KEY)).rejects.toThrow(BackupError);
    expect(await target.listCollections().toArray()).toEqual([]);
  });

  it("refuse a changed header, and name the key a file needs", async () => {
    await seed();
    const { file } = await createBackup(db(), { dir, key: KEY, keep: 14 });
    const text = (await readFile(file)).toString("latin1").replace('"app":"', '"app":"x');
    await writeFile(file, Buffer.from(text, "latin1"));
    await expect(openBackup(file, KEY)).rejects.toThrow("damaged or was changed");

    const other = await createBackup(db(), { dir, key: KEY, keep: 14, at: new Date("2027-01-01T00:00:00Z") });
    await expect(openBackup(other.file, Buffer.alloc(32, 1))).rejects.toThrow(`key ${keyId(KEY)}`);
    await writeFile(path.join(dir, "junk.lfbak"), "not a backup\n0123456789abcdef");
    await expect(openBackup(path.join(dir, "junk.lfbak"), KEY)).rejects.toThrow("not a leffloard.xyz backup");
  });

  it("restore only into an empty database, unless its contents are replaced on purpose", async () => {
    await seed();
    const { file } = await createBackup(db(), { dir, key: KEY, keep: 14 });
    await target.collection("notes").insertOne({ stale: true });
    const backup = await openBackup(file, KEY);
    try {
      await expect(restoreInto(target, backup, { replace: false })).rejects.toThrow("is not empty");
      const report = await restoreInto(target, backup, { replace: true });
      expect(report.matches).toBe(true);
      expect(await target.collection("notes").countDocuments({ stale: true })).toBe(0);
    } finally {
      await backup.close();
    }
  });

  it("keep the newest files of this database only", async () => {
    for (const day of ["01", "02", "03", "04"]) {
      await createBackup(db(), { dir, key: KEY, keep: 99, at: new Date(`2026-09-${day}T03:15:00Z`) });
    }
    await writeFile(path.join(dir, "leffloard-staging-20260901T031500Z.lfbak"), "other database");
    expect(await pruneBackups(dir, db().databaseName, 2)).toHaveLength(2);
    const names = (await listBackups(dir, db().databaseName)).map((file) => file.name);
    expect(names).toEqual([
      `leffloard-${db().databaseName}-20260904T031500Z.lfbak`,
      `leffloard-${db().databaseName}-20260903T031500Z.lfbak`,
    ]);
    expect(await readdir(dir)).toContain("leffloard-staging-20260901T031500Z.lfbak");
    expect(await listBackups(path.join(dir, "missing"), "x")).toEqual([]);
  });
});
