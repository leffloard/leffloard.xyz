import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RevisionForm } from "@/components/site/portal/revision-form";
import { PageIntro, Section } from "@/components/site/section";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/format";
import { formatMoney } from "@/lib/money";
import { PROJECT_STAGE_LABELS, REVISION_STATUS_LABELS } from "@/lib/work/options";
import { longDate } from "@/server/billing/view";
import { getDb } from "@/server/db/client";
import { requirePortalClient } from "@/server/portal/dal";
import { updatesForProject } from "@/server/portal/updates";
import { portalProject } from "@/server/portal/views";
import { listRevisions } from "@/server/projects/revisions";
import { parseId } from "@/server/work/collections";

export const metadata: Metadata = { title: "Project" };

const card = "rounded-3xl border border-line bg-surface p-6";

// Safe to link: only http(s) addresses are shown as links.
function webLink(url: string): string | null {
  return /^https?:\/\//i.test(url) ? url : null;
}

export default async function PortalProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { client } = await requirePortalClient();
  const id = parseId((await params).id);
  const db = await getDb();
  // Another client's project is simply not found.
  const project = id ? await portalProject(db, client._id, id) : null;
  if (!project) notFound();
  const [updates, rounds] = await Promise.all([
    updatesForProject(db, project._id),
    listRevisions(db, project._id),
  ]);
  const shared = project.links.filter((link) => link.shared);
  const { included, extraPrice } = project.revisionPolicy;
  const used = project.revisionsUsed;
  const nextBillable = used >= included;

  return (
    <>
      <div className="px-5 pt-8 sm:px-10">
        <Link href="/portal" className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline">
          ← All projects
        </Link>
      </div>
      <PageIntro
        label={`${project.ref} · ${PROJECT_STAGE_LABELS[project.stage]}`}
        title={project.title}
        intro={project.dueDate ? `Planned for ${longDate(project.dueDate)}.` : undefined}
      />
      <Section label="Progress" title="Steps">
        {project.milestones.length ? (
          <ol className="grid gap-2">
            {project.milestones.map((milestone) => (
              <li key={milestone.id} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={`size-3 shrink-0 rounded-full border ${milestone.done ? "border-success bg-success" : "border-line-strong"}`}
                />
                <span className={milestone.done ? "text-muted line-through" : undefined}>
                  {milestone.title}
                </span>
                <span className="sr-only">{milestone.done ? "(done)" : "(to do)"}</span>
                {milestone.dueDate && !milestone.done ? (
                  <span className="text-sm text-muted">by {longDate(milestone.dueDate)}</span>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted">The steps of this project will show here.</p>
        )}
      </Section>
      <Section label="Updates" title="News from me">
        {updates.length ? (
          <ol className="grid gap-4">
            {updates.map((update) => (
              <li key={update._id.toHexString()} className={card}>
                <p className="font-mono text-xs text-muted">{formatDate(update.createdAt)}</p>
                <p className="mt-2 whitespace-pre-line">{update.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-muted">No updates yet.</p>
        )}
      </Section>
      {shared.length ? (
        <Section label="Deliverables" title="Links and files">
          <ul className="grid gap-2">
            {shared.map((link) => {
              const href = webLink(link.url);
              return (
                <li key={link.id}>
                  {href ? (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ink underline underline-offset-4"
                    >
                      {link.label}
                    </a>
                  ) : (
                    <span>
                      {link.label}: {link.url}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}
      <Section
        label="Revisions"
        title="Revision rounds"
        intro={`${Math.min(used, included)} of ${included} included ${included === 1 ? "round" : "rounds"} used.${
          extraPrice ? ` Each further round is ${formatMoney(extraPrice)}.` : ""
        }`}
      >
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,420px)]">
          <div>
            {rounds.length ? (
              <ul className="grid gap-3">
                {rounds.map((round) => (
                  <li key={round._id.toHexString()} className={`${card} grid gap-1`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted">Round {round.number}</span>
                      <Badge
                        tone={
                          round.status === "done"
                            ? "success"
                            : round.status === "cancelled"
                              ? "neutral"
                              : "accent"
                        }
                      >
                        {REVISION_STATUS_LABELS[round.status]}
                      </Badge>
                      {round.billable ? (
                        <Badge>{round.price ? `extra: ${formatMoney(round.price)}` : "extra"}</Badge>
                      ) : null}
                    </span>
                    <span className="font-medium">{round.title}</span>
                    {round.details ? (
                      <span className="text-sm whitespace-pre-line text-muted">{round.details}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted">None asked for yet.</p>
            )}
          </div>
          {project.stage !== "paused" ? (
            <RevisionForm
              projectId={project._id.toHexString()}
              billable={nextBillable}
              extraPrice={extraPrice}
            />
          ) : (
            <p className="text-sm text-muted">
              This project is paused: for changes, reply to my last email or book a call.
            </p>
          )}
        </div>
      </Section>
    </>
  );
}
