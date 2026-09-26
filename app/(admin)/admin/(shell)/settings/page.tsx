import {
  BackupsCard,
  BlockedCard,
  NotificationsCard,
  OutboxCard,
  type ChannelRow,
} from "@/components/admin/settings/cards";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { formatBytes, formatDateTime, formatRelative } from "@/lib/format";
import { backupStatus } from "@/server/backup/service";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { listBlocked } from "@/server/inquiries/blocklist";
import { listJobs } from "@/server/jobs/runner";
import { readChannels } from "@/server/notify/channels";
import { outboxSummary, recentOutbox } from "@/server/notify/outbox";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const db = await getDb();
  const at = now();
  const channels = readChannels();
  const [summary, recent, blocked, backups, jobs] = await Promise.all([
    outboxSummary(db),
    recentOutbox(db, 15),
    listBlocked(db),
    backupStatus(db),
    listJobs(db),
  ]);
  const lastBackup = backups.last;

  const email = channels.email;
  const rows: ChannelRow[] = [
    {
      label: "Email delivery",
      on: email !== null,
      detail: !email
        ? "off: set SMTP_HOST and SMTP_FROM"
        : email.delivery === "log"
          ? "written to the server log (EMAIL_DELIVERY=log)"
          : `${email.host}:${email.port} (${email.security})`,
    },
    {
      label: "Email alerts for new messages",
      on: channels.ownerEmail !== null,
      detail: channels.ownerEmail ? `to ${channels.ownerEmail}` : "off: set NOTIFY_EMAIL_TO",
    },
    {
      label: "Replies and status emails to visitors",
      on: email !== null,
      detail: email ? `from ${email.from}` : "off until email delivery works",
    },
    {
      label: "Discord alerts",
      on: channels.discordWebhookUrl !== null,
      detail: channels.discordWebhookUrl ? "webhook set" : "off: set DISCORD_WEBHOOK_URL",
    },
  ];

  return (
    <>
      <PageHeader
        title="Settings"
        description="Notifications, the inbox, backups and background jobs. More arrive with later modules."
      />
      <div className="grid grid-cols-1 gap-6">
        <NotificationsCard
          rows={rows}
          canTestEmail={channels.ownerEmail !== null}
          canTestDiscord={channels.discordWebhookUrl !== null}
        />
        <OutboxCard
          pending={summary.pending}
          failed={summary.failed}
          sentLastDay={summary.sentLastDay}
          lines={recent.map((item) => ({
            id: item._id.toHexString(),
            label: item.label,
            channel: item.channel === "email" ? "email" : "Discord",
            status: item.status,
            attempts: item.attempts,
            when:
              item.status === "pending" && item.attempts > 0
                ? `retry ${formatRelative(item.nextAttemptAt, at)}`
                : formatRelative(item.sentAt ?? item.createdAt, at),
            error: item.lastError,
          }))}
        />
        <BackupsCard
          state={backups.state}
          folder={backups.dir}
          keep={backups.keep}
          lastRun={
            lastBackup?.lastFinishedAt
              ? `${formatRelative(lastBackup.lastFinishedAt, at)}: ${lastBackup.lastOk ? "" : "failed: "}${lastBackup.lastMessage ?? ""}`
              : null
          }
          files={backups.files.slice(0, 10).map((file) => ({
            name: file.name,
            size: formatBytes(file.bytes),
            when: formatDateTime(file.modifiedAt),
          }))}
        />
        <Card>
          <CardHeader
            title="Background jobs"
            description="What the server runs on its own, and how it went last time."
          />
          <CardBody>
            {jobs.length === 0 ? (
              <p className="text-[13px] text-muted">No job has run yet.</p>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {jobs.map((job) => (
                  <li key={job._id} className="grid gap-0.5 py-2 first:pt-0 last:pb-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{job._id}</span>
                      {job.lastOk === null ? null : (
                        <Badge tone={job.lastOk ? "success" : "danger"}>{job.lastOk ? "ok" : "failed"}</Badge>
                      )}
                      <span className="ml-auto text-xs text-muted">
                        {job.lastFinishedAt
                          ? `last run ${formatRelative(job.lastFinishedAt, at)}`
                          : "not run yet"}
                      </span>
                    </div>
                    {job.lastMessage ? (
                      <p className="text-xs break-words text-muted">{job.lastMessage}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
        <BlockedCard
          lines={blocked.map((entry) => ({
            key: entry._id,
            kind: entry.kind,
            value: entry.value,
            since: formatDateTime(entry.createdAt),
          }))}
        />
      </div>
    </>
  );
}
