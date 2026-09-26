import Link from "next/link";
import { ClientForm } from "@/components/admin/clients/client-form";
import { PageHeader } from "@/components/admin/shell";
import { timeZoneNames } from "@/lib/intake/time";
import { DEFAULT_CURRENCY } from "@/lib/money";
import { requireAdmin } from "@/server/auth/dal";

export const metadata = { title: "Add client" };

export default async function NewClientPage() {
  await requireAdmin();
  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/clients"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Clients
        </Link>
      </div>
      <PageHeader title="Add client" description="Only the name is needed; the rest can come later." />
      <ClientForm
        timeZones={timeZoneNames()}
        values={{
          name: "",
          company: "",
          email: "",
          phone: "",
          website: "",
          location: "",
          timeZone: "",
          currency: DEFAULT_CURRENCY,
          status: "lead",
          tags: "",
          notes: "",
          source: "",
        }}
      />
    </>
  );
}
