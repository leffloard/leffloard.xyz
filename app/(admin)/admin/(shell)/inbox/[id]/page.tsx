import Link from "next/link";
import { notFound } from "next/navigation";
import { CallCard, type CallInfo } from "@/components/admin/inbox/call-card";
import { LinkifiedText } from "@/components/admin/inbox/linkified-text";
import { OrganizeCard } from "@/components/admin/inbox/organize-card";
import { ReplyComposer } from "@/components/admin/inbox/reply-composer";
import { StatusPanel } from "@/components/admin/inbox/status-panel";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ADMIN_TIME_ZONE, formatDateTime, formatRelative } from "@/lib/format";
import {
  BUDGET_OPTIONS,
  KIND_LABELS,
  optionLabel,
  SERVICE_OPTIONS,
  STATUS_LABELS,
  TIMELINE_OPTIONS,
} from "@/lib/intake/options";
import { describeMoment, wallDateTime, zonedInstant } from "@/lib/intake/time";
import { requireAdmin } from "@/server/auth/dal";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getInquiry, listLabels, parseInquiryId } from "@/server/inquiries/store";
import type { Delivery, InquiryDoc } from "@/server/inquiries/types";
import { channelStatus } from "@/server/notify/channels";
import { defaultReplySubject } from "@/server/notify/templates";

export const metadata = { title: "Message" };

const SOURCES: Record<InquiryDoc["source"], string> = {
  form: "Contact form",
  "legacy-api": "v1 form",
  "legacy-import": "Imported from v1",
};

const DELIVERY: Record<Delivery, { label: string; tone: "accent" | "success" | "danger" | "warning" }> = {
  queued: { label: "sending", tone: "accent" },
  sent: { label: "sent", tone: "success" },
  failed: { label: "failed", tone: "danger" },
  skipped: { label: "not sent", tone: "warning" },
};

function callInfo(inquiry: InquiryDoc): CallInfo | null {
  const call = inquiry.call;
  if (!call) return null;
  const requestedAt = zonedInstant(call.date, call.time, call.timeZone);
  const sameZone = call.timeZone === ADMIN_TIME_ZONE;
  const scheduledWall = inquiry.scheduledAt ? wallDateTime(inquiry.scheduledAt, call.timeZone) : null;
  return {
    requested: requestedAt
      ? describeMoment(requestedAt, call.timeZone)
      : `${call.date} ${call.time} (${call.timeZone})`,
    requestedLocal: requestedAt && !sameZone ? describeMoment(requestedAt, ADMIN_TIME_ZONE) : null,
    duration: call.duration,
    timeZone: call.timeZone,
    defaultDate: scheduledWall?.date ?? call.date,
    defaultTime: scheduledWall?.time ?? call.time,
    scheduled: inquiry.scheduledAt ? describeMoment(inquiry.scheduledAt, call.timeZone) : null,
    scheduledLocal:
      inquiry.scheduledAt && !sameZone ? describeMoment(inquiry.scheduledAt, ADMIN_TIME_ZONE) : null,
  };
}

export default async function InquiryPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseInquiryId((await params).id);
  const db = await getDb();
  const inquiry = id ? await getInquiry(db, id) : null;
  if (!inquiry) notFound();
  const knownLabels = await listLabels(db);
  const canEmail = channelStatus().clientEmail;
  const at = now();
  const hexId = inquiry._id.toHexString();

  const details: [string, string | null][] = [
    ["Service", optionLabel(SERVICE_OPTIONS, inquiry.service)],
    ["Budget", optionLabel(BUDGET_OPTIONS, inquiry.budget)],
    ["Timeline", optionLabel(TIMELINE_OPTIONS, inquiry.timeline)],
    ["Project", inquiry.projectReference],
    ["Company", inquiry.company],
    ["Contact", inquiry.contact],
  ];
  const shownDetails = details.filter((entry): entry is [string, string] => Boolean(entry[1]));
  const call = callInfo(inquiry);

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/inbox"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Inbox
        </Link>
      </div>
      <PageHeader
        title={inquiry.subject}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono">{inquiry.ref}</span>
            <Badge>{KIND_LABELS[inquiry.kind]}</Badge>
            <Badge tone={inquiry.status === "new" ? "accent" : "neutral"}>
              {STATUS_LABELS[inquiry.status]}
            </Badge>
            {inquiry.aiOptOut ? <Badge tone="warning">no AI tools</Badge> : null}
            <span title={formatDateTime(inquiry.receivedAt)}>
              received {formatRelative(inquiry.receivedAt, at)}
            </span>
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader
              title={inquiry.name}
              description={
                <a
                  href={`mailto:${inquiry.email}`}
                  className="text-accent underline-offset-2 hover:underline"
                >
                  {inquiry.email}
                </a>
              }
              action={<span className="text-xs text-muted">{SOURCES[inquiry.source]}</span>}
            />
            <CardBody className="grid gap-4">
              <p className="text-sm leading-6 break-words whitespace-pre-wrap">
                <LinkifiedText text={inquiry.message} />
              </p>
              {inquiry.links ? (
                <div>
                  <h3 className="text-xs text-muted">Links</h3>
                  <p className="mt-1 text-[13px] break-words whitespace-pre-wrap">
                    <LinkifiedText text={inquiry.links} />
                  </p>
                </div>
              ) : null}
              {shownDetails.length ? (
                <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-line pt-4 text-[13px] sm:grid-cols-2">
                  {shownDetails.map(([label, value]) => (
                    <div key={label} className="min-w-0">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className="break-words">{value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {inquiry.aiOptOut ? (
                <p className="text-xs text-muted">
                  The sender asked that AI tools don&apos;t process this message.
                </p>
              ) : null}
            </CardBody>
          </Card>

          {inquiry.replies.length ? (
            <Card>
              <CardHeader title="Sent from here" />
              <CardBody>
                <ol className="grid gap-4">
                  {inquiry.replies.map((reply) => (
                    <li key={reply.id} className="grid gap-1.5 border-l-2 border-line pl-3">
                      <p className="flex flex-wrap items-center gap-2 text-[13px]">
                        <span className="font-medium">
                          {reply.kind === "reply" ? reply.subject : "Status email"}
                        </span>
                        <Badge tone={DELIVERY[reply.delivery].tone}>{DELIVERY[reply.delivery].label}</Badge>
                        <span className="text-xs text-muted" title={formatDateTime(reply.createdAt)}>
                          {formatRelative(reply.createdAt, at)}
                        </span>
                      </p>
                      {reply.body ? (
                        <p className="text-[13px] whitespace-pre-wrap text-ink/85">{reply.body}</p>
                      ) : null}
                      {reply.error && reply.delivery !== "sent" ? (
                        <p className="text-xs text-danger">Last error: {reply.error}</p>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ) : null}

          <ReplyComposer
            id={hexId}
            to={inquiry.email}
            defaultSubject={defaultReplySubject(inquiry)}
            canEmail={canEmail}
            isSpam={inquiry.status === "spam"}
          />
        </div>

        <div className="grid min-w-0 content-start gap-6">
          <StatusPanel id={hexId} status={inquiry.status} visitorName={inquiry.name} canEmail={canEmail} />
          {call ? <CallCard id={hexId} call={call} canEmail={canEmail} visitorName={inquiry.name} /> : null}
          <OrganizeCard
            id={hexId}
            note={inquiry.note}
            labels={inquiry.labels}
            knownLabels={knownLabels}
            snoozedUntil={
              inquiry.snoozedUntil && inquiry.snoozedUntil > at ? formatDateTime(inquiry.snoozedUntil) : null
            }
          />
          {inquiry.history.length ? (
            <Card>
              <CardHeader title="History" />
              <CardBody>
                <ol className="grid gap-1.5 text-[13px]">
                  {[...inquiry.history].reverse().map((change, index) => (
                    <li key={index} className="flex justify-between gap-3">
                      <span>
                        {STATUS_LABELS[change.from]} → {STATUS_LABELS[change.status]}
                      </span>
                      <span className="text-xs text-muted" title={formatDateTime(change.at)}>
                        {formatRelative(change.at, at)}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
