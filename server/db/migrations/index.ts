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
  {
    id: "0004",
    name: "inbox-and-outbox",
    async up(db) {
      const expires = { expireAfterSeconds: 0 };
      const inquiries = db.collection("inquiries");
      await inquiries.createIndex({ publicId: 1 }, { unique: true });
      await inquiries.createIndex({ ref: 1 }, { unique: true });
      // Migrated v1 requests: running the migration twice cannot copy one twice.
      await inquiries.createIndex(
        { legacyId: 1 },
        { unique: true, partialFilterExpression: { legacyId: { $exists: true } } },
      );
      await inquiries.createIndex({ status: 1, receivedAt: -1 });
      await inquiries.createIndex({ kind: 1, receivedAt: -1 });
      await inquiries.createIndex({ receivedAt: -1 });
      await inquiries.createIndex({ email: 1 });
      await inquiries.createIndex({ purgeAt: 1 }, expires);

      const outbox = db.collection("outbox");
      await outbox.createIndex({ dedupeKey: 1 }, { unique: true });
      await outbox.createIndex({ status: 1, nextAttemptAt: 1 });
      await outbox.createIndex({ createdAt: -1 });
      await outbox.createIndex({ purgeAt: 1 }, expires);

      await db.collection("idempotency_keys").createIndex({ expiresAt: 1 }, expires);
    },
  },
  {
    id: "0005",
    name: "clients-projects-tasks-time",
    async up(db) {
      const clients = db.collection("clients");
      await clients.createIndex({ emailKey: 1 });
      await clients.createIndex({ status: 1, updatedAt: -1 });
      await clients.createIndex({ updatedAt: -1 });

      const activities = db.collection("activities");
      await activities.createIndex({ clientId: 1, at: -1 });
      await activities.createIndex({ projectId: 1, at: -1 });

      const projects = db.collection("projects");
      await projects.createIndex({ ref: 1 }, { unique: true });
      await projects.createIndex({ clientId: 1, createdAt: -1 });
      await projects.createIndex({ stage: 1, rank: 1 });

      const revisions = db.collection("revisions");
      await revisions.createIndex({ projectId: 1, number: 1 }, { unique: true });
      await revisions.createIndex({ clientId: 1, requestedAt: -1 });

      const tasks = db.collection("tasks");
      await tasks.createIndex({ projectId: 1, status: 1, rank: 1 });
      await tasks.createIndex({ status: 1, due: 1 });
      await tasks.createIndex({ status: 1, completedAt: -1 });
      await tasks.createIndex({ clientId: 1 });

      const time = db.collection("time_entries");
      // Only one timer can run: the running entry is the only one with `running: true`.
      await time.createIndex(
        { running: 1 },
        { unique: true, partialFilterExpression: { running: true }, name: "one_running_timer" },
      );
      await time.createIndex({ startedAt: -1 });
      await time.createIndex({ projectId: 1, startedAt: -1 });
      await time.createIndex({ clientId: 1 });
      await time.createIndex({ taskId: 1 });

      // Messages linked to a client.
      await db
        .collection("inquiries")
        .createIndex({ clientId: 1 }, { partialFilterExpression: { clientId: { $type: "objectId" } } });
    },
  },
];
