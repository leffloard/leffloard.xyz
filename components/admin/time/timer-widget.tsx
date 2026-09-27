"use client";

import { useEffect, useState } from "react";
import { startTimerAction, stopTimerAction } from "@/app/(admin)/admin/(shell)/time/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { compactInputClasses, selectClasses } from "@/components/ui/field";
import { formatClock } from "@/lib/duration";

export type RunningTimerView = {
  description: string;
  label: string | null; // "PRJ-004 · Shop rebuild"
  startedAt: string; // ISO
  elapsed: number; // seconds when the page was rendered, so the first paint matches the server's
};

// The timer in the admin's sidebar: one runs at a time, from any page.
export function TimerWidget({
  running,
  projects,
  compact = false,
}: {
  running: RunningTimerView | null;
  projects: { id: string; label: string }[];
  compact?: boolean;
}) {
  const { run, pending, message } = useActionRunner();
  const [elapsed, setElapsed] = useState(running?.elapsed ?? 0);
  const [starting, setStarting] = useState(false);
  const [description, setDescription] = useState("");
  const [projectId, setProjectId] = useState("");
  const idPrefix = compact ? "timer-mobile" : "timer";

  useEffect(() => {
    if (!running) return;
    const started = Date.parse(running.startedAt);
    const tick = () => setElapsed(Math.max(0, (Date.now() - started) / 1000));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [running]);

  if (running) {
    return (
      <div
        className={cn(
          "grid gap-1.5 rounded-lg border border-accent/30 bg-accent/[0.06] p-2.5",
          compact && "p-2",
        )}
      >
        <div className="flex items-center gap-2">
          <span
            aria-hidden
            className="size-2 animate-pulse rounded-full bg-accent motion-reduce:animate-none"
          />
          <span
            className="font-mono text-sm tabular-nums"
            role="timer"
            aria-label="Time on the running timer"
          >
            {formatClock(elapsed)}
          </span>
          <Button
            size="sm"
            className="ml-auto h-7 px-2.5"
            pending={pending === "stop"}
            onClick={() => run("stop", () => stopTimerAction({}))}
          >
            Stop
          </Button>
        </div>
        <p className="truncate text-xs text-muted">
          {running.description || "No description"}
          {running.label ? ` · ${running.label}` : ""}
        </p>
        {message ? (
          <p className={cn("text-xs", message.tone === "error" ? "text-danger" : "text-muted")}>
            {message.text}
          </p>
        ) : null}
      </div>
    );
  }

  if (!starting) {
    return (
      <div className="grid gap-1.5">
        <Button size="sm" variant="ghost" className="justify-start" onClick={() => setStarting(true)}>
          <span aria-hidden className="size-2 rounded-full border border-current" />
          Start timer
        </Button>
        {message ? (
          <p className={cn("px-2.5 text-xs", message.tone === "error" ? "text-danger" : "text-muted")}>
            {message.text}
          </p>
        ) : null}
      </div>
    );
  }

  async function start(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("start", () => startTimerAction({ description, projectId, taskId: "" }));
    if (result.ok) {
      setStarting(false);
      setDescription("");
      setProjectId("");
    }
  }

  return (
    <form onSubmit={start} className="grid gap-2 rounded-lg border border-line p-2.5">
      <label htmlFor={`${idPrefix}-description`} className="sr-only">
        What are you working on?
      </label>
      <input
        id={`${idPrefix}-description`}
        className={compactInputClasses}
        placeholder="What are you working on?"
        maxLength={300}
        value={description}
        autoFocus
        onChange={(event) => setDescription(event.target.value)}
      />
      <label htmlFor={`${idPrefix}-project`} className="sr-only">
        Project
      </label>
      <select
        id={`${idPrefix}-project`}
        className={cn(selectClasses, "w-full")}
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
      {message?.tone === "error" ? <p className="text-xs text-danger">{message.text}</p> : null}
      <div className="flex gap-2">
        <Button type="submit" size="sm" variant="primary" className="flex-1" pending={pending === "start"}>
          Start
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setStarting(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

// "Start timer" on a task or project page.
export function StartTimerButton({
  description,
  projectId,
  taskId,
  running,
}: {
  description: string;
  projectId: string | null;
  taskId: string | null;
  running: boolean; // this task or project already has the running timer
}) {
  const { run, pending, message } = useActionRunner();
  if (running) {
    return (
      <span className="inline-flex items-center gap-2 text-[13px] text-accent">
        <span
          aria-hidden
          className="size-2 animate-pulse rounded-full bg-accent motion-reduce:animate-none"
        />
        Timer running
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        pending={pending === "start"}
        onClick={() =>
          run("start", () =>
            startTimerAction({ description, projectId: projectId ?? "", taskId: taskId ?? "" }),
          )
        }
      >
        Start timer
      </Button>
      {message?.tone === "error" ? <span className="text-xs text-danger">{message.text}</span> : null}
    </span>
  );
}
