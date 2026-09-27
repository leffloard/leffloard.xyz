import { describe, expect, it } from "vitest";
import { readEnv, type Env } from "@/server/env";
import { channelStatus, readChannels } from "@/server/notify/channels";
import { TEST_ENV_SOURCE } from "../helpers/env";

function env(overrides: Record<string, string> = {}): Env {
  const report = readEnv({ ...TEST_ENV_SOURCE, ...overrides });
  if (!report.ok) throw new Error(report.problems.join("\n"));
  return report.env;
}

const FULL = {
  SMTP_HOST: "smtp.leffloard.test",
  SMTP_USERNAME: "mailer@leffloard.test",
  SMTP_PASSWORD: "app-password",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
  DISCORD_WEBHOOK_URL: "https://discord.test/api/webhooks/1/token",
};

describe("readChannels", () => {
  it("turns everything off when nothing is configured", () => {
    expect(readChannels(env())).toEqual({ email: null, ownerEmail: null, discordWebhookUrl: null });
    expect(channelStatus(readChannels(env()))).toEqual({
      discord: false,
      ownerEmail: false,
      clientEmail: false,
    });
  });

  it("sends from SMTP_USERNAME when SMTP_FROM is empty, on the usual port for the security mode", () => {
    expect(readChannels(env(FULL)).email).toEqual({
      delivery: "smtp",
      from: "mailer@leffloard.test",
      host: "smtp.leffloard.test",
      port: 587,
      security: "starttls",
      username: "mailer@leffloard.test",
      password: "app-password",
    });
    expect(readChannels(env({ ...FULL, SMTP_SECURITY: "ssl" })).email).toMatchObject({ port: 465 });
    expect(readChannels(env({ ...FULL, SMTP_SECURITY: "none", SMTP_PORT: "2525" })).email).toMatchObject({
      port: 2525,
    });
  });

  // v1's /api/admin/me reported the same three switches.
  it("reports which channels work", () => {
    expect(channelStatus(readChannels(env(FULL)))).toEqual({
      discord: true,
      ownerEmail: true,
      clientEmail: true,
    });
    const noAlerts = { ...FULL, DISCORD_WEBHOOK_URL: "", NOTIFY_EMAIL_TO: "" };
    expect(channelStatus(readChannels(env(noAlerts)))).toEqual({
      discord: false,
      ownerEmail: false,
      clientEmail: true,
    });
    const noSmtp = { ...FULL, SMTP_HOST: "" };
    expect(channelStatus(readChannels(env(noSmtp)))).toEqual({
      discord: true,
      ownerEmail: false,
      clientEmail: false,
    });
  });

  it("can write emails to the log instead of sending them", () => {
    const channels = readChannels(env({ EMAIL_DELIVERY: "log", NOTIFY_EMAIL_TO: "owner@leffloard.test" }));
    expect(channels.email).toEqual({ delivery: "log", from: "leffloard.xyz <noreply@localhost>" });
    expect(channels.ownerEmail).toBe("owner@leffloard.test");
  });
});
