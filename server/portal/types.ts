import type { ObjectId } from "mongodb";

// The client portal: sign-in links, sessions, the updates the owner posts on a project, and the data requests
// clients make there.

// A one-time sign-in link. Only the SHA-256 of its secret is stored; it is used up by the sign-in (a POST),
// never by opening the link, so a mail scanner that follows it doesn't spend it.
export type PortalLinkDoc = {
  _id: string; // SHA-256 of the token
  clientId: ObjectId;
  purpose: "sign-in" | "invite";
  createdAt: Date;
  expiresAt: Date;
};

// A signed-in client. Its own collection and cookie: an admin check never sees a portal session.
export type PortalSessionDoc = {
  _id: string; // SHA-256 of the cookie's token
  clientId: ObjectId;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  ip: string;
  userAgent: string;
};

// A note to the client on their project ("the staging site is up"), shown in their portal.
export type ProjectUpdateDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  clientId: ObjectId;
  body: string;
  emailed: boolean;
  createdAt: Date;
};

export type PrivacyRequestKind = "export" | "erase";

// A client asking for a copy of their data, or for it to be deleted (KVKK Article 11, GDPR 15 and 17).
export type PrivacyRequestDoc = {
  _id: ObjectId;
  clientId: ObjectId;
  kind: PrivacyRequestKind;
  note: string;
  status: "open" | "done" | "declined";
  createdAt: Date;
  resolvedAt: Date | null;
  resolution: string | null; // what the owner did, or why not
};
