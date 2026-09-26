import { meetingInvite } from "@/server/calendar/emails";
import { findMeetingByToken } from "@/server/calendar/meetings";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { readChannels } from "@/server/notify/channels";

// The meeting as a calendar file, for "Add to calendar" on the guest's page.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const token = (await params).token;
  const meeting = await findMeetingByToken(await getDb(), token);
  if (!meeting) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const siteUrl = getEnv().SITE_URL;
  const active = meeting.status === "requested" || meeting.status === "confirmed";
  const invite = meetingInvite(
    meeting,
    { siteUrl, ownerEmail: readChannels().ownerEmail, manageUrl: `${siteUrl}/meeting/${token}` },
    active ? "REQUEST" : "CANCEL",
  );
  return new Response(invite.content, {
    headers: {
      "content-type": `text/calendar; charset=utf-8; method=${invite.method}`,
      "content-disposition": 'attachment; filename="meeting.ics"',
      "cache-control": "no-store",
    },
  });
}
