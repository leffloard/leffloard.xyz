"use client";

import { useState } from "react";
import { checkAiConnectionAction, saveAiSettingsAction } from "@/app/(admin)/admin/(shell)/ai/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses, selectFieldClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { AI_MODEL_LABELS, AI_MODELS, AUTO_TRIAGE_PER_DAY, type AiModel } from "@/lib/ai/features";

// The assistant's switch, model, monthly budget and options. Turning it off stops every AI request at once.

export type AiSettingsValue = {
  enabled: boolean;
  model: AiModel;
  budget: string; // dollars, as typed
  fallbacks: boolean;
  autoTriage: boolean;
  version: number;
};

export function AiSettingsForm({ initial, keySet }: { initial: AiSettingsValue; keySet: boolean }) {
  const { run, pending, message } = useActionRunner();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof AiSettingsValue>(key: K, next: AiSettingsValue[K]) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("save", () => saveAiSettingsAction(value));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setValue((current) => ({ ...current, version: result.data.version }));
  }

  return (
    <Card>
      <CardHeader
        title="Settings"
        description="The API key is set on the server (ANTHROPIC_API_KEY); everything else is here."
      />
      <CardBody>
        <form onSubmit={save} className="grid gap-4 text-[13px]" noValidate>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <p className="flex items-center gap-2">
            <span aria-hidden className={`size-1.5 rounded-full ${keySet ? "bg-success" : "bg-warning"}`} />
            {keySet
              ? "API key set on the server."
              : "No API key: set ANTHROPIC_API_KEY on the server and restart it."}
          </p>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.enabled}
              onChange={(event) => set("enabled", event.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            The AI assistant is on
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow id="ai-model" label="Model" error={errors.model}>
              <select
                {...controlProps("ai-model", errors.model)}
                className={selectFieldClasses}
                value={value.model}
                onChange={(event) => set("model", event.target.value as AiModel)}
              >
                {AI_MODELS.map((model) => (
                  <option key={model} value={model}>
                    {AI_MODEL_LABELS[model]}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow
              id="ai-budget"
              label="Monthly budget (US dollars)"
              error={errors.budget}
              hint="No request starts that could take the month past it."
            >
              <input
                {...controlProps("ai-budget", errors.budget, true)}
                className={inputClasses}
                inputMode="decimal"
                value={value.budget}
                onChange={(event) => set("budget", event.target.value)}
              />
            </FormRow>
          </div>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={value.fallbacks}
              onChange={(event) => set("fallbacks", event.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              Retry declined requests on another model
              <span className="block text-xs text-muted">
                Claude&apos;s safety checks sometimes decline harmless work (security topics, for example).
                Anthropic then answers with the model it recommends for that case, in the same request.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={value.autoTriage}
              onChange={(event) => set("autoTriage", event.target.checked)}
              className="mt-0.5 accent-[var(--color-accent)]"
            />
            <span>
              Triage new messages as they arrive
              <span className="block text-xs text-muted">
                At most {AUTO_TRIAGE_PER_DAY} a day; never spam, and never a sender who asked for no AI.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" pending={pending === "save"}>
              Save
            </Button>
            <Button
              disabled={!keySet || pending !== null}
              pending={pending === "check"}
              onClick={() => run("check", () => checkAiConnectionAction({}))}
            >
              Check the key
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
