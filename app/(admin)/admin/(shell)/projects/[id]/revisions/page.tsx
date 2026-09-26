import { notFound } from "next/navigation";
import { RevisionsPanel } from "@/components/admin/projects/revisions-panel";
import { formatDate } from "@/lib/format";
import { amountInput, formatMoney } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { listRevisions } from "@/server/projects/revisions";
import { getProject } from "@/server/projects/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Revisions" };

export default async function ProjectRevisionsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const project = id ? await getProject(db, id) : null;
  if (!project) notFound();
  const rounds = await listRevisions(db, project._id);
  const policy = project.revisionPolicy;

  return (
    <RevisionsPanel
      projectId={project._id.toHexString()}
      nextNumber={project.revisionSeq + 1}
      used={project.revisionsUsed}
      included={policy.included}
      extraPrice={policy.extraPrice ? formatMoney(policy.extraPrice) : null}
      extraPriceInput={amountInput(policy.extraPrice)}
      rounds={rounds.map((round) => ({
        id: round._id.toHexString(),
        number: round.number,
        title: round.title,
        details: round.details,
        status: round.status,
        billable: round.billable,
        fromPortal: round.fromPortal === true,
        price: round.price ? formatMoney(round.price) : null,
        requested: formatDate(round.requestedAt),
        taskId: round.taskId?.toHexString() ?? null,
        inquiryId: round.inquiryId?.toHexString() ?? null,
      }))}
    />
  );
}
