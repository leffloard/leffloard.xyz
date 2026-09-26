import "server-only";
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

export function createLogger(
  destination?: DestinationStream,
  level = process.env.LOG_LEVEL ?? "info",
): Logger {
  const options = {
    level,
    base: { app: "leffloard.xyz" },
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const log = createLogger();
