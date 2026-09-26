import { ObjectId } from "mongodb";
import { z } from "zod";
import { formatUsd } from "@/lib/ai/pricing";
import { CONTENT_KINDS } from "@/lib/content/schemas";
import { prepareCaseStudy, prepareRewrite } from "@/server/ai/content";
import { runAi } from "@/server/ai/engine";
import { prepareReplyDraft, type Prepared } from "@/server/ai/inbox";
import { prepareMeetingBrief } from "@/server/ai/meetings";
import { prepareWeeklyReview } from "@/server/ai/review";
import { currentAdmin } from "@/server/auth/dal";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readJsonPost } from "@/server/http";
import { log } from "@/server/log";

// The AI assistant's drafts, streamed as they are written (server-sent events): "thinking", then "text"
// pieces, then "done" or "error". Behind the admin's sign-in like the rest of /admin; only the site's own
// pages may post here. A draft keeps being written, and is recorded, if the page is closed meanwhile.
//   200 the stream   400 the request   401 signed out   403 another site   409 opted out or missing

export const dynamic = "force-dynamic";

const id = z.string().regex(/^[a-f0-9]{24}$/, "Unknown item.");
const guidance = z.string().trim().max(1000, "Keep the notes under 1,000 characters.").default("");

const body = z.discriminatedUnion("feature", [
  z.object({ feature: z.literal("reply"), inquiryId: id, guidance }),
  z.object({ feature: z.literal("brief"), meetingId: id, guidance }),
  z.object({ feature: z.literal("weekly"), guidance }),
  z.object({
    feature: z.literal("rewrite"),
    kind: z.enum(CONTENT_KINDS),
    id: id.nullable(),
    field: z.string().max(40),
    text: z.string().trim().min(1, "There is no text to rewrite.").max(60_000),
    instruction: z.string().trim().min(1, "Say how to rewrite it.").max(500),
  }),
  z.object({
    feature: z.literal("casestudy"),
    id: id.nullable(),
    facts: z.string().trim().min(40, "Write a few facts first.").max(12_000),
  }),
]);

async function prepare(input: z.infer<typeof body>): Promise<Prepared> {
  const db = await getDb();
  switch (input.feature) {
    case "reply":
      return prepareReplyDraft(db, new ObjectId(input.inquiryId), input.guidance);
    case "brief":
      return prepareMeetingBrief(db, new ObjectId(input.meetingId), input.guidance);
    case "weekly":
      return prepareWeeklyReview(db, input.guidance);
    case "rewrite":
      return prepareRewrite(db, { ...input, id: input.id ? new ObjectId(input.id) : null });
    case "casestudy":
      return prepareCaseStudy(db, { id: input.id ? new ObjectId(input.id) : null, facts: input.facts });
  }
}

export async function POST(request: Request): Promise<Response> {
  const read = await readJsonPost(request, { siteUrl: getEnv().SITE_URL, maxBytes: 128 * 1024 });
  if (!read.ok) return read.response;
  if (!(await currentAdmin())) return jsonResponse({ error: "Your session has ended. Sign in again." }, 401);
  const parsed = body.safeParse(read.fields);
  if (!parsed.success) {
    return jsonResponse({ error: parsed.error.issues[0]?.message ?? "The request could not be read." }, 400);
  }

  let prepared: Prepared;
  try {
    prepared = await prepare(parsed.data);
  } catch (error) {
    log.error({ err: error }, "POST /admin/ai-stream failed");
    return jsonResponse({ error: "The draft could not be started. Please try again." }, 500);
  }
  if (!prepared.ok) return jsonResponse({ error: prepared.message, reason: prepared.reason }, 409);
  const db = await getDb();
  const draft = prepared.request;

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false; // the page went away; the run goes on and is recorded
        }
      };
      try {
        const result = await runAi(db, {
          ...draft,
          onThinking: () => send({ type: "thinking" }),
          onText: (text) => send({ type: "text", text }),
        });
        send(
          result.ok
            ? {
                type: "done",
                runId: result.runId.toHexString(),
                cost: formatUsd(result.costMicros),
                truncated: result.truncated,
                fallback: result.fallback,
              }
            : { type: "error", message: result.message, reason: result.reason },
        );
      } catch (error) {
        log.error({ err: error }, "AI stream failed");
        send({ type: "error", message: "The draft failed. Please try again.", reason: "failed" });
      }
      if (open) {
        open = false;
        try {
          controller.close();
        } catch {
          // already closed by the page leaving
        }
      }
    },
    cancel() {
      open = false;
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      // no-transform: nothing on the way (compression, proxies) holds the pieces back.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
