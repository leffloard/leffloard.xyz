import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ADMIN_TIME_ZONE, formatRelative, plural } from "@/lib/format";
import { recentAudit } from "@/server/auth/audit";
import { requireAdmin } from "@/server/auth/dal";
import { listPasskeys } from "@/server/auth/passkeys";
import { listSessions } from "@/server/auth/sessions";
import { toPublicUser } from "@/server/auth/users";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { pendingMigrations } from "@/server/db/migrate";
import { readEnv } from "@/server/env";

export const metadata = { title: "Today" };

const ROADMAP = [
  ["M2", "Public site: design system, work, services, pricing, CV"],
  ["M3", "Inbox: project briefs, questions and revisions, with email and Discord alerts"],
  ["M4", "Going live on the VDS: backups, deploys, Cloudflare Tunnel"],
  ["M5", "Clients, projects, tasks, revisions and time tracking"],
  ["M6", "Calendar and booking"],
  ["M7", "Quotes, invoices, crypto and bank payments, finance"],
] as const;

function greeting(at: Date): string {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: ADMIN_TIME_ZONE, hour: "numeric" }).format(at),
  );
  if (hour < 5) return "Working late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function TodayPage() {
  const { user } = await requireAdmin();
  const db = await getDb();
  const at = now();
  const [sessions, passkeys, pending, lastSignIns] = await Promise.all([
    listSessions(db, user._id),
    listPasskeys(db, user._id),
    pendingMigrations(db),
    recentAudit(db, { prefix: "auth.login", limit: 20 }),
  ]);
  const profile = toPublicUser(user);
  const warnings = readEnv().warnings;
  const failedRecently = lastSignIns.filter(
    (event) => event.action !== "auth.login.succeeded" && at.getTime() - event.at.getTime() < 24 * 3600_000,
  ).length;
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone: ADMIN_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(at);

  return (
    <>
      <PageHeader title={`${greeting(at)}, ${profile.name.split(" ")[0]}`} description={date} />
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader title="System" description="Configuration and database." />
          <CardBody className="grid gap-2.5 text-[13px]">
            <StatusRow label="Database" ok detail="connected" />
            <StatusRow
              label="Migrations"
              ok={pending.length === 0}
              detail={pending.length ? `${plural(pending.length, "pending migration")}` : "up to date"}
            />
            {warnings.length === 0 ? (
              <StatusRow label="Configuration" ok detail="no warnings" />
            ) : (
              warnings.map((warning) => (
                <StatusRow key={warning} label="Configuration" ok={false} detail={warning} />
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Security"
            action={
              <Link
                href="/admin/security"
                className="text-[13px] text-accent underline-offset-4 hover:underline"
              >
                Open
              </Link>
            }
          />
          <CardBody className="grid gap-2.5 text-[13px]">
            <StatusRow label="Signed-in devices" ok detail={String(sessions.length)} />
            <StatusRow
              label="Passkeys"
              ok={passkeys.length > 0}
              detail={passkeys.length ? String(passkeys.length) : "none yet: add one as a backup"}
            />
            <StatusRow
              label="Recovery codes"
              ok={profile.recoveryCodesLeft > 3}
              detail={`${profile.recoveryCodesLeft} of 10 left`}
            />
            <StatusRow
              label="Failed sign-ins (24 h)"
              ok={failedRecently === 0}
              detail={failedRecently ? String(failedRecently) : "none"}
            />
            {lastSignIns[0] ? (
              <p className="pt-1 text-xs text-muted">
                Last sign-in event {formatRelative(lastSignIns[0].at, at)}.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card className="md:col-span-2">
          <CardHeader
            title="Coming next"
            description="The admin grows module by module. Each one arrives with its own tests."
          />
          <CardBody>
            <ol className="grid gap-2 text-[13px]">
              {ROADMAP.map(([milestone, text]) => (
                <li key={milestone} className="flex items-baseline gap-3">
                  <Badge>{milestone}</Badge>
                  <span className="text-muted">{text}</span>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function StatusRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="flex items-center gap-2">
        <span aria-hidden className={`size-1.5 rounded-full ${ok ? "bg-success" : "bg-warning"}`} />
        {label}
      </span>
      <span className={`text-right ${ok ? "text-muted" : "text-warning"}`}>{detail}</span>
    </div>
  );
}
