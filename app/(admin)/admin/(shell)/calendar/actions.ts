"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import {
  BUFFERS,
  checkIntervals,
  checkOverrides,
  DURATIONS,
  STEPS,
  type Availability,
} from "@/lib/booking/availability";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import {
  dateSchema,
  emailSchema,
  fieldError,
  idSchema,
  notesText,
  optionalIdSchema,
  requiredText,
  text,
  timeSchema,
  timeZoneSchema,
} from "@/lib/forms";
import { zonedInstant } from "@/lib/intake/time";
import { adminAction } from "@/server/auth/action";
import { BLOCK_KINDS, createBlock, deleteBlock } from "@/server/calendar/blocks";
import {
  ownerApprove,
  ownerCancel,
  ownerCreate,
  ownerDecline,
  ownerReschedule,
  PROBLEM_MESSAGES,
} from "@/server/calendar/booking";
import {
  createBookingType,
  deleteBookingType,
  rotateLinkKey,
  SLUG_PATTERN,
  SlugTakenError,
  updateBookingType,
} from "@/server/calendar/booking-types";
import { getMeeting, linkMeetingClient, setOwnerNote } from "@/server/calendar/meetings";
import { notifyContext } from "@/server/calendar/public";
import {
  disableFeed,
  rotateFeedToken,
  saveAvailability,
  StaleSettingsError,
} from "@/server/calendar/settings";
import { createClient, getClient } from "@/server/clients/store";
import { getEnv } from "@/server/env";
import { sendQueuedSoon } from "@/server/notify/kick";

const NOT_FOUND = "This meeting no longer exists.";

// A date and time in the owner's time zone, as one instant on the quarter hour.
function ownerInstant(date: string, time: string): Date | null {
  const at = zonedInstant(date, time, ADMIN_TIME_ZONE);
  return at && at.getTime() % (15 * 60_000) === 0 ? at : null;
}

const reasonText = text({ maxLength: 1000, multiline: true });

// A number from a fixed list (durations, buffers, steps).
function oneOf(values: readonly number[], message: string) {
  return z.coerce.number().refine((value) => values.includes(value), message);
}

// --- Meetings --------------------------------------------------------------------------------------------------

export const approveMeetingAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  const approved = await ownerApprove(db, new ObjectId(input.id), notifyContext());
  if (!approved) return fail("This request is no longer waiting.");
  sendQueuedSoon();
  refresh();
  return ok(null, "Confirmed. The guest gets the invite by email.");
});

export const declineMeetingAction = adminAction(
  z.object({ id: idSchema, reason: reasonText }),
  async (input, { db }) => {
    const declined = await ownerDecline(db, new ObjectId(input.id), input.reason, notifyContext());
    if (!declined) return fail("This request is no longer waiting.");
    sendQueuedSoon();
    refresh();
    return ok(null, "Declined. The guest is told by email, and the time is free again.");
  },
);

export const cancelMeetingAction = adminAction(
  z.object({ id: idSchema, reason: reasonText, tellGuest: z.boolean().default(true) }),
  async (input, { db }) => {
    const cancelled = await ownerCancel(db, new ObjectId(input.id), input.reason, notifyContext(), {
      tellGuest: input.tellGuest,
    });
    if (!cancelled) return fail("This meeting has already ended or been cancelled.");
    sendQueuedSoon();
    refresh();
    return ok(null, input.tellGuest ? "Cancelled. The guest is told by email." : "Cancelled.");
  },
);

export const rescheduleMeetingAction = adminAction(
  z.object({ id: idSchema, date: dateSchema, time: timeSchema, tellGuest: z.boolean().default(true) }),
  async (input, { db }) => {
    if (!input.date) return fieldError("date", "Choose the day.");
    if (!input.time) return fieldError("time", "Choose the time.");
    const start = ownerInstant(input.date, input.time);
    if (!start) return fieldError("time", "Use a time on the quarter hour that exists on that day.");
    const moved = await ownerReschedule(db, new ObjectId(input.id), start, notifyContext(), {
      tellGuest: input.tellGuest,
    });
    if (!moved.ok)
      return fail(
        moved.problem === "taken" ? "That time overlaps another meeting." : PROBLEM_MESSAGES[moved.problem],
      );
    sendQueuedSoon();
    refresh();
    return ok(null, input.tellGuest ? "Moved. The guest gets the new time by email." : "Moved.");
  },
);

export const saveMeetingNoteAction = adminAction(
  z.object({ id: idSchema, note: notesText(5000) }),
  async (input, { db }) => {
    if (!(await setOwnerNote(db, new ObjectId(input.id), input.note))) return fail(NOT_FOUND);
    refresh();
    return ok(null, "Note saved.");
  },
);

// Links the meeting to a client, creating the client from the guest when asked.
export const linkMeetingClientAction = adminAction(
  z.object({ id: idSchema, clientId: optionalIdSchema, create: z.boolean().default(false) }),
  async (input, { db }) => {
    const meeting = await getMeeting(db, new ObjectId(input.id));
    if (!meeting) return fail(NOT_FOUND);
    let clientId: ObjectId | null = input.clientId ? new ObjectId(input.clientId) : null;
    if (input.create) {
      const client = await createClient(db, {
        name: meeting.name,
        company: null,
        email: meeting.email,
        phone: null,
        website: null,
        location: null,
        timeZone: meeting.timeZone,
        currency: "USD",
        status: "lead",
        tags: [],
        notes: "",
        source: "Booked a call",
      });
      clientId = client._id;
    } else if (clientId && !(await getClient(db, clientId))) {
      return fail("That client no longer exists.");
    }
    await linkMeetingClient(db, meeting._id, clientId);
    refresh();
    return ok(null, clientId ? "Linked to the client." : "No longer linked.");
  },
);

export const createMeetingAction = adminAction(
  z.object({
    title: requiredText(120, "Name the meeting."),
    clientId: optionalIdSchema,
    name: text({ maxLength: 100 }),
    email: emailSchema,
    date: dateSchema,
    time: timeSchema,
    duration: oneOf(DURATIONS, "Choose a length from the list."),
    timeZone: timeZoneSchema,
    location: z.enum(["jitsi", "discord", "custom"]),
    locationDetails: text({ maxLength: 300 }),
    ownerNote: notesText(5000),
    tellGuest: z.boolean().default(true),
  }),
  async (input, { db }) => {
    if (!input.date) return fieldError("date", "Choose the day.");
    if (!input.time) return fieldError("time", "Choose the time.");
    const start = ownerInstant(input.date, input.time);
    if (!start) return fieldError("time", "Use a time on the quarter hour that exists on that day.");
    const client = input.clientId ? await getClient(db, new ObjectId(input.clientId)) : null;
    if (input.clientId && !client) return fieldError("clientId", "That client no longer exists.");
    const name = input.name ?? client?.name ?? null;
    const email = input.email ?? client?.email ?? null;
    if (!name) return fieldError("name", "Who is the meeting with?");
    if (!email) return fieldError("email", "Add their email address, or choose a client that has one.");
    const created = await ownerCreate(
      db,
      {
        title: input.title,
        startsAt: start,
        durationMinutes: input.duration,
        timeZone: input.timeZone ?? client?.timeZone ?? ADMIN_TIME_ZONE,
        name,
        email,
        location: input.location,
        locationDetails: input.locationDetails ?? "",
        clientId: client?._id ?? null,
        ownerNote: input.ownerNote,
        tellGuest: input.tellGuest,
      },
      notifyContext(),
    );
    if (!created.ok) return fieldError("time", "That time overlaps another meeting.");
    sendQueuedSoon();
    redirect(`/admin/calendar/meetings/${created.meeting._id.toHexString()}`);
  },
);

// --- Blocks ----------------------------------------------------------------------------------------------------

export const createBlockAction = adminAction(
  z.object({
    title: requiredText(80, "Name the block, for example School."),
    kind: z.enum(BLOCK_KINDS as [string, ...string[]]),
    startDate: dateSchema,
    startTime: timeSchema,
    endDate: dateSchema,
    endTime: timeSchema,
  }),
  async (input, { db }) => {
    if (!input.startDate) return fieldError("startDate", "Choose the first day.");
    const endDate = input.endDate ?? input.startDate;
    const start = zonedInstant(input.startDate, input.startTime ?? "00:00", ADMIN_TIME_ZONE);
    // No end time: the block lasts to the end of its last day.
    const end = input.endTime
      ? zonedInstant(endDate, input.endTime, ADMIN_TIME_ZONE)
      : zonedInstant(endDate, "23:59", ADMIN_TIME_ZONE);
    if (!start || !end) return fieldError("startTime", "Those times don't exist on those days.");
    const endsAt = input.endTime ? end : new Date(end.getTime() + 60_000);
    if (endsAt <= start) return fieldError("endTime", "The block has to end after it starts.");
    if (endsAt.getTime() - start.getTime() > 60 * 86_400_000)
      return fieldError("endDate", "Keep a block under 60 days.");
    await createBlock(db, {
      title: input.title,
      kind: input.kind as (typeof BLOCK_KINDS)[number],
      startsAt: start,
      endsAt,
    });
    refresh();
    return ok(null, "Block added. No one can book over it.");
  },
);

export const deleteBlockAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await deleteBlock(db, new ObjectId(input.id)))) return fail("That block no longer exists.");
  refresh();
  return ok(null, "Block removed.");
});

// --- Hours and rules -------------------------------------------------------------------------------------------

const intervalSchema = z.object({ start: z.string().max(5), end: z.string().max(5) });

export const saveAvailabilityAction = adminAction(
  z.object({
    version: z.number().int().min(0),
    timeZone: timeZoneSchema,
    weekly: z.array(z.array(intervalSchema).max(10)).length(7),
    overrides: z
      .array(z.object({ date: z.string().max(10), intervals: z.array(intervalSchema).max(10) }))
      .max(200),
    bufferMinutes: oneOf(BUFFERS, "Choose a gap from the list."),
    stepMinutes: oneOf(STEPS, "Choose a step from the list."),
    minNoticeHours: z
      .number("Enter a number of hours.")
      .int("Use whole hours.")
      .min(0, "Use 0 or more hours.")
      .max(24 * 14, "At most 336 hours (14 days)."),
    horizonDays: z
      .number("Enter a number of days.")
      .int("Use whole days.")
      .min(1, "At least 1 day.")
      .max(180, "At most 180 days."),
    dailyCap: z
      .number("Enter a number.")
      .int("Use a whole number.")
      .min(0, "Use 0 for no limit.")
      .max(20, "At most 20 a day."),
  }),
  async (input, { db }) => {
    const weekly: Availability["weekly"] = [];
    for (const [index, day] of input.weekly.entries()) {
      const checked = checkIntervals(day);
      if (!checked.ok) return fieldError(`weekly.${index}`, checked.message);
      weekly.push(checked.value);
    }
    const overrides = checkOverrides(input.overrides);
    if (!overrides.ok) return fieldError("overrides", overrides.message);
    try {
      await saveAvailability(
        db,
        {
          timeZone: input.timeZone ?? ADMIN_TIME_ZONE,
          weekly,
          overrides: overrides.value,
          bufferMinutes: input.bufferMinutes,
          stepMinutes: input.stepMinutes,
          minNoticeMinutes: input.minNoticeHours * 60,
          horizonDays: input.horizonDays,
          dailyCap: input.dailyCap,
        },
        input.version,
      );
    } catch (error) {
      if (error instanceof StaleSettingsError) return fail(error.message);
      throw error;
    }
    refresh();
    return ok(null, "Hours saved. The booking pages show them at once.");
  },
);

// The feed's address holds its secret, so it is shown once, when it is made.
export const rotateFeedAction = adminAction(
  z.object({}),
  async (_input, { db }) => {
    const token = await rotateFeedToken(db);
    refresh();
    return ok(
      { url: `${getEnv().SITE_URL}/api/calendar/feed/${token}.ics` },
      "New feed address made. Any old one stopped working.",
    );
  },
  { sudo: true },
);

export const disableFeedAction = adminAction(
  z.object({}),
  async (_input, { db }) => {
    await disableFeed(db);
    refresh();
    return ok(null, "The feed is off.");
  },
  { sudo: true },
);

// --- Booking types ---------------------------------------------------------------------------------------------

const bookingTypeFields = z.object({
  slug: z
    .string()
    .max(60)
    .transform((value) => value.trim().toLowerCase())
    .refine(
      (value) => SLUG_PATTERN.test(value),
      "Use lower-case letters, digits and dashes, like intro-call.",
    ),
  title: requiredText(80, "Name the call."),
  description: notesText(500),
  durationMinutes: oneOf(DURATIONS, "Choose a length from the list."),
  visibility: z.enum(["public", "secret"]),
  requiresApproval: z.boolean(),
  location: z.enum(["jitsi", "discord", "custom"]),
  locationDetails: notesText(300),
  questions: z
    .array(z.object({ label: requiredText(200, "Write the question or remove it."), required: z.boolean() }))
    .max(5),
  active: z.boolean(),
});

function typeInput(input: z.infer<typeof bookingTypeFields>) {
  return {
    slug: input.slug,
    title: input.title,
    description: input.description,
    durationMinutes: input.durationMinutes,
    visibility: input.visibility,
    requiresApproval: input.requiresApproval,
    location: { kind: input.location, details: input.locationDetails },
    questions: input.questions,
    active: input.active,
  };
}

export const createBookingTypeAction = adminAction(bookingTypeFields, async (input, { db }) => {
  try {
    await createBookingType(db, typeInput(input));
  } catch (error) {
    if (error instanceof SlugTakenError) return fieldError("slug", error.message);
    throw error;
  }
  refresh();
  return ok(null, "Booking type added.");
});

export const updateBookingTypeAction = adminAction(
  bookingTypeFields.extend({ id: idSchema }),
  async ({ id, ...input }, { db }) => {
    try {
      if (!(await updateBookingType(db, new ObjectId(id), typeInput(input))))
        return fail("That type no longer exists.");
    } catch (error) {
      if (error instanceof SlugTakenError) return fieldError("slug", error.message);
      throw error;
    }
    refresh();
    return ok(null, "Saved.");
  },
);

// A secret type's link gets a new key; the links shared before stop working.
export const rotateBookingTypeLinkAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await rotateLinkKey(db, new ObjectId(input.id)))) return fail("That type no longer exists.");
  refresh();
  return ok(null, "New link made. The old one no longer works.");
});

export const deleteBookingTypeAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await deleteBookingType(db, new ObjectId(input.id)))) return fail("That type no longer exists.");
  refresh();
  return ok(null, "Booking type deleted. Meetings booked with it stay.");
});
