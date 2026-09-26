import { parseStart } from "@/lib/booking/form";
import { clientIp } from "@/lib/ip";
import { guestReschedule, PROBLEM_MESSAGES } from "@/server/calendar/booking";
import { findMeetingByToken, openSlots } from "@/server/calendar/meetings";
import { limited, MANAGE_LIMIT, notifyContext, slotList } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";

// A guest moves their meeting through their link.
//   200 { ok, start, end }
//   409 { error, problem, slots }   the time is gone, or the meeting can't be changed any more
//   404 { error }                   the link is not valid

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const env = getEnv();
    const body = await readJsonPost(request, { siteUrl: env.SITE_URL, maxBytes: 2048 });
    if (!body.ok) return body.response;
    const db = await getDb();
    const tooMany = await limited(
      db,
      "manage",
      clientIp(request.headers, env.CLIENT_IP_SOURCE),
      MANAGE_LIMIT,
    );
    if (tooMany) return tooMany;
    const meeting = await findMeetingByToken(db, (await params).token);
    if (!meeting) return jsonResponse({ error: "This link is not valid." }, 404);
    const start = parseStart(body.fields.start);
    if (!start) return jsonResponse({ error: "Choose a time.", errors: { start: "Choose a time." } }, 422);

    const moved = await guestReschedule(db, meeting, start, notifyContext());
    if (!moved.ok) {
      const { slots } = await openSlots(db, meeting.durationMinutes, undefined, meeting);
      return jsonResponse(
        { error: PROBLEM_MESSAGES[moved.problem], problem: moved.problem, slots: slotList(slots) },
        409,
      );
    }
    sendQueuedSoon();
    return jsonResponse({
      ok: true,
      start: moved.meeting.startsAt.toISOString(),
      end: moved.meeting.endsAt.toISOString(),
    });
  } catch (error) {
    log.error({ err: error }, "POST /api/meetings/[token]/reschedule failed");
    return jsonResponse({ error: "This is temporarily unavailable. Please email me instead." }, 503);
  }
}
