"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useAiStream } from "@/components/admin/ai/use-ai-stream";
import { Button } from "@/components/ui/button";
import { inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

// A draft written by the AI assistant as you watch: optional notes to steer it, then the text, which you
// can take into the form ("Use this draft") or leave. Nothing is sent or saved on the page's behalf.

export type SavedDraft = { text: string; when: string };

type Props = {
  body: Record<string, unknown>; // what to draft (the feature and its target)
  action?: string;
  notes?: { label: string; placeholder: string } | null;
  onUse?: (text: string) => void;
  useLabel?: string;
  saved?: SavedDraft | null; // the last draft, kept on the server (meeting briefs, weekly reviews)
  disabledReason?: string | null;
};

export function AiDraft({
  body,
  action = "Draft with AI",
  notes = { label: "Notes for the draft (optional)", placeholder: "What should it say?" },
  onUse,
  useLabel = "Use this draft",
  saved = null,
  disabledReason = null,
}: Props) {
  const ai = useAiStream();
  const [guidance, setGuidance] = useState("");
  const id = useId();
  const fresh = ai.status !== "idle";
  const text = fresh ? ai.text : (saved?.text ?? "");

  if (disabledReason) {
    return (
      <p className="text-xs text-muted">
        {disabledReason}{" "}
        <Link href="/admin/ai" className="text-accent underline underline-offset-2">
          AI settings
        </Link>
      </p>
    );
  }

  return (
    <div className="grid gap-2.5">
      {notes ? (
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-notes`} className="text-xs text-muted">
            {notes.label}
          </label>
          <input
            id={`${id}-notes`}
            className={inputClasses}
            value={guidance}
            maxLength={1000}
            placeholder={notes.placeholder}
            onChange={(event) => setGuidance(event.target.value)}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          pending={ai.busy}
          onClick={() => void ai.start(notes ? { ...body, guidance } : body)}
        >
          {text ? "Write it again" : action}
        </Button>
        {ai.busy ? (
          <Button size="sm" variant="ghost" onClick={ai.stop}>
            Stop
          </Button>
        ) : null}
        <span className="text-xs text-muted" aria-live="polite">
          {ai.status === "thinking"
            ? "Thinking…"
            : ai.status === "writing"
              ? "Writing…"
              : ai.status === "done" && ai.cost
                ? `Done · ${ai.cost}${ai.fallback ? " · answered by the fallback model" : ""}`
                : !fresh && saved
                  ? `Written ${saved.when}`
                  : null}
        </span>
      </div>
      {ai.status === "error" && ai.message ? <Notice tone="error">{ai.message}</Notice> : null}
      {ai.message && ai.status !== "error" ? <p className="text-xs text-muted">{ai.message}</p> : null}
      {text ? (
        <div
          className="max-h-96 overflow-y-auto rounded-md border border-line bg-surface-2/60 px-3 py-2.5 text-[13px] leading-6 break-words whitespace-pre-wrap"
          aria-busy={ai.busy}
          aria-label="AI draft"
          role="region"
          tabIndex={0}
        >
          {text}
        </div>
      ) : null}
      {ai.truncated ? (
        <p className="text-xs text-warning">The draft reached its length limit and may end abruptly.</p>
      ) : null}
      {text && !ai.busy ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* Only a finished draft: a failed or stopped one may end mid-sentence. */}
          {onUse && (fresh ? ai.status === "done" : true) ? (
            <Button size="sm" variant="primary" onClick={() => onUse(text)}>
              {useLabel}
            </Button>
          ) : null}
          {fresh ? (
            <Button size="sm" variant="ghost" onClick={ai.reset}>
              Discard
            </Button>
          ) : null}
          <span className="text-xs text-muted">Written by AI: read it before you use it.</span>
        </div>
      ) : null}
    </div>
  );
}
