"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { card, portalInput, primaryButton } from "@/components/site/portal/styles";
import { formatMoney, type Money } from "@/lib/money";

// Asks for a revision round. A round beyond the included ones shows its price and needs a tick first. The
// server checks the count and the price again when it saves, so an out-of-date page can't slip one through:
// it answers with the price as it is now, and the form asks again.
export function RevisionForm({
  projectId,
  billable,
  extraPrice,
}: {
  projectId: string;
  billable: boolean; // the next round is beyond the included ones
  extraPrice: Money | null; // the price of a round beyond them
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [agreed, setAgreed] = useState(false);
  // Beyond the included rounds as the page says, or as the server found when it was sent; and its price.
  const [serverSaysExtra, setServerSaysExtra] = useState(false);
  const [price, setPrice] = useState<Money | null>(extraPrice);
  const mustAgree = billable || serverSaysExtra;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (mustAgree && !agreed) {
      setErrors({ chargeAgreed: "Tick the box to agree to the price of this round." });
      return;
    }
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/portal/revisions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId, title, details, chargeAgreed: agreed, agreedPrice: price }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        number?: number;
        error?: string;
        code?: string;
        price?: Money | null;
        errors?: Record<string, string>;
      };
      if (response.ok) {
        setSent(`Round ${body.number} is asked for. I'll get back to you on it.`);
        setTitle("");
        setDetails("");
        setAgreed(false);
        setErrors({});
        router.refresh();
      } else if (body.code === "charge") {
        // Agree again, to the price as it is now.
        setServerSaysExtra(true);
        setPrice(body.price ?? null);
        setAgreed(false);
        setNotice(body.error ?? "This round costs extra.");
      } else {
        setErrors(body.errors ?? {});
        setNotice(body.error ?? "That didn't go through. Please try again.");
      }
    } catch {
      setNotice("That didn't go through. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={send} noValidate className={`${card} grid gap-4`}>
      <h3 className="text-lg font-semibold tracking-tight">Ask for a revision</h3>
      {sent ? (
        <p role="status" className="text-sm text-success">
          {sent}
        </p>
      ) : null}
      {notice ? (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/[0.07] px-4 py-3 text-sm">
          {notice}
        </p>
      ) : null}
      <div className="grid gap-2">
        <label htmlFor="revision-title" className="text-sm font-medium">
          What should change?
        </label>
        <input
          id="revision-title"
          className={`${portalInput} h-12`}
          maxLength={120}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? "revision-title-error" : undefined}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        {errors.title ? (
          <p id="revision-title-error" className="text-sm text-danger">
            {errors.title}
          </p>
        ) : null}
      </div>
      <div className="grid gap-2">
        <label htmlFor="revision-details" className="text-sm font-medium">
          Details (optional)
        </label>
        <textarea
          id="revision-details"
          rows={4}
          maxLength={4000}
          className={`${portalInput} py-3 leading-7`}
          value={details}
          onChange={(event) => setDetails(event.target.value)}
        />
      </div>
      {mustAgree ? (
        <div className="grid gap-1">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              aria-describedby={errors.chargeAgreed ? "revision-charge-error" : undefined}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span>
              This round is beyond the ones included in the price
              {price ? `: I agree to pay ${formatMoney(price)} for it` : ": I agree to pay for it"}.
            </span>
          </label>
          {errors.chargeAgreed ? (
            <p id="revision-charge-error" className="text-sm text-danger">
              {errors.chargeAgreed}
            </p>
          ) : null}
        </div>
      ) : null}
      <div>
        <button type="submit" disabled={sending} className={primaryButton}>
          {sending ? "Sending…" : "Send the request"}
        </button>
      </div>
    </form>
  );
}
