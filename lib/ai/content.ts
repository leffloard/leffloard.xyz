import { CONTENT_FIELDS } from "@/lib/content/fields";
import type { ContentKind } from "@/lib/content/schemas";

// The content editor's AI help: ready-made rewrite instructions, and the facts sheet a case study is
// drafted from (the fields that may be told about a project, private ones included).

// The fields worth rewriting: long text at the top level of a kind's form.
export function rewritableFields(kind: ContentKind): { name: string; label: string }[] {
  return CONTENT_FIELDS[kind]
    .filter((field) => field.type === "markdown" || field.type === "textarea")
    .map((field) => ({ name: field.name, label: field.label }));
}

export const REWRITE_PRESETS = [
  { key: "tighten", label: "Tighter", instruction: "Make it shorter and tighter. Keep every fact." },
  {
    key: "clearer",
    label: "Clearer for clients",
    instruction: "Make it clearer for a client who isn't technical.",
  },
  { key: "precise", label: "More precise", instruction: "Make it more precise for an engineer reading it." },
  {
    key: "grammar",
    label: "Grammar only",
    instruction: "Fix grammar, spelling and punctuation only. Change nothing else.",
  },
] as const;

export const FACTS_TEMPLATE = `Project name:
Public or private:
Purpose (the problem it solves):
Who it is for (no names):
What it does:
Architecture:
Security practices:
Stack:
Period:
Confirmed results (only what you can show):`;
