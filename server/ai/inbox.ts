import "server-only";
import type { Db, Filter, ObjectId } from "mongodb";
import { AUTO_TRIAGE_PER_DAY } from "@/lib/ai/features";
import {
  cleanTriage,
  quoteDraftOutput,
  triageOutput,
  type QuoteDraftOutput,
  type QuoteSuggestion,
} from "@/lib/ai/schemas";
import { untrusted } from "@/lib/ai/untrusted";
import { MAX_LINES } from "@/lib/billing/document";
import { site } from "@/content/site";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import {
  BUDGET_OPTIONS,
  KIND_LABELS,
  optionLabel,
  SERVICE_OPTIONS,
  TIMELINE_OPTIONS,
} from "@/lib/intake/options";
import { describeMoment, todayIn, zonedInstant } from "@/lib/intake/time";
import type { Currency } from "@/lib/money";
import { equalsIgnoringCase } from "@/lib/search";
import { runAi, type AiFailure, type AiRequest } from "@/server/ai/engine";
import { claimDaily } from "@/server/ai/ledger";
import { businessContext, catalogue, TASKS, type CatalogueItem } from "@/server/ai/prompts";
import { aiDisabledReason, getAiSettings } from "@/server/ai/settings";
import { now } from "@/server/clock";
import { loadContent } from "@/server/content/store";
import { getEnv } from "@/server/env";
import { getInquiry, inquiries, setTriage } from "@/server/inquiries/store";
import type { InquiryDoc, InquiryTriage } from "@/server/inquiries/types";
import { log } from "@/server/log";

// The inbox's AI help: triage a message, draft a reply, draft a quote. A sender who ticked "Don't use AI
// tools on my message", on this message or any other, is never sent to the model. Runs about a message
// follow the message (they are deleted with it), not the client it may be linked to.

export const OPTED_OUT = "The sender asked that AI tools don't process this message.";
export const OPTED_OUT_ELSEWHERE =
  "The sender asked, on another message, that AI tools don't process their messages.";

export type Failure = { ok: false; reason: AiFailure | "missing" | "opted_out"; message: string };

// Whether any message from these addresses, or linked to this client, asked for no AI tools. Spam counts
// too: the choice stands once made.
export async function optedOut(
  db: Db,
  who: { emails: (string | null | undefined)[]; clientId?: ObjectId | null },
): Promise<boolean> {
  const any: Filter<InquiryDoc>[] = who.emails
    .filter((email): email is string => Boolean(email))
    .map((email) => ({ email: equalsIgnoringCase(email) }));
  if (who.clientId) any.push({ clientId: who.clientId });
  if (!any.length) return false;
  return (await inquiries(db).countDocuments({ aiOptOut: true, $or: any }, { limit: 1 })) > 0;
}

// Why this message may not go to the AI, or null.
export async function optOutReason(
  db: Db,
  inquiry: Pick<InquiryDoc, "aiOptOut" | "email" | "clientId">,
): Promise<string | null> {
  if (inquiry.aiOptOut) return OPTED_OUT;
  const elsewhere = await optedOut(db, { emails: [inquiry.email], clientId: inquiry.clientId });
  return elsewhere ? OPTED_OUT_ELSEWHERE : null;
}

// The message as the model sees it: the form's choices, then everything the sender typed, as data.
export function inquiryPrompt(inquiry: InquiryDoc, at: Date): string {
  const details = [
    `Name: ${inquiry.name}`,
    inquiry.company ? `Company: ${inquiry.company}` : null,
    `Service: ${optionLabel(SERVICE_OPTIONS, inquiry.service) ?? "not chosen"}`,
    `Budget: ${optionLabel(BUDGET_OPTIONS, inquiry.budget) ?? "not given"}`,
    `Timeline: ${optionLabel(TIMELINE_OPTIONS, inquiry.timeline) ?? "not given"}`,
    inquiry.projectReference ? `About project: ${inquiry.projectReference}` : null,
    `Subject: ${inquiry.subject}`,
    "",
    inquiry.message,
    inquiry.links ? `\nLinks:\n${inquiry.links}` : null,
  ].filter((line) => line !== null);
  const call = inquiry.call
    ? zonedInstant(inquiry.call.date, inquiry.call.time, inquiry.call.timeZone)
    : null;
  return [
    `Today is ${describeMoment(at, ADMIN_TIME_ZONE)}.`,
    `Message ${inquiry.ref} (${KIND_LABELS[inquiry.kind]}), received ${describeMoment(inquiry.receivedAt, ADMIN_TIME_ZONE)}.`,
    call
      ? `They asked for a ${inquiry.call!.duration}-minute call on ${describeMoment(call, inquiry.call!.timeZone)}.`
      : null,
    "",
    untrusted("contact form", details.join("\n")),
  ]
    .filter((line) => line !== null)
    .join("\n");
}

async function shared(db: Db) {
  const content = await loadContent(db, "published");
  return { content, system: businessContext(content, getEnv().SITE_URL) };
}

async function openInquiry(db: Db, id: ObjectId): Promise<{ ok: true; inquiry: InquiryDoc } | Failure> {
  const inquiry = await getInquiry(db, id);
  if (!inquiry) return { ok: false, reason: "missing", message: "This message no longer exists." };
  const refused = await optOutReason(db, inquiry);
  if (refused) return { ok: false, reason: "opted_out", message: refused };
  return { ok: true, inquiry };
}

// --- Triage -------------------------------------------------------------------------------------------------

export async function triageInquiry(
  db: Db,
  id: ObjectId,
  trigger: "owner" | "auto" = "owner",
): Promise<{ ok: true; triage: InquiryTriage } | Failure> {
  const opened = await openInquiry(db, id);
  if (!opened.ok) return opened;
  const { inquiry } = opened;
  const { content, system } = await shared(db);
  const result = await runAi(db, {
    feature: "triage",
    trigger,
    target: { kind: "inquiry", id: inquiry._id },
    system: { shared: system, task: TASKS.triage },
    prompt: inquiryPrompt(inquiry, now()),
    schema: triageOutput,
  });
  if (!result.ok) return result;
  const triage: InquiryTriage = {
    ...cleanTriage(
      result.data,
      content.services.map((service) => service.slug),
    ),
    runId: result.runId,
    at: now(),
    model: result.model,
  };
  await setTriage(db, inquiry._id, triage);
  return { ok: true, triage };
}

// Triage of a message that just arrived, when the owner turned it on: in the background, within the daily
// limit (a slot is taken before the request, so a burst of messages can't pass it), never for spam or a
// sender who opted out. Failures are only logged.
export async function autoTriage(
  db: Db,
  inquiry: Pick<InquiryDoc, "_id" | "status" | "aiOptOut">,
): Promise<void> {
  try {
    if (inquiry.aiOptOut || inquiry.status === "spam") return;
    const settings = await getAiSettings(db);
    if (!settings.enabled || !settings.autoTriage) return;
    const at = now();
    const day = todayIn(ADMIN_TIME_ZONE, at);
    const expires = new Date(at.getTime() + 2 * 86_400_000);
    if (!(await claimDaily(db, `auto-triage:${day}`, AUTO_TRIAGE_PER_DAY, expires))) return;
    const result = await triageInquiry(db, inquiry._id, "auto");
    if (!result.ok && result.reason !== "off" && result.reason !== "no_key") {
      log.warn({ reason: result.reason, inquiryId: inquiry._id }, "automatic triage skipped");
    }
  } catch (error) {
    log.error({ err: error }, "automatic triage failed");
  }
}

// --- Reply draft (streamed) ----------------------------------------------------------------------------------

export type Prepared = { ok: true; request: AiRequest<string> } | Failure;

export async function prepareReplyDraft(db: Db, id: ObjectId, guidance: string): Promise<Prepared> {
  const opened = await openInquiry(db, id);
  if (!opened.ok) return opened;
  const { inquiry } = opened;
  const { system } = await shared(db);
  // Only the bodies he wrote: a subject usually repeats the sender's own ("Re: ...").
  const earlier = inquiry.replies
    .filter((reply) => reply.kind === "reply" && reply.body)
    .slice(-3)
    .map((reply) => `---\n${reply.body.slice(0, 2000)}`);
  const prompt = [
    inquiryPrompt(inquiry, now()),
    earlier.length
      ? `\n${site.firstName}'s earlier replies in this conversation, oldest first:\n${earlier.join("\n")}`
      : null,
    guidance ? `\n${site.firstName}'s notes for this reply (follow them): ${guidance}` : null,
  ]
    .filter((line) => line !== null)
    .join("\n");
  return {
    ok: true,
    request: {
      feature: "reply",
      target: { kind: "inquiry", id: inquiry._id },
      system: { shared: system, task: TASKS.reply },
      prompt,
    },
  };
}

// --- Quote draft ----------------------------------------------------------------------------------------------

const clip = (text: string, max: number) => text.replace(/\s+/g, " ").trim().slice(0, max);

// The model picks packages; everything commercial comes from the catalogue: prices (in US dollars, so a
// quote in another currency gets the list price as a note to convert), one of each package, and the main
// package's timeline and revision rounds. Only a monthly plan's months and lines outside the catalogue
// (which have no price) take the model's whole-number quantity.
export function toSuggestion(
  output: QuoteDraftOutput,
  items: CatalogueItem[],
  currency: Currency,
): QuoteSuggestion {
  let main: CatalogueItem | undefined;
  const lines = output.lines.slice(0, MAX_LINES).flatMap((line) => {
    const description = clip(line.description, 300);
    if (!description) return [];
    const item = line.item ? items.find((candidate) => candidate.id === line.item) : undefined;
    main ??= item;
    const whole = Number.isFinite(line.quantity) ? Math.min(Math.max(Math.round(line.quantity), 1), 100) : 1;
    const quantity = item && !item.per ? 1 : whole;
    const listPrice = item
      ? `$${item.price.toLocaleString("en-US")}${item.per ? ` a ${item.per}` : ""}`
      : null;
    return [
      {
        description,
        quantity: String(quantity),
        unitPrice: item && currency === "USD" ? String(item.price) : "",
        note: item
          ? currency === "USD"
            ? `${item.service}: ${item.name}, list price ${listPrice}`
            : `${item.service}: ${item.name}, list price ${listPrice}: convert to ${currency}`
          : "Not in the catalogue: price it yourself",
      },
    ];
  });
  return {
    title: clip(output.title, 200),
    lines,
    timeline: main ? main.timeline : clip(output.timeline, 100),
    revisionsIncluded: String(main?.revisions ?? Math.min(Math.max(Math.round(output.revisions), 0), 20)),
    assumptions: output.assumptions
      .map((text) => clip(text, 300))
      .filter(Boolean)
      .slice(0, 6),
    questions: output.questions
      .map((text) => clip(text, 300))
      .filter(Boolean)
      .slice(0, 6),
  };
}

export async function draftQuote(
  db: Db,
  id: ObjectId,
  currency: Currency,
): Promise<{ ok: true; suggestion: QuoteSuggestion; costMicros: number } | Failure> {
  const opened = await openInquiry(db, id);
  if (!opened.ok) return opened;
  const { inquiry } = opened;
  const { content, system } = await shared(db);
  const result = await runAi(db, {
    feature: "quote",
    target: { kind: "inquiry", id: inquiry._id },
    system: { shared: system, task: TASKS.quote },
    prompt: `${inquiryPrompt(inquiry, now())}\n\nThe quote will be in ${currency}.`,
    schema: quoteDraftOutput,
  });
  if (!result.ok) return result;
  return {
    ok: true,
    suggestion: toSuggestion(result.data, catalogue(content), currency),
    costMicros: result.costMicros,
  };
}

// For the quote editor: the AI suggestion is offered on a quote made from an inbox message.
export async function quoteAssist(
  db: Db,
  inquiryId: ObjectId | null,
): Promise<{ inquiryId: string; disabledReason: string | null } | null> {
  if (!inquiryId) return null;
  const inquiry = await getInquiry(db, inquiryId);
  if (!inquiry) return null;
  return {
    inquiryId: inquiry._id.toHexString(),
    disabledReason: (await optOutReason(db, inquiry)) ?? (await aiDisabledReason(db)),
  };
}
