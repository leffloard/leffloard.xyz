import type { ObjectId } from "mongodb";
import type { Availability } from "@/lib/booking/availability";

// The owner's hours and booking rules, and the private feed's token.
export type CalendarSettingsDoc = Availability & {
  _id: "calendar";
  feedTokenHash: string | null; // SHA-256 of the feed address's secret; null: the feed is off
  updatedAt: Date;
  version: number;
};

export type LocationKind = "jitsi" | "discord" | "custom";
// public: listed on /book. portal: listed in clients' portals. secret: only through its link. The last two
// are booked through a link carrying the type's key.
export type Visibility = "public" | "portal" | "secret";

export type BookingQuestion = { id: string; label: string; required: boolean };

export type BookingTypeDoc = {
  _id: ObjectId;
  slug: string; // /book/<slug>
  title: string;
  description: string;
  durationMinutes: number;
  visibility: Visibility; // portal and secret: bookable only through a link carrying linkKey
  linkKey: string | null; // the secret part of a secret type's link (?key=...); replaced to retire old links
  requiresApproval: boolean;
  location: { kind: LocationKind; details: string };
  questions: BookingQuestion[];
  active: boolean;
  rank: string;
  createdAt: Date;
  updatedAt: Date;
};

export type MeetingStatus = "requested" | "confirmed" | "declined" | "cancelled";

export type MeetingDoc = {
  _id: ObjectId;
  bookingTypeId: ObjectId | null; // null: set up by the owner
  title: string; // "Intro call", kept even if the type changes
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  bufferMinutes: number; // the gap it holds after it, as when it was booked
  ownerDate: string; // the day it counts towards (owner's time zone)
  timeZone: string; // the guest's
  status: MeetingStatus;
  name: string;
  email: string;
  notes: string; // what the guest wrote
  answers: { label: string; value: string }[];
  location: { kind: LocationKind; details: string; url: string | null };
  clientId: ObjectId | null;
  manageTokenHash: string; // SHA-256 of the guest's reschedule-and-cancel link secret, to find the meeting
  manageTokenSealed: string; // the secret itself, encrypted, so later emails can carry the same link
  source: "booking" | "admin";
  ownerNote: string; // private
  sequence: number; // iCalendar SEQUENCE: raised on every change the guest is told about
  scheduledAt: Date; // when it was booked or last moved: a call arranged in the last hours needs no reminder
  notifyGuest: boolean; // false: the owner set it up without emailing the guest, so no reminder either
  reminderSentAt: Date | null;
  cancelledBy: "guest" | "owner" | null;
  cancelReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  purgeAt: Date; // 24 months after the meeting (see the privacy notice)
};

export type BlockKind = "school" | "exam" | "focus" | "away" | "other";

// Time the owner keeps free of bookings.
export type BlockDoc = {
  _id: ObjectId;
  title: string;
  kind: BlockKind;
  startsAt: Date;
  endsAt: Date;
  createdAt: Date;
};

export type SlotLockDoc = { _id: string; meetingId: ObjectId; expiresAt: Date };

export type BookingDayDoc = { _id: string; count: number; expiresAt: Date };
