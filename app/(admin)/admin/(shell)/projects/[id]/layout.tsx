import Link from "next/link";
import { notFound } from "next/navigation";
import { StageSelect } from "@/components/admin/projects/project-controls";
import { PageHeader } from "@/components/admin/shell";
import { TabNav } from "@/components/admin/tab-nav";
import { StartTimerButton } from "@/components/admin/time/timer-widget";
import { buttonClasses } from "@/components/ui/button";
import { requireAdmin } from "@/server/auth/dal";
import { getClient } from "@/server/clients/store";
import { getDb } from "@/server/db/client";
import { getProject, projectNumbers } from "@/server/projects/store";
import { runningEntry } from "@/server/time/store";
import { parseId } from "@/server/work/collections";

// The project's header and tabs. Each tab's page checks the session again (see the shell layout).
export default async function ProjectLayout({
  params,
  children,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const project = id ? await getProject(db, id) : null;
  if (!project) notFound();
  const [client, numbers, running] = await Promise.all([
    getClient(db, project.clientId),
    projectNumbers(db, project._id),
    runningEntry(db),
  ]);
  const hexId = project._id.toHexString();
  const base = `/admin/projects/${hexId}`;

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/projects"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Projects
        </Link>
      </div>
      <PageHeader
        title={project.title}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="font-mono">{project.ref}</span>
            {client ? (
              <Link
                href={`/admin/clients/${client._id.toHexString()}`}
                className="hover:text-ink hover:underline"
              >
                {client.name}
                {client.company ? ` · ${client.company}` : ""}
              </Link>
            ) : null}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StageSelect id={hexId} stage={project.stage} />
            <StartTimerButton
              description={project.title}
              projectId={hexId}
              taskId={null}
              running={Boolean(running?.projectId?.equals(project._id) && !running.taskId)}
            />
            <Link href={`${base}/edit`} className={buttonClasses("secondary", "sm")}>
              Edit
            </Link>
            <Link
              href={`/admin/billing/invoices/new?project=${hexId}`}
              className={buttonClasses("secondary", "sm")}
            >
              New invoice
            </Link>
          </div>
        }
      />
      <TabNav
        label="Project"
        tabs={[
          { href: base, label: "Overview" },
          { href: `${base}/tasks`, label: "Tasks", count: numbers.tasks.todo + numbers.tasks.doing },
          { href: `${base}/revisions`, label: "Revisions", count: project.revisionsUsed },
          { href: `${base}/time`, label: "Time" },
        ]}
      />
      {children}
    </>
  );
}
