"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  confirmSudoAction,
  confirmSudoWithPasskeyAction,
  sudoPasskeyOptionsAction,
} from "@/app/(admin)/admin/(shell)/actions";
import type { ActionResult } from "@/lib/action-result";
import { PasskeyButton } from "@/components/admin/passkey-button";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

// Sensitive actions answer "sudo_required" when the last confirmation is older than 10 minutes. withSudo()
// then asks for the password and a code (or a passkey) and runs the action again.

type WithSudo = <T>(run: () => Promise<ActionResult<T>>) => Promise<ActionResult<T>>;

const SudoContext = createContext<WithSudo | null>(null);

export function useSudo(): WithSudo {
  const context = useContext(SudoContext);
  if (!context) throw new Error("useSudo() must be used inside <SudoProvider>.");
  return context;
}

export function SudoProvider({ children, hasPasskeys }: { children: ReactNode; hasPasskeys: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const waiting = useRef<((confirmed: boolean) => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const finish = useCallback((confirmed: boolean) => {
    const resolve = waiting.current;
    waiting.current = null;
    if (dialog.current?.open) dialog.current.close();
    resolve?.(confirmed);
  }, []);

  const withSudo = useCallback<WithSudo>(async (run) => {
    const first = await run();
    if (first.ok || first.code !== "sudo_required") return first;
    setError(null);
    const confirmed = await new Promise<boolean>((resolve) => {
      waiting.current = resolve;
      dialog.current?.showModal();
    });
    return confirmed ? run() : first;
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPending(true);
    const result = await confirmSudoAction({ password: form.get("password"), code: form.get("code") });
    setPending(false);
    if (result.ok) {
      formElement.reset();
      finish(true);
    } else {
      setError(result.error);
    }
  }

  return (
    <SudoContext value={withSudo}>
      {children}
      <dialog
        ref={dialog}
        aria-labelledby="sudo-title"
        onClose={() => finish(false)}
        className="m-auto w-[min(400px,calc(100vw-2rem))] rounded-xl border border-line bg-surface p-6 text-ink shadow-2xl shadow-black/60 backdrop:bg-black/60 backdrop:backdrop-blur-sm"
      >
        <h2 id="sudo-title" className="text-lg font-semibold tracking-tight">
          Confirm it&apos;s you
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          This change needs a fresh check. It stays valid for 10 minutes.
        </p>
        <form onSubmit={submit} className="mt-5 grid gap-4" noValidate>
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Field label="Password" name="password" type="password" autoComplete="current-password" required />
          <Field
            label="Authenticator code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="[&_input]:font-mono [&_input]:tracking-[0.3em]"
            required
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => finish(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" pending={pending}>
              Confirm
            </Button>
          </div>
        </form>
        {hasPasskeys ? (
          <div className="mt-4 border-t border-line pt-4">
            <PasskeyButton
              getOptions={() => sudoPasskeyOptionsAction({})}
              verify={(response) => confirmSudoWithPasskeyAction(response)}
              onSuccess={() => finish(true)}
            >
              Use a passkey instead
            </PasskeyButton>
          </div>
        ) : null}
      </dialog>
    </SudoContext>
  );
}
