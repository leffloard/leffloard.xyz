"use client";

import { useRef, useState } from "react";
import { cn } from "@/components/ui/cn";

// Accepting (or declining) a quote from its link. The version the client read goes with the answer, so a
// quote changed in the meantime is never accepted unseen.

const field =
  "w-full rounded-xl border border-line-strong bg-canvas px-4 text-base text-ink focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none aria-invalid:border-danger";
const button =
  "inline-flex h-11 items-center rounded-full px-5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

type Done = { kind: "accepted"; invoiceUrl: string | null } | { kind: "declined" };

export function QuoteAnswer({
  publicId,
  version,
  name: suggested,
}: {
  publicId: string;
  version: number;
  name: string;
}) {
  const [mode, setMode] = useState<"accept" | "decline">("accept");
  const [name, setName] = useState(suggested);
  const [agree, setAgree] = useState(false);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const status = useRef<HTMLDivElement>(null);

  async function send(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/quotes/${publicId}/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(mode === "accept" ? { version, name, agree } : { version, reason }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        errors?: Record<string, string>;
        invoiceUrl?: string | null;
      };
      if (response.ok) {
        setDone(
          mode === "accept"
            ? { kind: "accepted", invoiceUrl: body.invoiceUrl ?? null }
            : { kind: "declined" },
        );
        requestAnimationFrame(() => status.current?.focus());
        return;
      }
      setErrors(body.errors ?? {});
      setNotice(body.error ?? "That didn't go through. Please try again.");
    } catch {
      setNotice("That didn't go through. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <div
        ref={status}
        tabIndex={-1}
        role="status"
        className="rounded-3xl border border-line bg-surface p-6 outline-none"
      >
        {done.kind === "accepted" ? (
          <>
            <p className="text-lg font-semibold tracking-tight">Accepted. Thank you!</p>
            <p className="mt-2 text-muted">
              The work is on its way. The first payment is ready, with the ways to pay; you&apos;ll get it by
              email too.
            </p>
            {done.invoiceUrl ? (
              <a
                href={done.invoiceUrl}
                className={cn(button, "mt-5 bg-accent text-accent-ink hover:bg-accent-hover")}
              >
                See the first payment
              </a>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-lg font-semibold tracking-tight">Declined.</p>
            <p className="mt-2 text-muted">
              Thanks for letting me know. If anything changes, just reply to the email.
            </p>
          </>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={send} noValidate className="grid gap-4 rounded-3xl border border-line bg-surface p-6">
      {notice ? (
        <p role="alert" className="rounded-xl border border-danger/40 bg-danger/[0.07] px-4 py-3 text-sm">
          {notice}{" "}
          {errors.form || notice.includes("Reload") ? (
            <a href="" className="underline underline-offset-4">
              Reload
            </a>
          ) : null}
        </p>
      ) : null}
      {mode === "accept" ? (
        <>
          <h2 className="text-lg font-semibold tracking-tight">Accept the quote</h2>
          <div className="grid gap-2">
            <label htmlFor="answer-name" className="text-sm font-medium">
              Your name
            </label>
            <input
              id="answer-name"
              autoComplete="name"
              maxLength={100}
              value={name}
              onChange={(event) => setName(event.target.value)}
              aria-invalid={errors.name ? true : undefined}
              aria-describedby={errors.name ? "answer-name-error" : undefined}
              className={cn(field, "h-12")}
            />
            {errors.name ? (
              <p id="answer-name-error" className="text-sm text-danger">
                {errors.name}
              </p>
            ) : null}
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={agree}
              onChange={(event) => setAgree(event.target.checked)}
              aria-invalid={errors.agree ? true : undefined}
              aria-describedby={errors.agree ? "answer-agree-error" : undefined}
              className="mt-1 accent-[var(--color-accent)]"
            />
            <span>I accept this quote: the work, the price and the payments as written here.</span>
          </label>
          {errors.agree ? (
            <p id="answer-agree-error" className="text-sm text-danger">
              {errors.agree}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={sending}
              className={cn(button, "bg-accent text-accent-ink hover:bg-accent-hover")}
            >
              {sending ? "Accepting…" : "Accept the quote"}
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("decline");
                setNotice(null);
                setErrors({});
              }}
              className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Not for you? Decline it
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 className="text-lg font-semibold tracking-tight">Decline the quote</h2>
          <div className="grid gap-2">
            <label htmlFor="answer-reason" className="text-sm font-medium">
              Anything I should know? <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="answer-reason"
              rows={3}
              maxLength={1000}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={cn(field, "py-3 leading-7")}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="submit"
              disabled={sending}
              className={cn(button, "border border-line-strong hover:border-ink/40")}
            >
              {sending ? "Sending…" : "Decline the quote"}
            </button>
            <button
              type="button"
              onClick={() => setMode("accept")}
              className="text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
            >
              Back
            </button>
          </div>
        </>
      )}
    </form>
  );
}
