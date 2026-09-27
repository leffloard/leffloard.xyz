"use client";

import Link from "next/link";
import { useState } from "react";
import { quoteDraftAction } from "@/app/(admin)/admin/(shell)/ai/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import type { QuoteSuggestion } from "@/lib/ai/schemas";
import type { Currency } from "@/lib/money";

// "Suggest lines with AI" on a quote made from an inbox message: the AI picks packages from the services
// catalogue; prices come from the catalogue, never from the model. Its assumptions and questions stay here
// for the owner to check before saving.

export function QuoteAssist({
  inquiryId,
  currency,
  disabledReason,
  onApply,
}: {
  inquiryId: string;
  currency: Currency;
  disabledReason: string | null;
  onApply: (suggestion: QuoteSuggestion) => void;
}) {
  const { run, pending, message } = useActionRunner();
  const [last, setLast] = useState<QuoteSuggestion | null>(null);

  async function suggest() {
    const result = await run("suggest", () => quoteDraftAction({ inquiryId, currency }));
    if (result.ok) {
      setLast(result.data);
      onApply(result.data);
    }
  }

  return (
    <div className="grid gap-2.5 rounded-md border border-dashed border-line-strong p-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">AI draft from the message</p>
        {disabledReason ? null : (
          <Button size="sm" pending={pending === "suggest"} onClick={() => void suggest()}>
            {last ? "Suggest again" : "Suggest lines with AI"}
          </Button>
        )}
      </div>
      {disabledReason ? (
        <p className="text-xs text-muted">
          {disabledReason}{" "}
          <Link href="/admin/ai" className="text-accent underline underline-offset-2">
            AI settings
          </Link>
        </p>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {last ? (
        <div className="grid gap-2">
          <ul className="grid gap-1">
            {last.lines.map((line, index) => (
              <li key={index} className="text-xs text-muted">
                Line: {line.description}
                {line.note ? ` (${line.note})` : ""}
              </li>
            ))}
          </ul>
          {last.assumptions.length ? (
            <div>
              <p className="text-xs text-muted">It assumes</p>
              <ul className="list-disc pl-4">
                {last.assumptions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {last.questions.length ? (
            <div>
              <p className="text-xs text-muted">Ask the client first</p>
              <ul className="list-disc pl-4">
                {last.questions.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
