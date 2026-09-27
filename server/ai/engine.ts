import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { ObjectId, Db } from "mongodb";
import type { z } from "zod";
import { maxCostMicros, utf8Bytes } from "@/lib/ai/budget";
import { AI_FEATURE_LIMITS, type AiFeature } from "@/lib/ai/features";
import { addTokens, attemptsCost, billedAttempts, formatUsd, NO_TOKENS } from "@/lib/ai/pricing";
import { anthropicClient } from "@/server/ai/client";
import { finishRun, release, reserve, startRun, sweepStaleRuns, type RunOutcome } from "@/server/ai/ledger";
import { availability, getAiSettings } from "@/server/ai/settings";
import type { AiTarget } from "@/server/ai/types";
import { now } from "@/server/clock";
import { log } from "@/server/log";

// Every AI request goes through here: the switch and the key are checked, the most it could cost is reserved
// against the month's budget, the request streams from Claude, and the run is recorded with what it cost.
//
// Requests use adaptive thinking with a fixed effort per feature, and a two-block system prompt marked for
// caching. With fallbacks on (the default), a request Claude declines for policy reasons is re-run by the
// API on the model Anthropic recommends for that case, in the same call.

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
// The server-side fallback is offered for Claude Opus 5; other models answer or decline on their own.
const FALLBACK_MODELS = new Set(["claude-opus-5"]);

export type AiFailure =
  "no_key" | "off" | "budget" | "busy" | "refused" | "invalid" | "unavailable" | "failed";

export type AiSuccess<T> = {
  ok: true;
  runId: ObjectId;
  text: string;
  data: T;
  truncated: boolean; // the draft reached the length limit
  costMicros: number;
  model: string;
  fallback: boolean;
};

export type AiResult<T> =
  AiSuccess<T> | { ok: false; reason: AiFailure; message: string; runId: ObjectId | null };

export type AiRequest<T> = {
  feature: AiFeature;
  trigger?: "owner" | "auto";
  target: AiTarget | null;
  clientId?: ObjectId | null;
  // Two requests with the same lock can't run at once (default: the feature and its target).
  lock?: string;
  system: { shared: string; task: string };
  prompt: string;
  // A structured answer: the model is held to this schema, and the answer is checked against it.
  schema?: z.ZodType<T>;
  onText?: (delta: string) => void; // the draft as it is written (text answers only)
  onThinking?: () => void; // the model started thinking before it writes
};

function targetKey(target: AiTarget | null): string {
  if (!target) return "none";
  return `${target.kind}:${target.id === null ? "new" : String(target.id)}`;
}

function textOf(message: Anthropic.Beta.Messages.BetaMessage): string {
  return message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("")
    .trim();
}

// An API failure in the owner's words, and whether the key or the service is the problem.
function describeError(error: unknown): { reason: AiFailure; message: string } {
  if (error instanceof Anthropic.AuthenticationError) {
    return { reason: "unavailable", message: "Anthropic refused the API key. Check ANTHROPIC_API_KEY." };
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return { reason: "unavailable", message: "This API key isn't allowed to use the model." };
  }
  if (error instanceof Anthropic.NotFoundError) {
    return { reason: "unavailable", message: "The model isn't available to this API key." };
  }
  if (error instanceof Anthropic.RateLimitError) {
    return { reason: "unavailable", message: "Anthropic's rate limit was reached. Try again in a minute." };
  }
  if (error instanceof Anthropic.BadRequestError) {
    // For example "Your credit balance is too low": worth showing as it is.
    return {
      reason: "failed",
      message: `Anthropic couldn't take the request: ${error.message.slice(0, 300)}`,
    };
  }
  if (error instanceof Anthropic.InternalServerError) {
    return {
      reason: "unavailable",
      message: "Anthropic is overloaded or having trouble. Try again shortly.",
    };
  }
  if (error instanceof Anthropic.APIConnectionError) {
    return { reason: "unavailable", message: "Anthropic could not be reached. Try again shortly." };
  }
  if (error instanceof Anthropic.APIError) {
    return {
      reason: "failed",
      message: `Anthropic answered with an error (${error.status ?? "no status"}).`,
    };
  }
  return { reason: "failed", message: "The AI request failed. Nothing was changed." };
}

const EMPTY_OUTCOME: Omit<RunOutcome, "status" | "error"> = {
  servedBy: null,
  fallback: false,
  costMicros: 0,
  usage: NO_TOKENS,
  stopReason: null,
  refusal: null,
  output: null,
  requestId: null,
  durationMs: null,
};

export async function runAi<T = string>(db: Db, request: AiRequest<T>): Promise<AiResult<T>> {
  const settings = await getAiSettings(db);
  const ready = availability(settings);
  if (!ready.ready) return { ok: false, reason: ready.reason, message: ready.message, runId: null };
  const client = anthropicClient()!;
  await sweepStaleRuns(db);

  let format: Anthropic.Beta.Messages.BetaJSONOutputFormat | undefined;
  if (request.schema) {
    // The helper turns the schema into the JSON schema the API accepts; parsing stays here, after the run is
    // recorded (an answer that doesn't fit must not lose its cost).
    const generated = betaZodOutputFormat(request.schema as z.ZodType);
    format = { type: generated.type, schema: generated.schema };
  }

  const { effort, maxTokens } = AI_FEATURE_LIMITS[request.feature];
  const model = settings.model;
  const withFallback = settings.fallbacks && FALLBACK_MODELS.has(model);
  const bytes = utf8Bytes(request.system.shared, request.system.task, request.prompt);
  const most = maxCostMicros(model, bytes, maxTokens, withFallback);

  const reserved = await reserve(db, most, settings.monthlyBudgetMicros);
  if (!reserved.ok) {
    return {
      ok: false,
      reason: "budget",
      message: `This month's AI budget is nearly used up: ${formatUsd(reserved.leftMicros)} left, and this request could cost up to ${formatUsd(most)}. Raise the budget on the AI page, or wait for next month.`,
      runId: null,
    };
  }
  const started = now();
  let runId: Awaited<ReturnType<typeof startRun>>;
  try {
    runId = await startRun(db, {
      feature: request.feature,
      trigger: request.trigger ?? "owner",
      target: request.target,
      clientId: request.clientId ?? null,
      lock: request.lock ?? `${request.feature}:${targetKey(request.target)}`,
      model,
      month: reserved.month,
      reservedMicros: most,
    });
  } catch (error) {
    // Without a run nothing would ever settle the reservation.
    await release(db, reserved.month, most);
    throw error;
  }
  if (runId === "busy") {
    await release(db, reserved.month, most);
    return {
      ok: false,
      reason: "busy",
      message: "This is already being worked on. Wait a moment.",
      runId: null,
    };
  }

  const finish = (outcome: RunOutcome) => finishRun(db, runId, outcome);
  let stream: ReturnType<typeof client.beta.messages.stream> | null = null;
  try {
    stream = client.beta.messages.stream({
      model,
      max_tokens: maxTokens,
      system: [
        { type: "text", text: request.system.shared, cache_control: { type: "ephemeral" } },
        { type: "text", text: request.system.task, cache_control: { type: "ephemeral" } },
      ],
      messages: [{ role: "user", content: request.prompt }],
      thinking: { type: "adaptive" },
      output_config: format ? { effort, format } : { effort },
      ...(withFallback ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
    });
    for await (const event of stream) {
      if (event.type === "content_block_start" && event.content_block.type === "thinking") {
        request.onThinking?.();
      } else if (
        event.type === "content_block_delta" &&
        event.delta.type === "text_delta" &&
        !request.schema
      ) {
        request.onText?.(event.delta.text);
      }
    }
    const message = await stream.finalMessage();

    const attempts = billedAttempts(message, model);
    const usage = attempts.reduce((sum, attempt) => addTokens(sum, attempt.usage), NO_TOKENS);
    const costMicros = attemptsCost(attempts);
    const iterations: { type: string }[] = message.usage.iterations ?? [];
    const fallback = iterations.some((entry) => entry.type === "fallback_message");
    const text = textOf(message);
    const recorded = {
      ...EMPTY_OUTCOME,
      servedBy: message.model,
      fallback,
      costMicros,
      usage,
      stopReason: message.stop_reason,
      output: text || null,
      requestId: stream.request_id ?? null,
      durationMs: now().getTime() - started.getTime(),
    };

    if (message.stop_reason === "refusal") {
      const category = message.stop_details?.category ?? null;
      await finish({ ...recorded, status: "refused", refusal: category, output: null, error: null });
      return {
        ok: false,
        reason: "refused",
        message: `Claude declined this request${category ? ` (${category.replace(/_/g, " ")})` : ""}. Nothing was changed.`,
        runId,
      };
    }
    const truncated = message.stop_reason === "max_tokens";

    if (request.schema) {
      let parsed: T | null = null;
      try {
        const checked = request.schema.safeParse(JSON.parse(text));
        parsed = checked.success ? checked.data : null;
      } catch {
        parsed = null;
      }
      if (parsed === null) {
        await finish({
          ...recorded,
          status: "failed",
          error: truncated
            ? "The answer was cut off at the length limit."
            : "The answer didn't fit the format.",
        });
        return {
          ok: false,
          reason: "invalid",
          message: "The AI's answer couldn't be used. Try again.",
          runId,
        };
      }
      await finish({ ...recorded, status: "done", error: null });
      return { ok: true, runId, text, data: parsed, truncated, costMicros, model: message.model, fallback };
    }

    if (!text) {
      await finish({ ...recorded, status: "failed", error: "The answer was empty." });
      return { ok: false, reason: "invalid", message: "The AI returned nothing. Try again.", runId };
    }
    await finish({ ...recorded, status: "done", error: truncated ? "Cut off at the length limit." : null });
    return {
      ok: true,
      runId,
      text,
      data: text as T,
      truncated,
      costMicros,
      model: message.model,
      fallback,
    };
  } catch (error) {
    const described = describeError(error);
    if (described.reason === "failed")
      log.error({ err: error, feature: request.feature }, "AI request failed");
    else log.warn({ err: error, feature: request.feature }, "AI request not answered");
    // A request that failed before Claude started answering costs nothing. Once it started, its thinking and
    // text are billed, but the final count comes only at the end: it is counted at the most it could have
    // cost, as a run whose server stopped is.
    const snapshot = stream?.currentMessage;
    const attempts = snapshot ? billedAttempts(snapshot, model) : [];
    await finish({
      ...EMPTY_OUTCOME,
      status: "failed",
      servedBy: snapshot?.model ?? null,
      costMicros: snapshot ? most : 0,
      usage: attempts.reduce((sum, attempt) => addTokens(sum, attempt.usage), NO_TOKENS),
      error: snapshot
        ? `${described.message} It stopped mid-answer: counted at the most it could have cost.`
        : described.message,
      requestId: (error instanceof Anthropic.APIError ? error.requestID : null) ?? stream?.request_id ?? null,
      durationMs: now().getTime() - started.getTime(),
    });
    return { ok: false, reason: described.reason, message: described.message, runId };
  }
}
