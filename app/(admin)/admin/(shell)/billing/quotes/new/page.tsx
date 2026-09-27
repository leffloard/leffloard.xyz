import Link from "next/link";
import { DocumentEditor } from "@/components/admin/billing/document-editor";
import { PageHeader } from "@/components/admin/shell";
import { quoteAssist } from "@/server/ai/inbox";
import { requireAdmin } from "@/server/auth/dal";
import { blankEditorValue } from "@/server/billing/editor";
import { billingClients, serviceCatalog } from "@/server/billing/lookups";
import { getDb } from "@/server/db/client";
import { getInquiry } from "@/server/inquiries/store";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "New quote" };

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const raw = await searchParams;
  const db = await getDb();
  const clients = await billingClients(db);
  const clientId = parseId(first(raw.client))?.toHexString();
  const client = clients.find((option) => option.id === clientId);
  const inquiryId = parseId(first(raw.inquiry));
  const inquiry = inquiryId ? await getInquiry(db, inquiryId) : null;
  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/billing/quotes"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Quotes
        </Link>
      </div>
      <PageHeader
        title="New quote"
        description="Saved as a draft. Nothing reaches the client until you send it."
      />
      <DocumentEditor
        kind="quote"
        id={null}
        version={0}
        initial={blankEditorValue({
          title: inquiry?.subject ?? "",
          clientId: client?.id,
          inquiryId: inquiry?._id.toHexString(),
          recipient: client
            ? { name: client.name, company: client.company ?? "", email: client.email ?? "", address: "" }
            : undefined,
          currency: client?.currency ?? "USD",
          methods: [],
        })}
        clients={clients}
        catalog={await serviceCatalog()}
        cryptoReady={false}
        ai={await quoteAssist(db, inquiry?._id ?? null)}
      />
    </>
  );
}
