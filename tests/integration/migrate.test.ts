import { describe, expect, it, vi } from "vitest";
import { MigrationLockedError, pendingMigrations, runMigrations } from "@/server/db/migrate";
import { migrations, type Migration } from "@/server/db/migrations";
import { setupTestDb } from "./db";

const { db } = setupTestDb();

function migration(id: string, up: Migration["up"] = async () => {}): Migration {
  return { id, name: `test-${id}`, up };
}

async function lockCount(): Promise<number> {
  return db()
    .collection("locks")
    .countDocuments({ _id: "migrations" as never });
}

describe("runMigrations", () => {
  it("applies pending migrations in order and records them", async () => {
    const order: string[] = [];
    const list = ["0001", "0002", "0003"].map((id) =>
      migration(id, async () => {
        order.push(id);
      }),
    );

    await expect(runMigrations(db(), list)).resolves.toEqual(["0001", "0002", "0003"]);
    expect(order).toEqual(["0001", "0002", "0003"]);

    const records = await db().collection("schema_migrations").find().sort({ _id: 1 }).toArray();
    expect(records.map((record) => record._id)).toEqual(["0001", "0002", "0003"]);
    expect(records[0]).toMatchObject({ name: "test-0001", appliedAt: expect.any(Date) });
    expect(records[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(await lockCount()).toBe(0);
  });

  it("runs each migration only once", async () => {
    const up = vi.fn(async () => {});
    const list = [migration("0001", up)];

    await runMigrations(db(), list);
    await expect(runMigrations(db(), list)).resolves.toEqual([]);
    expect(up).toHaveBeenCalledTimes(1);

    const later = migration("0002");
    await expect(pendingMigrations(db(), [...list, later])).resolves.toEqual([later]);
    await expect(runMigrations(db(), [...list, later])).resolves.toEqual(["0002"]);
  });

  it("stops at a failing migration without recording it, and retries it next time", async () => {
    const after = vi.fn(async () => {});
    let fail = true;
    const list = [
      migration("0001"),
      migration("0002", async () => {
        if (fail) throw new Error("index build failed");
      }),
      migration("0003", after),
    ];

    await expect(runMigrations(db(), list)).rejects.toThrow("index build failed");
    expect(after).not.toHaveBeenCalled();
    await expect(pendingMigrations(db(), list)).resolves.toHaveLength(2);
    expect(await lockCount()).toBe(0);

    fail = false;
    await expect(runMigrations(db(), list)).resolves.toEqual(["0002", "0003"]);
  });

  it("lets only one process migrate at a time", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let signalStarted!: () => void;
    const started = new Promise<void>((resolve) => (signalStarted = resolve));
    const slow = migration("0001", async () => {
      signalStarted();
      await gate;
    });

    const first = runMigrations(db(), [slow]);
    await started;
    await expect(runMigrations(db(), [slow])).rejects.toBeInstanceOf(MigrationLockedError);

    release();
    await expect(first).resolves.toEqual(["0001"]);
    expect(await lockCount()).toBe(0);
  });

  it("takes over a lock whose holder died", async () => {
    await db()
      .collection("locks")
      .insertOne({
        _id: "migrations" as never,
        owner: "crashed-process",
        expiresAt: new Date(Date.now() - 1_000),
      });

    await expect(runMigrations(db(), [migration("0001")])).resolves.toEqual(["0001"]);
    expect(await lockCount()).toBe(0);
  });

  it("does not release a lock that another process took over", async () => {
    const takeOver = migration("0001", async (database) => {
      // Simulates this run's lock expiring and another process taking it.
      await database
        .collection("locks")
        .updateOne({ _id: "migrations" as never }, { $set: { owner: "other-process" } });
    });

    await runMigrations(db(), [takeOver]);
    await expect(
      db()
        .collection("locks")
        .findOne({ _id: "migrations" as never }),
    ).resolves.toMatchObject({
      owner: "other-process",
    });
  });
});

describe("the real migration list", () => {
  it("has unique, ordered ids", () => {
    const ids = migrations.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it("applies cleanly, twice", async () => {
    await expect(runMigrations(db())).resolves.toEqual(migrations.map((m) => m.id));
    await expect(runMigrations(db())).resolves.toEqual([]);

    const indexes = await db().collection("locks").indexes();
    expect(indexes).toContainEqual(expect.objectContaining({ key: { expiresAt: 1 }, expireAfterSeconds: 0 }));
  });

  it("is safe to repeat when a migration ran but was not recorded", async () => {
    for (const m of migrations) await m.up(db());
    await expect(runMigrations(db())).resolves.toEqual(migrations.map((m) => m.id));
  });
});
