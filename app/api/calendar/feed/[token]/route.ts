import { buildFeed } from "@/server/calendar/feed";
import { feedTokenMatches } from "@/server/calendar/settings";
import { now } from "@/server/clock";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

// The owner's calendar feed (iCalendar). The address holds a secret made in the admin; without it, 404.

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const token = (await params).token.replace(/\.ics$/, "");
  try {
    const db = await getDb();
    if (!(await feedTokenMatches(db, token))) {
      return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    }
    return new Response(await buildFeed(db, getEnv().SITE_URL, now()), {
      headers: {
        "content-type": "text/calendar; charset=utf-8",
        "content-disposition": 'inline; filename="leffloard.ics"',
        "cache-control": "private, no-store",
        "x-robots-tag": "noindex",
      },
    });
  } catch (error) {
    log.error({ err: error }, "GET /api/calendar/feed failed");
    return new Response("Unavailable", { status: 503, headers: { "cache-control": "no-store" } });
  }
}
