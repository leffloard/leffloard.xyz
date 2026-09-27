import "server-only";
import { ObjectId, type Db } from "mongodb";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { setErrorSink } from "@/server/log";

// The error log on the System page: every line the server logs at error level, kept 30 days. Lines come from
// the logger (server/log.ts) after redaction; storing one is best effort and never logs again, so a database
// that is down can't cause a loop of errors about errors.

export type ErrorLogDoc = {
  _id: ObjectId;
  at: Date;
  level: "error" | "fatal";
  message: string;
  error: { type: string | null; message: string | null; stack: string | null } | null;
  context: Record<string, string | number | boolean>;
  purgeAt: Date;
};

export function errorLog(db: Db) {
  return db.collection<ErrorLogDoc>("error_log");
}

const KEEP_MS = 30 * 24 * 3600_000;
const MAX_PER_MINUTE = 30;
// Fields worth keeping from a log line besides the error: which job, feature or record it was about.
const CONTEXT_KEYS = ["job", "feature", "goal", "ref", "action", "channel", "kind", "requestId"];

const text = (value: unknown, max: number): string | null =>
  typeof value === "string" && value ? value.slice(0, max) : null;

export function toErrorDoc(line: Record<string, unknown>, at: Date): ErrorLogDoc {
  const err = line.err && typeof line.err === "object" ? (line.err as Record<string, unknown>) : null;
  const context: ErrorLogDoc["context"] = {};
  for (const key of CONTEXT_KEYS) {
    const value = line[key];
    if (typeof value === "string") context[key] = value.slice(0, 200);
    else if (typeof value === "number" || typeof value === "boolean") context[key] = value;
  }
  return {
    _id: new ObjectId(),
    at,
    level: typeof line.level === "number" && line.level >= 60 ? "fatal" : "error",
    message: text(line.msg, 500) ?? text(err?.message, 500) ?? "(no message)",
    error: err
      ? { type: text(err.type, 100), message: text(err.message, 1000), stack: text(err.stack, 4000) }
      : null,
    context,
    purgeAt: new Date(at.getTime() + KEEP_MS),
  };
}

let rate = { minute: 0, count: 0 };

// Called once when the server starts (server/boot.ts).
export function startErrorLog(): void {
  setErrorSink((line) => {
    const at = now();
    const minute = Math.floor(at.getTime() / 60_000);
    if (rate.minute !== minute) rate = { minute, count: 0 };
    // A flood (the database down, every request failing) is sampled, not stored line by line.
    if (++rate.count > MAX_PER_MINUTE) return;
    void getDb()
      .then((db) => errorLog(db).insertOne(toErrorDoc(line, at)))
      .catch(() => undefined);
  });
}

export type ErrorGroup = {
  message: string;
  type: string | null;
  count: number;
  firstAt: Date;
  lastAt: Date;
  detail: string | null; // the error's own message, when it adds to the line's
  stack: string | null;
  context: ErrorLogDoc["context"];
};

// The same message and error type together, the latest first.
export async function errorGroups(db: Db, limit = 30): Promise<ErrorGroup[]> {
  return errorLog(db)
    .aggregate<ErrorGroup>([
      { $sort: { at: 1 } },
      {
        $group: {
          _id: { message: "$message", type: "$error.type" },
          count: { $sum: 1 },
          firstAt: { $min: "$at" },
          lastAt: { $max: "$at" },
          detail: { $last: "$error.message" },
          stack: { $last: "$error.stack" },
          context: { $last: "$context" },
        },
      },
      { $sort: { lastAt: -1 } },
      { $limit: limit },
      {
        $project: {
          _id: 0,
          message: "$_id.message",
          type: { $ifNull: ["$_id.type", null] },
          count: 1,
          firstAt: 1,
          lastAt: 1,
          detail: { $ifNull: ["$detail", null] },
          stack: { $ifNull: ["$stack", null] },
          context: 1,
        },
      },
    ])
    .toArray();
}

export async function clearErrors(db: Db): Promise<number> {
  return (await errorLog(db).deleteMany({})).deletedCount;
}
