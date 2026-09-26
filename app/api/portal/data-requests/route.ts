import { dataRequestSchema } from "@/lib/portal/forms";
import { notifyContext } from "@/server/calendar/public";
import { jsonResponse } from "@/server/http";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";
import { fieldErrors, readPortalPost } from "@/server/portal/endpoint";
import { requestDataAction } from "@/server/portal/service";

// A signed-in client asks for a copy of their data, or for its deletion.
//   201 a new request   200 one of that kind was already open

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const read = await readPortalPost(request);
    if (!read.ok) return read.response;
    const parsed = dataRequestSchema.safeParse(read.fields);
    if (!parsed.success) {
      return jsonResponse(
        { error: "Check the highlighted fields.", errors: fieldErrors(parsed.error.issues) },
        422,
      );
    }
    const result = await requestDataAction(
      read.db,
      read.context.client,
      parsed.data.kind,
      parsed.data.note,
      notifyContext(),
    );
    if (result.created) sendQueuedSoon();
    return jsonResponse({ ok: true, created: result.created }, result.created ? 201 : 200);
  } catch (error) {
    log.error({ err: error }, "POST /api/portal/data-requests failed");
    return jsonResponse({ error: "This is temporarily unavailable. Please try again later." }, 503);
  }
}
