import "server-only";
import type { Db } from "mongodb";
import { after } from "next/server";
import { autoTriage } from "@/server/ai/inbox";
import type { InquiryDoc } from "@/server/inquiries/types";

// Triages a message that just arrived once the visitor has their answer, when the owner turned automatic
// triage on. Only callable while handling a request.
export function triageSoon(db: Db, inquiry: Pick<InquiryDoc, "_id" | "status" | "aiOptOut">): void {
  after(() => autoTriage(db, inquiry));
}
