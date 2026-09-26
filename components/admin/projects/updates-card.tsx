"use client";

import { useState } from "react";
import {
  deleteProjectUpdateAction,
  postProjectUpdateAction,
} from "@/app/(admin)/admin/(shell)/projects/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export type UpdateRow = { id: string; body: string; when: string; emailed: boolean };

// News for the client on their project: shown in their portal, and emailed if you like.
export function ProjectUpdatesCard({
  projectId,
  updates,
  portalOn,
}: {
  projectId: string;
  updates: UpdateRow[];
  portalOn: boolean;
}) {
  const { run, pending, message } = useActionRunner();
  const [body, setBody] = useState("");
  const [email, setEmail] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function post(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("post", () => postProjectUpdateAction({ projectId, body, email }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setBody("");
  }

  return (
    <Card>
      <CardHeader
        title="Updates for the client"
        description={
          portalOn
            ? "Shown in the client's portal."
            : "The client's portal is off: they see updates once you invite them (from the client's page)."
        }
      />
      <CardBody className="grid gap-4 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <form onSubmit={post} className="grid gap-3" noValidate>
          <FormRow id="update-body" label="What's new" error={errors.body}>
            <textarea
              {...controlProps("update-body", errors.body)}
              className={textareaClasses}
              rows={3}
              maxLength={4000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
          </FormRow>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={email}
              onChange={(event) => setEmail(event.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Email it to the client too
          </label>
          <div>
            <Button type="submit" size="sm" variant="primary" pending={pending === "post"}>
              Post the update
            </Button>
          </div>
        </form>
        {updates.length ? (
          <ol className="grid gap-3">
            {updates.map((update) => (
              <li key={update.id} className="grid gap-1 border-l-2 border-line pl-3">
                <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  {update.when}
                  {update.emailed ? <Badge>emailed</Badge> : null}
                  <button
                    type="button"
                    className="ml-auto text-muted hover:text-danger"
                    onClick={() =>
                      run(`delete-${update.id}`, () =>
                        deleteProjectUpdateAction({ projectId, id: update.id }),
                      )
                    }
                  >
                    Remove
                  </button>
                </p>
                <p className="whitespace-pre-wrap">{update.body}</p>
              </li>
            ))}
          </ol>
        ) : null}
      </CardBody>
    </Card>
  );
}
