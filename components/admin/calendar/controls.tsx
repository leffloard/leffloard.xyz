"use client";

import { useState } from "react";
import {
  approveMeetingAction,
  createBlockAction,
  declineMeetingAction,
  deleteBlockAction,
} from "@/app/(admin)/admin/(shell)/calendar/actions";
import { controlProps, FormRow, readForm } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses, selectFieldClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

const BLOCK_KINDS = [
  { value: "school", label: "School" },
  { value: "exam", label: "Exam" },
  { value: "focus", label: "Focus time" },
  { value: "away", label: "Away" },
  { value: "other", label: "Busy" },
];

// Time no one can book: a school day, an exam, a trip. Without times, whole days are blocked.
export function BlockForm({ today }: { today: string }) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await run("add", () => createBlockAction(readForm(event.currentTarget)));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setFormKey((key) => key + 1);
  }

  return (
    <Card>
      <CardHeader title="Block time" description="No one can book over a block." />
      <CardBody>
        <form key={formKey} onSubmit={add} className="grid gap-3" noValidate>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormRow id="block-title" label="What" error={errors.title}>
              <input
                {...controlProps("block-title", errors.title)}
                className={inputClasses}
                maxLength={80}
                placeholder="Maths exam"
              />
            </FormRow>
            <FormRow id="block-kind" label="Kind">
              <select {...controlProps("block-kind")} className={selectFieldClasses} defaultValue="exam">
                {BLOCK_KINDS.map((kind) => (
                  <option key={kind.value} value={kind.value}>
                    {kind.label}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow id="block-startDate" label="From" error={errors.startDate}>
              <input
                {...controlProps("block-startDate", errors.startDate)}
                type="date"
                className={inputClasses}
                defaultValue={today}
              />
            </FormRow>
            <FormRow id="block-startTime" label="At (optional)" error={errors.startTime}>
              <input
                {...controlProps("block-startTime", errors.startTime)}
                type="time"
                step={900}
                className={inputClasses}
              />
            </FormRow>
            <FormRow id="block-endDate" label="Until (optional)" error={errors.endDate}>
              <input
                {...controlProps("block-endDate", errors.endDate)}
                type="date"
                className={inputClasses}
              />
            </FormRow>
            <FormRow id="block-endTime" label="At (optional)" error={errors.endTime}>
              <input
                {...controlProps("block-endTime", errors.endTime)}
                type="time"
                step={900}
                className={inputClasses}
              />
            </FormRow>
          </div>
          <div>
            <Button type="submit" size="sm" variant="primary" pending={pending === "add"}>
              Add block
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function DeleteBlockButton({ id, title }: { id: string; title: string }) {
  const { run, pending } = useActionRunner();
  return (
    <button
      type="button"
      className="text-xs text-muted hover:text-danger"
      aria-label={`Remove block ${title}`}
      disabled={pending !== null}
      onClick={() => run("delete", () => deleteBlockAction({ id }))}
    >
      Remove
    </button>
  );
}

// Confirm or decline a booking request, from the calendar's list.
// Declining emails the guest, so it takes a second click (the meeting's page adds a note to it).
export function RequestButtons({ id, name }: { id: string; name: string }) {
  const { run, pending, message } = useActionRunner();
  const [declining, setDeclining] = useState(false);
  return (
    <span className="flex flex-wrap items-center gap-2">
      {declining ? (
        <>
          <Button
            size="sm"
            variant="danger"
            pending={pending === "decline"}
            onClick={() => run("decline", () => declineMeetingAction({ id, reason: "" }))}
          >
            Decline {name}&apos;s request
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDeclining(false)}>
            Back
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="primary"
            pending={pending === "approve"}
            onClick={() => run("approve", () => approveMeetingAction({ id }))}
          >
            Confirm
          </Button>
          <Button size="sm" onClick={() => setDeclining(true)}>
            Decline…
          </Button>
        </>
      )}
      {message?.tone === "error" ? <span className="text-xs text-danger">{message.text}</span> : null}
    </span>
  );
}
