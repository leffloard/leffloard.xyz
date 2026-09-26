import type { ObjectId } from "mongodb";
import type { CallSlot } from "@/lib/intake/form";
import type { InquiryKind, InquiryStatus } from "@/lib/intake/options";

export type InquirySource = "form" | "legacy-api" | "legacy-import";

export type Delivery = "queued" | "sent" | "failed" | "skipped";

// An email sent to the visitor from the inbox: a free reply, or a note about a status change.
export type ReplyEntry = {
  id: string;
  kind: "reply" | "status";
  to: string;
  subject: string;
  body: string;
  createdAt: Date;
  delivery: Delivery;
  sentAt: Date | null;
  error: string | null;
};

export type StatusChange = { at: Date; status: InquiryStatus; from: InquiryStatus };

export type InquiryDoc = {
  _id: ObjectId;
  // The id the v1 API answered with (a UUID); migrated requests keep their v1 id.
  publicId: string;
  ref: string; // "INQ-2026-0007"
  kind: InquiryKind;
  status: InquiryStatus;
  source: InquirySource;
  name: string;
  email: string;
  contact: string | null;
  company: string | null;
  service: string | null;
  subject: string;
  message: string;
  budget: string | null;
  timeline: string | null;
  links: string | null;
  projectReference: string | null;
  call: CallSlot | null;
  scheduledAt: Date | null; // the confirmed call time
  aiOptOut: boolean; // the visitor asked that no AI tools process the message
  note: string; // private, never shown to the visitor
  labels: string[];
  snoozedUntil: Date | null;
  history: StatusChange[];
  replies: ReplyEntry[];
  receivedAt: Date;
  updatedAt: Date;
  lastActivityAt: Date;
  // Deleted by a TTL index: 24 months after the last activity (see the privacy notice), 30 days for spam.
  purgeAt: Date | null;
  legacyId?: string;
  clientId?: ObjectId | null; // the client it belongs to (missing on messages from before clients existed)
};
