"use client";

import { useRef, useState } from "react";
import { Turnstile } from "@/components/ui/turnstile";
import { card, portalInput, primaryButton } from "@/components/site/portal/styles";

// Asks for a sign-in link by email. The answer never says whether the address has a portal.
export function SignInForm({ turnstileSiteKey, nonce }: { turnstileSiteKey?: string; nonce?: string }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const form = useRef<HTMLFormElement>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    const data = new FormData(form.current!);
    try {
      const response = await fetch("/api/portal/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          website: data.get("website") ?? "",
          turnstileToken: data.get("turnstileToken") ?? "",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
        errors?: Record<string, string>;
      };
      if (response.ok) setSent(body.message ?? "A sign-in link is on its way.");
      else setError(body.errors?.email ?? body.error ?? "That didn't go through. Please try again.");
    } catch {
      setError("That didn't go through. Check your connection and try again.");
    } finally {
      setSending(false);
      setAttempt((count) => count + 1);
    }
  }

  if (sent) {
    return (
      <div role="status" className={card}>
        <p className="text-lg font-semibold tracking-tight">Check your inbox.</p>
        <p className="mt-2 text-muted">
          {sent} It works once, within 20 minutes. Nothing there? Look in spam, or make sure it&apos;s the
          address you use with me.
        </p>
      </div>
    );
  }

  return (
    <form ref={form} onSubmit={send} noValidate className={`${card} grid gap-4`}>
      <div className="grid gap-2">
        <label htmlFor="portal-email" className="text-sm font-medium">
          Your email address
        </label>
        <input
          id="portal-email"
          type="email"
          autoComplete="email"
          required
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "portal-email-error" : undefined}
          className={`${portalInput} h-12`}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        {error ? (
          <p id="portal-email-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        ) : null}
      </div>
      {/* For bots only: people never see it. */}
      <div aria-hidden className="hidden">
        <label htmlFor="portal-website">Website</label>
        <input id="portal-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {turnstileSiteKey ? (
        <Turnstile siteKey={turnstileSiteKey} action="portal" nonce={nonce} theme="auto" resetKey={attempt} />
      ) : null}
      <div>
        <button type="submit" disabled={sending} className={primaryButton}>
          {sending ? "Sending…" : "Email me a sign-in link"}
        </button>
      </div>
    </form>
  );
}
