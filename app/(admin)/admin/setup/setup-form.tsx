"use client";

import Link from "next/link";
import { useActionState } from "react";
import { RecoveryCodes } from "@/components/admin/recovery-codes";
import { AuthenticatorSecret } from "@/components/admin/authenticator-secret";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { setupAction } from "../login/actions";

export function SetupForm({
  setup,
  email,
}: {
  setup: { qrCode: string; secret: string } | null;
  email: string;
}) {
  const [state, formAction, pending] = useActionState(setupAction, null);

  if (state && "recoveryCodes" in state && state.recoveryCodes) {
    return (
      <div className="grid gap-4">
        <Notice tone="success">Two-step sign-in is on.</Notice>
        <RecoveryCodes codes={state.recoveryCodes} account={email} />
        <Link
          href="/admin"
          className="text-center text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
        >
          Continue to the admin
        </Link>
      </div>
    );
  }

  if (!setup) {
    return (
      <div className="grid gap-4">
        <Notice tone="success">Two-step sign-in is already set up.</Notice>
        <Link href="/admin" className="text-[13px] text-accent underline-offset-4 hover:underline">
          Continue to the admin
        </Link>
      </div>
    );
  }

  if (state && "expired" in state && state.expired) {
    return (
      <div className="grid gap-4">
        <Notice tone="error">{state.error}</Notice>
        <Link href="/admin/login" className="text-[13px] text-accent underline-offset-4 hover:underline">
          Back to sign-in
        </Link>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <AuthenticatorSecret qrCode={setup.qrCode} secret={setup.secret} />
      <form action={formAction} className="grid gap-4" noValidate>
        {state && "error" in state ? <Notice tone="error">{state.error}</Notice> : null}
        <Field
          label="Code from the app"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          placeholder="123 456"
          className="[&_input]:font-mono [&_input]:tracking-[0.3em]"
          required
        />
        <Button type="submit" variant="primary" pending={pending}>
          Turn on two-step sign-in
        </Button>
      </form>
    </div>
  );
}
