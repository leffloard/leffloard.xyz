"use client";

import Link from "next/link";
import { useState } from "react";
import {
  addEntryAction,
  deleteEntryAction,
  updateEntryAction,
} from "@/app/(admin)/admin/(shell)/time/actions";
import { controlProps, FormRow, readForm } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { inputClasses, selectFieldClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export type TimeProjectOption = { id: string; label: string; hourly: boolean };

export type EntryValues = {
  id?: string;
  running?: boolean;
  description: string;
  projectId: string;
  taskId?: string;
  date: string;
  startTime: string;
  duration: string; // "1:30"
  billable: boolean;
};

// Adding time by hand, or changing an entry. A running timer only changes its description, project and
// whether it is billable.
export function EntryForm({
  values,
  projects,
  onDone,
  submitLabel,
  idPrefix,
}: {
  values: EntryValues;
  projects: TimeProjectOption[];
  onDone?: () => void;
  submitLabel: string;
  idPrefix: string;
}) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [billable, setBillable] = useState(values.billable);
  const [formKey, setFormKey] = useState(0);
  const editing = Boolean(values.id);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readForm(event.currentTarget);
    const payload = { ...fields, billable, taskId: values.taskId ?? "" };
    const result = await run("save", () =>
      editing ? updateEntryAction({ ...payload, id: values.id }) : addEntryAction(payload),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) {
      if (!editing) {
        setFormKey((key) => key + 1);
        setBillable(values.billable);
      }
      onDone?.();
    }
  }

  const id = (field: string) => `${idPrefix}-${field}`;
  const props = (field: string) => ({ ...controlProps(id(field), errors[field]), name: field });

  return (
    <form key={formKey} onSubmit={save} className="grid gap-3" noValidate>
      {message && (message.tone === "error" || !editing) ? (
        <Notice tone={message.tone}>{message.text}</Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <FormRow id={id("description")} label="What" error={errors.description} className="sm:col-span-2">
          <input
            {...props("description")}
            className={inputClasses}
            maxLength={300}
            defaultValue={values.description}
          />
        </FormRow>
        <FormRow id={id("projectId")} label="Project" error={errors.projectId}>
          <select
            {...props("projectId")}
            className={selectFieldClasses}
            defaultValue={values.projectId}
            onChange={(event) => {
              if (!editing)
                setBillable(projects.find((project) => project.id === event.target.value)?.hourly ?? false);
            }}
          >
            <option value="">No project</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.label}
              </option>
            ))}
          </select>
        </FormRow>
        {values.running ? null : (
          <>
            <FormRow id={id("date")} label="Day" error={errors.date}>
              <input {...props("date")} type="date" className={inputClasses} defaultValue={values.date} />
            </FormRow>
            <FormRow id={id("startTime")} label="From (optional)" error={errors.startTime}>
              <input
                {...props("startTime")}
                type="time"
                className={inputClasses}
                defaultValue={values.startTime}
              />
            </FormRow>
            <FormRow id={id("duration")} label="How long" error={errors.duration} hint="1:30, 1.5 or 90m">
              <input
                {...controlProps(id("duration"), errors.duration, true)}
                name="duration"
                className={inputClasses}
                defaultValue={values.duration}
                inputMode="decimal"
              />
            </FormRow>
          </>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-[13px]">
          <input
            type="checkbox"
            checked={billable}
            onChange={(event) => setBillable(event.target.checked)}
            className="accent-[var(--color-accent)]"
          />
          Billable
        </label>
        <div className="flex gap-2">
          {onDone && editing ? (
            <Button size="sm" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
          ) : null}
          <Button type="submit" size="sm" variant="primary" pending={pending === "save"}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

export type EntryRowData = {
  id: string;
  running: boolean;
  description: string;
  project: { id: string; label: string } | null;
  task: { id: string; title: string } | null;
  range: string; // "09:00–10:30"
  duration: string; // "1:30"
  billable: boolean;
  values: EntryValues;
};

export function EntryRow({ entry, projects }: { entry: EntryRowData; projects: TimeProjectOption[] }) {
  const { run, pending } = useActionRunner();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);

  if (editing) {
    return (
      <li className="bg-white/[0.02] px-4 py-3 sm:px-5">
        <EntryForm
          values={entry.values}
          projects={projects}
          submitLabel="Save"
          idPrefix={`entry-${entry.id}`}
          onDone={() => setEditing(false)}
        />
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5 text-[13px] sm:px-5">
      <span className="w-24 shrink-0 font-mono text-xs text-muted tabular-nums">{entry.range}</span>
      <span className="min-w-0 flex-1">
        <span className={cn(!entry.description && "text-muted")}>
          {entry.description || "No description"}
        </span>
        {entry.project || entry.task ? (
          <span className="block truncate text-xs text-muted">
            {entry.project ? (
              <Link href={`/admin/projects/${entry.project.id}/time`} className="hover:text-ink">
                {entry.project.label}
              </Link>
            ) : null}
            {entry.task ? (
              <>
                {entry.project ? " · " : ""}
                <Link href={`/admin/tasks/${entry.task.id}`} className="hover:text-ink">
                  {entry.task.title}
                </Link>
              </>
            ) : null}
          </span>
        ) : null}
      </span>
      {entry.running ? <Badge tone="accent">running</Badge> : entry.billable ? <Badge>billable</Badge> : null}
      <span className="w-12 shrink-0 text-right font-mono tabular-nums">{entry.duration}</span>
      <span className="flex shrink-0 gap-3 text-xs">
        <button type="button" className="text-muted hover:text-ink" onClick={() => setEditing(true)}>
          Edit
        </button>
        {confirming ? (
          <>
            <button
              type="button"
              className="text-danger"
              disabled={pending !== null}
              onClick={() => run("delete", () => deleteEntryAction({ id: entry.id }))}
            >
              Delete it
            </button>
            <button type="button" className="text-muted" onClick={() => setConfirming(false)}>
              Keep
            </button>
          </>
        ) : (
          <button type="button" className="text-muted hover:text-danger" onClick={() => setConfirming(true)}>
            Delete
          </button>
        )}
      </span>
    </li>
  );
}
