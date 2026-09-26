"use client";

import {
  browserSupportsWebAuthn,
  startAuthentication,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import type { ActionResult } from "@/lib/action-result";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";

// Runs a passkey check: ask the server for a challenge, let the browser sign it, send the answer back.
export function PasskeyButton({
  getOptions,
  verify,
  onSuccess,
  children,
  variant = "secondary",
}: {
  getOptions: () => Promise<ActionResult<PublicKeyCredentialRequestOptionsJSON>>;
  verify: (response: AuthenticationResponseJSON) => Promise<ActionResult<unknown>>;
  onSuccess: () => void;
  children: ReactNode;
  variant?: "primary" | "secondary";
}) {
  // Assumed supported while rendering on the server, checked for real in the browser.
  const supported = useSyncExternalStore(noSubscription, browserSupportsWebAuthn, () => true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setError(null);
    setPending(true);
    try {
      const options = await getOptions();
      if (!options.ok) return setError(options.error);
      let response: AuthenticationResponseJSON;
      try {
        response = await startAuthentication({ optionsJSON: options.data });
      } catch {
        return setError("The passkey prompt was closed or timed out.");
      }
      const result = await verify(response);
      if (!result.ok) return setError(result.error);
      onSuccess();
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="grid gap-3">
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button variant={variant} onClick={run} pending={pending} disabled={!supported}>
        <KeyIcon />
        {supported ? children : "Passkeys are not supported in this browser"}
      </Button>
    </div>
  );
}

function noSubscription() {
  return () => {};
}

function KeyIcon() {
  return (
    <svg
      viewBox="0 0 20 20"
      className="size-4"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
    >
      <circle cx="7" cy="10" r="3.5" />
      <path d="M10.5 10H17m-2 0v2.5M13 10v1.8" strokeLinecap="round" />
    </svg>
  );
}
