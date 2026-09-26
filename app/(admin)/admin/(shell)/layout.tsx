import { AdminShell } from "@/components/admin/shell";
import { SudoProvider } from "@/components/admin/sudo";
import { requireAdmin } from "@/server/auth/dal";
import { listPasskeys } from "@/server/auth/passkeys";
import { getDb } from "@/server/db/client";

// Pages below also call requireAdmin(): layouts are not re-rendered on every navigation, so a check here
// alone would not be enough.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  const hasPasskeys = (await listPasskeys(await getDb(), user._id)).length > 0;
  return (
    <AdminShell user={{ name: user.name, email: user.email }}>
      <SudoProvider hasPasskeys={hasPasskeys}>{children}</SudoProvider>
    </AdminShell>
  );
}
