import { clientIp } from "@/lib/ip";
import { bookableType } from "@/server/calendar/booking-types";
import { openSlots } from "@/server/calendar/meetings";
import { limited, slotList, SLOTS_LIMIT } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse } from "@/server/http";
import { log } from "@/server/log";

// The open start times of a booking type, as UTC instants for the browser to show in the visitor's zone.
//   200 { slots: [ISO...], durationMinutes, timeZone }   timeZone is the owner's, for reference
//   404 { error }                                        no such bookable type

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
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
    const type = await bookableType(db, (await params).slug, new URL(request.url).searchParams.get("key"));
    if (!type) return jsonResponse({ error: "There is no such booking type." }, 404);
    const { slots, rules } = await openSlots(db, type.durationMinutes);
    return jsonResponse({
      slots: slotList(slots),
      durationMinutes: type.durationMinutes,
      timeZone: rules.timeZone,
    });
  } catch (error) {
    log.error({ err: error }, "GET /api/bookings/[slug]/slots failed");
    return jsonResponse({ error: "The calendar is temporarily unavailable." }, 503);
  }
}
