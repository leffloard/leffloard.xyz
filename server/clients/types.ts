import type { ObjectId } from "mongodb";
import type { Currency } from "@/lib/money";
import type { ActivityKind, ClientStatus } from "@/lib/work/options";

export type ClientDoc = {
  _id: ObjectId;
  name: string; // the person you deal with
  company: string | null;
  email: string | null;
  emailKey: string | null; // lower case, for finding the client by a sender's address
  phone: string | null;
  website: string | null;
  location: string | null; // "Berlin, Germany"
  timeZone: string | null;
  currency: Currency; // for new projects
  status: ClientStatus;
  tags: string[];
  notes: string; // private
  source: string | null; // how they found you
  inquiryId: ObjectId | null; // the message the client was created from
  createdAt: Date;
  updatedAt: Date;
  lastContactAt: Date | null;
  version: number; // optimistic concurrency for the edit form
};

// An entry in a client's log: a note, or a call, email or meeting that happened outside the app.
export type ActivityDoc = {
  _id: ObjectId;
  clientId: ObjectId;
  projectId: ObjectId | null;
  kind: ActivityKind;
  body: string;
  at: Date; // when it happened
  createdAt: Date;
};
