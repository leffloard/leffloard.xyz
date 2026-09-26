import "server-only";
import path from "node:path";
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

const KEYGEN_HINT =
  "Generate one with: node -e \"console.log('1:' + require('crypto').randomBytes(32).toString('base64'))\"";
const BACKUP_KEYGEN_HINT =
  "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\"";

export type KeyRing = { current: number; keys: ReadonlyMap<number, Buffer> };

// "2:<base64>,1:<base64>": numbered 32-byte keys. New data is encrypted with the highest number; older keys
// stay listed until everything encrypted with them has been re-encrypted. Messages never show a key.
const encryptionKeys = z
  .string({ error: `DATA_ENCRYPTION_KEYS is missing. ${KEYGEN_HINT}` })
  .trim()
  .transform((value, ctx): KeyRing => {
    const keys = new Map<number, Buffer>();
    const fail = (message: string) => {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    };
    for (const entry of value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)) {
      const match = /^(\d{1,4}):([A-Za-z0-9+/_-]+={0,2})$/.exec(entry);
      const key = match?.[2] ? Buffer.from(match[2], "base64") : undefined;
      if (!match || key?.length !== 32) {
        return fail(
          `DATA_ENCRYPTION_KEYS entries must look like 1:<32 random bytes as base64>. ${KEYGEN_HINT}`,
        );
      }
      const version = Number(match[1]);
      if (keys.has(version)) return fail(`DATA_ENCRYPTION_KEYS lists key number ${version} twice.`);
      keys.set(version, key);
    }
    if (keys.size === 0) return fail(`DATA_ENCRYPTION_KEYS is empty. ${KEYGEN_HINT}`);
    return { current: Math.max(...keys.keys()), keys };
  });

const optionalText = () =>
  z
    .string()
    .trim()
    .optional()
    .transform((value) => value || undefined);

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
  DATA_ENCRYPTION_KEYS: encryptionKeys,
  CLIENT_IP_SOURCE: z
    .enum(["socket", "cloudflare"], { error: "CLIENT_IP_SOURCE must be socket or cloudflare." })
    .default("socket"),
  TURNSTILE_SITE_KEY: optionalText(),
  TURNSTILE_SECRET_KEY: optionalText(),
  CF_ACCESS_TEAM_DOMAIN: optionalText()
    .transform((value) =>
      value
        ?.replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .toLowerCase(),
    )
    .pipe(
      z
        .string()
        .regex(
          /^[a-z0-9-]+\.cloudflareaccess\.com$/,
          "CF_ACCESS_TEAM_DOMAIN must look like your-team.cloudflareaccess.com.",
        )
        .optional(),
    ),
  CF_ACCESS_AUD: optionalText().pipe(
    z
      .string()
      .regex(/^[a-f0-9]{64}$/, "CF_ACCESS_AUD must be the 64-character Application Audience (AUD) tag.")
      .optional(),
  ),
  // Notifications: the same variable names as the v1 backend, so the existing .env values carry over.
  DISCORD_WEBHOOK_URL: optionalText().pipe(
    z
      .url({
        protocol: /^https$/,
        error: "DISCORD_WEBHOOK_URL must be the https:// address of a Discord webhook.",
      })
      .optional(),
  ),
  SMTP_HOST: optionalText(),
  SMTP_PORT: optionalText().pipe(
    z
      .string()
      .regex(/^\d{1,5}$/, "SMTP_PORT must be a port number.")
      .transform(Number)
      .refine((port) => port > 0 && port < 65536, "SMTP_PORT must be a port number.")
      .optional(),
  ),
  SMTP_SECURITY: optionalText()
    .transform((value) => value?.toLowerCase() ?? "starttls")
    .pipe(z.enum(["starttls", "ssl", "none"], { error: "SMTP_SECURITY must be starttls, ssl or none." })),
  SMTP_USERNAME: optionalText(),
  // Not trimmed: an app password may end in a space.
  SMTP_PASSWORD: z
    .string()
    .optional()
    .transform((value) => value || undefined),
  SMTP_FROM: optionalText(),
  NOTIFY_EMAIL_TO: optionalText().pipe(
    z
      .string()
      .regex(/^[^\s@]+@[^\s@]+$/, "NOTIFY_EMAIL_TO must be an email address.")
      .optional(),
  ),
  // "log" writes emails to the server log instead of sending them (development and tests).
  EMAIL_DELIVERY: optionalText()
    .transform((value) => value?.toLowerCase() ?? "smtp")
    .pipe(z.enum(["smtp", "log"], { error: "EMAIL_DELIVERY must be smtp or log." })),
  // Nightly encrypted backups. Without BACKUP_KEY the backup job is off. The key is not the data key, so
  // a backup can be kept elsewhere without giving away the secrets stored inside it.
  BACKUP_KEY: optionalText().transform((value, ctx) => {
    if (!value) return undefined;
    const key = /^[A-Za-z0-9+/_-]+={0,2}$/.test(value) ? Buffer.from(value, "base64") : undefined;
    if (key?.length !== 32) {
      ctx.addIssue({
        code: "custom",
        message: `BACKUP_KEY must be 32 random bytes as base64. ${BACKUP_KEYGEN_HINT}`,
      });
      return z.NEVER;
    }
    return key;
  }),
  BACKUP_DIR: optionalText(),
  BACKUP_KEEP: optionalText().pipe(
    z
      .string()
      .regex(/^\d{1,3}$/, "BACKUP_KEEP must be how many backups to keep (1 to 365).")
      .transform(Number)
      .refine(
        (count) => count >= 1 && count <= 365,
        "BACKUP_KEEP must be how many backups to keep (1 to 365).",
      )
      .optional(),
  ),
  // "off" for a second copy of the app (the deploy script's trial start): it serves pages but runs no jobs.
  BACKGROUND_JOBS: optionalText()
    .transform((value) => value?.toLowerCase() ?? "on")
    .pipe(z.enum(["on", "off"], { error: "BACKGROUND_JOBS must be on or off." })),
});

const checkedSchema = schema.superRefine((env, ctx) => {
  if (Boolean(env.TURNSTILE_SITE_KEY) !== Boolean(env.TURNSTILE_SECRET_KEY)) {
    ctx.addIssue({
      code: "custom",
      message: "Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither.",
    });
  }
  if (Boolean(env.CF_ACCESS_TEAM_DOMAIN) !== Boolean(env.CF_ACCESS_AUD)) {
    ctx.addIssue({
      code: "custom",
      message: "Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither.",
    });
  }
  if (env.SMTP_HOST && !env.SMTP_FROM && !env.SMTP_USERNAME) {
    ctx.addIssue({ code: "custom", message: "Set SMTP_FROM (or SMTP_USERNAME) to send email." });
  }
  if (env.NODE_ENV === "production" && env.BACKUP_DIR && !path.isAbsolute(env.BACKUP_DIR)) {
    ctx.addIssue({
      code: "custom",
      message:
        "BACKUP_DIR must be a full path (for example C:\\leffloard\\shared\\backups): the server runs in its release folder.",
    });
  }
  if (env.BACKUP_KEY && !env.BACKUP_DIR) {
    ctx.addIssue({
      code: "custom",
      message: "Set BACKUP_DIR to a folder outside the app (for example C:\\leffloard\\shared\\backups).",
    });
  }
});

// Allowed, but worth a line in the start-up log of a production server.
function productionWarnings(env: z.infer<typeof schema>): string[] {
  if (env.NODE_ENV !== "production") return [];
  const warnings: string[] = [];
  if (!env.SITE_URL.startsWith("https://"))
    warnings.push("SITE_URL is not https: sign-in cookies need https.");
  if (!env.TURNSTILE_SECRET_KEY)
    warnings.push("TURNSTILE_* is not set: sign-in and forms have no bot check.");
  if (!env.CF_ACCESS_TEAM_DOMAIN)
    warnings.push("CF_ACCESS_* is not set: /admin is protected by the sign-in only.");
  if (env.CLIENT_IP_SOURCE === "socket") {
    warnings.push("CLIENT_IP_SOURCE is socket: behind the Cloudflare Tunnel set it to cloudflare.");
  }
  if (env.EMAIL_DELIVERY === "log") {
    warnings.push("EMAIL_DELIVERY is log: emails are written to the log, not sent.");
  } else if (!env.SMTP_HOST) {
    warnings.push("SMTP_* is not set: no email alerts, and the inbox cannot send replies.");
  }
  if ((env.SMTP_HOST || env.EMAIL_DELIVERY === "log") && !env.NOTIFY_EMAIL_TO) {
    warnings.push("NOTIFY_EMAIL_TO is empty: new inquiries are not emailed to you.");
  }
  if (!env.BACKUP_KEY) warnings.push("BACKUP_KEY is not set: there are no nightly backups.");
  return warnings;
}

export type Env = z.infer<typeof schema>;

export type EnvReport =
  { ok: true; env: Env; warnings: string[] } | { ok: false; problems: string[]; warnings: string[] };

export function readEnv(source: Record<string, string | undefined> = process.env): EnvReport {
  const warnings = LEGACY_VARIABLES.filter((name) => source[name]).map(
    (name) => `${name} is only used by the old v1 backend and is ignored by this app.`,
  );
  const result = checkedSchema.safeParse(source);
  if (result.success)
    return { ok: true, env: result.data, warnings: [...warnings, ...productionWarnings(result.data)] };
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

// For tests that change the environment between cases.
export function clearEnvCache(): void {
  cached = undefined;
}

export function getEnv(): Env {
  if (cached) return cached;
  const report = readEnv();
  if (!report.ok) throw new EnvError(report.problems);
  cached = report.env;
  return cached;
}
