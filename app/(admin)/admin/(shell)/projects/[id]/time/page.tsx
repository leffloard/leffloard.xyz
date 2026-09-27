import { notFound } from "next/navigation";
import { EntryForm, EntryRow } from "@/components/admin/time/entries";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatHours } from "@/lib/duration";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { formatDay } from "@/lib/work/dates";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getProject, projectChoices, trackedTime } from "@/server/projects/store";
import { recentEntries } from "@/server/time/store";
import { toEntryRow } from "@/server/time/view";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Project time" };

export default async function ProjectTimePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const project = id ? await getProject(db, id) : null;
  if (!project) notFound();
  const today = todayIn(ADMIN_TIME_ZONE, now());
  const [entries, total, choices] = await Promise.all([
    recentEntries(db, { projectId: project._id }, 200),
    trackedTime(db, { projectId: project._id }),
    projectChoices(db),
  ]);
  const hexId = project._id.toHexString();
  const projects = choices.map((choice) => ({
    id: choice.id,
    label: `${choice.ref} · ${choice.title}`,
    hourly: choice.hourly,
  }));
  if (!projects.some((option) => option.id === hexId)) {
    projects.unshift({
      id: hexId,
      label: `${project.ref} · ${project.title}`,
      hourly: project.pricing === "hourly",
    });
  }
  const rows = entries.map((entry) => toEntryRow(entry, ADMIN_TIME_ZONE));
  const days = [...new Set(rows.map((row) => row.values.date))];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader
          title="Add time"
          description={`${formatHours(total.seconds)} tracked on this project, ${formatHours(total.billableSeconds)} billable.`}
        />
        <CardBody>
          <EntryForm
            idPrefix="project-time"
            submitLabel="Add time"
            projects={projects}
            values={{
              description: "",
              projectId: hexId,
              date: today,
              startTime: "",
              duration: "",
              billable: project.pricing === "hourly",
            }}
          />
        </CardBody>
      </Card>
      {days.length ? (
        days.map((day) => {
          const dayRows = rows.filter((row) => row.values.date === day);
          return (
            <section key={day} aria-label={formatDay(day, today)}>
              <h2 className="mb-2 flex items-baseline justify-between text-[13px] font-semibold">
                {formatDay(day, today)}
              </h2>
              <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
                {dayRows.map((row) => (
                  <EntryRow key={row.id} entry={row} projects={projects} />
                ))}
              </ul>
            </section>
          );
        })
      ) : (
        <p className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">
          No time tracked yet. Start the timer above, or add time by hand.
        </p>
      )}
    </div>
  );
}
