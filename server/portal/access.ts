import "server-only";
import type { Db, ObjectId } from "mongodb";
import type { ClientDoc } from "@/server/clients/types";
import { now } from "@/server/clock";
import { portalLinks, portalSessions } from "@/server/portal/collections";
import type { PortalLinkDoc, PortalSessionDoc } from "@/server/portal/types";
import { randomToken, sha256Hex } from "@/server/security/crypto";
import { clients } from "@/server/work/collections";

// Who may use the client portal, and how they get in: the owner turns it on for a client; the client asks for
// a sign-in link by email (or the owner sends an invitation), and the link, used once, starts a session.

export const SIGN_IN_LINK_MS = 20 * 60_000;
export const INVITE_LINK_MS = 7 * 86_400_000;
export const PORTAL_IDLE_MS = 7 * 86_400_000;
export const PORTAL_MAX_MS = 30 * 86_400_000;
const TOUCH_EVERY_MS = 60_000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

export function portalEnabled(client: Pick<ClientDoc, "portal">): boolean {
  return client.portal?.enabled === true;
}

export async function setPortalAccess(
  db: Db,
  clientId: ObjectId,
  enabled: boolean,
  at: Date = now(),
): Promise<ClientDoc | null> {
  const client = await clients(db).findOneAndUpdate(
    { _id: clientId },
    [
      {
        $set: {
          portal: {
            enabled,
            invitedAt: { $ifNull: ["$portal.invitedAt", null] },
            lastSignInAt: { $ifNull: ["$portal.lastSignInAt", null] },
          },
          updatedAt: at,
        },
      },
    ],
    { returnDocument: "after" },
  );
  // Turning it off signs the client out everywhere, and spends their links.
  if (client && !enabled) await endClientSessions(db, clientId);
  return client;
}

// The clients a sign-in email may be for: the address, with the portal on (several, for someone who works
// with more than one company).
export async function portalClientsForEmail(db: Db, email: string): Promise<ClientDoc[]> {
  return clients(db)
    .find({ emailKey: email.trim().toLowerCase(), "portal.enabled": true })
    .sort({ updatedAt: -1 })
    .limit(3)
    .toArray();
}

// A new one-time link for a client. The secret is returned once, for the email; only its hash is kept.
export async function createPortalLink(
  db: Db,
  clientId: ObjectId,
  purpose: PortalLinkDoc["purpose"],
  at: Date = now(),
): Promise<string> {
  const token = randomToken();
  await portalLinks(db).insertOne({
    _id: sha256Hex(token),
    clientId,
    purpose,
    createdAt: at,
    expiresAt: new Date(at.getTime() + (purpose === "invite" ? INVITE_LINK_MS : SIGN_IN_LINK_MS)),
  });
  if (purpose === "invite") {
    await clients(db).updateOne({ _id: clientId }, { $set: { "portal.invitedAt": at } });
  }
  return token;
}

// The link's client, if it can still be used (the sign-in page asks before spending it).
export async function peekPortalLink(
  db: Db,
  token: string,
  at: Date = now(),
): Promise<{ link: PortalLinkDoc; client: ClientDoc } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const link = await portalLinks(db).findOne({ _id: sha256Hex(token), expiresAt: { $gt: at } });
  if (!link) return null;
  const client = await clients(db).findOne({ _id: link.clientId });
  return client && portalEnabled(client) ? { link, client } : null;
}

// Uses the link up (whoever deletes it first gets in) and starts a session for its client.
export async function signInWithLink(
  db: Db,
  token: string,
  meta: { ip: string; userAgent: string },
  at: Date = now(),
): Promise<{ token: string; session: PortalSessionDoc; client: ClientDoc } | null> {
  if (!TOKEN_PATTERN.test(token)) return null;
  const link = await portalLinks(db).findOneAndDelete({ _id: sha256Hex(token), expiresAt: { $gt: at } });
  if (!link) return null;
  const client = await clients(db).findOneAndUpdate(
    { _id: link.clientId, "portal.enabled": true },
    { $set: { "portal.lastSignInAt": at } },
    { returnDocument: "after" },
  );
  if (!client) return null;
  const sessionToken = randomToken();
  const session: PortalSessionDoc = {
    _id: sha256Hex(sessionToken),
    clientId: client._id,
    createdAt: at,
    lastSeenAt: at,
    expiresAt: new Date(at.getTime() + PORTAL_MAX_MS),
    ip: meta.ip,
    userAgent: meta.userAgent.slice(0, 300),
  };
  await portalSessions(db).insertOne(session);
  return { token: sessionToken, session, client };
}

// The signed-in client for a cookie's token: a session used in the last 7 days and under 30 days old, for a
// client whose portal is still on.
export async function findPortalSession(
  db: Db,
  token: string | undefined,
  at: Date = now(),
): Promise<{ session: PortalSessionDoc; client: ClientDoc } | null> {
  if (!token || !TOKEN_PATTERN.test(token)) return null;
  const session = await portalSessions(db).findOne({
    _id: sha256Hex(token),
    expiresAt: { $gt: at },
    lastSeenAt: { $gt: new Date(at.getTime() - PORTAL_IDLE_MS) },
  });
  if (!session) return null;
  const client = await clients(db).findOne({ _id: session.clientId });
  if (!client || !portalEnabled(client)) return null;
  if (at.getTime() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await portalSessions(db).updateOne({ _id: session._id }, { $set: { lastSeenAt: at } });
    session.lastSeenAt = at;
  }
  return { session, client };
}

export async function endPortalSession(db: Db, token: string | undefined): Promise<void> {
  if (!token || !TOKEN_PATTERN.test(token)) return;
  await portalSessions(db).deleteOne({ _id: sha256Hex(token) });
}

// Signs a client out everywhere and spends every link they were sent.
export async function endClientSessions(db: Db, clientId: ObjectId): Promise<number> {
  await portalLinks(db).deleteMany({ clientId });
  return (await portalSessions(db).deleteMany({ clientId })).deletedCount;
}

export async function activePortalSessions(db: Db, clientId: ObjectId, at: Date = now()): Promise<number> {
  return portalSessions(db).countDocuments({
    clientId,
    expiresAt: { $gt: at },
    lastSeenAt: { $gt: new Date(at.getTime() - PORTAL_IDLE_MS) },
  });
}
