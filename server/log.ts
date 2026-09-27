import "server-only";
import { Writable } from "node:stream";
import pino, { type DestinationStream, type Logger } from "pino";

// Secret-looking fields are replaced before a line is written, at the top level and one level down
// (log objects stay flat: `log.info({ user, request }, "...")`).
const REDACT_PATHS = [
  "password",
  "*.password",
  "token",
  "*.token",
  "secret",
  "*.secret",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
  "headers.authorization",
  "headers.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
];

// Error lines also go to a sink once the server has started: the admin's error log (server/system/errors.ts).
// They reach it after redaction, like every other line. The sink is kept on globalThis: Next.js bundles
// instrumentation.ts (which sets it) apart from the routes and pages (which log), so each has its own copy of
// this module.
export type ErrorSink = (line: Record<string, unknown>) => void;
const store = globalThis as typeof globalThis & { __leffloardErrorSink?: ErrorSink | null };

export function setErrorSink(sink: ErrorSink | null): void {
  store.__leffloardErrorSink = sink;
}

const toErrorSink = new Writable({
  write(chunk, _encoding, done) {
    const sink = store.__leffloardErrorSink;
    if (sink) {
      try {
        sink(JSON.parse(String(chunk)) as Record<string, unknown>);
      } catch {
        // The error log is a convenience; the line is in the server's own log either way.
      }
    }
    done();
  },
});

export function createLogger(
  destination?: DestinationStream,
  level = process.env.LOG_LEVEL ?? "info",
): Logger {
  const options = {
    level,
    base: { app: "leffloard.xyz" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  return pino(
    options,
    pino.multistream([
      { stream: destination ?? pino.destination(1), level: "trace" },
      { stream: toErrorSink, level: "error" },
    ]),
  );
}

export const log = createLogger();
