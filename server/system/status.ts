import "server-only";
import type { Db } from "mongodb";
import { pendingMigrations } from "@/server/db/migrate";
import type { Env } from "@/server/env";
import { readChannels } from "@/server/notify/channels";
import packageJson from "@/package.json";

// What the System page shows about the server itself: the database, the release, the configuration, and
// the Content Security Policy reports browsers sent.

export type DatabaseStatus = {
  pingMs: number | null;
  error: string | null;
  pending: string[]; // migrations not applied yet
  // Totals from dbStats: the data, its storage on disk and the indexes, in bytes.
  size: { data: number; storage: number; indexes: number; documents: number } | null;
  collections: { name: string; documents: number; bytes: number | null }[];
};

export async function databaseStatus(db: Db): Promise<DatabaseStatus> {
  const started = performance.now();
  try {
    await db.command({ ping: 1 });
  } catch (error) {
    return {
      pingMs: null,
      error: (error instanceof Error ? error.message : String(error)).slice(0, 300),
      pending: [],
      size: null,
      collections: [],
    };
  }
  const pingMs = Math.round(performance.now() - started);
  const [pending, stats, names] = await Promise.all([
    pendingMigrations(db),
    db.stats().catch(() => null),
    db.listCollections({}, { nameOnly: true }).toArray(),
  ]);
  const collections = await Promise.all(
    names
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith("system."))
      .map(async (name) => {
        const collection = db.collection(name);
        try {
          const [row] = await collection
            .aggregate<{ count: number; size: number; indexes: number }>([
              { $collStats: { storageStats: {} } },
              {
                $project: {
                  count: "$storageStats.count",
                  size: "$storageStats.size",
                  indexes: "$storageStats.totalIndexSize",
                },
              },
            ])
            .toArray();
          return { name, documents: row?.count ?? 0, bytes: row ? row.size + row.indexes : null };
        } catch {
          // Some hosted plans don't allow $collStats: the count is still worth showing.
          return { name, documents: await collection.estimatedDocumentCount(), bytes: null };
        }
      }),
  );
  return {
    pingMs,
    error: null,
    pending: pending.map((migration) => `${migration.id} ${migration.name}`),
    size: stats
      ? {
          data: Number(stats.dataSize ?? 0),
          storage: Number(stats.storageSize ?? 0),
          indexes: Number(stats.indexSize ?? 0),
          documents: Number(stats.objects ?? 0),
        }
      : null,
    collections: collections.sort((a, b) => (b.bytes ?? 0) - (a.bytes ?? 0) || b.documents - a.documents),
  };
}

export type ServerStatus = { version: string; node: string; uptimeSeconds: number; memoryBytes: number };

export function serverStatus(): ServerStatus {
  return {
    version: process.env.GIT_SHA ? `${packageJson.version}+${process.env.GIT_SHA}` : packageJson.version,
    node: process.version,
    uptimeSeconds: Math.round(process.uptime()),
    memoryBytes: process.memoryUsage().rss,
  };
}

export type Integration = { label: string; on: boolean; detail: string };

// Each outside service and security layer, and whether the server is set up for it.
export function integrations(env: Env): Integration[] {
  const channels = readChannels(env);
  return [
    {
      label: "Site address",
      on: env.SITE_URL.startsWith("https://"),
      detail: env.SITE_URL,
    },
    {
      label: "Email",
      on: channels.email !== null,
      detail: !channels.email
        ? "off: set SMTP_*"
        : channels.email.delivery === "log"
          ? "written to the server log"
          : `${channels.email.host}, alerts to ${channels.ownerEmail ?? "nobody (NOTIFY_EMAIL_TO)"}`,
    },
    {
      label: "Discord alerts",
      on: channels.discordWebhookUrl !== null,
      detail: channels.discordWebhookUrl ? "on" : "off",
    },
    {
      label: "Bot checks (Turnstile)",
      on: Boolean(env.TURNSTILE_SECRET_KEY),
      detail: env.TURNSTILE_SECRET_KEY ? "on" : "off: forms and sign-in have no bot check",
    },
    {
      label: "Cloudflare Access",
      on: Boolean(env.CF_ACCESS_TEAM_DOMAIN),
      detail: env.CF_ACCESS_TEAM_DOMAIN ?? "off: the admin is protected by the sign-in only",
    },
    {
      label: "Visitor addresses",
      on: env.CLIENT_IP_SOURCE === "cloudflare",
      detail:
        env.CLIENT_IP_SOURCE === "cloudflare"
          ? "from Cloudflare"
          : "from the connection (not behind Cloudflare)",
    },
    {
      label: "Backups",
      on: Boolean(env.BACKUP_KEY && env.BACKUP_DIR),
      detail:
        env.BACKUP_KEY && env.BACKUP_DIR ? `into ${env.BACKUP_DIR}` : "off: set BACKUP_KEY and BACKUP_DIR",
    },
    {
      label: "Crypto payments (NOWPayments)",
      on: Boolean(env.NOWPAYMENTS_API_KEY),
      detail: !env.NOWPAYMENTS_API_KEY
        ? "off"
        : env.NOWPAYMENTS_API_URL.includes("sandbox")
          ? "sandbox (test payments)"
          : "live",
    },
    {
      label: "AI assistant (Anthropic)",
      on: Boolean(env.ANTHROPIC_API_KEY),
      detail: env.ANTHROPIC_API_KEY
        ? "key set; switched on and off on the AI page"
        : "off: no ANTHROPIC_API_KEY",
    },
    {
      label: "GitHub",
      on: true,
      detail: env.GITHUB_TOKEN ? "with a token" : "without a token (60 requests an hour)",
    },
    {
      label: "Background jobs",
      on: env.BACKGROUND_JOBS === "on",
      detail: env.BACKGROUND_JOBS === "on" ? "running in this server" : "off (BACKGROUND_JOBS=off)",
    },
  ];
}

export type CspGroup = {
  directive: string;
  blockedUrl: string;
  count: number;
  lastAt: Date;
  documentUrl: string;
  sourceFile: string;
  sample: string;
  disposition: string;
};

// Content Security Policy reports from the last 30 days (they expire), by what was blocked.
export async function cspGroups(db: Db, limit = 30): Promise<CspGroup[]> {
  return db
    .collection("csp_reports")
    .aggregate<CspGroup>([
      { $sort: { receivedAt: 1 } },
      {
        $group: {
          _id: { directive: "$directive", blockedUrl: "$blockedUrl" },
          count: { $sum: 1 },
          lastAt: { $max: "$receivedAt" },
          documentUrl: { $last: "$documentUrl" },
          sourceFile: { $last: "$sourceFile" },
          sample: { $last: "$sample" },
          disposition: { $last: "$disposition" },
        },
      },
      { $sort: { lastAt: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          directive: "$_id.directive",
          blockedUrl: "$_id.blockedUrl",
          count: 1,
          lastAt: 1,
          documentUrl: 1,
          sourceFile: 1,
          sample: 1,
          disposition: 1,
        },
      },
    ])
    .toArray();
}

export async function clearCspReports(db: Db): Promise<number> {
  return (await db.collection("csp_reports").deleteMany({})).deletedCount;
}
