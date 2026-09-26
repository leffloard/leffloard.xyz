import Link from "next/link";
import { ProjectForm } from "@/components/admin/projects/project-form";
import { PageHeader } from "@/components/admin/shell";
import { Notice } from "@/components/ui/notice";
import { services } from "@/content/services";
import { amountInput } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";
import { clientChoices, getClient } from "@/server/clients/store";
import { getDb } from "@/server/db/client";
import { getInquiry } from "@/server/inquiries/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "New project" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

// The revision rounds of the service's highlighted package, as a starting point.
function defaultRounds(service: string | null): number {
  const match = services.find((item) => item.slug === service);
  return match?.packages.find((pack) => pack.highlighted)?.revisions ?? 2;
}

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const db = await getDb();
  const inquiryId = parseId(first(raw.inquiry));
  const inquiry = inquiryId ? await getInquiry(db, inquiryId) : null;
  const clientId = parseId(first(raw.client)) ?? inquiry?.clientId ?? null;
  const [client, clients] = await Promise.all([clientId ? getClient(db, clientId) : null, clientChoices(db)]);
  const service = inquiry?.service && inquiry.service !== "other" ? inquiry.service : null;
  const currency = client?.currency ?? "USD";
  const back = inquiry
    ? `/admin/inbox/${inquiry._id.toHexString()}`
    : client
      ? `/admin/clients/${client._id.toHexString()}`
      : "/admin/projects";

  return (
    <>
      <div className="mb-4">
        <Link
          href={back}
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← {inquiry ? inquiry.subject : client ? client.name : "Projects"}
        </Link>
      </div>
      <PageHeader title="New project" />
      {clients.length === 0 ? (
        <Notice tone="warning" className="mb-6">
          Projects belong to a client.{" "}
          <Link href="/admin/clients/new" className="underline">
            Add a client
          </Link>{" "}
          first.
        </Notice>
      ) : null}
      {inquiry ? (
        <Notice className="mb-6">
          Started from {inquiry.ref}: the title, service and scope come from the message. Check them before
          saving.
        </Notice>
      ) : null}
      <ProjectForm
        clients={clients.map((choice) => ({
          id: choice.id,
          label: choice.company ? `${choice.name} (${choice.company})` : choice.name,
        }))}
        cancelHref={back}
        values={{
          inquiryId: inquiry?._id.toHexString(),
          clientId: client?._id.toHexString() ?? "",
          title: inquiry?.subject ?? "",
          service: service ?? "",
          summary: inquiry?.message ?? "",
          startDate: "",
          dueDate: "",
          estimate: "",
          currency,
          pricing: "fixed",
          budget: "",
          hourlyRate: "",
          includedRevisions: String(defaultRounds(service)),
          extraRevisionPrice: currency === "USD" ? amountInput({ amountMinor: 6_000, currency }) : "",
          tags: "",
        }}
      />
    </>
  );
}
