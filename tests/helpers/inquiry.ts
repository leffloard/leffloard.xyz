import { ObjectId } from "mongodb";
import type { InquiryInput } from "@/lib/intake/form";
import type { InquiryDoc } from "@/server/inquiries/types";

export const SITE_URL = "https://leffloard.test";

export function inquiryInput(overrides: Partial<InquiryInput> = {}): InquiryInput {
  return {
    kind: "question",
    name: "Alan Turing",
    email: "alan@example.com",
    contact: null,
    company: null,
    service: null,
    subject: "Discord bot pricing",
    message: "How much would a moderation bot cost?",
    budget: null,
    timeline: null,
    links: null,
    projectReference: null,
    call: null,
    aiOptOut: false,
    ...overrides,
  };
}

// A stored inquiry, for code that works on documents (templates, the inbox).
export function inquiryDoc(overrides: Partial<InquiryDoc> = {}): InquiryDoc {
  const receivedAt = new Date("2026-09-25T21:27:15.399Z");
  return {
    _id: new ObjectId("66f4a1b2c3d4e5f6a7b8c9d0"),
    publicId: "6a1c6f0e-5a8b-4f55-9d6e-1f2b3c4d5e6f",
    ref: "INQ-2026-0007",
    ...inquiryInput(),
    status: "new",
    source: "form",
    scheduledAt: null,
    note: "",
    labels: [],
    snoozedUntil: null,
    history: [],
    replies: [],
    receivedAt,
    updatedAt: receivedAt,
    lastActivityAt: receivedAt,
    purgeAt: null,
    ...overrides,
  };
}

export function callDoc(overrides: Partial<InquiryDoc> = {}): InquiryDoc {
  return inquiryDoc({
    kind: "call",
    name: "Ada Lovelace",
    email: "ada@example.com",
    contact: "ada#0001",
    service: "websites",
    subject: "Kickoff call",
    message: "Let's plan the new landing page.",
    call: { timeZone: "Europe/Istanbul", date: "2026-10-01", time: "14:30", duration: 45 },
    ...overrides,
  });
}
