import "server-only";
import type { Db } from "mongodb";
import { KIND_LABELS } from "@/lib/content/schemas";
import { formatDate } from "@/lib/format";
import { containsPattern } from "@/lib/search";
import { invoices, quotes } from "@/server/billing/collections";
import { meetings } from "@/server/calendar/settings";
import { contentItems } from "@/server/content/collections";
import { contentTitle } from "@/server/content/editor";
import { inquiries } from "@/server/inquiries/store";
import { clients, projects, tasks } from "@/server/work/collections";

// The command palette's search: messages, clients, projects, tasks, quotes, invoices, meetings and content
// whose names contain the text, a few of each, newest first. The text is escaped (lib/search.ts), and every
// query reads only the fields a result shows.

export type SearchResult = {
  id: string;
  type: string; // "Client", "Invoice", ...
  title: string;
  detail: string;
  href: string;
};

const EACH = 4;

export async function searchEverything(db: Db, query: string): Promise<SearchResult[]> {
  const text = query.trim();
  const pattern = containsPattern(text);
  if (!pattern || text.length < 2) return [];
  const [messages, people, work, todo, quoteDocs, invoiceDocs, calls, content] = await Promise.all([
    inquiries(db)
      .find(
        { $or: [{ ref: pattern }, { name: pattern }, { email: pattern }, { subject: pattern }] },
        { projection: { ref: 1, name: 1, subject: 1 }, sort: { receivedAt: -1 }, limit: EACH },
      )
      .toArray(),
    clients(db)
      .find(
        { $or: [{ name: pattern }, { company: pattern }, { email: pattern }] },
        { projection: { name: 1, company: 1, email: 1 }, sort: { updatedAt: -1 }, limit: EACH },
      )
      .toArray(),
    projects(db)
      .find(
        { $or: [{ ref: pattern }, { title: pattern }] },
        { projection: { ref: 1, title: 1, stage: 1 }, sort: { updatedAt: -1 }, limit: EACH },
      )
      .toArray(),
    tasks(db)
      .find(
        { title: pattern, status: { $ne: "done" } },
        { projection: { title: 1, due: 1 }, sort: { updatedAt: -1 }, limit: EACH },
      )
      .toArray(),
    quotes(db)
      .find(
        { $or: [{ number: pattern }, { title: pattern }, { "recipient.name": pattern }] },
        {
          projection: { number: 1, title: 1, recipient: 1, status: 1 },
          sort: { createdAt: -1 },
          limit: EACH,
        },
      )
      .toArray(),
    invoices(db)
      .find(
        { $or: [{ number: pattern }, { title: pattern }, { "recipient.name": pattern }] },
        {
          projection: { number: 1, title: 1, recipient: 1, status: 1 },
          sort: { createdAt: -1 },
          limit: EACH,
        },
      )
      .toArray(),
    meetings(db)
      .find(
        { $or: [{ title: pattern }, { name: pattern }, { email: pattern }] },
        { projection: { title: 1, name: 1, startsAt: 1 }, sort: { startsAt: -1 }, limit: EACH },
      )
      .toArray(),
    contentItems(db)
      .find(
        { $or: [{ "draft.title": pattern }, { "draft.name": pattern }] },
        { projection: { kind: 1, draft: 1 }, sort: { updatedAt: -1 }, limit: EACH },
      )
      .toArray(),
  ]);
  const id = (value: { _id: { toHexString(): string } }) => value._id.toHexString();
  return [
    ...messages.map((doc) => ({
      id: `inquiry:${id(doc)}`,
      type: "Message",
      title: `${doc.name}: ${doc.subject}`,
      detail: doc.ref,
      href: `/admin/inbox/${id(doc)}`,
    })),
    ...people.map((doc) => ({
      id: `client:${id(doc)}`,
      type: "Client",
      title: doc.name,
      detail: [doc.company, doc.email].filter(Boolean).join(" · "),
      href: `/admin/clients/${id(doc)}`,
    })),
    ...work.map((doc) => ({
      id: `project:${id(doc)}`,
      type: "Project",
      title: doc.title,
      detail: doc.ref,
      href: `/admin/projects/${id(doc)}`,
    })),
    ...todo.map((doc) => ({
      id: `task:${id(doc)}`,
      type: "Task",
      title: doc.title,
      detail: doc.due ? `due ${doc.due}` : "no date",
      href: `/admin/tasks/${id(doc)}`,
    })),
    ...quoteDocs.map((doc) => ({
      id: `quote:${id(doc)}`,
      type: "Quote",
      title: doc.title,
      detail: [doc.number ?? "draft", doc.recipient?.name].filter(Boolean).join(" · "),
      href: `/admin/billing/quotes/${id(doc)}`,
    })),
    ...invoiceDocs.map((doc) => ({
      id: `invoice:${id(doc)}`,
      type: "Invoice",
      title: doc.title,
      detail: [doc.number ?? "draft", doc.recipient?.name].filter(Boolean).join(" · "),
      href: `/admin/billing/invoices/${id(doc)}`,
    })),
    ...calls.map((doc) => ({
      id: `meeting:${id(doc)}`,
      type: "Meeting",
      title: `${doc.title} with ${doc.name}`,
      detail: formatDate(doc.startsAt),
      href: `/admin/calendar/meetings/${id(doc)}`,
    })),
    ...content.map((doc) => ({
      id: `content:${id(doc)}`,
      type: KIND_LABELS[doc.kind].one,
      title: contentTitle(doc),
      detail: "Content",
      href: `/admin/content/${doc.kind}/${id(doc)}`,
    })),
  ];
}
