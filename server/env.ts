import "server-only";
import { z } from "zod";

// Variables that only the v1 FastAPI backend read. They are harmless but ignored here.
const LEGACY_VARIABLES = [
  "ADMIN_PASSWORD_HASH",
  "ADMIN_JWT_SECRET",
  "CORS_ORIGINS",
  "FRONTEND_DIST",
  "TRUST_PROXY",
] as const;

// The start of a wrong value, cut before anything that could be a password.
function visibleStart(value: string): string {
  const schemeEnd = value.indexOf("//");
  if (schemeEnd !== -1) return value.slice(0, schemeEnd + 2);
  return (value.split(/[:@]/)[0] ?? "").slice(0, 12);
}

const mongoUrl = z
  .string({ error: "MONGO_URL is missing. Put your MongoDB connection string in .env.local." })
  .trim()
  .min(1, "MONGO_URL is empty. Put your MongoDB connection string in .env.local.")
  .superRefine((value, ctx) => {
    if (!value || /^mongodb(\+srv)?:\/\//.test(value)) return;
    const hints: string[] = [];
    if (/^MONGO_URL\s*=/i.test(value)) hints.push("'MONGO_URL=' is written twice");
    if (/^["'<“”]/.test(value)) hints.push("remove the quotes or <> around the address");
    if (/^MONGODB_URI\s*=/i.test(value)) hints.push("paste only the address, not 'MONGODB_URI='");
    ctx.addIssue({
      code: "custom",
      message:
        `MONGO_URL must start with mongodb:// or mongodb+srv:// (it starts with "${visibleStart(value)}…")` +
        (hints.length ? ` - ${hints.join("; ")}.` : "."),
    });
  });

const siteUrl = z
  .string()
  .trim()
  .default("http://localhost:3000")
  .transform((value) => value.replace(/\/+$/, ""))
  .pipe(
    z.url({
      protocol: /^https?$/,
      error: "SITE_URL must be a full http(s) address such as https://leffloard.xyz.",
    }),
  );

const LOG_LEVELS = ["fatal", "error", "warn", "info", "debug", "trace", "silent"] as const;

const schema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"], {
      error: "NODE_ENV must be development, production or test.",
    })
    .default("development"),
  MONGO_URL: mongoUrl,
  DB_NAME: z
    .string()
    .trim()
    .default("leffloard")
    .pipe(
      z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,63}$/, "DB_NAME may only use letters, digits, '_' and '-' (max 63)."),
    ),
  SITE_URL: siteUrl,
  HEALTH_TOKEN: z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined)
    .pipe(z.string().min(24, "HEALTH_TOKEN must be at least 24 characters.").optional()),
  LOG_LEVEL: z
    .enum(LOG_LEVELS, { error: `LOG_LEVEL must be one of: ${LOG_LEVELS.join(", ")}.` })
    .default("info"),
});

export type Env = z.infer<typeof schema>;

export type EnvReport =
  { ok: true; env: Env; warnings: string[] } | { ok: false; problems: string[]; warnings: string[] };

export function readEnv(source: Record<string, string | undefined> = process.env): EnvReport {
  const warnings = LEGACY_VARIABLES.filter((name) => source[name]).map(
    (name) => `${name} is only used by the old v1 backend and is ignored by this app.`,
  );
  const result = schema.safeParse(source);
  if (result.success) return { ok: true, env: result.data, warnings };
  const problems = result.error.issues.map((issue) => issue.message);
  return { ok: false, problems, warnings };
}

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(formatProblems(problems));
    this.name = "EnvError";
  }
}

export function formatProblems(problems: string[]): string {
  return ["The configuration has problems:", ...problems.map((problem) => `  - ${problem}`)].join("\n");
}

let cached: Env | undefined;

export function getEnv(): Env {
  if (cached) return cached;
  const report = readEnv();
  if (!report.ok) throw new EnvError(report.problems);
  cached = report.env;
  return cached;
}
