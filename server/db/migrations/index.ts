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
  {
    id: "0002",
    name: "auth",
    async up(db) {
      const expires = { expireAfterSeconds: 0 };
      await db.collection("users").createIndex({ email: 1 }, { unique: true });
      await db.collection("users").createIndex({ role: 1 });
      await db.collection("sessions").createIndex({ userId: 1 });
      await db.collection("sessions").createIndex({ expiresAt: 1 }, expires);
      await db.collection("auth_tokens").createIndex({ expiresAt: 1 }, expires);
      await db.collection("passkeys").createIndex({ userId: 1 });
      await db.collection("rate_limits").createIndex({ expiresAt: 1 }, expires);
      await db.collection("login_lockouts").createIndex({ expiresAt: 1 }, expires);
      await db.collection("audit_log").createIndex({ at: -1 });
      await db.collection("audit_log").createIndex({ action: 1, at: -1 });
      await db
        .collection("csp_reports")
        .createIndex({ receivedAt: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
    },
  },
  {
    id: "0003",
    name: "audit-log-retention",
    // Security logs are kept for 12 months (see the privacy notice).
    async up(db) {
      await db.collection("audit_log").createIndex({ at: 1 }, { expireAfterSeconds: 365 * 24 * 3600 });
    },
  },
];
