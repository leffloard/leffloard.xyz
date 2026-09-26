import { randomUUID } from "node:crypto";
import { MongoClient, type Db } from "mongodb";
import { afterAll, beforeAll, beforeEach, inject } from "vitest";

// A fresh database per test file, emptied before every test.
export function setupTestDb(): { db: () => Db; url: string; name: string } {
  const url = inject("mongoUrl");
  const name = `test_${randomUUID().slice(0, 8)}`;
  let client: MongoClient | undefined;
  let database: Db | undefined;

  beforeAll(async () => {
    client = await new MongoClient(url).connect();
    database = client.db(name);
  });

  beforeEach(async () => {
    await database?.dropDatabase();
  });

  afterAll(async () => {
    await database?.dropDatabase();
    await client?.close();
  });

  return {
    url,
    name,
    db: () => {
      if (!database) throw new Error("setupTestDb: the database is only available inside tests and hooks.");
      return database;
    },
  };
}
