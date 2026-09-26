"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { primaryButton } from "@/components/site/portal/styles";

// Spends the link and signs in. A button rather than the link itself, so a mail scanner that opens every link
// in an email doesn't use it up first.
export function VerifyButton({ token, label }: { token: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/portal/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (response.ok) {
        router.replace("/portal");
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      setError(body.error ?? "That didn't work. Ask for a new link.");
    } catch {
      setError("That didn't work. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-3">
      <div>
        <button type="button" onClick={signIn} disabled={busy} className={primaryButton}>
          {busy ? "Signing in…" : label}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}{" "}
          <a href="/portal/login" className="underline underline-offset-4">
            Ask for a new link
          </a>
        </p>
      ) : null}
    </div>
  );
}
