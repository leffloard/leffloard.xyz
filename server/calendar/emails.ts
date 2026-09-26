import "server-only";
import { site } from "@/content/site";
import { buildCalendar } from "@/lib/booking/ics";
import { ADMIN_TIME_ZONE, SHORT_MONTHS } from "@/lib/format";
import { addDays, describeMoment, todayIn, wallDateTime } from "@/lib/intake/time";
import type { MeetingDoc } from "@/server/calendar/types";
import { discordSafe, headerText, truncate } from "@/server/notify/escape";
import {
  DISCORD_EMBED_TOTAL,
  embedSize,
  type DiscordEmbed,
  type DiscordField,
  type DiscordPayload,
  type EmailMessage,
  type Mailbox,
} from "@/server/notify/templates";

// What booking emails and alerts say. The guest's own words (name, notes, answers) are untrusted: Discord
// text goes through discordSafe(), headers through headerText(), and the invite through the iCalendar
// escaping in lib/booking/ics.ts.

export type MeetingMailContext = {
  siteUrl: string;
  ownerEmail: string | null; // replies and the invite's organizer
  manageUrl: string | null; // the guest's reschedule-and-cancel link
};

const LOCATION_NOTES = {
  jitsi: "A video call in the browser (Jitsi Meet): no account or app needed.",
  discord: "On Discord.",
  custom: "",
} as const;

const weekdayShort = (at: Date, zone: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: zone, weekday: "short" }).format(at);
const clock = (at: Date, zone: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(at);
const dayMonth = (at: Date, zone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    day: "numeric",
    month: "numeric",
  }).formatToParts(at);
  // en-GB writes a numeric day with two digits next to a numeric month ("05/10").
  const day = Number(parts.find((part) => part.type === "day")?.value ?? "1");
  const month = Number(parts.find((part) => part.type === "month")?.value ?? "1");
  return `${day} ${SHORT_MONTHS[month - 1]}`;
};

// "Thu 1 Oct, 17:00": for subject lines.
export function shortMoment(at: Date, zone: string): string {
  return `${weekdayShort(at, zone)} ${dayMonth(at, zone)}, ${clock(at, zone)}`;
}

export function adminMeetingUrl(siteUrl: string, meeting: Pick<MeetingDoc, "_id">): string {
  return `${siteUrl}/admin/calendar/meetings/${meeting._id.toHexString()}`;
}

function guest(meeting: MeetingDoc): Mailbox {
  return { name: headerText(meeting.name), address: meeting.email };
}

function where(meeting: MeetingDoc): string[] {
  const lines: string[] = [];
  if (meeting.location.url) lines.push(`Where: ${meeting.location.url}`);
  else if (meeting.location.details) lines.push(`Where: ${meeting.location.details}`);
  const note = LOCATION_NOTES[meeting.location.kind];
  if (note) lines.push(note);
  return lines;
}

function whenLines(meeting: MeetingDoc): string[] {
  return [
    `When: ${describeMoment(meeting.startsAt, meeting.timeZone)}`,
    `Length: ${meeting.durationMinutes} minutes`,
  ];
}

function signature(siteUrl: string): string[] {
  return ["", "Best regards,", site.name, siteUrl];
}

// The invite: its UID stays the same for the meeting's whole life, and SEQUENCE grows with each change, so
// calendars update the one event instead of adding another. A request waiting for the owner is tentative.
export function meetingInvite(
  meeting: MeetingDoc,
  context: MeetingMailContext,
  method: "REQUEST" | "CANCEL",
): { method: "REQUEST" | "CANCEL"; content: string } {
  const description = [
    ...where(meeting),
    ...(context.manageUrl ? ["", `Reschedule or cancel: ${context.manageUrl}`] : []),
  ].join("\n");
  const content = buildCalendar({
    method,
    events: [
      {
        uid: `${meeting._id.toHexString()}@${new URL(context.siteUrl).hostname}`,
        sequence: meeting.sequence,
        stamp: meeting.updatedAt,
        summary: `${meeting.title} with ${site.name}`,
        description,
        location: meeting.location.url ?? meeting.location.details,
        url: meeting.location.url ?? undefined,
        status:
          method === "CANCEL" ? "CANCELLED" : meeting.status === "requested" ? "TENTATIVE" : "CONFIRMED",
        organizer: context.ownerEmail ? { name: site.name, email: context.ownerEmail } : undefined,
        attendee: { name: meeting.name, email: meeting.email },
        start: meeting.startsAt,
        end: meeting.endsAt,
        alarmMinutes: 15,
      },
    ],
  });
  return { method, content };
}

function guestEmail(
  meeting: MeetingDoc,
  context: MeetingMailContext,
  subject: string,
  body: string[],
  calendar?: "REQUEST" | "CANCEL",
): EmailMessage {
  const lines = [`Hi ${meeting.name},`, "", ...body, ...signature(context.siteUrl)];
  return {
    to: [guest(meeting)],
    replyTo: context.ownerEmail ? { address: context.ownerEmail } : undefined,
    subject: headerText(subject),
    text: `${lines.join("\n")}\n`,
    ...(calendar ? { calendar: meetingInvite(meeting, context, calendar) } : {}),
  };
}

function manageLines(context: MeetingMailContext): string[] {
  return context.manageUrl
    ? ["", "Need another time, or can't make it? Reschedule or cancel here:", context.manageUrl]
    : [];
}

export function bookedEmail(meeting: MeetingDoc, context: MeetingMailContext): EmailMessage {
  return guestEmail(
    meeting,
    context,
    `Booked: ${meeting.title}, ${shortMoment(meeting.startsAt, meeting.timeZone)}`,
    [
      `Your ${meeting.title.toLowerCase()} with ${site.name} is booked.`,
      "",
      ...whenLines(meeting),
      ...where(meeting),
      ...manageLines(context),
      "",
      "The invite is attached, so you can add it to your calendar.",
    ],
    "REQUEST",
  );
}

export function requestedEmail(meeting: MeetingDoc, context: MeetingMailContext): EmailMessage {
  return guestEmail(
    meeting,
    context,
    `Request received: ${meeting.title}, ${shortMoment(meeting.startsAt, meeting.timeZone)}`,
    [
      `Thanks for your request. I'll confirm it by email, usually within a day; the time is held for you until then.`,
      "",
      ...whenLines(meeting),
      ...manageLines(context),
    ],
  );
}

export function declinedEmail(
  meeting: MeetingDoc,
  context: MeetingMailContext,
  reason: string | null,
  rebookUrl: string | null,
): EmailMessage {
  const body = [
    `I'm sorry, I can't take the ${meeting.title.toLowerCase()} you asked for on ${describeMoment(meeting.startsAt, meeting.timeZone)}.`,
  ];
  if (reason) body.push("", reason);
  if (rebookUrl) body.push("", `You're welcome to pick another time: ${rebookUrl}`);
  // The cancellation removes the tentative event, if the guest added the request to their calendar.
  return guestEmail(
    meeting,
    context,
    `Not possible: ${meeting.title}, ${shortMoment(meeting.startsAt, meeting.timeZone)}`,
    body,
    "CANCEL",
  );
}

export function cancelledEmail(
  meeting: MeetingDoc,
  context: MeetingMailContext,
  rebookUrl: string | null,
): EmailMessage {
  const when = describeMoment(meeting.startsAt, meeting.timeZone);
  const body =
    meeting.cancelledBy === "guest"
      ? [`Your ${meeting.title.toLowerCase()} on ${when} is cancelled, as you asked.`]
      : [`I'm sorry, I have to cancel our ${meeting.title.toLowerCase()} on ${when}.`];
  if (meeting.cancelReason && meeting.cancelledBy === "owner") body.push("", meeting.cancelReason);
  if (rebookUrl) body.push("", `Another time? ${rebookUrl}`);
  return guestEmail(
    meeting,
    context,
    `Cancelled: ${meeting.title}, ${shortMoment(meeting.startsAt, meeting.timeZone)}`,
    body,
    "CANCEL",
  );
}

export function rescheduledEmail(meeting: MeetingDoc, context: MeetingMailContext): EmailMessage {
  return guestEmail(
    meeting,
    context,
    `New time: ${meeting.title}, ${shortMoment(meeting.startsAt, meeting.timeZone)}`,
    [
      `Our ${meeting.title.toLowerCase()} has a new time.`,
      "",
      ...whenLines(meeting),
      ...where(meeting),
      ...manageLines(context),
      "",
      "The updated invite is attached.",
    ],
    "REQUEST",
  );
}

// A request the owner moved before answering it: still a request, so no invite yet.
export function requestMovedEmail(meeting: MeetingDoc, context: MeetingMailContext): EmailMessage {
  return guestEmail(
    meeting,
    context,
    `New time proposed: ${meeting.title}, ${shortMoment(meeting.startsAt, meeting.timeZone)}`,
    [
      `I've moved the ${meeting.title.toLowerCase()} you asked for to a new time. It is still waiting for my confirmation, which comes by email.`,
      "",
      ...whenLines(meeting),
      ...manageLines(context),
    ],
  );
}

// "Today" or "Tomorrow", on the guest's calendar, for a call within the next day.
function dayWord(start: Date, zone: string, at: Date): string {
  const date = wallDateTime(start, zone).date;
  const today = todayIn(zone, at);
  if (date === today) return "Today";
  return date === addDays(today, 1) ? "Tomorrow" : "Coming up";
}

export function reminderEmail(meeting: MeetingDoc, context: MeetingMailContext, at: Date): EmailMessage {
  return guestEmail(
    meeting,
    context,
    `${dayWord(meeting.startsAt, meeting.timeZone, at)}: ${meeting.title}, ${shortMoment(meeting.startsAt, meeting.timeZone)}`,
    [
      `A reminder of our ${meeting.title.toLowerCase()}.`,
      "",
      ...whenLines(meeting),
      ...where(meeting),
      ...manageLines(context),
    ],
  );
}

// --- The owner's alerts ----------------------------------------------------------------------------------------

export type OwnerEvent = "booked" | "requested" | "rescheduled" | "cancelled";

const OWNER_TITLES: Record<OwnerEvent, string> = {
  booked: "New booking",
  requested: "Booking request (needs your answer)",
  rescheduled: "Booking moved",
  cancelled: "Booking cancelled",
};

const COLORS: Record<OwnerEvent, number> = {
  booked: 0x22d3ee,
  requested: 0xf59e0b,
  rescheduled: 0xa78bfa,
  cancelled: 0xf87171,
};

function detailLines(meeting: MeetingDoc): string[] {
  const lines = [
    `Name: ${meeting.name}`,
    `Email: ${meeting.email}`,
    `When (your time): ${describeMoment(meeting.startsAt, ADMIN_TIME_ZONE)}`,
    `When (their time): ${describeMoment(meeting.startsAt, meeting.timeZone)}`,
    `Length: ${meeting.durationMinutes} minutes`,
  ];
  if (meeting.location.url) lines.push(`Where: ${meeting.location.url}`);
  for (const answer of meeting.answers) lines.push("", `${answer.label}`, answer.value);
  if (meeting.notes) lines.push("", "Notes:", meeting.notes);
  if (meeting.cancelReason && meeting.cancelledBy === "guest")
    lines.push("", "Their reason:", meeting.cancelReason);
  return lines;
}

export function ownerMeetingEmail(
  meeting: MeetingDoc,
  event: OwnerEvent,
  { to, siteUrl }: { to: string; siteUrl: string },
): EmailMessage {
  const title = OWNER_TITLES[event];
  const lines = [
    `${title}: ${meeting.title}`,
    "",
    ...detailLines(meeting),
    "",
    `Open in the calendar: ${adminMeetingUrl(siteUrl, meeting)}`,
  ];
  return {
    to: [{ address: to }],
    replyTo: guest(meeting),
    subject: headerText(
      `${title}: ${meeting.title} with ${meeting.name}, ${shortMoment(meeting.startsAt, ADMIN_TIME_ZONE)}`,
    ),
    text: `${lines.join("\n")}\n`,
  };
}

export function ownerMeetingDiscord(meeting: MeetingDoc, event: OwnerEvent, siteUrl: string): DiscordPayload {
  const start = Math.floor(meeting.startsAt.getTime() / 1000);
  // The guest's own words: shortened, last first, when the whole embed would pass Discord's limit.
  const long: DiscordField[] = meeting.answers.map((answer) => ({
    name: truncate(discordSafe(answer.label), 256),
    value: discordSafe(answer.value),
    inline: false,
  }));
  if (meeting.notes) long.push({ name: "Notes", value: discordSafe(meeting.notes), inline: false });
  const embed: DiscordEmbed = {
    title: `${OWNER_TITLES[event]}: ${discordSafe(meeting.title, 200)}`,
    color: COLORS[event],
    description: `${meeting.durationMinutes} minutes`,
    fields: [
      { name: "Name", value: discordSafe(meeting.name), inline: true },
      { name: "Email", value: discordSafe(meeting.email), inline: true },
      { name: "When", value: `<t:${start}:F> (<t:${start}:R>)`, inline: false },
      ...long,
      {
        name: "Manage",
        value: `[Open in the calendar](${adminMeetingUrl(siteUrl, meeting)})`,
        inline: false,
      },
    ],
    footer: { text: "leffloard.xyz calendar" },
    timestamp: meeting.updatedAt.toISOString(),
    url: adminMeetingUrl(siteUrl, meeting),
  };
  let overflow = embedSize(embed) - DISCORD_EMBED_TOTAL;
  for (const field of [...long].reverse()) {
    if (overflow <= 0) break;
    const before = field.value.length;
    field.value = truncate(field.value, Math.max(40, before - overflow));
    overflow -= before - field.value.length;
  }
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}
