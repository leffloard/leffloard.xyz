"use client";

import { useState } from "react";

// Paying an invoice in cryptocurrency: NOWPayments' page for what's left to pay, in the same tab.
export function PayCrypto({ publicId }: { publicId: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/invoices/${publicId}/checkout`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const body = (await response.json().catch(() => ({}))) as { url?: string; error?: string };
      if (response.ok && body.url) {
        window.location.assign(body.url);
        return;
      }
      setError(body.error ?? "That didn't work. Please try again, or pay by bank transfer.");
    } catch {
      setError("That didn't work. Check your connection and try again.");
    }
    setBusy(false);
  }

  return (
    <div className="grid gap-2">
      <button
        type="button"
        onClick={pay}
        disabled={busy}
        className="inline-flex h-11 items-center justify-center rounded-full bg-accent px-5 text-sm font-medium text-accent-ink hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
      >
        {busy ? "Opening the payment page…" : "Pay in cryptocurrency"}
      </button>
      <p className="text-xs text-muted">
        On NOWPayments&apos; page you choose the coin. The payment is confirmed here automatically.
      </p>
      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
