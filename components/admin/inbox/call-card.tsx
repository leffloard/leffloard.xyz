"use client";

import { useState } from "react";
import { scheduleCallAction } from "@/app/(admin)/admin/(shell)/inbox/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export type CallInfo = {
  requested: string; // "Thursday, 1 October 2026 at 14:30 (Europe/Istanbul)"
  requestedLocal: string | null; // the same moment in the owner's time zone, when the zones differ
  duration: number;
  timeZone: string;
  defaultDate: string;
  defaultTime: string;
  scheduled: string | null; // in the visitor's zone
  scheduledLocal: string | null;
};

export function CallCard({
  id,
  call,
  canEmail,
  visitorName,
}: {
  id: string;
  call: CallInfo;
  canEmail: boolean;
  visitorName: string;
}) {
  const { run, pending, message } = useActionRunner();
  const [date, setDate] = useState(call.defaultDate);
  const [time, setTime] = useState(call.defaultTime);
  const [notify, setNotify] = useState(canEmail);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("save", () =>
      scheduleCallAction({
        id,
        date,
        time,
        confirm: true,
        notify: notify && canEmail,
        message: notify ? note : "",
      }),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setNote("");
  }

  return (
    <Card>
      <CardHeader
        title="Call"
        description={`${call.duration} minutes, in the visitor's time zone (${call.timeZone}).`}
      />
      <CardBody className="grid gap-3 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <dl className="grid gap-1.5">
          <div>
            <dt className="text-xs text-muted">Requested</dt>
            <dd>{call.requested}</dd>
            {call.requestedLocal ? (
              <dd className="text-xs text-muted">Your time: {call.requestedLocal}</dd>
            ) : null}
          </div>
          {call.scheduled ? (
            <div>
              <dt className="text-xs text-muted">Scheduled</dt>
              <dd className="font-medium text-success">{call.scheduled}</dd>
              {call.scheduledLocal ? (
                <dd className="text-xs text-muted">Your time: {call.scheduledLocal}</dd>
              ) : null}
            </div>
          ) : null}
        </dl>
        <form onSubmit={save} className="grid gap-3 border-t border-line pt-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <label htmlFor="call-date" className="text-xs font-medium">
                Date
              </label>
              <input
                id="call-date"
                type="date"
                className={inputClasses}
                value={date}
                aria-invalid={errors.date ? true : undefined}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="grid gap-1">
              <label htmlFor="call-time" className="text-xs font-medium">
                Time
              </label>
              <input
                id="call-time"
                type="time"
                className={inputClasses}
                value={time}
                aria-invalid={errors.time ? true : undefined}
                onChange={(event) => setTime(event.target.value)}
              />
            </div>
          </div>
          {errors.date || errors.time ? (
            <p className="text-xs text-danger">{errors.date ?? errors.time}</p>
          ) : null}
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="mt-0.5 accent-[var(--color-accent)]"
              checked={notify && canEmail}
              disabled={!canEmail}
              onChange={(event) => setNotify(event.target.checked)}
            />
            <span>Email {visitorName} the confirmed time</span>
          </label>
          {notify && canEmail ? (
            <textarea
              aria-label="Message to add (optional)"
              placeholder="Message to add, e.g. the meeting link (optional)"
              className={textareaClasses}
              rows={3}
              maxLength={2000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              variant="primary"
              pending={pending === "save"}
              disabled={pending !== null}
            >
              Confirm this time
            </Button>
            {call.scheduled ? (
              <Button
                size="sm"
                pending={pending === "clear"}
                disabled={pending !== null}
                onClick={() => run("clear", () => scheduleCallAction({ id, clear: true }))}
              >
                Clear the time
              </Button>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
