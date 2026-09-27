import "server-only";
import { site } from "@/content/site";
import { formatMoney } from "@/lib/money";
import type { ClientDoc } from "@/server/clients/types";
import { discordSafe, headerText } from "@/server/notify/escape";
import type { DiscordPayload, EmailMessage } from "@/server/notify/templates";
import type { PrivacyRequestDoc, ProjectUpdateDoc } from "@/server/portal/types";
import type { ProjectDoc, RevisionDoc } from "@/server/projects/types";

// What the client portal's emails and the owner's alerts about it say. Sign-in links are secrets: they appear
// only in the email to the client's own address, never in an alert or a log.

export type PortalMailContext = { siteUrl: string; ownerEmail: string | null };

const signature = (context: PortalMailContext) => ["", "Best regards,", site.name, context.siteUrl];

function toClient(client: Pick<ClientDoc, "name" | "email">) {
  return [{ name: headerText(client.name), address: client.email! }];
}

function replyTo(context: PortalMailContext) {
  return context.ownerEmail ? { address: context.ownerEmail } : undefined;
}

const clientLabel = (client: Pick<ClientDoc, "name" | "company">) =>
  client.company ? `${client.name}, ${client.company}` : client.name;

// The sign-in link(s) someone asked for: one per client record the address belongs to.
export function signInEmail(
  to: string,
  links: { client: Pick<ClientDoc, "name" | "company">; url: string }[],
  context: PortalMailContext,
): EmailMessage {
  const lines =
    links.length === 1
      ? ["Here is your link to sign in to your client portal:", links[0]!.url]
      : [
          "Your address belongs to more than one client account. Sign in to the one you need:",
          ...links.flatMap((link) => ["", `${clientLabel(link.client)}:`, link.url]),
        ];
  return {
    to: [{ address: to }],
    replyTo: replyTo(context),
    subject: headerText(`Your sign-in link for ${site.name}`),
    text: `${[
      "Hi,",
      "",
      ...lines,
      "",
      "Each link works once, within 20 minutes. If you didn't ask for it, ignore this email: nothing happens.",
      ...signature(context),
    ].join("\n")}\n`,
  };
}

export function inviteEmail(
  client: Pick<ClientDoc, "name" | "email">,
  url: string,
  context: PortalMailContext,
): EmailMessage {
  return {
    to: toClient(client),
    replyTo: replyTo(context),
    subject: headerText(`Your client portal at ${site.name}`),
    text: `${[
      `Hi ${client.name},`,
      "",
      "Your client portal is ready. There you can follow your project, see its updates and deliverables, ask for revisions, pay invoices and book calls.",
      "",
      "Sign in with this link (it works once, within 7 days):",
      url,
      "",
      `Later, ask for a new link at ${context.siteUrl}/portal/login with this email address.`,
      ...signature(context),
    ].join("\n")}\n`,
  };
}

// The update itself; the way to the portal only for a client whose portal is on.
export function projectUpdateEmail(
  client: Pick<ClientDoc, "name" | "email" | "portal">,
  project: Pick<ProjectDoc, "_id" | "title">,
  update: Pick<ProjectUpdateDoc, "body">,
  context: PortalMailContext,
): EmailMessage {
  const portal =
    client.portal?.enabled === true
      ? [
          "",
          "The project, its updates and deliverables are in your portal:",
          `${context.siteUrl}/portal/projects/${project._id.toHexString()}`,
        ]
      : [];
  return {
    to: toClient(client),
    replyTo: replyTo(context),
    subject: headerText(`Update on ${project.title}`),
    text: `${[`Hi ${client.name},`, "", update.body, ...portal, ...signature(context)].join("\n")}\n`,
  };
}

// --- The owner's alerts ----------------------------------------------------------------------------------------

export type PortalEvent =
  | { kind: "revision"; project: Pick<ProjectDoc, "_id" | "title" | "ref">; revision: RevisionDoc }
  | { kind: "privacy"; request: PrivacyRequestDoc };

function alertText(
  client: Pick<ClientDoc, "name" | "company">,
  event: PortalEvent,
): { title: string; lines: string[] } {
  if (event.kind === "revision") {
    const { revision, project } = event;
    return {
      title: `Revision round ${revision.number} asked for: ${project.ref}`,
      lines: [
        `${clientLabel(client)} asked for round ${revision.number} on ${project.title} in their portal:`,
        revision.title,
        ...(revision.details ? ["", revision.details] : []),
        ...(revision.billable
          ? [
              "",
              `It is beyond the included rounds${revision.price ? `: ${formatMoney(revision.price)}, which they agreed to` : ""}.`,
            ]
          : []),
      ],
    };
  }
  const { request } = event;
  return {
    title: request.kind === "export" ? "Data copy requested" : "Data deletion requested",
    lines: [
      request.kind === "export"
        ? `${clientLabel(client)} asked for a copy of their data in their portal.`
        : `${clientLabel(client)} asked for their data to be deleted in their portal.`,
      ...(request.note ? ["", "Their note:", request.note] : []),
      "",
      "Answer within 30 days (see the privacy notice).",
    ],
  };
}

function adminUrl(siteUrl: string, client: Pick<ClientDoc, "_id">, event: PortalEvent): string {
  return event.kind === "revision"
    ? `${siteUrl}/admin/projects/${event.project._id.toHexString()}`
    : `${siteUrl}/admin/clients/${client._id.toHexString()}`;
}

export function portalAlertEmail(
  client: Pick<ClientDoc, "_id" | "name" | "company">,
  event: PortalEvent,
  { to, siteUrl }: { to: string; siteUrl: string },
): EmailMessage {
  const { title, lines } = alertText(client, event);
  return {
    to: [{ address: to }],
    subject: headerText(title),
    text: `${[...lines, "", `Open it: ${adminUrl(siteUrl, client, event)}`].join("\n")}\n`,
  };
}

export function portalAlertDiscord(
  client: Pick<ClientDoc, "_id" | "name" | "company">,
  event: PortalEvent,
  siteUrl: string,
  at: Date,
): DiscordPayload {
  const { title, lines } = alertText(client, event);
  const url = adminUrl(siteUrl, client, event);
  return {
    embeds: [
      {
        title,
        color: event.kind === "revision" ? 0x22d3ee : 0xf59e0b,
        description: discordSafe(lines.join("\n"), 1500),
        fields: [{ name: "Manage", value: `[Open it](${url})`, inline: false }],
        footer: { text: "leffloard.xyz portal" },
        timestamp: at.toISOString(),
        url,
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
