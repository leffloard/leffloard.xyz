import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUrl: string;
  }
}

// One throwaway replica set for the whole run; every test file works in its own database.
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } });
  project.provide("mongoUrl", replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
