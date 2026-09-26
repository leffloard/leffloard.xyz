import { AdminShell } from "@/components/admin/shell";
import { SudoProvider } from "@/components/admin/sudo";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { listPasskeys } from "@/server/auth/passkeys";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { countNew } from "@/server/inquiries/store";
import { projectChoices } from "@/server/projects/store";
import { taskCounts } from "@/server/tasks/store";
import { runningTimer } from "@/server/time/store";

// Pages below also call requireAdmin(): layouts are not re-rendered on every navigation, so a check here
// alone would not be enough.
export default async function ShellLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdmin();
  const db = await getDb();
  const at = now();
  const [passkeys, newInquiries, tasks, running, projects] = await Promise.all([
    listPasskeys(db, user._id),
    countNew(db),
    taskCounts(db, todayIn(ADMIN_TIME_ZONE, at)),
    runningTimer(db),
    projectChoices(db),
  ]);
  const timer = {
    running: running
      ? {
          description: running.description,
          label: running.project ? `${running.project.ref} · ${running.project.title}` : null,
          startedAt: running.startedAt.toISOString(),
          elapsed: Math.max(0, (at.getTime() - running.startedAt.getTime()) / 1000),
        }
      : null,
    projects: projects.map((project) => ({ id: project.id, label: `${project.ref} · ${project.title}` })),
  };
  // The provider wraps the shell too: the sidebar's timer runs admin actions.
  return (
    <SudoProvider hasPasskeys={passkeys.length > 0}>
      <AdminShell
        user={{ name: user.name, email: user.email }}
        newInquiries={newInquiries}
        tasksDue={tasks.today}
        timer={timer}
      >
        {children}
      </AdminShell>
    </SudoProvider>
  );
}
