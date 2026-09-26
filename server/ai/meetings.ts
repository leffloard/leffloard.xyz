import "server-only";
import type { Db, ObjectId } from "mongodb";
import { site } from "@/content/site";
import { untrusted } from "@/lib/ai/untrusted";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { KIND_LABELS, STATUS_LABELS } from "@/lib/intake/options";
import { describeMoment } from "@/lib/intake/time";
import { formatMoney, money } from "@/lib/money";
import { equalsIgnoringCase } from "@/lib/search";
import { PROJECT_STAGE_LABELS } from "@/lib/work/options";
import { optedOut, type Prepared } from "@/server/ai/inbox";
import { businessContext, TASKS } from "@/server/ai/prompts";
import { listInvoices } from "@/server/billing/invoices";
import { getMeeting, meetingsForClient } from "@/server/calendar/meetings";
import { getClient } from "@/server/clients/store";
import { now } from "@/server/clock";
import { loadContent } from "@/server/content/store";
import { getEnv } from "@/server/env";
import { inquiries } from "@/server/inquiries/store";
import { projectsForClient } from "@/server/projects/store";

// A brief before a meeting: the booking, the client's history with the business, and their earlier messages.
// A guest who asked on any message that AI tools don't process it is left out entirely.

export const GUEST_OPTED_OUT =
  "This guest asked, on a message they sent, that AI tools don't process their messages.";

export async function prepareMeetingBrief(db: Db, id: ObjectId, guidance: string): Promise<Prepared> {
  const meeting = await getMeeting(db, id);
  if (!meeting) return { ok: false, reason: "missing", message: "This meeting no longer exists." };
  const client = meeting.clientId ? await getClient(db, meeting.clientId) : null;
  const byGuest = [
    { email: equalsIgnoringCase(meeting.email) },
    ...(client ? [{ clientId: client._id }] : []),
  ];
  // Every message counts here, spam and old ones included: the choice stands once made.
  if (await optedOut(db, { emails: [meeting.email, client?.email], clientId: client?._id })) {
    return { ok: false, reason: "opted_out", message: GUEST_OPTED_OUT };
  }
  const messages = await inquiries(db)
    .find({ $or: byGuest, status: { $ne: "spam" } })
    .sort({ receivedAt: -1 })
    .limit(20)
    .toArray();

  const at = now();
  const [projects, invoices, pastMeetings, content] = await Promise.all([
    client ? projectsForClient(db, client._id) : Promise.resolve([]),
    client ? listInvoices(db, { view: "all", clientId: client._id }) : Promise.resolve([]),
    client ? meetingsForClient(db, client._id, 20) : Promise.resolve([]),
    loadContent(db, "published"),
  ]);

  const guestText = [
    `Name: ${meeting.name}`,
    meeting.notes ? `What they wrote when booking:\n${meeting.notes}` : null,
    ...meeting.answers.map((answer) => `${answer.label}: ${answer.value}`),
  ].filter((line) => line !== null);

  const sections: (string | null)[] = [
    `Today is ${describeMoment(at, ADMIN_TIME_ZONE)}.`,
    `Meeting: "${meeting.title}", ${meeting.durationMinutes} minutes, ${describeMoment(meeting.startsAt, ADMIN_TIME_ZONE)} (for the guest: ${describeMoment(meeting.startsAt, meeting.timeZone)}). Status: ${meeting.status}. ${meeting.source === "booking" ? "Booked by the guest." : `Set up by ${site.firstName}.`}`,
    meeting.ownerNote ? `${site.firstName}'s private note on the meeting: ${meeting.ownerNote}` : null,
    "",
    untrusted("booking form", guestText.join("\n")),
  ];

  if (client) {
    // The record is data too: its name, company and notes may have come from the contact form, and project
    // titles from a message's subject.
    const record = [
      `Client: ${client.name}${client.company ? `, ${client.company}` : ""}; status ${client.status}; client since ${describeMoment(client.createdAt, ADMIN_TIME_ZONE).split(" at ")[0]}.`,
      client.tags.length ? `Tags: ${client.tags.join(", ")}.` : null,
      client.notes ? `Notes on the client: ${client.notes.slice(0, 1500)}` : null,
      projects.length
        ? `Projects:\n${projects
            .slice(0, 10)
            .map(
              (project) =>
                `- ${project.ref} "${project.title}": ${PROJECT_STAGE_LABELS[project.stage]}${project.dueDate ? `, due ${project.dueDate}` : ""}`,
            )
            .join("\n")}`
        : "No projects yet.",
      invoices.length
        ? `Invoices:\n${invoices
            .slice(0, 10)
            .map(
              (invoice) =>
                `- ${invoice.number ?? "draft"}: ${formatMoney(money(invoice.totals.totalMinor, invoice.currency))}, ${invoice.status}${invoice.dueDate && invoice.status === "issued" ? `, due ${invoice.dueDate}` : ""}`,
            )
            .join("\n")}`
        : null,
      `Earlier meetings with them: ${pastMeetings.filter((past) => past.startsAt < at && past.status === "confirmed").length}.`,
    ].filter((line) => line !== null);
    sections.push("", untrusted("client record", record.join("\n")));
  } else {
    sections.push("", "Not linked to a client record: possibly a new contact.");
  }

  if (messages.length) {
    sections.push(
      "",
      `Their messages through the contact form, newest first (${messages.length}):`,
      ...messages
        .slice(0, 3)
        .map((message) =>
          untrusted(
            "contact form",
            `${message.ref} (${KIND_LABELS[message.kind]}, ${STATUS_LABELS[message.status].toLowerCase()}), ${describeMoment(message.receivedAt, ADMIN_TIME_ZONE)}\nSubject: ${message.subject}\n${message.message.slice(0, 1500)}`,
          ),
        ),
    );
  }
  if (guidance) sections.push("", `${site.firstName}'s notes for this brief (follow them): ${guidance}`);

  return {
    ok: true,
    request: {
      feature: "brief",
      target: { kind: "meeting", id: meeting._id },
      clientId: client?._id ?? null,
      system: { shared: businessContext(content, getEnv().SITE_URL), task: TASKS.brief },
      prompt: sections.filter((line) => line !== null).join("\n"),
    },
  };
}
