"use client";

import { useId, useState } from "react";
import { AiDraft } from "@/components/admin/ai/ai-draft";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses, selectFieldClasses, textareaClasses } from "@/components/ui/field";
import { FACTS_TEMPLATE, REWRITE_PRESETS, rewritableFields } from "@/lib/ai/content";
import type { ContentKind } from "@/lib/content/schemas";

// The content editor's AI help, beside the form: rewrite one of its long fields, or (for a case study)
// draft the body from a facts sheet. "Use" puts the text into the form unsaved; the owner saves, and the
// leak check runs when publishing as always.

export function ContentAssistant({
  kind,
  id,
  value,
  onReplace,
  disabledReason,
}: {
  kind: ContentKind;
  id: string | null;
  value: Record<string, unknown>;
  onReplace: (field: string, text: string) => void;
  disabledReason: string | null;
}) {
  const fields = rewritableFields(kind);
  const [field, setField] = useState(
    fields.find((candidate) => candidate.name === "body")?.name ?? fields[0]?.name,
  );
  const [preset, setPreset] = useState<string>(REWRITE_PRESETS[0].key);
  const [custom, setCustom] = useState("");
  const [facts, setFacts] = useState(FACTS_TEMPLATE);
  const uid = useId();
  if (!field) return null;
  const instruction =
    preset === "custom"
      ? custom
      : (REWRITE_PRESETS.find((candidate) => candidate.key === preset)?.instruction ?? "");
  const text = typeof value[field] === "string" ? (value[field] as string) : "";
  const label = fields.find((candidate) => candidate.name === field)?.label ?? field;

  return (
    <Card>
      <CardHeader title="AI writing help" description="Drafts only: you review, save and publish." />
      <CardBody className="grid gap-5 text-[13px]">
        <section className="grid gap-2.5" aria-labelledby={`${uid}-rewrite`}>
          <h3 id={`${uid}-rewrite`} className="font-medium">
            Rewrite a field
          </h3>
          <div className="grid gap-1.5">
            <label htmlFor={`${uid}-field`} className="text-xs text-muted">
              Field
            </label>
            <select
              id={`${uid}-field`}
              className={selectFieldClasses}
              value={field}
              onChange={(event) => setField(event.target.value)}
            >
              {fields.map((candidate) => (
                <option key={candidate.name} value={candidate.name}>
                  {candidate.label}
                </option>
              ))}
            </select>
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={`${uid}-how`} className="text-xs text-muted">
              How
            </label>
            <select
              id={`${uid}-how`}
              className={selectFieldClasses}
              value={preset}
              onChange={(event) => setPreset(event.target.value)}
            >
              {REWRITE_PRESETS.map((candidate) => (
                <option key={candidate.key} value={candidate.key}>
                  {candidate.label}
                </option>
              ))}
              <option value="custom">My own instruction…</option>
            </select>
          </div>
          {preset === "custom" ? (
            <div className="grid gap-1.5">
              <label htmlFor={`${uid}-custom`} className="text-xs text-muted">
                Instruction
              </label>
              <input
                id={`${uid}-custom`}
                className={inputClasses}
                value={custom}
                maxLength={500}
                placeholder="Lead with the result; mention the stack once"
                onChange={(event) => setCustom(event.target.value)}
              />
            </div>
          ) : null}
          {text.trim() ? (
            <AiDraft
              key={field}
              body={{ feature: "rewrite", kind, id, field, text, instruction }}
              action={`Rewrite "${label}"`}
              notes={null}
              onUse={(draft) => onReplace(field, draft)}
              useLabel="Replace the field"
              disabledReason={disabledReason}
            />
          ) : (
            <p className="text-xs text-muted">Write something in &quot;{label}&quot; first.</p>
          )}
        </section>

        {kind === "work" ? (
          <section className="grid gap-2.5 border-t border-line pt-4" aria-labelledby={`${uid}-facts-title`}>
            <h3 id={`${uid}-facts-title`} className="font-medium">
              Draft the case study from facts
            </h3>
            <label htmlFor={`${uid}-facts`} className="text-xs text-muted">
              Facts sheet: only what may be public. The draft uses nothing else.
            </label>
            <textarea
              id={`${uid}-facts`}
              className={textareaClasses}
              rows={10}
              maxLength={12_000}
              value={facts}
              onChange={(event) => setFacts(event.target.value)}
            />
            <AiDraft
              body={{ feature: "casestudy", id, facts }}
              action="Draft the case study"
              notes={null}
              onUse={(draft) => onReplace("body", draft)}
              useLabel="Use as the case study"
              disabledReason={disabledReason}
            />
          </section>
        ) : null}
      </CardBody>
    </Card>
  );
}
