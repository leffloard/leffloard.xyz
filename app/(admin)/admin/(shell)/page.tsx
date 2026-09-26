import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ADMIN_TIME_ZONE, formatDate, formatRelative, plural } from "@/lib/format";
import { recentAudit } from "@/server/auth/audit";
import { requireAdmin } from "@/server/auth/dal";
import { listPasskeys } from "@/server/auth/passkeys";
import { listSessions } from "@/server/auth/sessions";
import { toPublicUser } from "@/server/auth/users";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { countNew, latestInquiries } from "@/server/inquiries/store";
import { KIND_LABELS } from "@/lib/intake/options";
import { channelStatus } from "@/server/notify/channels";
import { outboxSummary } from "@/server/notify/outbox";
import { pendingMigrations } from "@/server/db/migrate";
import { readEnv } from "@/server/env";
import { DueText } from "@/components/admin/work/due-text";
import { TaskList } from "@/components/admin/work/task-list";
import { addDays, todayIn, wallDateTime } from "@/lib/intake/time";
import { dueLabel, formatWeekday } from "@/lib/work/dates";
import { PROJECT_STAGE_LABELS } from "@/lib/work/options";
import { listProjects } from "@/server/projects/store";
import { listTasks } from "@/server/tasks/store";
import { toTaskRow } from "@/server/tasks/view";
import { countRequests, upcomingMeetings } from "@/server/calendar/meetings";
import { openPrivacyRequests } from "@/server/portal/privacy";
import type { MeetingDoc } from "@/server/calendar/types";

export const metadata = { title: "Today" };

const ROADMAP = [
  ["M9", "Content editor for the public site, and GitHub sync"],
  ["M10", "AI assistant"],
  ["M11", "Analytics, notification centre, command palette"],
  ["M12", "Security tests, load tests and launch"],
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
  const today = todayIn(ADMIN_TIME_ZONE, at);
  const [
    sessions,
    passkeys,
    pending,
    lastSignIns,
    newCount,
    latest,
    delivery,
    dueTasks,
    openProjects,
    meetings,
    requests,
    dataRequests,
  ] = await Promise.all([
    listSessions(db, user._id),
    listPasskeys(db, user._id),
    pendingMigrations(db),
    recentAudit(db, { prefix: "auth.login", limit: 20 }),
    countNew(db),
    latestInquiries(db, 5, at),
    outboxSummary(db),
    listTasks(db, "today", today, { limit: 12 }),
    listProjects(db, { view: "open" }),
    upcomingMeetings(db, at, 6),
    countRequests(db, at),
    openPrivacyRequests(db),
  ]);
  const channels = channelStatus();
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
        <AgendaCard meetings={meetings} requests={requests} today={today} at={at} />

        <Card className="md:col-span-2">
          <CardHeader
            title="Inbox"
            description={newCount ? `${plural(newCount, "new message")} waiting.` : "Nothing new."}
            action={
              <Link
                href="/admin/inbox"
                className="text-[13px] text-accent underline-offset-4 hover:underline"
              >
                Open
              </Link>
            }
          />
          <CardBody>
            {latest.length === 0 ? (
              <p className="text-[13px] text-muted">
                Messages from the contact form show up here and in the Inbox.
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {latest.map((item) => (
                  <li key={item._id.toHexString()}>
                    <Link
                      href={`/admin/inbox/${item._id.toHexString()}`}
                      className="flex min-w-0 items-baseline gap-3 py-2 text-[13px] hover:text-accent"
                    >
                      <span
                        aria-hidden
                        className={`size-1.5 shrink-0 self-center rounded-full ${item.status === "new" ? "bg-accent" : "bg-line-strong"}`}
                      />
                      <span className="w-40 shrink-0 truncate font-medium">{item.name}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">{item.subject}</span>
                      <Badge className="hidden sm:inline-flex">{KIND_LABELS[item.kind]}</Badge>
                      <span className="shrink-0 text-xs text-muted">
                        {formatRelative(item.receivedAt, at)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        {dataRequests.length ? (
          <Card className="md:col-span-2">
            <CardHeader
              title="Data requests"
              description="Clients asked in their portal for a copy of their data or its deletion."
            />
            <CardBody>
              <ul className="divide-y divide-line">
                {dataRequests.map((row) => (
                  <li key={row.id}>
                    <Link
                      href={`/admin/clients/${row.clientId}`}
                      className="flex min-w-0 items-baseline gap-3 py-2 text-[13px] hover:text-accent"
                    >
                      <Badge tone="warning">{row.kind === "export" ? "Copy of data" : "Deletion"}</Badge>
                      <span className="min-w-0 flex-1 truncate font-medium">{row.clientName}</span>
                      <span className="shrink-0 text-xs text-muted">
                        answer by {formatDate(row.answerBy)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        ) : null}

        <Card className="md:col-span-2">
          <CardHeader
            title="Due today"
            description={
              dueTasks.length
                ? `${plural(dueTasks.length, "task")} due today or late.`
                : "Nothing due. Pick something from Anytime, or plan the week."
            }
            action={
              <Link
                href="/admin/tasks"
                className="text-[13px] text-accent underline-offset-4 hover:underline"
              >
                Tasks
              </Link>
            }
          />
          {dueTasks.length ? (
            <CardBody>
              <TaskList rows={dueTasks.map((task) => toTaskRow(task, today))} emptyText="" keyboard={false} />
            </CardBody>
          ) : null}
        </Card>

        <Card className="md:col-span-2">
          <CardHeader
            title="Projects"
            description={
              openProjects.items.length
                ? `${plural(openProjects.items.length, "open project")}, soonest first.`
                : "No open projects. Start one from a client or an inbox message."
            }
            action={
              <Link
                href="/admin/projects"
                className="text-[13px] text-accent underline-offset-4 hover:underline"
              >
                Board
              </Link>
            }
          />
          {openProjects.items.length ? (
            <ul className="divide-y divide-line">
              {openProjects.items.slice(0, 6).map((project) => (
                <li key={project._id.toHexString()}>
                  <Link
                    href={`/admin/projects/${project._id.toHexString()}`}
                    className="flex min-w-0 items-baseline gap-3 px-5 py-2 text-[13px] hover:text-accent"
                  >
                    <span className="shrink-0 font-mono text-[11px] text-muted">{project.ref}</span>
                    <span className="min-w-0 flex-1 truncate font-medium">{project.title}</span>
                    <span className="hidden truncate text-xs text-muted sm:inline">{project.clientName}</span>
                    <Badge className="hidden sm:inline-flex">{PROJECT_STAGE_LABELS[project.stage]}</Badge>
                    {project.dueDate ? (
                      <DueText due={dueLabel(project.dueDate, today)} className="shrink-0 text-xs" />
                    ) : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card>
          <CardHeader title="System" description="Configuration and database." />
          <CardBody className="grid gap-2.5 text-[13px]">
            <StatusRow label="Database" ok detail="connected" />
            <StatusRow
              label="Migrations"
              ok={pending.length === 0}
              detail={pending.length ? `${plural(pending.length, "pending migration")}` : "up to date"}
            />
            <StatusRow
              label="Email"
              ok={channels.clientEmail}
              detail={
                channels.clientEmail
                  ? channels.ownerEmail
                    ? "alerts and replies"
                    : "replies only"
                  : "not set up"
              }
            />
            <StatusRow
              label="Discord alerts"
              ok={channels.discord}
              detail={channels.discord ? "on" : "off"}
            />
            {delivery.failed > 0 ? (
              <StatusRow
                label="Notifications"
                ok={false}
                detail={`${plural(delivery.failed, "failed message")}: see Settings`}
              />
            ) : null}
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

// "Today, 17:00", "Tomorrow, 18:30", "Thu 1 Oct, 17:00", in the owner's zone.
function meetingTime(start: Date, today: string): string {
  const wall = wallDateTime(start, ADMIN_TIME_ZONE);
  const day =
    wall.date === today
      ? "Today"
      : wall.date === addDays(today, 1)
        ? "Tomorrow"
        : formatWeekday(wall.date, today);
  return `${day}, ${wall.time}`;
}

function AgendaCard({
  meetings,
  requests,
  today,
  at,
}: {
  meetings: MeetingDoc[];
  requests: number;
  today: string;
  at: Date;
}) {
  return (
    <Card className="md:col-span-2">
      <CardHeader
        title="Meetings"
        description={
          requests
            ? `${plural(requests, "request")} waiting for your answer.`
            : meetings.length
              ? "Coming up next."
              : "Nothing booked. Share /book when a client wants to talk."
        }
        action={
          <Link href="/admin/calendar" className="text-[13px] text-accent underline-offset-4 hover:underline">
            Calendar
          </Link>
        }
      />
      {meetings.length ? (
        <ul className="divide-y divide-line">
          {meetings.map((meeting) => {
            const id = meeting._id.toHexString();
            const live = meeting.startsAt <= at;
            return (
              <li
                key={id}
                className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2 text-[13px]"
              >
                <span className={`w-36 shrink-0 font-mono text-xs ${live ? "text-accent" : "text-muted"}`}>
                  {live ? "Now" : meetingTime(meeting.startsAt, today)}
                </span>
                <Link
                  href={`/admin/calendar/meetings/${id}`}
                  className="min-w-0 flex-1 truncate hover:text-accent"
                >
                  <span className="font-medium">{meeting.name}</span>
                  <span className="text-muted"> · {meeting.title}</span>
                </Link>
                {meeting.status === "requested" ? (
                  <Badge tone="warning">request</Badge>
                ) : meeting.location.url ? (
                  <a
                    href={meeting.location.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0 text-xs text-accent underline-offset-4 hover:underline"
                  >
                    Join
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </Card>
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
