"use client";

import {
  retryFailedAction,
  testChannelAction,
  unblockAction,
} from "@/app/(admin)/admin/(shell)/settings/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

export type ChannelRow = { label: string; on: boolean; detail: string };

export function NotificationsCard({
  rows,
  canTestEmail,
  canTestDiscord,
}: {
  rows: ChannelRow[];
  canTestEmail: boolean;
  canTestDiscord: boolean;
}) {
  const { run, pending, message } = useActionRunner();
  return (
    <Card>
      <CardHeader
        title="Notifications"
        description="Set on the server (SMTP_*, NOTIFY_EMAIL_TO, DISCORD_WEBHOOK_URL). Changes need a restart."
      />
      <CardBody className="grid gap-3 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <ul className="grid gap-2">
          {rows.map((row) => (
            <li key={row.label} className="flex items-baseline justify-between gap-4">
              <span className="flex items-center gap-2">
                <span
                  aria-hidden
                  className={`size-1.5 rounded-full ${row.on ? "bg-success" : "bg-warning"}`}
                />
                {row.label}
              </span>
              <span className={`text-right ${row.on ? "text-muted" : "text-warning"}`}>{row.detail}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap gap-2 border-t border-line pt-3">
          <Button
            size="sm"
            disabled={!canTestEmail || pending !== null}
            pending={pending === "email"}
            onClick={() => run("email", () => testChannelAction({ channel: "email" }))}
          >
            Send a test email
          </Button>
          <Button
            size="sm"
            disabled={!canTestDiscord || pending !== null}
            pending={pending === "discord"}
            onClick={() => run("discord", () => testChannelAction({ channel: "discord" }))}
          >
            Send a test to Discord
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export type OutboxLine = {
  id: string;
  label: string;
  channel: string;
  status: string;
  attempts: number;
  when: string;
  error: string | null;
};

const STATUS_TONES: Record<string, "neutral" | "accent" | "success" | "warning" | "danger"> = {
  pending: "accent",
  sending: "accent",
  sent: "success",
  skipped: "warning",
  failed: "danger",
};

export function OutboxCard({
  lines,
  pending: pendingCount,
  failed,
  sentLastDay,
}: {
  lines: OutboxLine[];
  pending: number;
  failed: number;
  sentLastDay: number;
}) {
  const { run, pending, message } = useActionRunner();
  return (
    <Card>
      <CardHeader
        title="Delivery log"
        description={`${sentLastDay} sent in the last 24 hours · ${pendingCount} waiting · ${failed} failed. Kept for 30 days.`}
        action={
          failed > 0 ? (
            <Button
              size="sm"
              pending={pending === "retry"}
              onClick={() => run("retry", () => retryFailedAction({}))}
            >
              Retry failed
            </Button>
          ) : null
        }
      />
      <CardBody className="grid gap-3">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {lines.length === 0 ? (
          <p className="text-[13px] text-muted">Nothing has been sent yet.</p>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {lines.map((line) => (
              <li key={line.id} className="grid gap-0.5 py-2 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">{line.label}</span>
                  <Badge>{line.channel}</Badge>
                  <Badge tone={STATUS_TONES[line.status] ?? "neutral"}>{line.status}</Badge>
                  <span className="text-xs text-muted">{line.when}</span>
                </div>
                {line.error && line.status !== "sent" ? (
                  <p className="text-xs text-danger">
                    {line.error}
                    {line.attempts > 1 ? ` (attempt ${line.attempts})` : ""}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

export type BlockedLine = { key: string; kind: string; value: string; since: string };

export function BlockedCard({ lines }: { lines: BlockedLine[] }) {
  const { run, pending, message } = useActionRunner();
  return (
    <Card>
      <CardHeader
        title="Blocked senders"
        description="Their messages go straight to spam, without alerts. Block someone from a message's Spam button."
      />
      <CardBody className="grid gap-3">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {lines.length === 0 ? (
          <p className="text-[13px] text-muted">Nobody is blocked.</p>
        ) : (
          <ul className="divide-y divide-line text-[13px]">
            {lines.map((line) => (
              <li
                key={line.key}
                className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
              >
                <span className="min-w-0 break-all">
                  {line.kind === "domain" ? `Everyone at ${line.value}` : line.value}
                  <span className="ml-2 text-xs text-muted">since {line.since}</span>
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  pending={pending === line.key}
                  onClick={() => run(line.key, () => unblockAction({ key: line.key }))}
                >
                  Unblock
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
