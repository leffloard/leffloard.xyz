import "server-only";
import type { Db } from "mongodb";
import type { ClientDoc } from "@/server/clients/types";
import type { Channels } from "@/server/notify/channels";
import { enqueue } from "@/server/notify/outbox";
import {
  inviteEmail,
  portalAlertDiscord,
  portalAlertEmail,
  projectUpdateEmail,
  signInEmail,
  type PortalEvent,
} from "@/server/portal/emails";
import type { ProjectUpdateDoc } from "@/server/portal/types";
import type { ProjectDoc } from "@/server/projects/types";

// The portal's messages go through the outbox like every other. A sign-in email's dedupeKey is its link's
// id, so it is never sent twice, and its label (shown in the delivery log) never holds the link.

export type PortalNotify = { siteUrl: string; channels: Channels };

const context = (notify: PortalNotify) => ({
  siteUrl: notify.siteUrl,
  ownerEmail: notify.channels.ownerEmail,
});

export function signInUrl(siteUrl: string, token: string): string {
  return `${siteUrl}/portal/verify?t=${token}`;
}

export async function emailSignInLinks(
  db: Db,
  to: string,
  links: { client: ClientDoc; token: string; key: string }[],
  notify: PortalNotify,
): Promise<boolean> {
  if (!notify.channels.email || !links.length) return false;
  await enqueue(db, {
    channel: "email",
    payload: signInEmail(
      to,
      links.map((link) => ({ client: link.client, url: signInUrl(notify.siteUrl, link.token) })),
      context(notify),
    ),
    dedupeKey: `portal:sign-in:${links[0]!.key}`,
    label: `Portal sign-in link to ${links[0]!.client.name}`,
    ref: { clientId: links[0]!.client._id },
  });
  return true;
}

export async function emailInvite(
  db: Db,
  client: ClientDoc,
  token: string,
  key: string,
  notify: PortalNotify,
): Promise<boolean> {
  if (!notify.channels.email || !client.email) return false;
  await enqueue(db, {
    channel: "email",
    payload: inviteEmail(client, signInUrl(notify.siteUrl, token), context(notify)),
    dedupeKey: `portal:invite:${key}`,
    label: `Portal invitation to ${client.name}`,
    ref: { clientId: client._id },
  });
  return true;
}

export async function emailProjectUpdate(
  db: Db,
  client: ClientDoc,
  project: ProjectDoc,
  update: ProjectUpdateDoc,
  notify: PortalNotify,
): Promise<boolean> {
  if (!notify.channels.email || !client.email) return false;
  await enqueue(db, {
    channel: "email",
    payload: projectUpdateEmail(client, project, update, context(notify)),
    dedupeKey: `portal:update:${update._id.toHexString()}`,
    label: `Update on ${project.ref} to ${client.name}`,
    ref: { clientId: client._id, projectId: project._id },
  });
  return true;
}

export async function alertPortalEvent(
  db: Db,
  client: ClientDoc,
  event: PortalEvent,
  notify: PortalNotify,
  at: Date,
): Promise<void> {
  const id = event.kind === "revision" ? event.revision._id : event.request._id;
  const key = `portal:${event.kind}:${id.toHexString()}`;
  const label =
    event.kind === "revision"
      ? `Revision asked for in the portal: ${event.project.ref}`
      : `Data request in the portal: ${client.name}`;
  if (notify.channels.ownerEmail) {
    await enqueue(db, {
      channel: "email",
      payload: portalAlertEmail(client, event, { to: notify.channels.ownerEmail, siteUrl: notify.siteUrl }),
      dedupeKey: `${key}:email`,
      label,
      ref: { clientId: client._id },
    });
  }
  if (notify.channels.discordWebhookUrl) {
    await enqueue(db, {
      channel: "discord",
      payload: portalAlertDiscord(client, event, notify.siteUrl, at),
      dedupeKey: `${key}:discord`,
      label,
      ref: { clientId: client._id },
    });
  }
}
