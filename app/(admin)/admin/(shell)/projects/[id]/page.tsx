import Link from "next/link";
import { notFound } from "next/navigation";
import { LinksCard, MilestonesCard, ProjectDeleteCard } from "@/components/admin/projects/project-controls";
import { RevisionMeter } from "@/components/admin/projects/revisions-panel";
import { ProjectUpdatesCard } from "@/components/admin/projects/updates-card";
import { DueText } from "@/components/admin/work/due-text";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { formatHours } from "@/lib/duration";
import { ADMIN_TIME_ZONE, formatDateTime, formatRelative } from "@/lib/format";
import { optionLabel, SERVICE_OPTIONS } from "@/lib/intake/options";
import { todayIn } from "@/lib/intake/time";
import { formatMoney, perHour, valueOfTime } from "@/lib/money";
import { dueLabel, formatDay } from "@/lib/work/dates";
import { ACTIVITY_LABELS, PRICING_LABELS } from "@/lib/work/options";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getProject, projectNumbers } from "@/server/projects/store";
import { updatesForProject } from "@/server/portal/updates";
import { activities, clients, parseId } from "@/server/work/collections";

export const metadata = { title: "Project" };

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const ratio = max > 0 ? value / max : 0;
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]" role="img" aria-label={label}>
      <div
        className={cn(
          "h-full rounded-full",
          ratio > 1 ? "bg-danger" : ratio > 0.85 ? "bg-warning" : "bg-accent",
        )}
        style={{ width: `${Math.min(ratio, 1) * 100}%` }}
      />
    </div>
  );
}

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const project = id ? await getProject(db, id) : null;
  if (!project) notFound();
  const at = now();
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const [numbers, notes, updates, owner] = await Promise.all([
    projectNumbers(db, project._id),
    activities(db).find({ projectId: project._id }).sort({ at: -1 }).limit(20).toArray(),
    updatesForProject(db, project._id, 20),
    clients(db).findOne({ _id: project.clientId }, { projection: { portal: 1 } }),
  ]);
  const hexId = project._id.toHexString();
  const totalTasks = numbers.tasks.todo + numbers.tasks.doing + numbers.tasks.done;

  const facts: [string, React.ReactNode][] = [
    ["Service", optionLabel(SERVICE_OPTIONS, project.service) ?? "Not set"],
    ["Pricing", PRICING_LABELS[project.pricing]],
  ];
  if (project.startDate) facts.push(["Started", formatDay(project.startDate, today)]);
  facts.push([
    "Due",
    project.dueDate ? (
      project.stage === "delivered" ? (
        formatDay(project.dueDate, today)
      ) : (
        <DueText due={dueLabel(project.dueDate, today)} />
      )
    ) : (
      "No due date"
    ),
  ]);
  if (project.deliveredAt) facts.push(["Delivered", formatDateTime(project.deliveredAt)]);
  if (project.tags.length) facts.push(["Tags", project.tags.join(", ")]);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 content-start gap-6">
        <Card>
          <CardHeader title="Health" />
          <CardBody className="grid gap-5 text-[13px] sm:grid-cols-2">
            <div className="grid content-start gap-1.5">
              <p className="text-xs text-muted">Time</p>
              <p>
                <span className="text-lg font-semibold">{formatHours(numbers.seconds)}</span>
                {project.estimateSeconds ? (
                  <span className="text-muted"> of {formatHours(project.estimateSeconds)} estimated</span>
                ) : (
                  <span className="text-muted"> tracked</span>
                )}
              </p>
              {project.estimateSeconds ? (
                <Meter
                  value={numbers.seconds}
                  max={project.estimateSeconds}
                  label={`${formatHours(numbers.seconds)} of ${formatHours(project.estimateSeconds)} estimated`}
                />
              ) : null}
              {numbers.billableSeconds ? (
                <p className="text-xs text-muted">{formatHours(numbers.billableSeconds)} billable</p>
              ) : null}
            </div>
            <div className="grid content-start gap-1.5">
              <p className="text-xs text-muted">Money</p>
              {project.pricing === "fixed" ? (
                project.budget ? (
                  <>
                    <p>
                      <span className="text-lg font-semibold">{formatMoney(project.budget)}</span>
                      <span className="text-muted"> fixed price</span>
                    </p>
                    {perHour(project.budget, numbers.seconds) ? (
                      <p className="text-xs text-muted">
                        {formatMoney(perHour(project.budget, numbers.seconds)!)} per hour so far
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="text-muted">No price set.</p>
                )
              ) : project.hourlyRate ? (
                <>
                  <p>
                    <span className="text-lg font-semibold">
                      {formatMoney(valueOfTime(project.hourlyRate, numbers.billableSeconds))}
                    </span>
                    <span className="text-muted">
                      {" "}
                      of billable time at {formatMoney(project.hourlyRate)}/h
                    </span>
                  </p>
                  {project.budget ? (
                    <Meter
                      value={valueOfTime(project.hourlyRate, numbers.billableSeconds).amountMinor}
                      max={project.budget.amountMinor}
                      label={`Against a cap of ${formatMoney(project.budget)}`}
                    />
                  ) : null}
                  {project.budget ? (
                    <p className="text-xs text-muted">Cap {formatMoney(project.budget)}</p>
                  ) : null}
                </>
              ) : (
                <p className="text-muted">No rate set.</p>
              )}
            </div>
            <div className="grid content-start gap-1.5">
              <p className="text-xs text-muted">Tasks</p>
              <p>
                <span className="text-lg font-semibold">{numbers.tasks.done}</span>
                <span className="text-muted"> of {totalTasks} done</span>
              </p>
              {totalTasks ? (
                <Meter
                  value={numbers.tasks.done}
                  max={totalTasks}
                  label={`${numbers.tasks.done} of ${totalTasks} tasks done`}
                />
              ) : (
                <Link href={`/admin/projects/${hexId}/tasks`} className="text-xs text-accent hover:underline">
                  Add the first task
                </Link>
              )}
            </div>
            <div className="grid content-start gap-1.5">
              <p className="text-xs text-muted">Revisions</p>
              <RevisionMeter used={project.revisionsUsed} included={project.revisionPolicy.included} />
            </div>
          </CardBody>
        </Card>

        {project.summary ? (
          <Card>
            <CardHeader title="Scope and notes" />
            <CardBody>
              <p className="text-[13px] leading-6 whitespace-pre-wrap text-ink/90">{project.summary}</p>
            </CardBody>
          </Card>
        ) : null}

        <MilestonesCard
          projectId={hexId}
          milestones={project.milestones.map((milestone) => ({
            id: milestone.id,
            title: milestone.title,
            due: milestone.dueDate ? formatDay(milestone.dueDate, today) : null,
            done: milestone.done,
          }))}
        />

        <ProjectUpdatesCard
          projectId={hexId}
          portalOn={owner?.portal?.enabled === true}
          updates={updates.map((update) => ({
            id: update._id.toHexString(),
            body: update.body,
            when: formatDateTime(update.createdAt),
            emailed: update.emailed,
          }))}
        />

        {notes.length ? (
          <Card>
            <CardHeader title="From the client's log" />
            <CardBody>
              <ol className="grid gap-3 text-[13px]">
                {notes.map((note) => (
                  <li key={note._id.toHexString()} className="border-l-2 border-line pl-3">
                    <p className="text-xs text-muted">
                      {ACTIVITY_LABELS[note.kind]} ·{" "}
                      <span title={formatDateTime(note.at)}>{formatRelative(note.at, at)}</span>
                    </p>
                    <p className="whitespace-pre-wrap">{note.body}</p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        ) : null}
      </div>

      <div className="grid min-w-0 content-start gap-6">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="grid gap-2.5 text-[13px]">
              {facts.map(([label, value]) => (
                <div key={label} className="grid gap-0.5">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            {project.inquiryId ? (
              <p className="mt-3 border-t border-line pt-3 text-xs">
                <Link
                  href={`/admin/inbox/${project.inquiryId.toHexString()}`}
                  className="text-accent hover:underline"
                >
                  The message it started from
                </Link>
              </p>
            ) : null}
          </CardBody>
        </Card>
        <LinksCard
          projectId={hexId}
          links={project.links.map((link) => ({
            id: link.id,
            label: link.label,
            url: link.url,
            shared: link.shared === true,
          }))}
        />
        <ProjectDeleteCard id={hexId} reference={project.ref} />
      </div>
    </div>
  );
}
