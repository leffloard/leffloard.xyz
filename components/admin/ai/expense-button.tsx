"use client";

import { recordAiExpenseAction } from "@/app/(admin)/admin/(shell)/ai/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";

// Puts a finished month's AI spending into the finance expenses, once.
export function AiExpenseButton({ month }: { month: string }) {
  const { run, pending, message } = useActionRunner();
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        pending={pending === "record"}
        onClick={() => run("record", () => recordAiExpenseAction({ month }))}
      >
        Add to expenses
      </Button>
      {message ? (
        <span role={message.tone === "error" ? "alert" : "status"} className="text-xs text-muted">
          {message.text}
        </span>
      ) : null}
    </span>
  );
}
