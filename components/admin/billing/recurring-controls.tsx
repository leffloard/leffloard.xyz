"use client";

import { useState } from "react";
import {
  deleteRecurringAction,
  issueRecurringNowAction,
  setInvoiceRemindersAction,
  setRecurringActiveAction,
} from "@/app/(admin)/admin/(shell)/billing/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

// A recurring plan's controls: issue the next invoice now, pause or resume, delete (the invoices it issued
// stay).
export function RecurringControls({
  id,
  version,
  active,
  ended,
}: {
  id: string;
  version: number;
  active: boolean;
  ended: boolean;
}) {
  const { run, pending, message } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {active ? (
          <Button
            size="sm"
            variant="primary"
            pending={pending === "issue"}
            onClick={() => run("issue", () => issueRecurringNowAction({ id }))}
          >
            Issue the next one now
          </Button>
        ) : null}
        {ended ? null : (
          <Button
            size="sm"
            pending={pending === "active"}
            onClick={() => run("active", () => setRecurringActiveAction({ id, version, active: !active }))}
          >
            {active ? "Pause" : "Resume"}
          </Button>
        )}
        {confirming ? (
          <span className="flex items-center gap-2 text-[13px]">
            Delete the plan? Invoices it issued stay.
            <Button
              size="sm"
              variant="danger"
              pending={pending === "delete"}
              onClick={() => run("delete", () => deleteRecurringAction({ id }))}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Keep it
            </Button>
          </span>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
            Delete…
          </Button>
        )}
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}

// An unpaid invoice's automatic reminders: how many went out, when the next one goes, and a switch.
export function RemindersSwitch({ id, paused }: { id: string; paused: boolean }) {
  const { run, pending, message } = useActionRunner();
  return (
    <div className="grid gap-2">
      <div>
        <Button
          size="sm"
          variant="ghost"
          pending={pending === "reminders"}
          onClick={() => run("reminders", () => setInvoiceRemindersAction({ id, paused: !paused }))}
        >
          {paused ? "Send reminders again" : "Stop reminders"}
        </Button>
      </div>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}
