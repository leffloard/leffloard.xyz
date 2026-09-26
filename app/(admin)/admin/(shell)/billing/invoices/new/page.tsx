import Link from "next/link";
import { DocumentEditor } from "@/components/admin/billing/document-editor";
import { PageHeader } from "@/components/admin/shell";
import { requireAdmin } from "@/server/auth/dal";
import { blankEditorValue } from "@/server/billing/editor";
import { billingClients, billingProjects, serviceCatalog } from "@/server/billing/lookups";
import { paymentsAvailable } from "@/server/billing/providers";
import { getBillingSettings } from "@/server/billing/settings";
import { getDb } from "@/server/db/client";
import { getProject } from "@/server/projects/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "New invoice" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewInvoicePage({
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
  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/billing/invoices"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Invoices
        </Link>
      </div>
      <PageHeader title="New invoice" description="Saved as a draft. It gets its number when you issue it." />
      <DocumentEditor
        kind="invoice"
        id={null}
        version={0}
        initial={blankEditorValue({
          title: project?.title ?? "",
          clientId: client?.id,
          projectId: project?._id.toHexString(),
          recipient: client
            ? { name: client.name, company: client.company ?? "", email: client.email ?? "", address: "" }
            : undefined,
          currency: project?.currency ?? client?.currency ?? "USD",
          methods: settings.methods.filter((method) => method === "bank" || available[method]),
        })}
        clients={clients}
        projects={projects}
        catalog={await serviceCatalog()}
        cryptoReady={available.crypto}
      />
    </>
  );
}
