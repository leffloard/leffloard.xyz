import { randomBytes } from "node:crypto";
import type { Db, Document } from "mongodb";

export type Migration = {
  id: string;
  name: string;
  up: (db: Db) => Promise<void>;
};

// Forward-only and additive ("expand, then contract"): the release before a migration must keep
// working on the migrated schema, so deploys can roll back without a down migration.
// A migration that fails is not recorded and runs again next time, so each one must be safe to repeat.

// Creates a collection with a $jsonSchema validator, or puts the validator on one that exists. The database
// then refuses a malformed billing document even if a bug in the app tried to write one.
async function withValidator(db: Db, name: string, schema: Document): Promise<void> {
  const validator = { $jsonSchema: schema };
  const exists = (await db.listCollections({ name }, { nameOnly: true }).toArray()).length > 0;
  if (exists) {
    await db.command({ collMod: name, validator, validationLevel: "strict", validationAction: "error" });
  } else {
    await db.createCollection(name, { validator, validationLevel: "strict", validationAction: "error" });
  }
}

const WHOLE_NUMBER = { bsonType: ["int", "long", "double"], multipleOf: 1 };
const AMOUNT = { ...WHOLE_NUMBER, minimum: 0, maximum: 100_000_000_000 };
const CURRENCY = { enum: ["USD", "EUR", "TRY", "GBP"] };
const PUBLIC_ID = { bsonType: "string", pattern: "^[0-9A-Za-z]{22}$" };
const DATE_TEXT = { bsonType: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" };
const LINES = {
  bsonType: "array",
  maxItems: 50,
  items: {
    bsonType: "object",
    required: ["id", "description", "quantityMilli", "unitMinor"],
    properties: {
      description: { bsonType: "string", maxLength: 2000 },
      quantityMilli: { ...WHOLE_NUMBER, minimum: 1 },
      unitMinor: AMOUNT,
    },
  },
};
const TOTALS = {
  bsonType: "object",
  required: ["subtotalMinor", "discountMinor", "taxes", "totalMinor"],
  properties: { subtotalMinor: AMOUNT, discountMinor: AMOUNT, totalMinor: AMOUNT },
};

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
  {
    id: "0006",
    name: "calendar-and-booking",
    async up(db) {
      const expires = { expireAfterSeconds: 0 };
      const types = db.collection("booking_types");
      await types.createIndex({ slug: 1 }, { unique: true });
      await types.createIndex({ rank: 1 });

      const meetings = db.collection("meetings");
      // The guest's reschedule-and-cancel link finds its meeting by the secret's hash.
      await meetings.createIndex({ manageTokenHash: 1 }, { unique: true });
      await meetings.createIndex({ status: 1, startsAt: 1 });
      await meetings.createIndex({ startsAt: 1 });
      await meetings.createIndex({ clientId: 1, startsAt: -1 });
      await meetings.createIndex({ purgeAt: 1 }, expires);

      await db.collection("calendar_blocks").createIndex({ startsAt: 1, endsAt: 1 });
      // A slot lock's id is its 15-minute cell, so a cell can be held by one meeting only.
      await db.collection("slot_locks").createIndex({ meetingId: 1 });
      await db.collection("slot_locks").createIndex({ expiresAt: 1 }, expires);
      await db.collection("booking_days").createIndex({ expiresAt: 1 }, expires);

      // Two booking types to start with; the owner edits them in the admin.
      if ((await types.countDocuments({}, { limit: 1 })) === 0) {
        const at = new Date();
        const jitsi = { kind: "jitsi", details: "" };
        await types.insertMany([
          {
            slug: "intro-call",
            title: "Intro call",
            description:
              "A first talk about your project: what it should do, the timeline and a rough budget. Free, in English or Turkish.",
            durationMinutes: 30,
            visibility: "public",
            requiresApproval: false,
            location: jitsi,
            questions: [{ id: "q-intro-1", label: "What would you like to build?", required: true }],
            linkKey: null,
            active: true,
            rank: "a0",
            createdAt: at,
            updatedAt: at,
          },
          {
            slug: "project-check-in",
            title: "Project check-in",
            description:
              "For clients with a project under way: a demo, feedback or a decision that needs a talk.",
            durationMinutes: 45,
            visibility: "secret",
            requiresApproval: false,
            location: jitsi,
            questions: [
              { id: "q-check-in-1", label: "Which project, and what should we cover?", required: true },
            ],
            // A secret type's link carries this key; the slug alone (public in this repository) is not enough.
            linkKey: randomBytes(16).toString("base64url"),
            active: true,
            rank: "a1",
            createdAt: at,
            updatedAt: at,
          },
        ]);
      }
    },
  },
  {
    id: "0007",
    name: "billing",
    async up(db) {
      await withValidator(db, "quotes", {
        bsonType: "object",
        required: ["publicId", "status", "clientId", "currency", "lines", "totals", "schedule", "version"],
        properties: {
          publicId: PUBLIC_ID,
          status: { enum: ["draft", "sent", "accepted", "declined", "withdrawn"] },
          number: { bsonType: ["string", "null"], pattern: "^Q-\\d{4}-\\d{4,}$" },
          clientId: { bsonType: "objectId" },
          currency: CURRENCY,
          lines: LINES,
          totals: TOTALS,
          validUntil: { anyOf: [{ bsonType: "null" }, DATE_TEXT] },
          version: { ...WHOLE_NUMBER, minimum: 1 },
        },
        // A quote the client can see has its number and the date it is valid until.
        anyOf: [
          { properties: { status: { enum: ["draft", "withdrawn"] } } },
          {
            required: ["number", "validUntil"],
            properties: { number: { bsonType: "string" }, validUntil: DATE_TEXT },
          },
        ],
      });
      await withValidator(db, "invoices", {
        bsonType: "object",
        required: [
          "publicId",
          "kind",
          "status",
          "currency",
          "lines",
          "totals",
          "paidMinor",
          "methods",
          "version",
        ],
        properties: {
          publicId: PUBLIC_ID,
          kind: { enum: ["invoice", "credit"] },
          status: { enum: ["draft", "issued", "paid", "void"] },
          number: { bsonType: ["string", "null"], pattern: "^(INV|CN)-\\d{4}-\\d{4,}$" },
          currency: CURRENCY,
          lines: LINES,
          totals: TOTALS,
          paidMinor: AMOUNT,
          creditedMinor: AMOUNT,
          methods: { bsonType: "array", items: { enum: ["bank", "crypto", "card"] } },
          version: { ...WHOLE_NUMBER, minimum: 1 },
        },
        // Issued, paid or void: numbered, dated and with the seller's details as they were.
        anyOf: [
          { properties: { status: { enum: ["draft"] } } },
          {
            required: ["number", "issueDate", "seller", "label"],
            properties: {
              number: { bsonType: "string" },
              issueDate: DATE_TEXT,
              seller: { bsonType: "object" },
            },
          },
        ],
      });
      await withValidator(db, "payments", {
        bsonType: "object",
        required: ["invoiceId", "method", "status", "amountMinor", "currency"],
        properties: {
          invoiceId: { bsonType: "objectId" },
          method: { enum: ["bank", "crypto", "card"] },
          status: { enum: ["pending", "confirmed", "review", "failed", "refunded"] },
          amountMinor: AMOUNT,
          currency: CURRENCY,
        },
      });

      const quotes = db.collection("quotes");
      await quotes.createIndex({ publicId: 1 }, { unique: true });
      await quotes.createIndex(
        { number: 1 },
        { unique: true, partialFilterExpression: { number: { $type: "string" } } },
      );
      await quotes.createIndex({ status: 1, updatedAt: -1 });
      await quotes.createIndex({ clientId: 1, updatedAt: -1 });

      const invoices = db.collection("invoices");
      await invoices.createIndex({ publicId: 1 }, { unique: true });
      await invoices.createIndex(
        { number: 1 },
        { unique: true, partialFilterExpression: { number: { $type: "string" } } },
      );
      await invoices.createIndex({ status: 1, dueDate: 1 });
      await invoices.createIndex({ clientId: 1, createdAt: -1 });
      await invoices.createIndex({ projectId: 1, createdAt: -1 });
      await invoices.createIndex({ quoteId: 1 });

      const payments = db.collection("payments");
      await payments.createIndex({ invoiceId: 1, createdAt: -1 });
      await payments.createIndex({ status: 1, createdAt: -1 });
      // One record per payment made at a provider, and one open crypto checkout per invoice.
      await payments.createIndex(
        { "provider.paymentId": 1 },
        { unique: true, partialFilterExpression: { "provider.paymentId": { $type: "string" } } },
      );
      await payments.createIndex(
        { invoiceId: 1 },
        {
          unique: true,
          name: "one_open_crypto_checkout",
          partialFilterExpression: { method: "crypto", status: "pending" },
        },
      );

      // The payment providers' callbacks, stored before they are acted on (duplicates share an _id).
      const events = db.collection("payment_events");
      await events.createIndex({ receivedAt: -1 });
      await events.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
    },
  },
  {
    id: "0008",
    name: "finance",
    async up(db) {
      await withValidator(db, "expenses", {
        bsonType: "object",
        required: ["date", "amountMinor", "currency", "category", "vendor", "version"],
        properties: {
          date: DATE_TEXT,
          amountMinor: { ...AMOUNT, minimum: 1 },
          currency: CURRENCY,
          category: {
            enum: [
              "software",
              "hosting",
              "hardware",
              "ai",
              "fees",
              "contractors",
              "education",
              "marketing",
              "office",
              "taxes",
              "other",
            ],
          },
          vendor: { bsonType: "string", minLength: 1, maxLength: 200 },
          version: { ...WHOLE_NUMBER, minimum: 1 },
        },
      });
      await withValidator(db, "recurring_invoices", {
        bsonType: "object",
        required: ["currency", "lines", "totals", "methods", "interval", "anchorDay", "active", "version"],
        properties: {
          currency: CURRENCY,
          lines: LINES,
          totals: TOTALS,
          interval: { enum: ["month", "quarter", "year"] },
          anchorDay: { ...WHOLE_NUMBER, minimum: 1, maximum: 31 },
          nextOn: { anyOf: [{ bsonType: "null" }, DATE_TEXT] },
          endOn: { anyOf: [{ bsonType: "null" }, DATE_TEXT] },
          active: { bsonType: "bool" },
          version: { ...WHOLE_NUMBER, minimum: 1 },
        },
      });

      const expenses = db.collection("expenses");
      await expenses.createIndex({ date: -1 });
      await expenses.createIndex({ category: 1, date: -1 });
      await expenses.createIndex({ projectId: 1, date: -1 });

      const plans = db.collection("recurring_invoices");
      await plans.createIndex({ active: 1, nextOn: 1 });
      // A plan bills each of its dates once.
      await db
        .collection("invoices")
        .createIndex(
          { recurringId: 1, period: 1 },
          { unique: true, partialFilterExpression: { recurringId: { $type: "objectId" } } },
        );

      // The finance report reads payments by the day they arrived or were refunded.
      const payments = db.collection("payments");
      await payments.createIndex({ status: 1, confirmedAt: 1 });
      await payments.createIndex({ status: 1, receivedOn: 1 });
      await payments.createIndex({ refundedAt: 1 }, { partialFilterExpression: { status: "refunded" } });
    },
  },
  {
    id: "0009",
    name: "client-portal",
    async up(db) {
      // One-time sign-in links and the clients' sessions expire on their own.
      const links = db.collection("portal_links");
      await links.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await links.createIndex({ clientId: 1 });
      const sessions = db.collection("portal_sessions");
      await sessions.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      await sessions.createIndex({ clientId: 1 });

      const updates = db.collection("project_updates");
      await updates.createIndex({ projectId: 1, createdAt: -1 });
      await updates.createIndex({ clientId: 1 });

      // One open request of each kind per client.
      const requests = db.collection("privacy_requests");
      await requests.createIndex({ status: 1, createdAt: 1 });
      await requests.createIndex(
        { clientId: 1, kind: 1 },
        { unique: true, name: "one_open_request_per_kind", partialFilterExpression: { status: "open" } },
      );
      await db.collection("clients").createIndex({ "portal.enabled": 1, emailKey: 1 });
    },
  },
  {
    id: "0010",
    name: "content",
    async up(db) {
      // The site's content (server/content): one draft and one published copy per item. The first request
      // fills an empty database from content/ (seedContent), not this migration.
      const content = db.collection("content");
      await content.createIndex({ kind: 1, key: 1 }, { unique: true, name: "one_key_per_kind" });
      await content.createIndex(
        { kind: 1, "published.slug": 1 },
        {
          unique: true,
          name: "one_published_slug_per_kind",
          partialFilterExpression: { "published.slug": { $type: "string" } },
        },
      );
      await content.createIndex({ kind: 1, rank: 1 });
      await content.createIndex(
        { publishAt: 1 },
        { partialFilterExpression: { publishAt: { $type: "date" } } },
      );
      await db.collection("content_versions").createIndex({ contentId: 1, replacedAt: -1 });
      await db.collection("content_previews").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    },
  },
  {
    id: "0011",
    name: "ai-assistant",
    async up(db) {
      // The AI assistant's runs (server/ai): kept 90 days; the monthly totals in ai_months stay.
      const runs = db.collection("ai_runs");
      await runs.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
      await runs.createIndex({ createdAt: -1 });
      await runs.createIndex({ status: 1, createdAt: 1 });
      await runs.createIndex({ "target.kind": 1, "target.id": 1, feature: 1, createdAt: -1 });
      await runs.createIndex({ feature: 1, trigger: 1, createdAt: -1 });
      await runs.createIndex(
        { clientId: 1 },
        { partialFilterExpression: { clientId: { $type: "objectId" } } },
      );
      // One running request per feature and target.
      await runs.createIndex(
        { lock: 1 },
        { unique: true, name: "one_running_request", partialFilterExpression: { lock: { $type: "string" } } },
      );
      // Daily allowances (automatic triage) expire a day after their day.
      await db.collection("ai_counters").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
      // Senders who asked for no AI tools, looked up before every AI request about them.
      await db
        .collection("inquiries")
        .createIndex({ aiOptOut: 1 }, { name: "ai_opt_out", partialFilterExpression: { aiOptOut: true } });
    },
  },
];
