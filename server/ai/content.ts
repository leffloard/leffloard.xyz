import "server-only";
import type { Db, ObjectId } from "mongodb";
import { site } from "@/content/site";
import { rewritableFields } from "@/lib/ai/content";
import { KIND_LABELS, type ContentKind } from "@/lib/content/schemas";
import type { Prepared } from "@/server/ai/inbox";
import { businessContext, TASKS } from "@/server/ai/prompts";
import { loadContent } from "@/server/content/store";
import { getEnv } from "@/server/env";

// Writing help in the content editor: rewrite a field, or draft a case study from a facts sheet. The result
// goes into the editor as unsaved text; saving, the leak check and publishing stay the owner's.

async function sharedPrompt(db: Db): Promise<string> {
  return businessContext(await loadContent(db, "published"), getEnv().SITE_URL);
}

export async function prepareRewrite(
  db: Db,
  input: { kind: ContentKind; id: ObjectId | null; field: string; text: string; instruction: string },
): Promise<Prepared> {
  const field = rewritableFields(input.kind).find((candidate) => candidate.name === input.field);
  if (!field) return { ok: false, reason: "failed", message: "That field can't be rewritten." };
  return {
    ok: true,
    request: {
      feature: "rewrite",
      target: { kind: "content", id: input.id, contentKind: input.kind },
      lock: `rewrite:${input.kind}:${input.id ? String(input.id) : "new"}:${field.name}`,
      system: { shared: await sharedPrompt(db), task: TASKS.rewrite },
      prompt: [
        `The "${field.label}" field of a ${KIND_LABELS[input.kind].one.toLowerCase()} on the public site.`,
        `${site.firstName}'s instruction: ${input.instruction}`,
        "",
        "<text>",
        input.text,
        "</text>",
      ].join("\n"),
    },
  };
}

export async function prepareCaseStudy(
  db: Db,
  input: { id: ObjectId | null; facts: string },
): Promise<Prepared> {
  return {
    ok: true,
    request: {
      feature: "casestudy",
      target: { kind: "content", id: input.id, contentKind: "work" },
      system: { shared: await sharedPrompt(db), task: TASKS.casestudy },
      prompt: [
        "The facts sheet, written by " + site.firstName + ":",
        "",
        "<facts>",
        input.facts,
        "</facts>",
      ].join("\n"),
    },
  };
}
