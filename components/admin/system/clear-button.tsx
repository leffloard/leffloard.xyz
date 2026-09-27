"use client";

import { clearCspReportsAction, clearErrorLogAction } from "@/app/(admin)/admin/(shell)/system/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

const ACTIONS = { errors: clearErrorLogAction, csp: clearCspReportsAction };

// Empties the error log or the CSP reports, after "confirm it's you".
// Stays on the page when the list empties, so its message can say how it went.
export function ClearButton({
  what,
  label,
  empty,
}: {
  what: keyof typeof ACTIONS;
  label: string;
  empty: boolean;
}) {
  const { run, pending, message } = useActionRunner();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Button
        size="sm"
        disabled={empty}
        pending={pending === what}
        onClick={() => run(what, () => ACTIONS[what]({}))}
      >
        {label}
      </Button>
    </div>
  );
}
