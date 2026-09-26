import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ActivityComposer,
  ClientPrivacyCard,
  ClientStatusSelect,
  DeleteActivityButton,
} from "@/components/admin/clients/client-controls";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatHours } from "@/lib/duration";
import { ADMIN_TIME_ZONE, formatDate, formatDateTime, formatRelative } from "@/lib/format";
import { KIND_LABELS } from "@/lib/intake/options";
import { todayIn } from "@/lib/intake/time";
import { CURRENCY_LABELS } from "@/lib/money";
import { ACTIVITY_LABELS, PROJECT_STAGE_LABELS } from "@/lib/work/options";
import { requireAdmin } from "@/server/auth/dal";
import { clientTimeline, getClient, type TimelineEntry } from "@/server/clients/store";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { projectsForClient, trackedTime } from "@/server/projects/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Client" };

function TimelineItem({ entry, at }: { entry: TimelineEntry; at: Date }) {
  const when = (
    <time className="shrink-0 text-xs text-muted" title={formatDateTime(entry.at)}>
      {formatRelative(entry.at, at)}
    </time>
  );
  switch (entry.type) {
    case "activity":
      return (
        <div className="grid gap-1">
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            <Badge tone={entry.kind === "note" ? "neutral" : "accent"}>{ACTIVITY_LABELS[entry.kind]}</Badge>
            {when}
            <span className="ml-auto">
              <DeleteActivityButton id={entry.id} />
            </span>
          </p>
          <p className="text-[13px] whitespace-pre-wrap text-ink/90">{entry.body}</p>
        </div>
      );
    case "message":
      return (
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge>{KIND_LABELS[entry.kind]}</Badge>
          <Link href={`/admin/inbox/${entry.id}`} className="min-w-0 truncate hover:text-accent">
            {entry.subject}
          </Link>
          <span className="font-mono text-[11px] text-muted">{entry.ref}</span>
          {when}
        </p>
      );
    case "email":
      return (
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge tone="accent">Sent</Badge>
          <Link href={`/admin/inbox/${entry.inquiryId}`} className="min-w-0 truncate hover:text-accent">
            {entry.subject}
          </Link>
          {entry.delivery !== "sent" ? <span className="text-xs text-muted">({entry.delivery})</span> : null}
          {when}
        </p>
      );
    case "project":
      return (
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge tone={entry.event === "delivered" ? "success" : "neutral"}>
            {entry.event === "delivered" ? "Delivered" : "Project"}
          </Badge>
          <Link href={`/admin/projects/${entry.id}`} className="min-w-0 truncate hover:text-accent">
            {entry.title}
          </Link>
          <span className="font-mono text-[11px] text-muted">{entry.ref}</span>
          {when}
        </p>
      );
    case "revision":
      return (
        <p className="flex flex-wrap items-center gap-2 text-[13px]">
          <Badge tone="warning">Round {entry.number}</Badge>
          <Link
            href={`/admin/projects/${entry.projectId}/revisions`}
            className="min-w-0 truncate hover:text-accent"
          >
            {entry.title}
          </Link>
          <span className="font-mono text-[11px] text-muted">{entry.projectRef}</span>
          {when}
        </p>
      );
  }
}

export default async function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const client = id ? await getClient(db, id) : null;
  if (!client) notFound();
  const at = now();
  const [projects, timeline, time] = await Promise.all([
    projectsForClient(db, client._id),
    clientTimeline(db, client._id),
    trackedTime(db, { clientId: client._id }),
  ]);
  const hexId = client._id.toHexString();

  const details: [string, React.ReactNode][] = [];
  if (client.email)
    details.push([
      "Email",
      <a key="email" href={`mailto:${client.email}`} className="text-accent hover:underline">
        {client.email}
      </a>,
    ]);
  if (client.phone) details.push(["Phone", client.phone]);
  if (client.website)
    details.push([
      "Website",
      <a
        key="web"
        href={client.website}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:underline"
      >
        {new URL(client.website).host}
      </a>,
    ]);
  if (client.location) details.push(["Location", client.location]);
  if (client.timeZone) details.push(["Time zone", client.timeZone]);
  details.push(["Currency", CURRENCY_LABELS[client.currency]]);
  if (client.source) details.push(["Found you through", client.source]);
  details.push(["Client since", formatDate(client.createdAt)]);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/clients"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Clients
        </Link>
      </div>
      <PageHeader
        title={client.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {client.company ? <span>{client.company}</span> : null}
            {client.tags.map((tag) => (
              <Badge key={tag}>{tag}</Badge>
            ))}
            {client.lastContactAt ? (
              <span title={formatDateTime(client.lastContactAt)}>
                last contact {formatRelative(client.lastContactAt, at)}
              </span>
            ) : null}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <ClientStatusSelect id={hexId} status={client.status} />
            <Link href={`/admin/clients/${hexId}/edit`} className={buttonClasses("secondary", "sm")}>
              Edit
            </Link>
            <Link href={`/admin/projects/new?client=${hexId}`} className={buttonClasses("primary", "sm")}>
              New project
            </Link>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader
              title="Projects"
              description={projects.length ? undefined : "No projects yet."}
              action={
                projects.length ? (
                  <Link
                    href={`/admin/projects?view=all&client=${hexId}`}
                    className="text-[13px] text-accent underline-offset-4 hover:underline"
                  >
                    All
                  </Link>
                ) : null
              }
            />
            {projects.length ? (
              <ul className="divide-y divide-line">
                {projects.map((project) => (
                  <li key={project._id.toHexString()}>
                    <Link
                      href={`/admin/projects/${project._id.toHexString()}`}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5 text-[13px] hover:bg-white/[0.03]"
                    >
                      <span className="font-mono text-[11px] text-muted">{project.ref}</span>
                      <span className="min-w-0 flex-1 truncate font-medium">{project.title}</span>
                      {project.openTasks ? (
                        <span className="text-xs text-muted">{project.openTasks} open tasks</span>
                      ) : null}
                      <Badge
                        tone={
                          project.stage === "delivered"
                            ? "success"
                            : project.stage === "cancelled"
                              ? "neutral"
                              : "accent"
                        }
                      >
                        {PROJECT_STAGE_LABELS[project.stage]}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </Card>

          <ActivityComposer
            clientId={hexId}
            today={todayIn(ADMIN_TIME_ZONE, at)}
            projects={projects.map((project) => ({
              id: project._id.toHexString(),
              label: `${project.ref} · ${project.title}`,
            }))}
          />

          <Card>
            <CardHeader
              title="Timeline"
              description="Messages, emails, calls, projects and revision rounds."
            />
            <CardBody>
              {timeline.length ? (
                <ol className="grid gap-4">
                  {timeline.map((entry, index) => (
                    <li key={index} className="border-l-2 border-line pl-3">
                      <TimelineItem entry={entry} at={at} />
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-[13px] text-muted">Nothing yet.</p>
              )}
            </CardBody>
          </Card>
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="grid gap-2.5 text-[13px]">
                {details.map(([label, value]) => (
                  <div key={label} className="grid gap-0.5">
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              {client.notes ? (
                <p className="mt-4 border-t border-line pt-4 text-[13px] whitespace-pre-wrap text-ink/90">
                  {client.notes}
                </p>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Time" />
            <CardBody className="grid gap-1 text-[13px]">
              <p>
                <span className="font-semibold">{formatHours(time.seconds)}</span> tracked
              </p>
              {time.billableSeconds ? (
                <p className="text-muted">{formatHours(time.billableSeconds)} of it billable</p>
              ) : null}
            </CardBody>
          </Card>
          <ClientPrivacyCard id={hexId} name={client.name} />
        </div>
      </div>
    </>
  );
}
