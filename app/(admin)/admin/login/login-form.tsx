"use client";

import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { PasskeyButton } from "@/components/admin/passkey-button";
import { Turnstile } from "@/components/ui/turnstile";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { passkeyLoginAction, passkeyLoginOptionsAction, passwordLoginAction } from "./actions";

export function LoginForm({ turnstileSiteKey, nonce }: { turnstileSiteKey?: string; nonce?: string }) {
  const [state, formAction, pending] = useActionState(passwordLoginAction, null);
  const router = useRouter();
  return (
    <div className="grid gap-5">
      <form action={formAction} className="grid gap-4" noValidate>
        {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="username webauthn"
          required
          defaultValue={state?.email}
          autoFocus
        />
        <Field label="Password" name="password" type="password" autoComplete="current-password" required />
        {turnstileSiteKey ? (
          <Turnstile siteKey={turnstileSiteKey} action="login" nonce={nonce} resetKey={state} />
        ) : null}
        <Button type="submit" variant="primary" pending={pending}>
          Continue
        </Button>
      </form>
      <div className="flex items-center gap-3 text-xs text-muted" aria-hidden>
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>
      <PasskeyButton
        getOptions={passkeyLoginOptionsAction}
        verify={passkeyLoginAction}
        onSuccess={() => router.replace("/admin")}
      >
        Sign in with a passkey
      </PasskeyButton>
    </div>
  );
}
