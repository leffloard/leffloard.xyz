import {
  BlockedCard,
  NotificationsCard,
  OutboxCard,
  type ChannelRow,
} from "@/components/admin/settings/cards";
import Link from "next/link";
import { PageHeader } from "@/components/admin/shell";
import { formatDateTime, formatRelative } from "@/lib/format";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { listBlocked } from "@/server/inquiries/blocklist";
import { readChannels } from "@/server/notify/channels";
import { outboxSummary, recentOutbox } from "@/server/notify/outbox";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  await requireAdmin();
  const db = await getDb();
  const at = now();
  const channels = readChannels();
  const [summary, recent, blocked] = await Promise.all([
    outboxSummary(db),
    recentOutbox(db, 15),
    listBlocked(db),
  ]);

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
        description={
          <>
            Notification channels, the delivery log and blocked senders. Backups and background jobs are on
            the{" "}
            <Link href="/admin/system" className="text-accent underline underline-offset-2">
              System
            </Link>{" "}
            page.
          </>
        }
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
                : item.status === "pending" && item.nextAttemptAt > at
                  ? `held for quiet hours until ${formatDateTime(item.nextAttemptAt)}`
                  : formatRelative(item.sentAt ?? item.createdAt, at),
            error: item.lastError,
          }))}
        />
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
