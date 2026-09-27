import "server-only";
import type { ClientSession, Db } from "mongodb";
import { documentNumber, type NumberedKind } from "@/lib/billing/document";
import { counters } from "@/server/billing/collections";

// The next number of a kind of document in a year. Called inside the transaction that sends or issues the
// document, so a failed issue does not use up a number and the sequence has no gaps.
export async function nextDocumentNumber(
  db: Db,
  kind: NumberedKind,
  year: number,
  session?: ClientSession,
): Promise<string> {
  const counter = await counters(db).findOneAndUpdate(
    { _id: `${kind}:${year}` },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: "after", session },
  );
  return documentNumber(kind, year, counter?.seq ?? 1);
}
