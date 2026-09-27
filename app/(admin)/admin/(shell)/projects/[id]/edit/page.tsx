import { notFound } from "next/navigation";
import { ProjectForm } from "@/components/admin/projects/project-form";
import { amountInput } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { clientChoices } from "@/server/clients/store";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/projects/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Edit project" };

function hoursInput(seconds: number | null): string {
  if (!seconds) return "";
  const hours = Math.round((seconds / 3600) * 100) / 100;
  return String(hours);
}

export default async function EditProjectPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const project = id ? await getProject(db, id) : null;
  if (!project) notFound();
  const clients = await clientChoices(db);
  const hexId = project._id.toHexString();
  // An archived client does not appear in the list, but the project may still belong to one.
  const options = clients.map((choice) => ({
    id: choice.id,
    label: choice.company ? `${choice.name} (${choice.company})` : choice.name,
  }));
  if (!options.some((option) => option.id === project.clientId.toHexString())) {
    options.unshift({ id: project.clientId.toHexString(), label: "The current client (archived)" });
  }

  return (
    <ProjectForm
      clients={options}
      cancelHref={`/admin/projects/${hexId}`}
      values={{
        id: hexId,
        version: project.version,
        clientId: project.clientId.toHexString(),
        title: project.title,
        service: project.service ?? "",
        summary: project.summary,
        startDate: project.startDate ?? "",
        dueDate: project.dueDate ?? "",
        estimate: hoursInput(project.estimateSeconds),
        currency: project.currency,
        pricing: project.pricing,
        budget: amountInput(project.budget),
        hourlyRate: amountInput(project.hourlyRate),
        includedRevisions: String(project.revisionPolicy.included),
        extraRevisionPrice: amountInput(project.revisionPolicy.extraPrice),
        tags: project.tags.join(", "),
      }}
    />
  );
}
