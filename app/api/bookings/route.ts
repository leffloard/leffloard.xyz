import { parseBookingForm } from "@/lib/booking/form";
import { honeypotFilled } from "@/lib/intake/legacy";
import { clientIp } from "@/lib/ip";
import { ObjectId } from "mongodb";
import { bookFromSite, PROBLEM_MESSAGES } from "@/server/calendar/booking";
import { bookableType } from "@/server/calendar/booking-types";
import { getMeeting, manageTokenOf, openSlots } from "@/server/calendar/meetings";
import { BOOKING_LIMIT, limited, notifyContext, slotList } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";
import { idempotent, readIdempotencyKey } from "@/server/security/idempotency";
import { verifyTurnstile } from "@/server/security/turnstile";

// Booking a call from /book/<type>. Answers:
//   201 { ok, status: "confirmed" | "requested", manageUrl, start, end, title, location }
//   409 { error, problem, slots }            the time is gone: pick again from the fresh `slots`
//   422 { error, errors: { field: message } }
//   404 { error }                            no such bookable type
//   403 { error, code }                      bot check failed, or a cross-site post
//   429 { error, retryAfter }
// With an Idempotency-Key header, sending the same booking twice books it once. A secret type needs its
// link's `key`.

export const dynamic = "force-dynamic";

const MAX_BYTES = 16 * 1024;

async function replayedToken(meetingId: string): Promise<string | null> {
  if (!ObjectId.isValid(meetingId)) return null;
  const meeting = await getMeeting(await getDb(), new ObjectId(meetingId));
  if (!meeting) return null;
  try {
    return manageTokenOf(meeting);
  } catch {
    return null; // an encryption key retired since: the guest still has the link in their email
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const env = getEnv();
    const body = await readJsonPost(request, { siteUrl: env.SITE_URL, maxBytes: MAX_BYTES });
    if (!body.ok) return body.response;
    const { fields } = body;
    // Bots that fill the hidden field get the usual answer, and nothing is booked.
    if (honeypotFilled(fields.website)) return jsonResponse({ ok: true, status: "confirmed" }, 201);

    const db = await getDb();
    const ip = clientIp(request.headers, env.CLIENT_IP_SOURCE);
    // Counted before the type is looked up, so the links of secret types cannot be probed freely.
    const tooMany = await limited(db, "booking", ip, BOOKING_LIMIT);
    if (tooMany) return tooMany;
    const key = typeof fields.key === "string" ? fields.key : null;
    const type = typeof fields.type === "string" ? await bookableType(db, fields.type, key) : null;
    if (!type) return jsonResponse({ error: "There is no such booking type." }, 404);
    const parsed = parseBookingForm(fields, type.questions);
    if (!parsed.ok)
      return jsonResponse({ error: "Check the highlighted fields.", errors: parsed.errors }, 422);

    // The stored answer (kept 24 hours for replays) names the meeting but not its link's secret; a replay
    // rebuilds the link from the meeting's sealed copy.
    let manageToken: string | null = null;
    const result = await idempotent(db, "booking", readIdempotencyKey(request.headers), async () => {
      const token = typeof fields.turnstileToken === "string" ? fields.turnstileToken : null;
      const check = await verifyTurnstile({ token, ip, action: "booking" });
      if (!check.ok) {
        return {
          status: 403,
          body: { error: "The bot check did not pass. Wait a moment and try again.", code: "turnstile" },
        };
      }
      const booked = await bookFromSite(db, type, parsed.data, notifyContext());
      if (!booked.ok) {
        const { slots } = await openSlots(db, type.durationMinutes);
        return {
          status: 409,
          body: { error: PROBLEM_MESSAGES[booked.problem], problem: booked.problem, slots: slotList(slots) },
        };
      }
      sendQueuedSoon();
      const { meeting } = booked;
      manageToken = booked.token;
      return {
        status: 201,
        body: {
          ok: true,
          status: meeting.status,
          meetingId: meeting._id.toHexString(),
          start: meeting.startsAt.toISOString(),
          end: meeting.endsAt.toISOString(),
          title: meeting.title,
          location: meeting.location.url ?? meeting.location.details,
        },
      };
    });
    if (result.status !== 201) return jsonResponse(result.body, result.status);
    const { meetingId, ...answer } = result.body as { meetingId: string } & Record<string, unknown>;
    if (!manageToken) manageToken = await replayedToken(meetingId);
    return jsonResponse({ ...answer, manageUrl: manageToken ? `/meeting/${manageToken}` : null }, 201);
  } catch (error) {
    log.error({ err: error }, "POST /api/bookings failed");
    return jsonResponse({ error: "Booking is temporarily unavailable. Please email me instead." }, 503);
  }
}
