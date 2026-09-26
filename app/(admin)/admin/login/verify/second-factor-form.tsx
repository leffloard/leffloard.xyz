"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { secondFactorAction } from "../actions";

export function SecondFactorForm() {
  const [state, formAction, pending] = useActionState(secondFactorAction, null);
  const [recovery, setRecovery] = useState(false);

  if (state?.expired) {
    return (
      <div className="grid gap-4">
        <Notice tone="error">{state.error}</Notice>
        <Link href="/admin/login" className={buttonClasses("primary")}>
          Back to sign-in
        </Link>
      </div>
    );
  }

  return (
    <form action={formAction} className="grid gap-4" noValidate>
      {state?.error ? <Notice tone="error">{state.error}</Notice> : null}
      {recovery ? (
        <Field
          key="recovery"
          label="Recovery code"
          name="code"
          autoComplete="off"
          spellCheck={false}
          placeholder="xxxxx-xxxxx-xxxxx"
          hint="Each recovery code works once."
          required
          autoFocus
        />
      ) : (
        <Field
          key="totp"
          label="Code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          placeholder="123 456"
          className="[&_input]:font-mono [&_input]:tracking-[0.3em]"
          required
          autoFocus
        />
      )}
      <Button type="submit" variant="primary" pending={pending}>
        Verify
      </Button>
      <button
        type="button"
        onClick={() => setRecovery((value) => !value)}
        className="justify-self-start text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline"
      >
        {recovery ? "Use the authenticator app instead" : "Lost your phone? Use a recovery code"}
      </button>
    </form>
  );
}
