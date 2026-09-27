"use client";

import { useState } from "react";
import { changePasswordAction } from "@/app/(admin)/admin/(shell)/security/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function PasswordCard({ changed }: { changed: string }) {
  const { run, pending, message } = useActionRunner();
  const [open, setOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  return (
    <Card>
      <CardHeader
        id="password"
        title="Password"
        description={`Last changed ${changed}. Changing it signs out every other device.`}
        action={
          open ? null : (
            <Button size="sm" onClick={() => setOpen(true)}>
              Change password
            </Button>
          )
        }
      />
      {open || message ? (
        <CardBody className="grid gap-4">
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          {open ? (
            <form
              className="grid max-w-md gap-4"
              noValidate
              onSubmit={async (event) => {
                event.preventDefault();
                const form = event.currentTarget;
                const fields = Object.fromEntries(new FormData(form));
                const result = await run("password", () => changePasswordAction(fields));
                setFieldErrors(result.ok ? {} : (result.fieldErrors ?? {}));
                if (result.ok) {
                  form.reset();
                  setOpen(false);
                }
              }}
            >
              <Field
                label="Current password"
                name="current"
                type="password"
                autoComplete="current-password"
                required
                error={fieldErrors.current}
              />
              <Field
                label="New password"
                name="next"
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                hint="At least 12 characters. A few random words work well."
                error={fieldErrors.next}
              />
              <Field
                label="New password again"
                name="confirm"
                type="password"
                autoComplete="new-password"
                required
                error={fieldErrors.confirm}
              />
              <div className="flex gap-2">
                <Button type="submit" variant="primary" pending={pending === "password"}>
                  Change password
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </form>
          ) : null}
        </CardBody>
      ) : null}
    </Card>
  );
}
