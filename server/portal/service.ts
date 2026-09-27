import "server-only";
import type { Db, ObjectId } from "mongodb";
import type { Money } from "@/lib/money";
import type { ClientDoc } from "@/server/clients/types";
import { now } from "@/server/clock";
import { createPortalLink, portalClientsForEmail, setPortalAccess } from "@/server/portal/access";
import {
  alertPortalEvent,
  emailInvite,
  emailProjectUpdate,
  emailSignInLinks,
  type PortalNotify,
} from "@/server/portal/notify";
import { requestPrivacyAction } from "@/server/portal/privacy";
import type { PrivacyRequestDoc, PrivacyRequestKind, ProjectUpdateDoc } from "@/server/portal/types";
import { addProjectUpdate, markUpdateEmailed } from "@/server/portal/updates";
import { portalProject } from "@/server/portal/views";
import { addRevision, RevisionChargeError } from "@/server/projects/revisions";
import type { ProjectDoc, RevisionDoc } from "@/server/projects/types";
import { sha256Hex } from "@/server/security/crypto";
import { clients } from "@/server/work/collections";

// The portal's flows, used by its endpoints and by the admin.

// Someone asks for a sign-in link. The answer outside is always the same, whether or not the address has a
// portal, so it can't be used to find out who is a client.
export async function requestSignInLink(
  db: Db,
  email: string,
  notify: PortalNotify,
  at: Date = now(),
): Promise<void> {
  const found = await portalClientsForEmail(db, email);
  if (!found.length) return;
  const links = [];
  for (const client of found) {
    const token = await createPortalLink(db, client._id, "sign-in", at);
    links.push({ client, token, key: sha256Hex(token) });
  }
  await emailSignInLinks(db, found[0]!.email!, links, notify);
}

// The owner invites a client: the portal is turned on, and a link valid for a week is emailed.
export async function inviteToPortal(
  db: Db,
  clientId: ObjectId,
  notify: PortalNotify,
  at: Date = now(),
): Promise<{ ok: true; emailed: boolean; client: ClientDoc } | { ok: false; message: string }> {
  const current = await clients(db).findOne({ _id: clientId });
  if (!current) return { ok: false, message: "This client no longer exists." };
  if (!current.email) return { ok: false, message: "Add the client's email address first." };
  await setPortalAccess(db, clientId, true, at);
  const token = await createPortalLink(db, clientId, "invite", at);
  const client = (await clients(db).findOne({ _id: clientId }))!;
  const emailed = await emailInvite(db, client, token, sha256Hex(token), notify);
  return { ok: true, emailed, client };
}

export async function postProjectUpdate(
  db: Db,
  project: ProjectDoc,
  body: string,
  email: boolean,
  notify: PortalNotify,
  at: Date = now(),
): Promise<{ update: ProjectUpdateDoc; emailed: boolean }> {
  const client = await clients(db).findOne({ _id: project.clientId });
  const update = await addProjectUpdate(db, project, body, false, at);
  // Marked as emailed only once the email is queued (not when email isn't set up, or there's no address).
  const emailed = email && client ? await emailProjectUpdate(db, client, project, update, notify) : false;
  if (emailed) {
    await markUpdateEmailed(db, update._id);
    update.emailed = true;
  }
  return { update, emailed };
}

export type PortalRevision =
  | { ok: true; revision: RevisionDoc }
  | { ok: false; problem: "missing" | "paused" }
  | { ok: false; problem: "charge"; price: Money | null };

// A client asks for a revision round on their project. A round beyond the included ones needs their
// agreement to its price, checked in the transaction that counts it. A paused project takes none.
export async function requestRevision(
  db: Db,
  client: ClientDoc,
  projectId: ObjectId,
  input: { title: string; details: string; chargeAgreed: boolean; agreedPrice: Money | null },
  notify: PortalNotify,
  at: Date = now(),
): Promise<PortalRevision> {
  const project = await portalProject(db, client._id, projectId);
  if (!project) return { ok: false, problem: "missing" };
  if (project.stage === "paused") return { ok: false, problem: "paused" };
  let revision: RevisionDoc | null;
  try {
    revision = await addRevision(
      db,
      project._id,
      {
        title: input.title,
        details: input.details,
        fromPortal: { chargeAgreed: input.chargeAgreed, agreedPrice: input.agreedPrice },
      },
      at,
    );
  } catch (error) {
    if (error instanceof RevisionChargeError) return { ok: false, problem: "charge", price: error.price };
    throw error;
  }
  if (!revision) return { ok: false, problem: "missing" };
  await alertPortalEvent(db, client, { kind: "revision", project, revision }, notify, at);
  return { ok: true, revision };
}

export async function requestDataAction(
  db: Db,
  client: ClientDoc,
  kind: PrivacyRequestKind,
  note: string,
  notify: PortalNotify,
  at: Date = now(),
): Promise<{ request: PrivacyRequestDoc; created: boolean }> {
  const result = await requestPrivacyAction(db, client._id, kind, note, at);
  if (result.created)
    await alertPortalEvent(db, client, { kind: "privacy", request: result.request }, notify, at);
  return result;
}
