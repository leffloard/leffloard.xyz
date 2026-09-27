import { Writable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { createLogger } from "@/server/log";

function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  });
  return {
    stream,
    lines: () =>
      chunks
        .join("")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe("createLogger", () => {
  it("redacts secret fields at the top level and one level down", () => {
    const { stream, lines } = capture();
    const log = createLogger(stream, "info");
    log.info(
      {
        password: "hunter2",
        token: "t0ken",
        user: { email: "owner@example.com", password: "hunter2", secret: "s3cret" },
        headers: { authorization: "Bearer abc", cookie: "sid=abc", accept: "text/html" },
      },
      "login attempt",
    );
    const [line] = lines();
    expect(line).toMatchObject({
      app: "leffloard.xyz",
      msg: "login attempt",
      password: "[redacted]",
      token: "[redacted]",
      user: { email: "owner@example.com", password: "[redacted]", secret: "[redacted]" },
      headers: { authorization: "[redacted]", cookie: "[redacted]", accept: "text/html" },
    });
    expect(JSON.stringify(line)).not.toMatch(/hunter2|t0ken|s3cret|Bearer abc|sid=abc/);
  });

  it("respects the level", () => {
    const { stream, lines } = capture();
    const log = createLogger(stream, "warn");
    log.info("hidden");
    log.warn("shown");
    expect(lines().map((line) => line.msg)).toEqual(["shown"]);
  });
});

describe("the error log's sink", () => {
  // Next.js bundles instrumentation.ts (which sets the sink) apart from the routes (which log), so each has
  // its own copy of server/log.ts. Two copies here play that part.
  it("gets error lines from every copy of the logger", async () => {
    const first = await import("@/server/log");
    vi.resetModules();
    const second = await import("@/server/log");
    expect(second).not.toBe(first);
    const seen: Record<string, unknown>[] = [];
    first.setErrorSink((line) => seen.push(line));
    try {
      const logger = second.createLogger(capture().stream, "info");
      logger.warn("only a warning");
      logger.error({ job: "digest" }, "background job failed");
      await new Promise((resolve) => setImmediate(resolve));
      expect(seen).toMatchObject([{ msg: "background job failed", job: "digest", level: 50 }]);
    } finally {
      first.setErrorSink(null);
    }
  });
});
