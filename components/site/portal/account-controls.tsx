"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { card, portalInput, primaryButton, quietButton } from "@/components/site/portal/styles";

async function post(url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { ok: response.ok, data: (await response.json().catch(() => ({}))) as Record<string, unknown> };
}

// Signs out of this browser, or of every one (and spends any sign-in link not used yet).
export function SignOutButtons() {
  const router = useRouter();
  const [busy, setBusy] = useState<"here" | "everywhere" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function signOut(everywhere: boolean) {
    setBusy(everywhere ? "everywhere" : "here");
    try {
      const { ok } = await post("/api/portal/logout", { everywhere });
      if (ok) {
        router.replace("/portal/login");
        router.refresh();
        return;
      }
      setError("That didn't work. Please try again.");
    } catch {
      setError("That didn't work. Check your connection and try again.");
    }
    setBusy(null);
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-3">
        <button type="button" className={quietButton} disabled={busy !== null} onClick={() => signOut(false)}>
          {busy === "here" ? "Signing out…" : "Sign out"}
        </button>
        <button type="button" className={quietButton} disabled={busy !== null} onClick={() => signOut(true)}>
          {busy === "everywhere" ? "Signing out…" : "Sign out everywhere"}
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

// A copy of their data, or its deletion: a request I answer within 30 days.
export function DataRequestForm({ kind, open }: { kind: "export" | "erase"; open: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const erase = kind === "erase";

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (erase && !confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    try {
      const { ok, data } = await post("/api/portal/data-requests", { kind, note });
      setMessage(
        ok
          ? data.created
            ? "Asked. You'll hear from me within 30 days, usually much sooner."
            : "You already asked; it's on my list."
          : String(data.error ?? "That didn't go through. Please try again."),
      );
      if (ok) {
        setNote("");
        setConfirming(false);
        router.refresh();
      }
    } catch {
      setMessage("That didn't go through. Check your connection and try again.");
    }
    setBusy(false);
  }

  const id = `data-${kind}`;
  return (
    <form onSubmit={send} noValidate className={`${card} grid gap-3`}>
      <h3 className="text-lg font-semibold tracking-tight">
        {erase ? "Delete my data" : "A copy of my data"}
      </h3>
      <p className="text-sm text-muted">
        {erase
          ? "Everything I keep about you and your projects is deleted, except what tax law makes me keep (invoices and payments). Your portal closes."
          : "Everything I keep about you and your projects, as a file, by email."}
      </p>
      {open ? (
        <p className="text-sm">You asked already; it&apos;s on my list.</p>
      ) : (
        <>
          <label htmlFor={id} className="text-sm font-medium">
            A note (optional)
          </label>
          <textarea
            id={id}
            rows={2}
            maxLength={1000}
            className={`${portalInput} py-2 leading-7`}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
          {confirming ? (
            <p role="alert" className="text-sm">
              Sure? Press the button again to ask for the deletion.
            </p>
          ) : null}
          <div>
            <button type="submit" disabled={busy} className={erase ? quietButton : primaryButton}>
              {busy
                ? "Sending…"
                : erase
                  ? confirming
                    ? "Yes, delete my data"
                    : "Ask for deletion"
                  : "Ask for a copy"}
            </button>
          </div>
        </>
      )}
      {message ? (
        <p role="status" className="text-sm">
          {message}
        </p>
      ) : null}
    </form>
  );
}
