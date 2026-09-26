import { describe, expect, it } from "vitest";
import { EnvError, formatProblems, readEnv } from "@/server/env";

const VALID = { MONGO_URL: "mongodb+srv://user:pass@cluster0.example.mongodb.net/?appName=leff" };

function problemsFor(overrides: Record<string, string | undefined>): string[] {
  const report = readEnv({ ...VALID, ...overrides });
  return report.ok ? [] : report.problems;
}

describe("readEnv", () => {
  it("fills in defaults for everything but MONGO_URL", () => {
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
      },
    });
  });

  it("accepts a local replica set address and trims spaces", () => {
    const report = readEnv({ MONGO_URL: "  mongodb://127.0.0.1:27027/?replicaSet=rs0  " });
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
