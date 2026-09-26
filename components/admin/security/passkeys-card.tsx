"use client";

import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { useState } from "react";
import {
  passkeyRegistrationOptionsAction,
  registerPasskeyAction,
  removePasskeyAction,
  renamePasskeyAction,
} from "@/app/(admin)/admin/(shell)/security/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { fail } from "@/lib/action-result";

export type PasskeyRow = {
  id: string;
  name: string;
  added: string;
  lastUsed: string | null;
  synced: boolean;
};

export function PasskeysCard({ passkeys }: { passkeys: PasskeyRow[] }) {
  const { run, pending, message, setMessage } = useActionRunner();
  const [editing, setEditing] = useState<string | null>(null);

  async function add() {
    if (!browserSupportsWebAuthn()) {
      setMessage({ tone: "error", text: "This browser does not support passkeys." });
      return;
    }
    await run("add", async () => {
      const options = await passkeyRegistrationOptionsAction({});
      if (!options.ok) return options;
      try {
        const response = await startRegistration({ optionsJSON: options.data.options });
        return registerPasskeyAction({ token: options.data.token, response });
      } catch {
        return fail("The passkey prompt was closed or timed out.");
      }
    });
  }

  return (
    <Card>
      <CardHeader
        id="passkeys"
        title="Passkeys"
        description="Sign in with Windows Hello, Touch ID, your phone or a security key. A passkey keeps working even while password sign-in is locked."
        action={
          <Button size="sm" variant="primary" pending={pending === "add"} onClick={add}>
            Add a passkey
          </Button>
        }
      />
      <CardBody className="grid gap-3">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {passkeys.length === 0 ? (
          <p className="text-[13px] text-muted">No passkeys yet.</p>
        ) : (
          <ul className="divide-y divide-line" aria-labelledby="passkeys">
            {passkeys.map((passkey) => (
              <li
                key={passkey.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
              >
                {editing === passkey.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={async (event) => {
                      event.preventDefault();
                      const name = String(new FormData(event.currentTarget).get("name") ?? "");
                      const result = await run(passkey.id, () =>
                        renamePasskeyAction({ id: passkey.id, name }),
                      );
                      if (result.ok) setEditing(null);
                    }}
                  >
                    <label className="sr-only" htmlFor={`name-${passkey.id}`}>
                      Passkey name
                    </label>
                    <input
                      id={`name-${passkey.id}`}
                      name="name"
                      defaultValue={passkey.name}
                      maxLength={60}
                      className={inputClasses}
                      autoFocus
                    />
                    <Button type="submit" size="sm" pending={pending === passkey.id}>
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-sm font-medium">
                        {passkey.name}
                        {passkey.synced ? <Badge>synced</Badge> : null}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">
                        Added {passkey.added} ·{" "}
                        {passkey.lastUsed ? `last used ${passkey.lastUsed}` : "not used yet"}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(passkey.id)}>
                        Rename
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        pending={pending === `remove-${passkey.id}`}
                        onClick={() => {
                          if (confirm(`Remove "${passkey.name}"? It will no longer sign you in.`)) {
                            void run(`remove-${passkey.id}`, () => removePasskeyAction({ id: passkey.id }));
                          }
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}
