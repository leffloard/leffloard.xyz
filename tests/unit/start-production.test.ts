import path from "node:path";
import { describe, expect, it } from "vitest";
// The launcher is plain CommonJS, because it runs next to Next.js's server.js without a build step.
import launcher from "../../deploy/start-production.cjs";

const { parseEnvFile, applySettings, settingsFile } = launcher;

describe("the production launcher", () => {
  it("reads .env-style settings the way people write them", () => {
    const text = [
      "\uFEFF# leffloard.xyz production settings",
      "MONGO_URL=mongodb+srv://user:p%40ss@cluster0.example.mongodb.net/?retryWrites=true&w=majority",
      "export SITE_URL = https://leffloard.xyz   # the public address",
      'SMTP_FROM="Mert Kaan Koparan <me@example.com>"',
      "SMTP_PASSWORD='abcd efgh ijkl mnop'",
      'MESSAGE="line one\\nline \\"two\\""',
      "PASSWORD_WITH_HASH=abc#def",
      "EMPTY=",
      "",
      "   # indented comment",
    ].join("\r\n");
    expect(parseEnvFile(text)).toEqual({
      MONGO_URL: "mongodb+srv://user:p%40ss@cluster0.example.mongodb.net/?retryWrites=true&w=majority",
      SITE_URL: "https://leffloard.xyz",
      SMTP_FROM: "Mert Kaan Koparan <me@example.com>",
      SMTP_PASSWORD: "abcd efgh ijkl mnop",
      MESSAGE: 'line one\nline "two"',
      PASSWORD_WITH_HASH: "abc#def",
      EMPTY: "",
    });
  });

  it("names the line of a mistake, never the value", () => {
    expect(() => parseEnvFile("OK=1\nthis is a secret value")).toThrow("Line 2: expected NAME=value.");
    expect(() => parseEnvFile('A="unterminated secret')).toThrow("Line 1: the value has no closing quote.");
    expect(() => parseEnvFile("B='unterminated secret")).toThrow("Line 1: the value has no closing quote.");
    try {
      parseEnvFile("this is a secret value");
    } catch (error) {
      expect((error as Error).message).not.toContain("secret");
    }
  });

  it("lets variables that are already set win", () => {
    const env: Record<string, string | undefined> = { PORT: "3101" };
    applySettings({ PORT: "3000", MONGO_URL: "mongodb://db" }, env);
    expect(env).toEqual({ PORT: "3101", MONGO_URL: "mongodb://db" });
  });

  it("finds the shared settings file next to the releases folder", () => {
    const release = path.resolve("/leffloard/releases/20260926-120000");
    expect(settingsFile({}, release)).toBe(path.resolve("/leffloard/shared/leffloard.env"));
    expect(settingsFile({ LEFFLOARD_ENV_FILE: "/etc/leffloard.env" }, release)).toBe("/etc/leffloard.env");
  });
});
