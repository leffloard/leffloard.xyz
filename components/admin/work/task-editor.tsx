"use client";

import { useState } from "react";
import {
  addChecklistItemAction,
  deleteTaskAction,
  removeChecklistItemAction,
  setChecklistItemDoneAction,
  setTaskDoneAction,
  updateTaskAction,
} from "@/app/(admin)/admin/(shell)/tasks/actions";
import { controlProps, FormRow, readForm } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import {
  compactInputClasses,
  inputClasses,
  selectFieldClasses,
  textareaClasses,
} from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { RECURRENCE_LABELS, RECURRENCES, type Recurrence } from "@/lib/work/options";

export type TaskEditorValues = {
  id: string;
  title: string;
  notes: string;
  projectId: string;
  due: string;
  someday: boolean;
  flagged: boolean;
  recurrence: Recurrence | "";
  estimate: string;
  done: boolean;
};

export function TaskEditor({
  values,
  projects,
}: {
  values: TaskEditorValues;
  projects: { id: string; label: string }[];
}) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [someday, setSomeday] = useState(values.someday);
  const [flagged, setFlagged] = useState(values.flagged);
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readForm(event.currentTarget);
    const result = await run("save", () => updateTaskAction({ ...fields, id: values.id, someday, flagged }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={save} className="grid gap-4" noValidate>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <FormRow id="task-title" label="Task" error={errors.title}>
            <input
              {...controlProps("task-title", errors.title)}
              className={inputClasses}
              maxLength={300}
              defaultValue={values.title}
            />
          </FormRow>
          <FormRow id="task-notes" label="Notes" error={errors.notes}>
            <textarea
              {...controlProps("task-notes", errors.notes)}
              className={textareaClasses}
              rows={5}
              maxLength={20_000}
              defaultValue={values.notes}
            />
          </FormRow>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow id="task-projectId" label="Project" error={errors.projectId}>
              <select
                {...controlProps("task-projectId", errors.projectId)}
                className={selectFieldClasses}
                defaultValue={values.projectId}
              >
                <option value="">No project</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow id="task-due" label="Due" error={errors.due}>
              <input
                {...controlProps("task-due", errors.due)}
                type="date"
                className={inputClasses}
                defaultValue={values.due}
              />
            </FormRow>
            <FormRow id="task-recurrence" label="Repeat" error={errors.recurrence}>
              <select
                {...controlProps("task-recurrence", errors.recurrence)}
                className={selectFieldClasses}
                defaultValue={values.recurrence}
              >
                <option value="">Does not repeat</option>
                {RECURRENCES.map((recurrence) => (
                  <option key={recurrence} value={recurrence}>
                    {RECURRENCE_LABELS[recurrence]}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow id="task-estimate" label="Estimate" error={errors.estimate} hint="1:30, 1.5 or 90m">
              <input
                {...controlProps("task-estimate", errors.estimate, true)}
                className={inputClasses}
                defaultValue={values.estimate}
                inputMode="decimal"
              />
            </FormRow>
          </div>
          <div className="flex flex-wrap gap-5 text-[13px]">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={flagged}
                onChange={(event) => setFlagged(event.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Flagged
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={someday}
                onChange={(event) => setSomeday(event.target.checked)}
                className="accent-[var(--color-accent)]"
              />
              Someday (when it has no date)
            </label>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            <div className="flex flex-wrap gap-2">
              <Button type="submit" variant="primary" size="sm" pending={pending === "save"}>
                Save
              </Button>
              <Button
                size="sm"
                pending={pending === "done"}
                onClick={() => run("done", () => setTaskDoneAction({ id: values.id, done: !values.done }))}
              >
                {values.done ? "Reopen" : "Mark as done"}
              </Button>
            </div>
            {confirmDelete ? (
              <span className="flex items-center gap-2 text-[13px]">
                Delete this task?
                <Button
                  size="sm"
                  variant="danger"
                  pending={pending === "delete"}
                  onClick={() => run("delete", () => deleteTaskAction({ id: values.id }))}
                >
                  Delete
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </span>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete…
              </Button>
            )}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export type ChecklistRow = { id: string; text: string; done: boolean };

export function Checklist({ taskId, items }: { taskId: string; items: ChecklistRow[] }) {
  const { run, pending, message } = useActionRunner();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const done = items.filter((item) => item.done).length;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("add", () => addChecklistItemAction({ id: taskId, text }));
    setError(result.ok ? null : (result.fieldErrors?.text ?? null));
    if (result.ok) setText("");
  }

  return (
    <Card>
      <CardHeader
        title="Checklist"
        description={items.length ? `${done} of ${items.length} done.` : undefined}
      />
      <CardBody className="grid gap-3 text-[13px]">
        {message?.tone === "error" && !error ? <Notice tone="error">{message.text}</Notice> : null}
        {items.length ? (
          <ul className="grid gap-1.5">
            {items.map((item) => (
              <li key={item.id} className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={item.done}
                  aria-label={`Step done: ${item.text}`}
                  disabled={pending !== null}
                  onChange={(event) =>
                    run(item.id, () =>
                      setChecklistItemDoneAction({ id: taskId, itemId: item.id, done: event.target.checked }),
                    )
                  }
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className={cn("min-w-0 flex-1", item.done && "text-muted line-through")}>
                  {item.text}
                </span>
                <button
                  type="button"
                  className="shrink-0 text-xs text-muted hover:text-danger"
                  aria-label={`Remove step ${item.text}`}
                  onClick={() =>
                    run(`remove-${item.id}`, () => removeChecklistItemAction({ id: taskId, itemId: item.id }))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={add} className="flex gap-2" noValidate>
          <label htmlFor="checklist-text" className="sr-only">
            New step
          </label>
          <input
            id="checklist-text"
            className={compactInputClasses}
            placeholder="Add a step"
            maxLength={300}
            value={text}
            aria-invalid={error ? true : undefined}
            onChange={(event) => setText(event.target.value)}
          />
          <Button type="submit" size="sm" pending={pending === "add"}>
            Add
          </Button>
        </form>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
      </CardBody>
    </Card>
  );
}
