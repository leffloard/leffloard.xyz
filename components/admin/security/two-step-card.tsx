"use client";

import { useState } from "react";
import {
  finishAuthenticatorReplacementAction,
  regenerateRecoveryCodesAction,
  startAuthenticatorReplacementAction,
} from "@/app/(admin)/admin/(shell)/security/actions";
import { AuthenticatorSecret } from "@/components/admin/authenticator-secret";
import { RecoveryCodes } from "@/components/admin/recovery-codes";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function TwoStepCard({
  email,
  totpSince,
  recoveryCodesLeft,
}: {
  email: string;
  totpSince: string;
  recoveryCodesLeft: number;
}) {
  const { run, pending, message } = useActionRunner();
  const [replacement, setReplacement] = useState<{ token: string; qrCode: string; secret: string } | null>(
    null,
  );
  const [codes, setCodes] = useState<string[] | null>(null);

  return (
    <Card>
      <CardHeader
        id="two-step"
        title="Two-step sign-in"
        description="Every password sign-in also needs a code from your authenticator app."
      />
      <CardBody className="grid gap-5">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              Authenticator app <Badge tone="success">on</Badge>
            </p>
            <p className="mt-0.5 text-xs text-muted">Set up {totpSince}</p>
          </div>
          {replacement ? null : (
            <Button
              size="sm"
              pending={pending === "replace"}
              onClick={async () => {
                const result = await run("replace", () => startAuthenticatorReplacementAction({}));
                if (result.ok) setReplacement(result.data);
              }}
            >
              Move to a new phone
            </Button>
          )}
        </div>

        {replacement ? (
          <div className="grid gap-4 rounded-lg border border-line p-4">
            <p className="text-[13px] text-muted">
              Add this key to the new app, then enter the code it shows. The old app stops working once the
              code matches.
            </p>
            <AuthenticatorSecret qrCode={replacement.qrCode} secret={replacement.secret} />
            <form
              className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end"
              onSubmit={async (event) => {
                event.preventDefault();
                const code = String(new FormData(event.currentTarget).get("code") ?? "");
                const result = await run("finish", () =>
                  finishAuthenticatorReplacementAction({ token: replacement.token, code }),
                );
                if (result.ok) setReplacement(null);
              }}
            >
              <Field
                label="Code from the new app"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
              />
              <div className="flex gap-2">
                <Button variant="ghost" onClick={() => setReplacement(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" pending={pending === "finish"}>
                  Switch
                </Button>
              </div>
            </form>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <div>
            <p className="flex items-center gap-2 text-sm font-medium">
              Recovery codes
              <Badge tone={recoveryCodesLeft <= 3 ? "warning" : "neutral"}>
                {recoveryCodesLeft} of 10 left
              </Badge>
            </p>
            <p className="mt-0.5 text-xs text-muted">
              For when the phone is lost. New codes replace all old ones.
            </p>
          </div>
          <Button
            size="sm"
            pending={pending === "codes"}
            onClick={async () => {
              const result = await run("codes", () => regenerateRecoveryCodesAction({}));
              if (result.ok) setCodes(result.data);
            }}
          >
            Create new codes
          </Button>
        </div>
        {codes ? (
          <div className="rounded-lg border border-line p-4">
            <RecoveryCodes codes={codes} account={email} />
            <Button size="sm" variant="ghost" className="mt-3" onClick={() => setCodes(null)}>
              Done
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
