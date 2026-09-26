import { describe, expect, it } from "vitest";
import { EnvError, formatProblems, readEnv } from "@/server/env";
import { TEST_ENV_SOURCE, TEST_KEY_1, TEST_KEY_2 } from "../helpers/env";

const VALID = TEST_ENV_SOURCE;

function problemsFor(overrides: Record<string, string | undefined>): string[] {
  const report = readEnv({ ...VALID, ...overrides });
  return report.ok ? [] : report.problems;
}

describe("readEnv", () => {
  it("fills in defaults for everything but MONGO_URL and DATA_ENCRYPTION_KEYS", () => {
    const report = readEnv(VALID);
    expect(report).toEqual({
      ok: true,
      warnings: [],
      env: {
        NODE_ENV: "development",
        MONGO_URL: VALID.MONGO_URL,
        DB_NAME: "leffloard",
        SITE_URL: "http://localhost:3000",
        HEALTH_TOKEN: undefined,
        LOG_LEVEL: "info",
        DATA_ENCRYPTION_KEYS: { current: 1, keys: new Map([[1, Buffer.alloc(32, 1)]]) },
        CLIENT_IP_SOURCE: "socket",
        TURNSTILE_SITE_KEY: undefined,
        TURNSTILE_SECRET_KEY: undefined,
        CF_ACCESS_TEAM_DOMAIN: undefined,
        CF_ACCESS_AUD: undefined,
        DISCORD_WEBHOOK_URL: undefined,
        SMTP_HOST: undefined,
        SMTP_PORT: undefined,
        SMTP_SECURITY: "starttls",
        SMTP_USERNAME: undefined,
        SMTP_PASSWORD: undefined,
        SMTP_FROM: undefined,
        NOTIFY_EMAIL_TO: undefined,
        EMAIL_DELIVERY: "smtp",
        BACKUP_KEY: undefined,
        BACKUP_DIR: undefined,
        BACKUP_KEEP: undefined,
        BACKGROUND_JOBS: "on",
      },
    });
  });

  it("accepts a local replica set address and trims spaces", () => {
    const report = readEnv({ ...VALID, MONGO_URL: "  mongodb://127.0.0.1:27027/?replicaSet=rs0  " });
    expect(report.ok && report.env.MONGO_URL).toBe("mongodb://127.0.0.1:27027/?replicaSet=rs0");
  });

  it("explains a missing or empty MONGO_URL", () => {
    expect(problemsFor({ MONGO_URL: undefined })).toEqual([
      "MONGO_URL is missing. Put your MongoDB connection string in .env.local.",
    ]);
    expect(problemsFor({ MONGO_URL: "   " })).toEqual([
      "MONGO_URL is empty. Put your MongoDB connection string in .env.local.",
    ]);
  });

  it.each([
    ["MONGO_URL=mongodb+srv://u:p@c.mongodb.net", "'MONGO_URL=' is written twice"],
    ['"mongodb+srv://u:p@c.mongodb.net"', "remove the quotes or <> around the address"],
    ["<mongodb+srv://u:p@c.mongodb.net>", "remove the quotes or <> around the address"],
    ["MONGODB_URI=mongodb+srv://u:p@c.mongodb.net", "paste only the address, not 'MONGODB_URI='"],
  ])("gives a hint for the common paste mistake %s", (value, hint) => {
    const [problem] = problemsFor({ MONGO_URL: value });
    expect(problem).toContain("MONGO_URL must start with mongodb:// or mongodb+srv://");
    expect(problem).toContain(hint);
  });

  it.each([
    ["MONGO_URL=mongodb+srv://leff:S3cretPassw0rd@c.mongodb.net", 'starts with "MONGO_URL=mongodb+srv://…"'],
    ["mongdb://u:S3cretPassw0rd@c.mongodb.net", 'starts with "mongdb://…"'],
    ["u:S3cretPassw0rd@c.mongodb.net", 'starts with "u…"'],
  ])("never repeats any part of the password in %s", (value, shown) => {
    const [problem] = problemsFor({ MONGO_URL: value });
    expect(problem).toContain(shown);
    expect(problem).not.toMatch(/S3c/);
  });

  it("normalises SITE_URL and rejects addresses that are not http(s)", () => {
    const report = readEnv({ ...VALID, SITE_URL: "https://leffloard.xyz/" });
    expect(report.ok && report.env.SITE_URL).toBe("https://leffloard.xyz");
    for (const value of ["leffloard.xyz", "ftp://leffloard.xyz", "javascript:alert(1)"]) {
      expect(problemsFor({ SITE_URL: value })).toEqual([
        "SITE_URL must be a full http(s) address such as https://leffloard.xyz.",
      ]);
    }
  });

  it("checks DB_NAME and HEALTH_TOKEN", () => {
    expect(problemsFor({ DB_NAME: "my db" })).toEqual([
      "DB_NAME may only use letters, digits, '_' and '-' (max 63).",
    ]);
    expect(problemsFor({ HEALTH_TOKEN: "short" })).toEqual(["HEALTH_TOKEN must be at least 24 characters."]);
    const report = readEnv({ ...VALID, HEALTH_TOKEN: "" });
    expect(report.ok && report.env.HEALTH_TOKEN).toBeUndefined();
  });

  it("reports every problem at once, in plain English", () => {
    expect(problemsFor({ MONGO_URL: undefined, DB_NAME: "a.b", LOG_LEVEL: "loud" })).toEqual([
      "MONGO_URL is missing. Put your MongoDB connection string in .env.local.",
      "DB_NAME may only use letters, digits, '_' and '-' (max 63).",
      "LOG_LEVEL must be one of: fatal, error, warn, info, debug, trace, silent.",
    ]);
  });

  it("reads numbered encryption keys and uses the highest number for new data", () => {
    const report = readEnv({ ...VALID, DATA_ENCRYPTION_KEYS: ` 1:${TEST_KEY_1} , 2:${TEST_KEY_2} ` });
    expect(report.ok && report.env.DATA_ENCRYPTION_KEYS.current).toBe(2);
    expect(report.ok && [...report.env.DATA_ENCRYPTION_KEYS.keys.keys()]).toEqual([1, 2]);
  });

  it.each([
    [undefined, "DATA_ENCRYPTION_KEYS is missing."],
    ["", "DATA_ENCRYPTION_KEYS is empty."],
    [TEST_KEY_1, "DATA_ENCRYPTION_KEYS entries must look like 1:<32 random bytes as base64>."],
    [`1:${Buffer.alloc(16, 7).toString("base64")}`, "DATA_ENCRYPTION_KEYS entries must look like"],
    [`1:${TEST_KEY_1},1:${TEST_KEY_2}`, "DATA_ENCRYPTION_KEYS lists key number 1 twice."],
  ])("explains a bad DATA_ENCRYPTION_KEYS (%j) without showing the key", (value, message) => {
    const [problem] = problemsFor({ DATA_ENCRYPTION_KEYS: value });
    expect(problem).toContain(message);
    expect(problem).not.toContain(TEST_KEY_1);
    expect(problem).not.toContain(TEST_KEY_2);
  });

  it("wants Turnstile and Cloudflare Access settings in pairs", () => {
    expect(problemsFor({ TURNSTILE_SITE_KEY: "0x4AAAAAAA" })).toEqual([
      "Set both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither.",
    ]);
    expect(problemsFor({ CF_ACCESS_AUD: "a".repeat(64) })).toEqual([
      "Set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither.",
    ]);
    const report = readEnv({
      ...VALID,
      CF_ACCESS_TEAM_DOMAIN: "https://Leff.cloudflareaccess.com/",
      CF_ACCESS_AUD: "a".repeat(64),
    });
    expect(report.ok && report.env.CF_ACCESS_TEAM_DOMAIN).toBe("leff.cloudflareaccess.com");
    expect(problemsFor({ CF_ACCESS_TEAM_DOMAIN: "leff.example.com", CF_ACCESS_AUD: "a".repeat(64) })).toEqual(
      ["CF_ACCESS_TEAM_DOMAIN must look like your-team.cloudflareaccess.com."],
    );
  });

  it("lists what a production server is missing, without failing", () => {
    const report = readEnv({ ...VALID, NODE_ENV: "production", SITE_URL: "http://leffloard.xyz" });
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([
      "SITE_URL is not https: sign-in cookies need https.",
      "TURNSTILE_* is not set: sign-in and forms have no bot check.",
      "CF_ACCESS_* is not set: /admin is protected by the sign-in only.",
      "CLIENT_IP_SOURCE is socket: behind the Cloudflare Tunnel set it to cloudflare.",
      "SMTP_* is not set: no email alerts, and the inbox cannot send replies.",
      "BACKUP_KEY is not set: there are no nightly backups.",
    ]);
  });

  it("reads the backup settings, and wants a folder with the key", () => {
    const key = Buffer.alloc(32, 3).toString("base64");
    const report = readEnv({
      ...VALID,
      BACKUP_KEY: key,
      BACKUP_DIR: "C:\\leffloard\\shared\\backups",
      BACKUP_KEEP: "30",
    });
    expect(report.ok && report.env).toMatchObject({ BACKUP_KEY: Buffer.alloc(32, 3), BACKUP_KEEP: 30 });
    expect(problemsFor({ BACKUP_KEY: key })).toEqual([
      "Set BACKUP_DIR to a folder outside the app (for example C:\\leffloard\\shared\\backups).",
    ]);
    const [problem] = problemsFor({ BACKUP_KEY: "short-secret-value", BACKUP_DIR: "/backups" });
    expect(problem).toMatch(/^BACKUP_KEY must be 32 random bytes as base64/);
    expect(problem).not.toContain("short-secret-value");
    expect(problemsFor({ BACKUP_KEEP: "0" })).toEqual([
      "BACKUP_KEEP must be how many backups to keep (1 to 365).",
    ]);
    expect(problemsFor({ BACKGROUND_JOBS: "maybe" })).toEqual(["BACKGROUND_JOBS must be on or off."]);
    // The production server runs in its release folder, so a relative folder would move with every deploy.
    const production = { NODE_ENV: "production", BACKUP_KEY: key };
    expect(problemsFor({ ...production, BACKUP_DIR: "backups" })[0]).toMatch(
      /^BACKUP_DIR must be a full path/,
    );
    expect(problemsFor({ ...production, BACKUP_DIR: "/var/backups/leffloard" })).toEqual([]);
  });

  it("reads the v1 notification settings under the same names", () => {
    const report = readEnv({
      ...VALID,
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USERNAME: "me@gmail.com",
      SMTP_PASSWORD: "app password ",
      SMTP_SECURITY: "SSL",
      NOTIFY_EMAIL_TO: "me@gmail.com",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token",
    });
    expect(report.ok && report.env).toMatchObject({
      SMTP_HOST: "smtp.gmail.com",
      SMTP_SECURITY: "ssl",
      SMTP_PASSWORD: "app password ",
      NOTIFY_EMAIL_TO: "me@gmail.com",
      DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/1/token",
    });
  });

  it("explains wrong notification settings without repeating them", () => {
    const problems = problemsFor({
      SMTP_HOST: "smtp.example.com",
      SMTP_PORT: "smtp",
      SMTP_SECURITY: "tls",
      NOTIFY_EMAIL_TO: "me",
      EMAIL_DELIVERY: "carrier-pigeon",
      DISCORD_WEBHOOK_URL: "http://discord.com/api/webhooks/1/SECRET-TOKEN",
    });
    expect(problems).toEqual([
      "DISCORD_WEBHOOK_URL must be the https:// address of a Discord webhook.",
      "SMTP_PORT must be a port number.",
      "SMTP_SECURITY must be starttls, ssl or none.",
      "NOTIFY_EMAIL_TO must be an email address.",
      "EMAIL_DELIVERY must be smtp or log.",
    ]);
    expect(problems.join(" ")).not.toContain("SECRET-TOKEN");
    expect(problemsFor({ SMTP_HOST: "smtp.example.com" })).toEqual([
      "Set SMTP_FROM (or SMTP_USERNAME) to send email.",
    ]);
    expect(problemsFor({ SMTP_PORT: "70000" })).toEqual(["SMTP_PORT must be a port number."]);
  });

  it("warns when production mail is only logged, or alerts have nowhere to go", () => {
    const base = {
      ...VALID,
      NODE_ENV: "production",
      SITE_URL: "https://leffloard.xyz",
      CLIENT_IP_SOURCE: "cloudflare",
    };
    const logged = readEnv({ ...base, EMAIL_DELIVERY: "log" });
    expect(logged.warnings).toContain("EMAIL_DELIVERY is log: emails are written to the log, not sent.");
    expect(logged.warnings).toContain("NOTIFY_EMAIL_TO is empty: new inquiries are not emailed to you.");
    const smtp = readEnv({
      ...base,
      SMTP_HOST: "smtp.gmail.com",
      SMTP_USERNAME: "me@gmail.com",
      NOTIFY_EMAIL_TO: "me@gmail.com",
    });
    expect(smtp.warnings.filter((warning) => /SMTP|NOTIFY|EMAIL/.test(warning))).toEqual([]);
  });

  it("warns about variables only the v1 backend used", () => {
    const report = readEnv({ ...VALID, ADMIN_JWT_SECRET: "x", CORS_ORIGINS: "" });
    expect(report.warnings).toEqual([
      "ADMIN_JWT_SECRET is only used by the old v1 backend and is ignored by this app.",
    ]);
  });
});

describe("formatProblems / EnvError", () => {
  it("prints a readable list", () => {
    expect(formatProblems(["A is wrong.", "B is missing."])).toBe(
      "The configuration has problems:\n  - A is wrong.\n  - B is missing.",
    );
    const error = new EnvError(["A is wrong."]);
    expect(error.message).toBe("The configuration has problems:\n  - A is wrong.");
    expect(error.problems).toEqual(["A is wrong."]);
  });
});
