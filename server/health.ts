import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import type { EnvReport } from "@/server/env";

export type CheckState = "ok" | "error" | "pending" | "skipped";

export type BackupState = "off" | "ok" | "stale" | "failed" | "unknown";

export type DeepHealth = {
  ok: boolean;
  version: string;
  checks: { env: CheckState; db: CheckState; migrations: CheckState };
  // For information: an old backup must not make a deploy roll back.
  info?: { backup: BackupState };
};

export type HealthDeps = {
  envReport: () => EnvReport;
  pingDb: () => Promise<void>;
  pendingMigrationCount: () => Promise<number>;
  backupState?: () => Promise<BackupState>;
  version: string;
  timeoutMs?: number;
};

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function deepHealth(deps: HealthDeps): Promise<DeepHealth> {
  const timeoutMs = deps.timeoutMs ?? 3_000;
  const checks: DeepHealth["checks"] = { env: "ok", db: "skipped", migrations: "skipped" };

  if (!deps.envReport().ok) {
    checks.env = "error";
  } else {
    try {
      await withTimeout(deps.pingDb(), timeoutMs);
      checks.db = "ok";
      const pending = await withTimeout(deps.pendingMigrationCount(), timeoutMs);
      checks.migrations = pending === 0 ? "ok" : "pending";
    } catch {
      if (checks.db !== "ok") checks.db = "error";
      else checks.migrations = "error";
    }
  }

  const ok = Object.values(checks).every((state) => state === "ok");
  if (!deps.backupState) return { ok, version: deps.version, checks };
  let backup: BackupState = "unknown";
  if (checks.db === "ok") {
    try {
      backup = await withTimeout(deps.backupState(), timeoutMs);
    } catch {
      backup = "unknown";
    }
  }
  return { ok, version: deps.version, checks, info: { backup } };
}

export function tokenMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}
