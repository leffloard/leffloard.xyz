import type { Db } from "mongodb";

export type Migration = {
  id: string;
  name: string;
  up: (db: Db) => Promise<void>;
};

// Forward-only and additive ("expand, then contract"): the release before a migration must keep
// working on the migrated schema, so deploys can roll back without a down migration.
// A migration that fails is not recorded and runs again next time, so each one must be safe to repeat.
export const migrations: Migration[] = [
  {
    id: "0001",
    name: "locks-ttl",
    async up(db) {
      await db.collection("locks").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    },
  },
];
