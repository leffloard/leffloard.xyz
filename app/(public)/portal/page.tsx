import type { Metadata } from "next";
import Link from "next/link";
import { PageIntro, Section } from "@/components/site/section";
import { Badge } from "@/components/ui/badge";
import { amountLeft } from "@/lib/billing/document";
import { invoiceState } from "@/lib/billing/options";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { describeMoment, todayIn } from "@/lib/intake/time";
import { formatMoney, money } from "@/lib/money";
import { PROJECT_STAGE_LABELS } from "@/lib/work/options";
import { longDate } from "@/server/billing/view";
import { readableManageToken } from "@/server/calendar/meetings";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { requirePortalClient } from "@/server/portal/dal";
import { portalDocuments, portalMeetings, portalProjects } from "@/server/portal/views";

export const metadata: Metadata = { title: "Overview" };

const card = "rounded-3xl border border-line bg-surface p-6";

export default async function PortalOverviewPage() {
  const { client } = await requirePortalClient();
  const db = await getDb();
  const at = now();
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const [projectList, documents, calls] = await Promise.all([
    portalProjects(db, client._id),
    portalDocuments(db, client._id),
    portalMeetings(db, client._id, at),
  ]);
  const owed = documents.invoices.filter(
    (invoice) => invoice.kind === "invoice" && invoice.status === "issued" && amountLeft(invoice) > 0,
  );
  const next = calls.upcoming[0];
  const nextManageToken = next ? readableManageToken(next) : null;

  return (
    <>
      <PageIntro
        label="Client portal"
        title={`Hello, ${client.name}.`}
        intro="Where your projects stand, what's left to pay, and your next call."
      />
      <Section label="Projects" title="Your projects">
        {projectList.length ? (
          <ul className="grid gap-4 md:grid-cols-2">
            {projectList.map((project) => {
              const done = project.milestones.filter((milestone) => milestone.done).length;
              const upcoming = project.milestones.find((milestone) => !milestone.done);
              return (
                <li key={project._id.toHexString()}>
                  <Link
                    href={`/portal/projects/${project._id.toHexString()}`}
                    className={`${card} block transition-colors hover:border-line-strong`}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">{project.ref}</span>
                      <Badge tone={project.stage === "delivered" ? "success" : "accent"}>
                        {PROJECT_STAGE_LABELS[project.stage]}
                      </Badge>
                    </span>
                    <span className="mt-3 block text-xl font-semibold tracking-tight">{project.title}</span>
                    <span className="mt-2 block text-sm text-muted">
                      {project.milestones.length
                        ? `${done} of ${project.milestones.length} steps done${upcoming ? `. Next: ${upcoming.title}` : ""}.`
                        : "Open it for updates and deliverables."}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-muted">No projects yet. Once we start one, it shows up here.</p>
        )}
      </Section>
      {owed.length ? (
        <Section label="Invoices" title="To pay">
          <ul className="grid gap-3">
            {owed.map((invoice) => {
              const late = invoiceState(invoice, today) === "overdue";
              return (
                <li
                  key={invoice._id.toHexString()}
                  className={`${card} flex flex-wrap items-center gap-x-4 gap-y-2`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{invoice.title}</span>
                    <span className="block text-sm text-muted">
                      {invoice.number}
                      {invoice.dueDate ? ` · due ${longDate(invoice.dueDate)}` : ""}
                    </span>
                  </span>
                  {late ? <Badge tone="danger">overdue</Badge> : null}
                  <span className="font-mono text-lg tabular-nums">
                    {formatMoney(money(amountLeft(invoice), invoice.currency))}
                  </span>
                  <a
                    href={`/i/${invoice.publicId}`}
                    className="text-sm text-ink underline underline-offset-4"
                  >
                    Pay
                  </a>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
      <Section label="Calls" title={next ? "Your next call" : "Calls"}>
        {next ? (
          <div className={card}>
            <p className="font-medium">{next.title}</p>
            <p className="mt-1 text-muted">
              {describeMoment(next.startsAt, next.timeZone)}
              {next.status === "requested" ? " (waiting for my confirmation)" : ""}
            </p>
            <div className="mt-4 flex flex-wrap gap-4 text-sm">
              {next.location.url && next.status === "confirmed" ? (
                <a href={next.location.url} className="text-ink underline underline-offset-4">
                  Join the call
                </a>
              ) : null}
              {nextManageToken ? (
                <a
                  href={`/meeting/${nextManageToken}`}
                  className="text-muted underline underline-offset-4 hover:text-ink"
                >
                  Move or cancel it
                </a>
              ) : null}
            </div>
          </div>
        ) : (
          <p className="text-muted">
            Nothing booked.{" "}
            <Link href="/portal/meetings" className="text-ink underline underline-offset-4">
              Book a call
            </Link>
            .
          </p>
        )}
      </Section>
    </>
  );
}
