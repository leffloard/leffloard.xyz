import Link from "next/link";
import { notFound } from "next/navigation";
import { AiDraft } from "@/components/admin/ai/ai-draft";
import { MeetingActions, MeetingClient, MeetingNote } from "@/components/admin/calendar/meeting-panel";
import { PageHeader } from "@/components/admin/shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { ADMIN_TIME_ZONE, formatDateTime, formatRelative } from "@/lib/format";
import { describeMoment, wallDateTime } from "@/lib/intake/time";
import { latestDraft } from "@/server/ai/ledger";
import { aiDisabledReason } from "@/server/ai/settings";
import { requireAdmin } from "@/server/auth/dal";
import { getMeeting } from "@/server/calendar/meetings";
import type { MeetingStatus } from "@/server/calendar/types";
import { clientChoices, getClient } from "@/server/clients/store";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { channelStatus } from "@/server/notify/channels";
import { parseId } from "@/server/work/collections";

export const metadata = { title: "Meeting" };

const STATUS: Record<MeetingStatus, { label: string; tone: "accent" | "success" | "warning" | "neutral" }> = {
  requested: { label: "Waiting for you", tone: "warning" },
  confirmed: { label: "Confirmed", tone: "success" },
  declined: { label: "Declined", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const id = parseId((await params).id);
  const db = await getDb();
  const meeting = id ? await getMeeting(db, id) : null;
  if (!meeting) notFound();
  const at = now();
  const [client, choices, aiOff, brief] = await Promise.all([
    meeting.clientId ? getClient(db, meeting.clientId) : null,
    clientChoices(db),
    aiDisabledReason(db),
    latestDraft(db, "brief", { kind: "meeting", id: meeting._id }),
  ]);
  const live = meeting.status === "requested" || meeting.status === "confirmed";
  const hexId = meeting._id.toHexString();
  const ownerWall = wallDateTime(meeting.startsAt, ADMIN_TIME_ZONE);
  const status = STATUS[meeting.status];
  const sameZone = meeting.timeZone === ADMIN_TIME_ZONE;

  return (
    <>
      <div className="mb-4">
        <Link
          href="/admin/calendar"
          className="text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          ← Calendar
        </Link>
      </div>
      <PageHeader
        title={`${meeting.title}: ${meeting.name}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone}>{status.label}</Badge>
            <span>{describeMoment(meeting.startsAt, ADMIN_TIME_ZONE)}</span>
          </span>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <dl className="grid gap-3 text-[13px] sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted">Guest</dt>
                  <dd>
                    {meeting.name} ·{" "}
                    <a href={`mailto:${meeting.email}`} className="text-accent hover:underline">
                      {meeting.email}
                    </a>
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Length</dt>
                  <dd>{meeting.durationMinutes} minutes</dd>
                </div>
                {!sameZone ? (
                  <div>
                    <dt className="text-xs text-muted">Their time</dt>
                    <dd>{describeMoment(meeting.startsAt, meeting.timeZone)}</dd>
                  </div>
                ) : null}
                <div>
                  <dt className="text-xs text-muted">Where</dt>
                  <dd className="break-words">
                    {meeting.location.url ? (
                      <a
                        href={meeting.location.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                      >
                        {meeting.location.url}
                      </a>
                    ) : (
                      meeting.location.details || "To be agreed"
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Booked</dt>
                  <dd>
                    {formatDateTime(meeting.createdAt)}{" "}
                    {meeting.source === "admin" ? "(by you)" : "(on the site)"}
                  </dd>
                </div>
                {meeting.cancelReason ? (
                  <div className="sm:col-span-2">
                    <dt className="text-xs text-muted">
                      {meeting.cancelledBy === "guest" ? "Their reason" : "Your reason"}
                    </dt>
                    <dd className="whitespace-pre-wrap">{meeting.cancelReason}</dd>
                  </div>
                ) : null}
              </dl>
              {meeting.answers.length || meeting.notes ? (
                <div className="mt-5 grid gap-4 border-t border-line pt-5 text-[13px]">
                  {meeting.answers.map((answer, index) => (
                    <div key={index}>
                      <p className="text-xs text-muted">{answer.label}</p>
                      <p className="mt-1 whitespace-pre-wrap">{answer.value}</p>
                    </div>
                  ))}
                  {meeting.notes ? (
                    <div>
                      <p className="text-xs text-muted">Notes</p>
                      <p className="mt-1 whitespace-pre-wrap">{meeting.notes}</p>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardBody>
          </Card>
          {live ? (
            <Card>
              <CardHeader
                title="AI brief"
                description="Who they are, what they want and what to ask, from what this site knows about them."
              />
              <CardBody>
                <AiDraft
                  body={{ feature: "brief", meetingId: hexId }}
                  action="Prepare a brief"
                  notes={{
                    label: "Anything to focus on? (optional)",
                    placeholder: "Their budget; whether they need hosting",
                  }}
                  saved={
                    brief?.output ? { text: brief.output, when: formatRelative(brief.createdAt, at) } : null
                  }
                  disabledReason={aiOff}
                />
              </CardBody>
            </Card>
          ) : null}
          <MeetingActions
            id={hexId}
            status={meeting.status}
            upcoming={meeting.startsAt > at}
            date={ownerWall.date}
            time={ownerWall.time}
            canEmail={channelStatus().clientEmail}
            emailByDefault={meeting.notifyGuest}
          />
        </div>
        <div className="grid min-w-0 content-start gap-6">
          <MeetingClient
            id={hexId}
            client={client ? { id: client._id.toHexString(), name: client.name } : null}
            clients={choices.map((choice) => ({
              id: choice.id,
              label: choice.company ? `${choice.name} (${choice.company})` : choice.name,
            }))}
          />
          <MeetingNote id={hexId} note={meeting.ownerNote} />
        </div>
      </div>
    </>
  );
}
