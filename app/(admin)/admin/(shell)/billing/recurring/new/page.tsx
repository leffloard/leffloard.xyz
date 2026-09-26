import Link from "next/link";
import { DocumentEditor } from "@/components/admin/billing/document-editor";
import { PageHeader } from "@/components/admin/shell";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { blankEditorValue } from "@/server/billing/editor";
import { billingClients, billingProjects, serviceCatalog } from "@/server/billing/lookups";
import { paymentsAvailable } from "@/server/billing/providers";
import { getBillingSettings } from "@/server/billing/settings";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/projects/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "New recurring invoice" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewRecurringPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const db = await getDb();
  const projectId = parseId(first(raw.project));
  const [clients, projects, settings, project] = await Promise.all([
    billingClients(db),
    billingProjects(db),
    getBillingSettings(db),
    projectId ? getProject(db, projectId) : null,
  ]);
  const clientId = project?.clientId.toHexString() ?? parseId(first(raw.client))?.toHexString();
  const client = clients.find((option) => option.id === clientId);
  const available = paymentsAvailable();
  const initial = blankEditorValue({
    title: project ? `${project.title}: care plan, {period}` : "",
    clientId: client?.id,
    projectId: project?._id.toHexString(),
    recipient: client
      ? { name: client.name, company: client.company ?? "", email: client.email ?? "", address: "" }
      : undefined,
    currency: project?.currency ?? client?.currency ?? "USD",
    methods: settings.methods.filter((method) => method === "bank" || available[method]),
    nextOn: todayIn(ADMIN_TIME_ZONE, now()),
  });
  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/billing/recurring"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Recurring invoices
        </Link>
      </div>
      <PageHeader
        title="New recurring invoice"
        description="The same invoice every month, quarter or year, issued on its date and emailed to the client."
      />
      <DocumentEditor
        kind="recurring"
        id={null}
        version={0}
        initial={initial}
        clients={clients}
        projects={projects}
        catalog={serviceCatalog()}
        cryptoReady={available.crypto}
      />
    </>
  );
}
