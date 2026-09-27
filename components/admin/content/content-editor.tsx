"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  createContentAction,
  deleteContentAction,
  publishContentAction,
  restoreVersionAction,
  saveContentAction,
  scheduleContentAction,
  unpublishContentAction,
} from "@/app/(admin)/admin/(shell)/content/actions";
import { ContentAssistant } from "@/components/admin/ai/content-assistant";
import { ContentFields, type WorkOption } from "@/components/admin/content/content-form";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { compactInputBase } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { CONTENT_FIELDS, withoutEmptyLines } from "@/lib/content/fields";
import type { LeakFinding } from "@/lib/content/leaks";
import { isListKind, type ContentKind } from "@/lib/content/schemas";

export type EditorStatus = "new" | "draft" | "published" | "changed" | "scheduled";

export type VersionRow = { id: string; label: string; publishedAt: string; replacedAt: string };

const STATUS: Record<EditorStatus, { label: string; tone: "neutral" | "success" | "warning" | "accent" }> = {
  new: { label: "New", tone: "neutral" },
  draft: { label: "Draft, not on the site", tone: "neutral" },
  published: { label: "Published", tone: "success" },
  changed: { label: "Changes not published", tone: "warning" },
  scheduled: { label: "Scheduled", tone: "accent" },
};

type Props = {
  kind: ContentKind;
  id: string | null;
  version: number;
  initial: Record<string, unknown>;
  status: EditorStatus;
  publishedAt: string | null;
  publishAt: string | null;
  previewPath: string | null;
  livePath: string | null;
  workOptions: WorkOption[];
  versions: VersionRow[];
  aiDisabledReason: string | null;
};

export function ContentEditor(props: Props) {
  const { kind, id, status, previewPath, livePath } = props;
  const router = useRouter();
  const fields = CONTENT_FIELDS[kind];
  const [value, setValue] = useState(props.initial);
  const [savedValue, setSavedValue] = useState(JSON.stringify(props.initial));
  const [version, setVersion] = useState(props.version);
  const [seenVersion, setSeenVersion] = useState(props.version);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [findings, setFindings] = useState<LeakFinding[]>([]);
  const [scheduleAt, setScheduleAt] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { run, pending, message, setMessage } = useActionRunner();
  const dirty = JSON.stringify(value) !== savedValue;

  // A newer draft from the server (a version brought back): shown when nothing here is unsaved.
  if (props.version !== seenVersion) {
    setSeenVersion(props.version);
    if (props.version > version && !dirty) {
      setValue(props.initial);
      setSavedValue(JSON.stringify(props.initial));
      setVersion(props.version);
    }
  }

  async function save(): Promise<number | null> {
    setFindings([]);
    const data = withoutEmptyLines(value, fields);
    if (!id) {
      if (!isListKind(kind)) return null;
      const result = await run("save", () => createContentAction({ kind, data }));
      if (!result.ok) setErrors(result.fieldErrors ?? {});
      return null; // on success the action opens the new item's page
    }
    const result = await run("save", () => saveContentAction({ kind, id, version, data }));
    if (!result.ok) {
      setErrors(result.fieldErrors ?? {});
      return null;
    }
    setErrors({});
    setValue(data as Record<string, unknown>);
    setSavedValue(JSON.stringify(data));
    setVersion(result.data.version);
    setSeenVersion(result.data.version);
    return result.data.version;
  }

  async function publish() {
    if (!id) return;
    const at = dirty ? await save() : version;
    if (at === null) return;
    const result = await run("publish", () => publishContentAction({ id, version: at }));
    if (result.ok && !result.data.published) {
      setFindings(result.data.findings);
      setMessage({
        tone: "error",
        text: "Not published: the leak check found something. Edit it and try again.",
      });
    } else if (result.ok) {
      setFindings([]);
      router.refresh();
    }
  }

  async function schedule(at: string) {
    if (!id) return;
    const current = dirty ? await save() : version;
    if (current === null) return;
    const result = await run("schedule", () => scheduleContentAction({ id, version: current, at }));
    if (!result.ok) setErrors(result.fieldErrors ?? {});
    else if (!result.data.published) {
      setFindings(result.data.findings);
      setMessage({
        tone: "error",
        text: "Not scheduled: the leak check found something. Edit it and try again.",
      });
    } else router.refresh();
  }

  async function restore(versionId: string) {
    if (!id) return;
    const result = await run(`restore-${versionId}`, () => restoreVersionAction({ id, versionId, version }));
    if (result.ok) router.refresh();
    else setErrors(result.fieldErrors ?? {});
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <form
        noValidate
        className="grid content-start gap-6"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <Card>
          <CardBody className="grid gap-5">
            {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
            {findings.length ? (
              <Notice tone="error">
                <p className="font-medium">The leak check found:</p>
                <ul className="mt-1 list-disc pl-5">
                  {findings.map((finding) => (
                    <li key={`${finding.rule}-${finding.excerpt}`}>
                      {finding.label}: <code>{finding.excerpt}</code>
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {errors.form ? <Notice tone="error">{errors.form}</Notice> : null}
            <ContentFields
              fields={fields}
              value={value}
              onChange={setValue}
              errors={errors}
              workOptions={props.workOptions}
            />
          </CardBody>
        </Card>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" pending={pending === "save"}>
            {id ? "Save the draft" : "Create the draft"}
          </Button>
          {dirty ? <span className="text-xs text-muted">Unsaved changes</span> : null}
        </div>
      </form>

      <aside aria-label="Publishing" className="grid content-start gap-4">
        <Card>
          <CardHeader title="Publishing" />
          <CardBody className="grid gap-3 text-[13px]">
            <p>
              <Badge tone={STATUS[status].tone}>{STATUS[status].label}</Badge>
            </p>
            {props.publishedAt ? <p className="text-muted">Last published {props.publishedAt}.</p> : null}
            {props.publishAt ? <p>Goes live {props.publishAt}.</p> : null}
            {id ? (
              <>
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" size="sm" pending={pending === "publish"} onClick={publish}>
                    {dirty ? "Save and publish" : "Publish"}
                  </Button>
                  {previewPath ? (
                    <form method="post" action="/admin/preview" target="_blank">
                      <input type="hidden" name="to" value={previewPath} />
                      <Button type="submit" size="sm" disabled={dirty}>
                        Preview
                      </Button>
                    </form>
                  ) : null}
                </div>
                {dirty && previewPath ? (
                  <p className="text-xs text-muted">Save the draft to preview it.</p>
                ) : null}
                {livePath ? (
                  <a href={livePath} target="_blank" rel="noopener" className="text-accent hover:underline">
                    See it on the site
                  </a>
                ) : null}
                <div className="grid gap-1.5 border-t border-line pt-3">
                  <label htmlFor="content-schedule" className="font-medium">
                    Publish later (Istanbul time)
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <input
                      id="content-schedule"
                      type="datetime-local"
                      className={compactInputBase}
                      value={scheduleAt}
                      aria-invalid={errors.at ? true : undefined}
                      aria-describedby={errors.at ? "content-schedule-error" : undefined}
                      onChange={(event) => setScheduleAt(event.target.value)}
                    />
                    <Button size="sm" pending={pending === "schedule"} onClick={() => schedule(scheduleAt)}>
                      Schedule
                    </Button>
                  </div>
                  {errors.at ? (
                    <p id="content-schedule-error" className="text-xs text-danger">
                      {errors.at}
                    </p>
                  ) : null}
                  {props.publishAt ? (
                    <Button size="sm" variant="ghost" onClick={() => schedule("")}>
                      Cancel the schedule
                    </Button>
                  ) : null}
                </div>
                {isListKind(kind) && (status === "published" || status === "changed") ? (
                  <div className="border-t border-line pt-3">
                    <Button
                      size="sm"
                      variant="ghost"
                      pending={pending === "unpublish"}
                      onClick={() => run("unpublish", () => unpublishContentAction({ id }))}
                    >
                      Take it off the site
                    </Button>
                  </div>
                ) : null}
                {isListKind(kind) ? (
                  <div className="border-t border-line pt-3">
                    {confirmDelete ? (
                      <div className="grid gap-2">
                        <p>Delete it, with its versions? This can&apos;t be undone.</p>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="danger"
                            pending={pending === "delete"}
                            onClick={() => run("delete", () => deleteContentAction({ id, kind }))}
                          >
                            Yes, delete it
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                            Keep it
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                        Delete
                      </Button>
                    )}
                  </div>
                ) : null}
              </>
            ) : (
              <p className="text-muted">
                Create the draft first; it stays off the site until you publish it.
              </p>
            )}
          </CardBody>
        </Card>
        <ContentAssistant
          kind={kind}
          id={id}
          value={value}
          onReplace={(field, text) => setValue((current) => ({ ...current, [field]: text }))}
          disabledReason={props.aiDisabledReason}
        />
        {id ? (
          <Card>
            <CardHeader title="Earlier versions" description="Copies that were on the site before." />
            <CardBody className="text-[13px]">
              {props.versions.length ? (
                <ul className="grid gap-2">
                  {props.versions.map((row) => (
                    <li key={row.id} className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        <span className="block">{row.label}</span>
                        <span className="text-xs text-muted">
                          {row.publishedAt} to {row.replacedAt}
                        </span>
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        pending={pending === `restore-${row.id}`}
                        disabled={dirty}
                        onClick={() => restore(row.id)}
                      >
                        Bring back
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted">None yet. Each publication keeps the copy it replaces.</p>
              )}
            </CardBody>
          </Card>
        ) : null}
      </aside>
    </div>
  );
}
