import "server-only";
import type { Db } from "mongodb";
import type { InquiryInput } from "@/lib/intake/form";
import { ipKey } from "@/lib/ip";
import { linkToKnownClient } from "@/server/clients/store";
import { isBlocked } from "@/server/inquiries/blocklist";
import { insertInquiry } from "@/server/inquiries/store";
import type { InquiryDoc, InquirySource } from "@/server/inquiries/types";
import { log } from "@/server/log";
import { readChannels, type Channels } from "@/server/notify/channels";
import { enqueue } from "@/server/notify/outbox";
import { discordPayload, ownerAlertEmail } from "@/server/notify/templates";

// A validated message from the contact form or the v1 API: stored, then announced on the configured
// channels. Sending happens later, from the outbox, so a slow or broken channel never fails the visitor.

// Shared by the contact form and the v1 API: five messages per address every ten minutes.
export const INTAKE_LIMIT = { limit: 5, windowMs: 10 * 60_000 };

export function intakeLimitKey(ip: string): string {
  return `intake:${ipKey(ip) ?? "unknown"}`;
}

export type IntakeOptions = { source: InquirySource; siteUrl: string | null; channels?: Channels };

export async function submitInquiry(
  db: Db,
  input: InquiryInput,
  options: IntakeOptions,
): Promise<InquiryDoc> {
  const spam = await isBlocked(db, input.email);
  const inquiry = await insertInquiry(db, input, { source: options.source, status: spam ? "spam" : "new" });
  try {
    // A message from a known client's address joins their timeline.
    inquiry.clientId = await linkToKnownClient(db, inquiry);
  } catch (error) {
    log.error({ err: error, ref: inquiry.ref }, "linking a message to its client failed");
  }
  if (!spam)
    await queueAlerts(db, inquiry, {
      siteUrl: options.siteUrl,
      channels: options.channels ?? readChannels(),
    });
  return inquiry;
}

export async function queueAlerts(
  db: Db,
  inquiry: InquiryDoc,
  { siteUrl, channels }: { siteUrl: string | null; channels: Channels },
): Promise<void> {
  const ref = { inquiryId: inquiry._id };
  const id = inquiry._id.toHexString();
  if (channels.discordWebhookUrl) {
    await enqueue(db, {
      channel: "discord",
      payload: discordPayload(inquiry, siteUrl),
      dedupeKey: `inquiry:${id}:discord`,
      label: `Discord alert for ${inquiry.ref}`,
      ref,
    });
  }
  if (channels.ownerEmail) {
    await enqueue(db, {
      channel: "email",
      payload: ownerAlertEmail(inquiry, { to: channels.ownerEmail, siteUrl }),
      dedupeKey: `inquiry:${id}:owner-email`,
      label: `Email alert for ${inquiry.ref}`,
      ref,
    });
  }
}
