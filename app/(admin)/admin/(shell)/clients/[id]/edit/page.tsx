import Link from "next/link";
import { notFound } from "next/navigation";
import { ClientForm } from "@/components/admin/clients/client-form";
import { PageHeader } from "@/components/admin/shell";
import { timeZoneNames } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { getClient } from "@/server/clients/store";
import { getDb } from "@/server/db/client";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Edit client" };

export default async function EditClientPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const client = id ? await getClient(await getDb(), id) : null;
  if (!client) notFound();
  const hexId = client._id.toHexString();
  return (
    <>
      <div className="mb-4">
        <Link
          href={`/admin/clients/${hexId}`}
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← {client.name}
        </Link>
      </div>
      <PageHeader title="Edit client" />
      <ClientForm
        timeZones={timeZoneNames()}
        values={{
          id: hexId,
          version: client.version,
          name: client.name,
          company: client.company ?? "",
          email: client.email ?? "",
          phone: client.phone ?? "",
          website: client.website ?? "",
          location: client.location ?? "",
          timeZone: client.timeZone ?? "",
          currency: client.currency,
          status: client.status,
          tags: client.tags.join(", "),
          notes: client.notes,
          source: client.source ?? "",
        }}
      />
    </>
  );
}
