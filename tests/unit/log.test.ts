import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
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
