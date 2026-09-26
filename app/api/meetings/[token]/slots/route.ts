import { clientIp } from "@/lib/ip";
import { guestCanChange } from "@/server/calendar/booking";
import { findMeetingByToken, openSlots } from "@/server/calendar/meetings";
import { limited, slotList, SLOTS_LIMIT } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse } from "@/server/http";
import { log } from "@/server/log";

// The times a guest can move their meeting to (its own time counts as free).
//   200 { slots: [ISO...] }
//   409 { error }   it can't be changed any more
//   404 { error }   the link is not valid

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const db = await getDb();
    const tooMany = await limited(
      db,
      "slots",
      clientIp(request.headers, getEnv().CLIENT_IP_SOURCE),
      SLOTS_LIMIT,
    );
    if (tooMany) return tooMany;
    const meeting = await findMeetingByToken(db, (await params).token);
    if (!meeting) return jsonResponse({ error: "This link is not valid." }, 404);
    if (!guestCanChange(meeting))
      return jsonResponse({ error: "This meeting can't be changed any more." }, 409);
    const { slots } = await openSlots(db, meeting.durationMinutes, undefined, meeting);
    return jsonResponse({ slots: slotList(slots) });
  } catch (error) {
    log.error({ err: error }, "GET /api/meetings/[token]/slots failed");
    return jsonResponse({ error: "The calendar is temporarily unavailable." }, 503);
  }
}
