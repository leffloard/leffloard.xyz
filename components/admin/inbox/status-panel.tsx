"use client";

import { useState } from "react";
import { changeStatusAction, markSpamAction } from "@/app/(admin)/admin/(shell)/inbox/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { selectClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { STATUS_LABELS, type InquiryStatus } from "@/lib/intake/options";

const MOVES: { status: InquiryStatus; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "confirmed", label: "Confirm" },
  { status: "done", label: "Done" },
  { status: "declined", label: "Decline" },
  { status: "new", label: "Back to new" },
];

export function StatusPanel({
  id,
  status,
  visitorName,
  canEmail,
}: {
  id: string;
  status: InquiryStatus;
  visitorName: string;
  canEmail: boolean;
}) {
  const { run, pending, message } = useActionRunner();
  const [notify, setNotify] = useState(false);
  const [note, setNote] = useState("");
  const [blockMode, setBlockMode] = useState<"none" | "email" | "domain">("none");

  async function move(next: InquiryStatus) {
    const result = await run(next, () =>
      changeStatusAction({ id, status: next, notify, message: notify ? note : "" }),
    );
    if (result.ok) {
      setNotify(false);
      setNote("");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Status"
        action={
          <Badge tone={status === "new" ? "accent" : status === "spam" ? "danger" : "neutral"}>
            {STATUS_LABELS[status]}
          </Badge>
        }
      />
      <CardBody className="grid gap-3">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          {MOVES.filter((move) => move.status !== status).map((option) => (
            <Button
              key={option.status}
              size="sm"
              variant={option.status === "done" ? "primary" : "secondary"}
              pending={pending === option.status}
              disabled={pending !== null}
              onClick={() => move(option.status)}
            >
              {option.label}
            </Button>
          ))}
        </div>
        <label className="flex items-start gap-2 text-[13px]">
          <input
            type="checkbox"
            className="mt-0.5 accent-[var(--color-accent)]"
            checked={notify}
            disabled={!canEmail}
            onChange={(event) => setNotify(event.target.checked)}
          />
          <span>
            Email {visitorName} about the change
            {!canEmail ? (
              <span className="block text-xs text-muted">Email is not set up on the server yet.</span>
            ) : null}
          </span>
        </label>
        {notify ? (
          <div className="grid gap-1.5">
            <label htmlFor={`status-note-${id}`} className="text-[13px] font-medium">
              Message to add (optional)
            </label>
            <textarea
              id={`status-note-${id}`}
              className={textareaClasses}
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        ) : null}
        {status !== "spam" ? (
          <div className="mt-1 flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <label htmlFor={`block-${id}`} className="sr-only">
              Block the sender
            </label>
            <select
              id={`block-${id}`}
              className={selectClasses}
              value={blockMode}
              onChange={(event) => setBlockMode(event.target.value as typeof blockMode)}
            >
              <option value="none">Don&apos;t block the sender</option>
              <option value="email">Block this address</option>
              <option value="domain">Block the whole domain</option>
            </select>
            <Button
              size="sm"
              variant="danger"
              pending={pending === "spam"}
              disabled={pending !== null}
              onClick={() => run("spam", () => markSpamAction({ id, block: blockMode }))}
            >
              Spam
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
