import "server-only";
import { getEnv, type Env } from "@/server/env";

// Which notification channels are configured. Read at send time, so a changed configuration applies to
// messages that are still waiting in the outbox.

export type SmtpSecurity = "starttls" | "ssl" | "none";

export type EmailConfig =
  | { delivery: "log"; from: string }
  | {
      delivery: "smtp";
      from: string;
      host: string;
      port: number;
      security: SmtpSecurity;
      username?: string;
      password?: string;
    };

export type Channels = {
  email: EmailConfig | null;
  // Where alerts about new inquiries go; null when email is off or NOTIFY_EMAIL_TO is empty.
  ownerEmail: string | null;
  discordWebhookUrl: string | null;
};

const DEFAULT_PORTS: Record<SmtpSecurity, number> = { starttls: 587, ssl: 465, none: 25 };

export function readChannels(env: Env = getEnv()): Channels {
  let email: EmailConfig | null = null;
  const from = env.SMTP_FROM ?? env.SMTP_USERNAME;
  if (env.EMAIL_DELIVERY === "log") {
    email = { delivery: "log", from: from ?? `leffloard.xyz <noreply@${new URL(env.SITE_URL).hostname}>` };
  } else if (env.SMTP_HOST && from) {
    email = {
      delivery: "smtp",
      from,
      host: env.SMTP_HOST,
      port: env.SMTP_PORT ?? DEFAULT_PORTS[env.SMTP_SECURITY],
      security: env.SMTP_SECURITY,
      username: env.SMTP_USERNAME,
      password: env.SMTP_PASSWORD,
    };
  }
  return {
    email,
    ownerEmail: email && env.NOTIFY_EMAIL_TO ? env.NOTIFY_EMAIL_TO : null,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL ?? null,
  };
}

export type ChannelStatus = { discord: boolean; ownerEmail: boolean; clientEmail: boolean };

export function channelStatus(channels: Channels = readChannels()): ChannelStatus {
  return {
    discord: channels.discordWebhookUrl !== null,
    ownerEmail: channels.ownerEmail !== null,
    clientEmail: channels.email !== null,
  };
}
