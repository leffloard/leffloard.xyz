import { MongoMemoryReplSet } from "mongodb-memory-server";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    mongoUrl: string;
  }
}

// One throwaway replica set for the whole run; every test file works in its own database. Each file drops
// and rebuilds its database before every test, which leaves WiredTiger with thousands of files: it is told to
// close idle ones and to checkpoint (which removes dropped ones) every second, so mongod stays well within
// the open files limit (it aborts when it runs out).
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: {
      count: 1,
      storageEngine: "wiredTiger",
      args: [
        "--syncdelay=1",
        "--setParameter=wiredTigerFileHandleCloseIdleTime=2",
        "--setParameter=wiredTigerFileHandleCloseScanInterval=1",
        "--setParameter=wiredTigerFileHandleCloseMinimum=100",
      ],
    },
  });
  project.provide("mongoUrl", replSet.getUri());
  return async () => {
    await replSet.stop();
  };
}
