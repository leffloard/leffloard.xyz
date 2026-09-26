"use client";

import { useState } from "react";
import {
  addActivityAction,
  deleteActivityAction,
  deleteClientAction,
  exportClientAction,
  setClientStatusAction,
} from "@/app/(admin)/admin/(shell)/clients/actions";
import { controlProps, FormRow, readForm } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { inputClasses, selectClasses, selectFieldClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  ACTIVITY_KINDS,
  ACTIVITY_LABELS,
  CLIENT_STATUS_LABELS,
  CLIENT_STATUSES,
  type ClientStatus,
} from "@/lib/work/options";

export function ClientStatusSelect({ id, status }: { id: string; status: ClientStatus }) {
  const { run, pending, message } = useActionRunner();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="client-status-select" className="text-[13px] text-muted">
        Status
      </label>
      <select
        key={status}
        id="client-status-select"
        className={selectClasses}
        defaultValue={status}
        disabled={pending !== null}
        onChange={(event) =>
          run("status", () => setClientStatusAction({ id, status: event.target.value as ClientStatus }))
        }
      >
        {CLIENT_STATUSES.map((option) => (
          <option key={option} value={option}>
            {CLIENT_STATUS_LABELS[option]}
          </option>
        ))}
      </select>
      {message?.tone === "error" ? <span className="text-xs text-danger">{message.text}</span> : null}
    </div>
  );
}

// Logging a call, email, meeting or note that happened outside the app.
export function ActivityComposer({
  clientId,
  projects,
  today,
}: {
  clientId: string;
  projects: { id: string; label: string }[];
  today: string;
}) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formKey, setFormKey] = useState(0);

  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readForm(event.currentTarget);
    const result = await run("add", () => addActivityAction({ ...fields, clientId }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setFormKey((key) => key + 1);
  }

  return (
    <Card>
      <CardHeader title="Log" description="Calls, emails and meetings outside the app, and notes." />
      <CardBody>
        <form key={formKey} onSubmit={add} className="grid gap-3" noValidate>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))]">
            <FormRow id="activity-kind" label="What">
              <select {...controlProps("activity-kind")} className={selectFieldClasses} defaultValue="note">
                {ACTIVITY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {ACTIVITY_LABELS[kind]}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow id="activity-date" label="Day" error={errors.date}>
              <input
                {...controlProps("activity-date", errors.date)}
                type="date"
                className={inputClasses}
                defaultValue={today}
              />
            </FormRow>
            <FormRow id="activity-time" label="Time (optional)" error={errors.time}>
              <input {...controlProps("activity-time", errors.time)} type="time" className={inputClasses} />
            </FormRow>
          </div>
          <FormRow id="activity-body" label="Notes" error={errors.body}>
            <textarea
              {...controlProps("activity-body", errors.body)}
              className={textareaClasses}
              rows={3}
              maxLength={5000}
            />
          </FormRow>
          <div className="flex flex-wrap items-end justify-between gap-3">
            {projects.length ? (
              <div className="flex items-center gap-2">
                <label htmlFor="activity-projectId" className="text-[13px] text-muted">
                  About
                </label>
                <select {...controlProps("activity-projectId")} className={selectClasses} defaultValue="">
                  <option value="">No project in particular</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.label}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <span />
            )}
            <Button type="submit" size="sm" variant="primary" pending={pending === "add"}>
              Add to the log
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export function DeleteActivityButton({ id }: { id: string }) {
  const { run, pending } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  if (!confirming) {
    return (
      <button
        type="button"
        className="text-xs text-muted underline-offset-2 hover:text-danger hover:underline"
        onClick={() => setConfirming(true)}
      >
        Delete
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      <button
        type="button"
        className="text-danger underline underline-offset-2"
        disabled={pending !== null}
        onClick={() => run("delete", () => deleteActivityAction({ id }))}
      >
        Delete this entry
      </button>
      <button type="button" className="text-muted" onClick={() => setConfirming(false)}>
        Keep
      </button>
    </span>
  );
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Export and delete: both ask to confirm it's you first.
export function ClientPrivacyCard({ id, name }: { id: string; name: string }) {
  const { run, pending, message } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function exportData() {
    const result = await run("export", () => exportClientAction({ id }));
    if (result.ok) download(result.data.filename, result.data.json);
  }

  async function remove() {
    const result = await run("delete", () => deleteClientAction({ id, confirm: typed }));
    setError(result.ok ? null : (result.fieldErrors?.confirm ?? null));
  }

  return (
    <Card>
      <CardHeader
        title="Data and privacy"
        description="For a data request from the client, or to remove them."
      />
      <CardBody className="grid gap-4 text-[13px]">
        {message && !error ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <div className="grid gap-1.5">
          <p className="text-muted">
            A JSON file with everything stored about {name}: details, log, projects, rounds, tasks, time and
            their inbox messages.
          </p>
          <div>
            <Button size="sm" pending={pending === "export"} onClick={exportData}>
              Export data
            </Button>
          </div>
        </div>
        <div className="grid gap-2 border-t border-line pt-4">
          {confirming ? (
            <>
              <p>
                This deletes {name} with their projects, revision rounds, tasks, time and log. Their inbox
                messages stay (unlinked) until the inbox deletes them. It can&apos;t be undone.
              </p>
              <label htmlFor="client-delete-confirm" className="font-medium">
                Type the client&apos;s name to confirm
              </label>
              <input
                id="client-delete-confirm"
                className={cn(inputClasses, "max-w-sm")}
                value={typed}
                autoComplete="off"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "client-delete-error" : undefined}
                onChange={(event) => setTyped(event.target.value)}
              />
              {error ? (
                <p id="client-delete-error" className="text-xs text-danger">
                  {error}
                </p>
              ) : null}
              <div className="flex gap-2">
                <Button size="sm" variant="danger" pending={pending === "delete"} onClick={remove}>
                  Delete for good
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                  Keep the client
                </Button>
              </div>
            </>
          ) : (
            <div>
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                Delete client…
              </Button>
            </div>
          )}
        </div>
      </CardBody>
    </Card>
  );
}
