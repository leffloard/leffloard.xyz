import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { meetingInvite, ownerMeetingDiscord, reminderEmail } from "@/server/calendar/emails";
import type { MeetingDoc } from "@/server/calendar/types";
import { DISCORD_EMBED_TOTAL, embedSize } from "@/server/notify/templates";

const CONTEXT = { siteUrl: "https://leffloard.test", ownerEmail: "owner@leffloard.test", manageUrl: null };

function meeting(overrides: Partial<MeetingDoc> = {}): MeetingDoc {
  const at = new Date("2026-09-28T06:00:00Z");
  return {
    _id: new ObjectId(),
    bookingTypeId: null,
    title: "Intro call",
    startsAt: new Date("2026-10-05T14:00:00Z"),
    endsAt: new Date("2026-10-05T14:30:00Z"),
    durationMinutes: 30,
    bufferMinutes: 15,
    ownerDate: "2026-10-05",
    timeZone: "Europe/London",
    status: "confirmed",
    name: "Ada Lovelace",
    email: "ada@example.com",
    notes: "",
    answers: [],
    location: { kind: "jitsi", details: "", url: "https://meet.jit.si/leffloard-0123456789abcdef0123" },
    clientId: null,
    manageTokenHash: "0".repeat(64),
    manageTokenSealed: "",
    source: "booking",
    ownerNote: "",
    sequence: 0,
    scheduledAt: at,
    notifyGuest: true,
    reminderSentAt: null,
    cancelledBy: null,
    cancelReason: null,
    createdAt: at,
    updatedAt: at,
    purgeAt: new Date("2028-10-05T14:30:00Z"),
    ...overrides,
  };
}

describe("meeting emails", () => {
  it("marks a request's invite tentative and a confirmed one confirmed", () => {
    expect(meetingInvite(meeting({ status: "requested" }), CONTEXT, "REQUEST").content).toContain(
      "STATUS:TENTATIVE",
    );
    expect(meetingInvite(meeting(), CONTEXT, "REQUEST").content).toContain("STATUS:CONFIRMED");
    const cancelled = meetingInvite(meeting({ status: "declined", sequence: 1 }), CONTEXT, "CANCEL").content;
    expect(cancelled).toContain("METHOD:CANCEL");
    expect(cancelled).toContain("STATUS:CANCELLED");
    expect(cancelled).toContain("SEQUENCE:1");
  });

  it("names the day of a reminder on the guest's calendar", () => {
    // 15:00 in London on Monday 5 October.
    expect(reminderEmail(meeting(), CONTEXT, new Date("2026-10-04T18:00:00Z")).subject).toBe(
      "Tomorrow: Intro call, Mon 5 Oct, 15:00",
    );
    expect(reminderEmail(meeting(), CONTEXT, new Date("2026-10-05T04:00:00Z")).subject).toBe(
      "Today: Intro call, Mon 5 Oct, 15:00",
    );
  });

  it("keeps the owner's Discord alert within Discord's size limit", () => {
    const long = "x".repeat(1024);
    const payload = ownerMeetingDiscord(
      meeting({
        answers: Array.from({ length: 5 }, (_, index) => ({
          label: `Question ${index + 1} ${"?".repeat(200)}`,
          value: long,
        })),
        notes: long,
      }),
      "booked",
      "https://leffloard.test",
    );
    const embed = payload.embeds[0]!;
    expect(embedSize(embed)).toBeLessThanOrEqual(DISCORD_EMBED_TOTAL);
    // The fixed fields are untouched; the guest's words were shortened, last first.
    expect(embed.fields.map((field) => field.name).slice(0, 3)).toEqual(["Name", "Email", "When"]);
    expect(embed.fields.at(-1)?.value).toContain("/admin/calendar/meetings/");
    expect(embed.fields[3]!.value).toHaveLength(1024);
    expect(embed.fields.at(-2)!.value.length).toBeLessThan(1024);
  });
});
