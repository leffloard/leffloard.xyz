import "server-only";
import { site } from "@/content/site";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import type { CallSlot } from "@/lib/intake/form";
import {
  BUDGET_OPTIONS,
  optionLabel,
  SERVICE_OPTIONS,
  TIMELINE_OPTIONS,
  type InquiryKind,
  type InquiryStatus,
} from "@/lib/intake/options";
import { describeMoment, utcStamp, zonedInstant } from "@/lib/intake/time";
import type { InquiryDoc } from "@/server/inquiries/types";
import { DISCORD_DESCRIPTION_LIMIT, discordSafe, headerText, truncate } from "@/server/notify/escape";

// What notifications say. Ported from the v1 backend (notify.py) and extended for the new inquiry kinds.
// Visitor text is untrusted: Discord text goes through discordSafe(), header text through headerText().

export type Mailbox = { name?: string; address: string };
// `calendar` attaches an iCalendar invite (a meeting's REQUEST, or its CANCEL) that mail apps show as one.
export type EmailMessage = {
  to: Mailbox[];
  replyTo?: Mailbox;
  subject: string;
  text: string;
  calendar?: { method: "REQUEST" | "CANCEL"; content: string };
};

export type DiscordField = { name: string; value: string; inline: boolean };
export type DiscordEmbed = {
  title: string;
  color: number;
  description: string;
  fields: DiscordField[];
  footer: { text: string };
  timestamp: string;
  url?: string;
};
export type DiscordPayload = { embeds: DiscordEmbed[]; allowed_mentions: { parse: never[] } };

const TITLES: Record<InquiryKind, string> = {
  brief: "New project brief",
  question: "New question",
  revision: "New revision request",
  call: "New call request",
};

// How the visitor's own emails name what they sent.
const VISITOR_LABELS: Record<InquiryKind, string> = {
  brief: "project brief",
  question: "question",
  revision: "revision request",
  call: "call request",
};

const COLORS: Record<InquiryKind, number> = {
  brief: 0x34d399,
  question: 0xa78bfa,
  revision: 0xf59e0b,
  call: 0x22d3ee,
};

export type VisitorStatus = Exclude<InquiryStatus, "spam">;

const STATUS_PHRASES: Record<VisitorStatus, string> = {
  new: "is waiting for review",
  open: "is being reviewed",
  confirmed: "has been confirmed",
  done: "has been marked as completed",
  declined: "has been declined",
};

const STATUS_WORDS: Record<VisitorStatus, string> = {
  new: "new",
  open: "in review",
  confirmed: "confirmed",
  done: "completed",
  declined: "declined",
};

// Discord refuses embeds larger than this in total.
export const DISCORD_EMBED_TOTAL = 6000;

export function inboxUrl(siteUrl: string, inquiry: Pick<InquiryDoc, "_id">): string {
  return `${siteUrl}/admin/inbox/${inquiry._id.toHexString()}`;
}

function describeSlot(call: CallSlot): string {
  return `${call.date} ${call.time} (${call.timeZone}), ${call.duration} minutes`;
}

function callStart(call: CallSlot): Date | null {
  return zonedInstant(call.date, call.time, call.timeZone);
}

export function embedSize(embed: DiscordEmbed): number {
  return (
    embed.title.length +
    embed.description.length +
    embed.footer.text.length +
    embed.fields.reduce((total, field) => total + field.name.length + field.value.length, 0)
  );
}

export function discordPayload(inquiry: InquiryDoc, siteUrl: string | null): DiscordPayload {
  const fields: DiscordField[] = [
    { name: "Name", value: discordSafe(inquiry.name), inline: true },
    { name: "Email", value: discordSafe(inquiry.email), inline: true },
  ];
  const inline = (name: string, value: string | null) => {
    if (value) fields.push({ name, value: discordSafe(value), inline: true });
  };
  inline("Contact", inquiry.contact);
  inline("Company", inquiry.company);
  inline("Service", optionLabel(SERVICE_OPTIONS, inquiry.service));
  inline("Budget", optionLabel(BUDGET_OPTIONS, inquiry.budget));
  inline("Timeline", optionLabel(TIMELINE_OPTIONS, inquiry.timeline));
  if (inquiry.call) {
    let value = discordSafe(describeSlot(inquiry.call));
    const start = callStart(inquiry.call);
    if (start) value += `\n<t:${Math.floor(start.getTime() / 1000)}:F> in your time zone`;
    fields.push({ name: "Preferred time", value, inline: false });
  }
  if (inquiry.projectReference) {
    fields.push({ name: "Project", value: discordSafe(inquiry.projectReference), inline: false });
  }
  fields.push({ name: "Subject", value: discordSafe(inquiry.subject), inline: false });
  if (inquiry.links) fields.push({ name: "Links", value: discordSafe(inquiry.links), inline: false });
  if (inquiry.aiOptOut) fields.push({ name: "AI tools", value: "Not allowed by the sender", inline: false });
  if (siteUrl) {
    fields.push({
      name: "Manage",
      value: `[Open in the inbox](${inboxUrl(siteUrl, inquiry)})`,
      inline: false,
    });
  }

  const embed: DiscordEmbed = {
    title: TITLES[inquiry.kind],
    color: COLORS[inquiry.kind],
    description: discordSafe(inquiry.message, DISCORD_DESCRIPTION_LIMIT),
    fields,
    footer: { text: inquiry.ref },
    timestamp: inquiry.receivedAt.toISOString(),
  };
  if (siteUrl) embed.url = inboxUrl(siteUrl, inquiry);
  const overflow = embedSize(embed) - DISCORD_EMBED_TOTAL;
  if (overflow > 0) embed.description = truncate(embed.description, embed.description.length - overflow);
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}

function summaryLines(inquiry: InquiryDoc): string[] {
  const lines = [`Name: ${inquiry.name}`, `Email: ${inquiry.email}`];
  const add = (label: string, value: string | null) => {
    if (value) lines.push(`${label}: ${value}`);
  };
  add("Contact", inquiry.contact);
  add("Company", inquiry.company);
  add("Service", optionLabel(SERVICE_OPTIONS, inquiry.service));
  add("Budget", optionLabel(BUDGET_OPTIONS, inquiry.budget));
  add("Timeline", optionLabel(TIMELINE_OPTIONS, inquiry.timeline));
  if (inquiry.call) {
    const { date, time, timeZone, duration } = inquiry.call;
    lines.push(`Preferred time: ${date} ${time} (${timeZone})`);
    const start = callStart(inquiry.call);
    if (start) lines.push(`In UTC: ${utcStamp(start)} UTC`);
    lines.push(`Duration: ${duration} minutes`);
  }
  add("Project", inquiry.projectReference);
  lines.push(`Subject: ${inquiry.subject}`);
  if (inquiry.aiOptOut) lines.push("AI tools: not allowed by the sender");
  return lines;
}

function visitorMailbox(inquiry: InquiryDoc): Mailbox {
  return { name: headerText(inquiry.name), address: inquiry.email };
}

export function ownerAlertEmail(
  inquiry: InquiryDoc,
  { to, siteUrl }: { to: string; siteUrl: string | null },
): EmailMessage {
  const title = TITLES[inquiry.kind];
  const lines = [title, "", ...summaryLines(inquiry), "", "Message:", inquiry.message];
  if (inquiry.links) lines.push("", "Links:", inquiry.links);
  lines.push("", `Reference: ${inquiry.ref}`, `Received: ${utcStamp(inquiry.receivedAt)} UTC`);
  if (siteUrl) lines.push(`Open in the inbox: ${inboxUrl(siteUrl, inquiry)}`);
  lines.push("", `Reply to this email to answer ${inquiry.name} directly.`);
  return {
    to: [{ address: to }],
    replyTo: visitorMailbox(inquiry),
    subject: headerText(`${title} from ${inquiry.name}: ${inquiry.subject}`),
    text: `${lines.join("\n")}\n`,
  };
}

function signature(siteUrl: string | null): string[] {
  return siteUrl ? [site.name, siteUrl] : [site.name];
}

// The v1 status email: "Your call request "..." has been confirmed."
export function statusEmail(
  inquiry: InquiryDoc,
  status: VisitorStatus,
  visitorMessage: string | null,
  { ownerEmail, siteUrl }: { ownerEmail: string | null; siteUrl: string | null },
): EmailMessage {
  const label = VISITOR_LABELS[inquiry.kind];
  const lines = [`Hi ${inquiry.name},`, "", `Your ${label} "${inquiry.subject}" ${STATUS_PHRASES[status]}.`];
  if (status === "confirmed" && inquiry.scheduledAt) {
    lines.push("", `Scheduled time: ${describeMoment(inquiry.scheduledAt, inquiry.call?.timeZone ?? "UTC")}`);
    if (inquiry.call?.duration) lines.push(`Duration: ${inquiry.call.duration} minutes`);
  }
  if (visitorMessage) lines.push("", visitorMessage);
  lines.push(
    "",
    "If you have any questions, simply reply to this email.",
    "",
    "Best regards,",
    ...signature(siteUrl),
  );
  return {
    to: [visitorMailbox(inquiry)],
    replyTo: ownerEmail ? { address: ownerEmail } : undefined,
    subject: `Your ${label}: ${STATUS_WORDS[status]}`,
    text: `${lines.join("\n")}\n`,
  };
}

const receivedDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: ADMIN_TIME_ZONE,
  day: "numeric",
  month: "long",
  year: "numeric",
});

// A reply written in the inbox, with the visitor's message quoted below it as mail clients do.
export function replyEmail(
  inquiry: InquiryDoc,
  { subject, body }: { subject: string; body: string },
  { ownerEmail, siteUrl }: { ownerEmail: string | null; siteUrl: string | null },
): EmailMessage {
  const quoted = inquiry.message.split("\n").map((line) => (line ? `> ${line}` : ">"));
  const lines = [
    body,
    "",
    "-- ",
    ...signature(siteUrl),
    "",
    `On ${receivedDate.format(inquiry.receivedAt)}, ${inquiry.name} wrote:`,
    ...quoted,
  ];
  return {
    to: [visitorMailbox(inquiry)],
    replyTo: ownerEmail ? { address: ownerEmail } : undefined,
    subject: headerText(subject),
    text: `${lines.join("\n")}\n`,
  };
}

export function defaultReplySubject(inquiry: Pick<InquiryDoc, "subject">): string {
  return truncate(/^re:/i.test(inquiry.subject) ? inquiry.subject : `Re: ${inquiry.subject}`, 200);
}
