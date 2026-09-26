import { AdminShell } from "@/components/admin/shell";
import { SudoProvider } from "@/components/admin/sudo";
import { requireAdmin } from "@/server/auth/dal";
import { listPasskeys } from "@/server/auth/passkeys";
import { getDb } from "@/server/db/client";
import { countNew } from "@/server/inquiries/store";

// Pages below also call requireAdmin(): layouts are not re-rendered on every navigation, so a check here
// alone would not be enough.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  const db = await getDb();
  const [passkeys, newInquiries] = await Promise.all([listPasskeys(db, user._id), countNew(db)]);
  return (
    <AdminShell user={{ name: user.name, email: user.email }} newInquiries={newInquiries}>
      <SudoProvider hasPasskeys={passkeys.length > 0}>{children}</SudoProvider>
    </AdminShell>
  );
}
