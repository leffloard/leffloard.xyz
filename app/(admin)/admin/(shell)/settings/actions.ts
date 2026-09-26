"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import { formatDateTime, plural } from "@/lib/format";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import { unblock } from "@/server/inquiries/blocklist";
import { readChannels } from "@/server/notify/channels";
import { postDiscord } from "@/server/notify/discord";
import { sendEmail } from "@/server/notify/email";
import { sendQueuedSoon } from "@/server/notify/kick";
import { retryFailed } from "@/server/notify/outbox";
import { now } from "@/server/clock";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`No answer after ${ms / 1000} seconds.`)), ms),
    ),
  ]);
}

function reason(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 300);
}

// Sends a test straight away (not through the outbox), so the answer shows whether the channel works.
export const testChannelAction = adminAction(
  z.object({ channel: z.enum(["email", "discord"]) }),
  async ({ channel }) => {
    const channels = readChannels();
    const stamp = formatDateTime(now());
    if (channel === "email") {
      if (!channels.email) return fail("Email is not set up on the server (SMTP_* settings).");
      if (!channels.ownerEmail) return fail("Set NOTIFY_EMAIL_TO first: the test email goes there.");
      try {
        await withTimeout(
          sendEmail(
            {
              to: [{ address: channels.ownerEmail }],
              subject: "Test email from the leffloard.xyz admin",
              text: `This test was sent from the admin at ${stamp}.\n\nEmail alerts and replies from the inbox work.\n`,
            },
            channels.email,
          ),
          25_000,
        );
      } catch (error) {
        return fail(`The test email failed: ${reason(error)}`);
      }
      return ok(null, `Test email sent to ${channels.ownerEmail}.`);
    }
    if (!channels.discordWebhookUrl) return fail("DISCORD_WEBHOOK_URL is not set on the server.");
    try {
      await withTimeout(
        postDiscord(channels.discordWebhookUrl, {
          content: `Test from the leffloard.xyz admin (${stamp}): Discord alerts work.`,
          allowed_mentions: { parse: [] },
        }),
        15_000,
      );
    } catch (error) {
      return fail(`The Discord test failed: ${reason(error)}`);
    }
    return ok(null, "Test message posted to Discord.");
  },
);

export const retryFailedAction = adminAction(z.object({}), async (_input, { db }) => {
  const count = await retryFailed(db);
  if (count > 0) sendQueuedSoon();
  refresh();
  return ok(null, count ? `${plural(count, "message")} queued again.` : "Nothing had failed.");
});

export const unblockAction = adminAction(
  z.object({ key: z.string().regex(/^(email|domain):[^\s]{1,300}$/, "Unknown entry.") }),
  async ({ key }, { db, user, client }) => {
    if (!(await unblock(db, key))) return fail("That sender was not blocked.");
    await audit(db, {
      action: "inbox.sender.unblocked",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { kind: key.split(":")[0] ?? "" },
    });
    refresh();
    return ok(null, "Unblocked. New messages from them reach the inbox again.");
  },
);
