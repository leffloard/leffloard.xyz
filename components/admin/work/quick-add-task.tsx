"use client";

import { useRef, useState } from "react";
import { createTaskAction } from "@/app/(admin)/admin/(shell)/tasks/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { inputClasses, selectClasses } from "@/components/ui/field";
import { TASK_WHEN, TASK_WHEN_LABELS, type TaskWhen } from "@/lib/work/options";

export type ProjectOption = { id: string; label: string };

// The row above the task lists: type, pick when, press Enter. Focus stays in the box for the next one.
export function QuickAddTask({
  projects,
  defaultWhen = "none",
}: {
  projects: ProjectOption[];
  defaultWhen?: TaskWhen;
}) {
  const { run, pending, message } = useActionRunner();
  const [title, setTitle] = useState("");
  const [when, setWhen] = useState<TaskWhen>(defaultWhen);
  const [date, setDate] = useState("");
  const [projectId, setProjectId] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const input = useRef<HTMLInputElement>(null);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("add", () => createTaskAction({ title, when, date, projectId }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setTitle("");
    input.current?.focus();
  }

  const error = errors.title ?? errors.date ?? errors.projectId;
  return (
    <form onSubmit={add} className="grid gap-2 rounded-xl border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="quick-add-title" className="sr-only">
          New task
        </label>
        <input
          ref={input}
          id="quick-add-title"
          className={cn(inputClasses, "h-9 min-w-48 flex-1")}
          placeholder="Add a task…  ( n )"
          maxLength={300}
          value={title}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={error ? "quick-add-error" : undefined}
          onChange={(event) => setTitle(event.target.value)}
        />
        <label htmlFor="quick-add-when" className="sr-only">
          When
        </label>
        <select
          id="quick-add-when"
          className={cn(selectClasses, "h-9")}
          value={when}
          onChange={(event) => setWhen(event.target.value as TaskWhen)}
        >
          {TASK_WHEN.map((option) => (
            <option key={option} value={option}>
              {TASK_WHEN_LABELS[option]}
            </option>
          ))}
        </select>
        {when === "date" ? (
          <>
            <label htmlFor="quick-add-date" className="sr-only">
              Date
            </label>
            <input
              id="quick-add-date"
              type="date"
              className={cn(selectClasses, "h-9")}
              value={date}
              aria-invalid={errors.date ? true : undefined}
              onChange={(event) => setDate(event.target.value)}
            />
          </>
        ) : null}
        {projects.length ? (
          <>
            <label htmlFor="quick-add-project" className="sr-only">
              Project
            </label>
            <select
              id="quick-add-project"
              className={cn(selectClasses, "h-9 max-w-56")}
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
          </>
        ) : null}
        <Button type="submit" variant="primary" size="sm" className="h-9" pending={pending === "add"}>
          Add
        </Button>
      </div>
      {error ? (
        <p id="quick-add-error" className="text-xs text-danger">
          {error}
        </p>
      ) : message ? (
        <p role="status" className={message.tone === "error" ? "text-xs text-danger" : "text-xs text-muted"}>
          {message.text}
        </p>
      ) : null}
    </form>
  );
}
