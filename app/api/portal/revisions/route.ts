import { ObjectId } from "mongodb";
import { formatMoney } from "@/lib/money";
import { revisionRequestSchema } from "@/lib/portal/forms";
import { notifyContext } from "@/server/calendar/public";
import { jsonResponse } from "@/server/http";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";
import { fieldErrors, readPortalPost } from "@/server/portal/endpoint";
import { requestRevision } from "@/server/portal/service";

// A signed-in client asks for a revision round on one of their projects.
//   201 { number, billable }   404 not their project
//   409 { code: "charge", price } the round costs extra, and its price (as it is now) wasn't agreed to
//   409 { code: "paused" } the project is paused

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    const read = await readPortalPost(request);
    if (!read.ok) return read.response;
    const parsed = revisionRequestSchema.safeParse(read.fields);
    if (!parsed.success) {
      return jsonResponse(
        { error: "Check the highlighted fields.", errors: fieldErrors(parsed.error.issues) },
        422,
      );
    }
    const result = await requestRevision(
      read.db,
      read.context.client,
      new ObjectId(parsed.data.projectId),
      parsed.data,
      notifyContext(),
    );
    if (!result.ok) {
      switch (result.problem) {
        case "missing":
          return jsonResponse({ error: "There is no such project." }, 404);
        case "paused":
          return jsonResponse(
            {
              error: "This project is paused: for changes, reply to my last email or book a call.",
              code: "paused",
            },
            409,
          );
        case "charge":
          return jsonResponse(
            {
              error: `This round is beyond the included ones${result.price ? ` and costs ${formatMoney(result.price)}` : ""}. Tick the box to agree, then send it again.`,
              code: "charge",
              price: result.price,
            },
            409,
          );
      }
    }
    sendQueuedSoon();
    return jsonResponse({ number: result.revision.number, billable: result.revision.billable }, 201);
  } catch (error) {
    log.error({ err: error }, "POST /api/portal/revisions failed");
    return jsonResponse({ error: "This is temporarily unavailable. Please try again later." }, 503);
  }
}
