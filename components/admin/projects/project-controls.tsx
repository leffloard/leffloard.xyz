"use client";

import { useState } from "react";
import {
  addLinkAction,
  addMilestoneAction,
  deleteProjectAction,
  moveProjectAction,
  removeLinkAction,
  removeMilestoneAction,
  setLinkSharedAction,
  setMilestoneDoneAction,
} from "@/app/(admin)/admin/(shell)/projects/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { compactInputBase, compactInputClasses, inputClasses, selectClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { PROJECT_STAGE_LABELS, PROJECT_STAGES, type ProjectStage } from "@/lib/work/options";

export function StageSelect({ id, stage }: { id: string; stage: ProjectStage }) {
  const { run, pending, message } = useActionRunner();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="project-stage-select" className="text-[13px] text-muted">
        Stage
      </label>
      <select
        key={stage}
        id="project-stage-select"
        className={selectClasses}
        defaultValue={stage}
        disabled={pending !== null}
        onChange={(event) =>
          run("stage", () =>
            moveProjectAction({ id, stage: event.target.value as ProjectStage, after: "top" }),
          )
        }
      >
        {PROJECT_STAGES.map((option) => (
          <option key={option} value={option}>
            {PROJECT_STAGE_LABELS[option]}
          </option>
        ))}
      </select>
      {message?.tone === "error" ? <span className="text-xs text-danger">{message.text}</span> : null}
    </div>
  );
}

export type MilestoneRow = { id: string; title: string; due: string | null; done: boolean };

export function MilestonesCard({ projectId, milestones }: { projectId: string; milestones: MilestoneRow[] }) {
  const { run, pending, message } = useActionRunner();
  const [title, setTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const done = milestones.filter((milestone) => milestone.done).length;

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("add", () => addMilestoneAction({ projectId, title, dueDate }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) {
      setTitle("");
      setDueDate("");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Milestones"
        description={
          milestones.length ? `${done} of ${milestones.length} reached.` : "The steps you deliver in."
        }
      />
      <CardBody className="grid gap-3 text-[13px]">
        {message?.tone === "error" ? <Notice tone="error">{message.text}</Notice> : null}
        {milestones.length ? (
          <ul className="grid gap-1.5">
            {milestones.map((milestone) => (
              <li key={milestone.id} className="group flex items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={milestone.done}
                  aria-label={`Reached: ${milestone.title}`}
                  disabled={pending !== null}
                  onChange={(event) =>
                    run(milestone.id, () =>
                      setMilestoneDoneAction({
                        projectId,
                        milestoneId: milestone.id,
                        done: event.target.checked,
                      }),
                    )
                  }
                  className="size-4 accent-[var(--color-accent)]"
                />
                <span className={cn("min-w-0 flex-1 truncate", milestone.done && "text-muted line-through")}>
                  {milestone.title}
                </span>
                {milestone.due ? <span className="shrink-0 text-xs text-muted">{milestone.due}</span> : null}
                <button
                  type="button"
                  className="shrink-0 text-xs text-muted hover:text-danger"
                  aria-label={`Remove milestone ${milestone.title}`}
                  onClick={() =>
                    run(`remove-${milestone.id}`, () =>
                      removeMilestoneAction({ projectId, milestoneId: milestone.id }),
                    )
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form onSubmit={add} className="flex flex-wrap items-start gap-2 sm:flex-nowrap" noValidate>
          <div className="grid min-w-40 flex-1 gap-1">
            <label htmlFor="milestone-title" className="sr-only">
              New milestone
            </label>
            <input
              id="milestone-title"
              className={compactInputClasses}
              placeholder="New milestone"
              maxLength={160}
              value={title}
              aria-invalid={errors.title ? true : undefined}
              onChange={(event) => setTitle(event.target.value)}
            />
            {errors.title ? <p className="text-xs text-danger">{errors.title}</p> : null}
          </div>
          <label htmlFor="milestone-date" className="sr-only">
            Due date
          </label>
          <input
            id="milestone-date"
            type="date"
            className={compactInputBase}
            value={dueDate}
            onChange={(event) => setDueDate(event.target.value)}
          />
          <Button type="submit" size="sm" pending={pending === "add"}>
            Add
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export type LinkRow = { id: string; label: string; url: string; shared: boolean };

// Shows a link in the client's portal. Ticks at once, and goes back if saving fails.
function SharedToggle({
  projectId,
  link,
  run,
  busy,
}: {
  projectId: string;
  link: LinkRow;
  run: ReturnType<typeof useActionRunner>["run"];
  busy: boolean;
}) {
  const [shared, setShared] = useState(link.shared);
  const [saved, setSaved] = useState(link.shared);
  if (link.shared !== saved) {
    setSaved(link.shared);
    setShared(link.shared);
  }
  return (
    <label className="flex shrink-0 items-center gap-1.5 text-xs text-muted">
      <input
        type="checkbox"
        checked={shared}
        disabled={busy}
        onChange={async (event) => {
          const next = event.target.checked;
          setShared(next);
          const result = await run(`share-${link.id}`, () =>
            setLinkSharedAction({ projectId, linkId: link.id, shared: next }),
          );
          if (!result.ok) setShared(!next);
        }}
        className="accent-[var(--color-accent)]"
      />
      <span>
        Shared<span className="sr-only"> with the client: {link.label}</span>
      </span>
    </label>
  );
}

export function LinksCard({ projectId, links }: { projectId: string; links: LinkRow[] }) {
  const { run, pending, message } = useActionRunner();
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("add", () => addLinkAction({ projectId, label, url }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) {
      setLabel("");
      setUrl("");
    }
  }

  return (
    <Card>
      <CardHeader
        title="Links"
        description="Repository, staging, production, designs. Shared ones show in the client's portal."
      />
      <CardBody className="grid gap-3 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {links.length ? (
          <ul className="grid gap-1.5">
            {links.map((link) => (
              <li key={link.id} className="flex items-center gap-2.5">
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="min-w-0 flex-1 truncate text-accent underline-offset-2 hover:underline"
                >
                  {link.label}
                  <span className="ml-2 text-xs text-muted">{new URL(link.url).host}</span>
                </a>
                <SharedToggle
                  projectId={projectId}
                  link={link}
                  run={run}
                  busy={pending === `share-${link.id}`}
                />
                <button
                  type="button"
                  className="shrink-0 text-xs text-muted hover:text-danger"
                  aria-label={`Remove link ${link.label}`}
                  onClick={() =>
                    run(`remove-${link.id}`, () => removeLinkAction({ projectId, linkId: link.id }))
                  }
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <form
          onSubmit={add}
          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto]"
          noValidate
        >
          <div className="grid gap-1">
            <label htmlFor="link-label" className="sr-only">
              Link name
            </label>
            <input
              id="link-label"
              className={compactInputClasses}
              placeholder="Staging"
              maxLength={60}
              value={label}
              aria-invalid={errors.label ? true : undefined}
              onChange={(event) => setLabel(event.target.value)}
            />
            {errors.label ? <p className="text-xs text-danger">{errors.label}</p> : null}
          </div>
          <div className="grid gap-1">
            <label htmlFor="link-url" className="sr-only">
              Address
            </label>
            <input
              id="link-url"
              className={compactInputClasses}
              placeholder="staging.example.com"
              maxLength={500}
              value={url}
              aria-invalid={errors.url ? true : undefined}
              onChange={(event) => setUrl(event.target.value)}
            />
            {errors.url ? <p className="text-xs text-danger">{errors.url}</p> : null}
          </div>
          <Button type="submit" size="sm" pending={pending === "add"}>
            Add
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}

export function ProjectDeleteCard({ id, reference }: { id: string; reference: string }) {
  const { run, pending, message } = useActionRunner();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    const result = await run("delete", () => deleteProjectAction({ id, confirm: typed }));
    setError(result.ok ? null : (result.fieldErrors?.confirm ?? null));
  }

  return (
    <Card>
      <CardHeader title="Delete project" />
      <CardBody className="grid gap-2 text-[13px]">
        {message && !error ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {confirming ? (
          <>
            <p>
              This deletes the project with its tasks, revision rounds and tracked time. Notes in the
              client&apos;s log stay. It can&apos;t be undone.
            </p>
            <label htmlFor="project-delete-confirm" className="font-medium">
              Type {reference} to confirm
            </label>
            <input
              id="project-delete-confirm"
              className={cn(inputClasses, "max-w-xs")}
              value={typed}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "project-delete-error" : undefined}
              onChange={(event) => setTyped(event.target.value)}
            />
            {error ? (
              <p id="project-delete-error" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button size="sm" variant="danger" pending={pending === "delete"} onClick={remove}>
                Delete for good
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-muted">
              Cancelled work can stay as a cancelled project. Delete only mistakes.
            </p>
            <div>
              <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>
                Delete project…
              </Button>
            </div>
          </>
        )}
      </CardBody>
    </Card>
  );
}
