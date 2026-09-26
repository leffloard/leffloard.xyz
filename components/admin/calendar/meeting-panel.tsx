"use client";

import { useState } from "react";
import {
  approveMeetingAction,
  cancelMeetingAction,
  declineMeetingAction,
  linkMeetingClientAction,
  rescheduleMeetingAction,
  saveMeetingNoteAction,
} from "@/app/(admin)/admin/(shell)/calendar/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses, selectClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

// What the owner does with a meeting: answer a request, move or cancel it, keep a note, link a client.

export function MeetingActions({
  id,
  status,
  upcoming,
  date,
  time,
  canEmail,
  emailByDefault,
}: {
  id: string;
  status: "requested" | "confirmed" | "declined" | "cancelled";
  upcoming: boolean;
  date: string; // its current day and time, in the owner's zone, for the move form
  time: string;
  canEmail: boolean;
  emailByDefault: boolean; // false for a meeting set up without emailing the guest
}) {
  const { run, pending, message } = useActionRunner();
  const [mode, setMode] = useState<"none" | "move" | "cancel" | "decline">("none");
  const [reason, setReason] = useState("");
  const [tellGuest, setTellGuest] = useState(canEmail && emailByDefault);
  const [when, setWhen] = useState({ date, time });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const active = status === "requested" || status === "confirmed";

  async function move(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("move", () => rescheduleMeetingAction({ id, ...when, tellGuest }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setMode("none");
  }

  async function end(event: React.FormEvent) {
    event.preventDefault();
    const result = await run(mode, () =>
      mode === "decline"
        ? declineMeetingAction({ id, reason })
        : cancelMeetingAction({ id, reason, tellGuest }),
    );
    if (result.ok) setMode("none");
  }

  if (!active) {
    return message ? <Notice tone={message.tone}>{message.text}</Notice> : null;
  }

  const tellGuestBox = (
    <label className="flex items-center gap-2 text-[13px]">
      <input
        type="checkbox"
        checked={tellGuest}
        disabled={!canEmail}
        onChange={(event) => setTellGuest(event.target.checked)}
        className="accent-[var(--color-accent)]"
      />
      Email the guest{canEmail ? "" : " (email is not set up)"}
    </label>
  );

  return (
    <Card>
      <CardHeader title={status === "requested" ? "Answer the request" : "Change"} />
      <CardBody className="grid gap-4">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          {status === "requested" ? (
            <>
              <Button
                size="sm"
                variant="primary"
                pending={pending === "approve"}
                onClick={() => run("approve", () => approveMeetingAction({ id }))}
              >
                Confirm
              </Button>
              <Button size="sm" onClick={() => setMode("decline")}>
                Decline…
              </Button>
            </>
          ) : null}
          {upcoming ? (
            <Button size="sm" onClick={() => setMode("move")}>
              Move…
            </Button>
          ) : null}
          <Button size="sm" variant="danger" onClick={() => setMode("cancel")}>
            Cancel…
          </Button>
        </div>

        {mode === "move" ? (
          <form onSubmit={move} className="grid gap-3 border-t border-line pt-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <FormRow id="move-date" label="Day" error={errors.date}>
                <input
                  {...controlProps("move-date", errors.date)}
                  type="date"
                  className={inputClasses}
                  value={when.date}
                  onChange={(event) => setWhen((current) => ({ ...current, date: event.target.value }))}
                />
              </FormRow>
              <FormRow id="move-time" label="Time (your time zone)" error={errors.time}>
                <input
                  {...controlProps("move-time", errors.time)}
                  type="time"
                  step={900}
                  className={inputClasses}
                  value={when.time}
                  onChange={(event) => setWhen((current) => ({ ...current, time: event.target.value }))}
                />
              </FormRow>
            </div>
            {tellGuestBox}
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" pending={pending === "move"}>
                Move the meeting
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
                Keep the time
              </Button>
            </div>
            <p className="text-xs text-muted">
              You can move it outside your bookable hours; other meetings still can&apos;t overlap.
            </p>
          </form>
        ) : null}

        {mode === "cancel" || mode === "decline" ? (
          <form onSubmit={end} className="grid gap-3 border-t border-line pt-4" noValidate>
            <FormRow
              id="end-reason"
              label={mode === "decline" ? "A note for the guest (optional)" : "Reason (optional)"}
            >
              <textarea
                {...controlProps("end-reason")}
                className={textareaClasses}
                rows={3}
                maxLength={1000}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </FormRow>
            {mode === "cancel" ? tellGuestBox : null}
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="danger" pending={pending === mode}>
                {mode === "decline" ? "Decline the request" : "Cancel the meeting"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
                Back
              </Button>
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}

export function MeetingNote({ id, note }: { id: string; note: string }) {
  const { run, pending, message } = useActionRunner();
  const [text, setText] = useState(note);
  return (
    <Card>
      <CardHeader title="Private note" description="Only you see it." />
      <CardBody className="grid gap-2">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <label htmlFor="meeting-note" className="sr-only">
          Private note
        </label>
        <textarea
          id="meeting-note"
          className={textareaClasses}
          rows={4}
          maxLength={5000}
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
        <div>
          <Button
            size="sm"
            pending={pending === "note"}
            onClick={() => run("note", () => saveMeetingNoteAction({ id, note: text }))}
          >
            Save note
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

export function MeetingClient({
  id,
  client,
  clients,
}: {
  id: string;
  client: { id: string; name: string } | null;
  clients: { id: string; label: string }[];
}) {
  const { run, pending, message } = useActionRunner();
  const [chosen, setChosen] = useState("");
  return (
    <Card>
      <CardHeader title="Client" />
      <CardBody className="grid gap-3 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {client ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <a href={`/admin/clients/${client.id}`} className="font-medium text-accent hover:underline">
              {client.name}
            </a>
            <Button
              size="sm"
              variant="ghost"
              pending={pending === "unlink"}
              onClick={() => run("unlink", () => linkMeetingClientAction({ id, clientId: "" }))}
            >
              Unlink
            </Button>
          </div>
        ) : (
          <>
            <div>
              <Button
                size="sm"
                pending={pending === "create"}
                onClick={() =>
                  run("create", () => linkMeetingClientAction({ id, clientId: "", create: true }))
                }
              >
                Make the guest a client
              </Button>
            </div>
            {clients.length ? (
              <div className="flex flex-wrap gap-2">
                <label htmlFor="meeting-client" className="sr-only">
                  Link to a client
                </label>
                <select
                  id="meeting-client"
                  className={selectClasses}
                  value={chosen}
                  onChange={(event) => setChosen(event.target.value)}
                >
                  <option value="">Link to a client…</option>
                  {clients.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <Button
                  size="sm"
                  disabled={!chosen}
                  pending={pending === "link"}
                  onClick={() => run("link", () => linkMeetingClientAction({ id, clientId: chosen }))}
                >
                  Link
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
