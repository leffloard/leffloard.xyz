import "server-only";
import type { Db, ObjectId } from "mongodb";
import { invoices, quotes } from "@/server/billing/collections";
import type { InvoiceDoc, QuoteDoc } from "@/server/billing/types";
import { bookingTypes, meetings } from "@/server/calendar/settings";
import type { BookingTypeDoc, MeetingDoc } from "@/server/calendar/types";
import { now } from "@/server/clock";
import type { ProjectDoc } from "@/server/projects/types";
import { projects } from "@/server/work/collections";

// What a signed-in client sees. Every query here is scoped to the client's id: another client's project,
// invoice or meeting is never found, so its page answers 404.

export async function portalProjects(db: Db, clientId: ObjectId): Promise<ProjectDoc[]> {
  return projects(db)
    .find({ clientId, stage: { $ne: "cancelled" } })
    .sort({ updatedAt: -1 })
    .limit(100)
    .toArray();
}

export async function portalProject(db: Db, clientId: ObjectId, id: ObjectId): Promise<ProjectDoc | null> {
  return projects(db).findOne({ _id: id, clientId, stage: { $ne: "cancelled" } });
}

// Their invoices (issued, paid, void; credit notes too) and the quotes they were sent.
export async function portalDocuments(
  db: Db,
  clientId: ObjectId,
): Promise<{ invoices: InvoiceDoc[]; quotes: QuoteDoc[] }> {
  const [invoiceDocs, quoteDocs] = await Promise.all([
    invoices(db)
      .find({ clientId, status: { $in: ["issued", "paid", "void"] } })
      .sort({ issueDate: -1, createdAt: -1 })
      .limit(200)
      .toArray(),
    quotes(db)
      .find({ clientId, status: { $in: ["sent", "accepted", "declined"] } })
      .sort({ sentAt: -1 })
      .limit(100)
      .toArray(),
  ]);
  return { invoices: invoiceDocs, quotes: quoteDocs };
}

export async function portalMeetings(
  db: Db,
  clientId: ObjectId,
  at: Date = now(),
): Promise<{ upcoming: MeetingDoc[]; past: MeetingDoc[] }> {
  const [upcoming, past] = await Promise.all([
    meetings(db)
      .find({ clientId, status: { $in: ["requested", "confirmed"] }, endsAt: { $gt: at } })
      .sort({ startsAt: 1 })
      .limit(20)
      .toArray(),
    meetings(db)
      .find({ clientId, status: "confirmed", endsAt: { $lte: at } })
      .sort({ startsAt: -1 })
      .limit(10)
      .toArray(),
  ]);
  return { upcoming, past };
}

// The calls a client can book from the portal: the public ones and those kept for clients.
export async function portalBookingTypes(db: Db): Promise<BookingTypeDoc[]> {
  return bookingTypes(db)
    .find({ active: true, visibility: { $in: ["public", "portal"] } })
    .sort({ rank: 1, _id: 1 })
    .limit(20)
    .toArray();
}
