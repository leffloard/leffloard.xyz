"use client";

import { useEffect, useRef, useState } from "react";
import { dayLabel, SlotPicker, timeLabel, ZoneSelect } from "@/components/site/booking/slot-picker";
import { cn } from "@/components/ui/cn";
import { Turnstile } from "@/components/ui/turnstile";
import { BOOKING_LIMITS, parseBookingForm, type BookingAnswerRule } from "@/lib/booking/form";
import { isTimeZone, timeZoneNames, wallDateTime } from "@/lib/intake/time";

// Booking a call: pick a time in your own time zone, add your details, done. The same rules as the server
// run here first; a time taken meanwhile brings back the fresh list.

export type BookingTypeView = {
  slug: string;
  linkKey: string | null; // a secret type's key, sent back with the booking
  title: string;
  durationMinutes: number;
  requiresApproval: boolean;
  questions: BookingAnswerRule[];
};

type Done = { status: "confirmed" | "requested"; manageUrl: string | null; start: string; location: string };

// Problems with the time or the time zone belong to the first step, which has no fields to show them under.
const TIME_FIELDS = ["start", "timeZone"];

const inputClass = cn(
  "w-full rounded-xl border border-line-strong bg-canvas px-4 text-base text-ink transition-colors",
  "placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none",
  "aria-invalid:border-danger disabled:opacity-60",
);

function newKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random()}`;
}

export function BookingFlow({
  type,
  initialSlots,
  ownerZone,
  ownerEmail,
  turnstileSiteKey,
}: {
  type: BookingTypeView;
  initialSlots: string[];
  ownerZone: string;
  ownerEmail: string;
  turnstileSiteKey?: string;
}) {
  const [slots, setSlots] = useState(initialSlots);
  const [zone, setZone] = useState<string | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [step, setStep] = useState<"time" | "details">("time");
  const [values, setValues] = useState({ name: "", email: "", notes: "" });
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  const [key, setKey] = useState("");
  const [attempt, setAttempt] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);

  // The visitor's own time zone is only known in the browser.
  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const names = timeZoneNames();
    const usable = detected && isTimeZone(detected) ? detected : ownerZone;
    if (!names.includes(usable)) names.unshift(usable);
    /* eslint-disable react-hooks/set-state-in-effect -- reading the browser once after hydration */
    setZones(names);
    setZone(usable);
    setKey(newKey());
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [ownerZone]);

  useEffect(() => {
    if (step === "details" || done) heading.current?.focus();
  }, [step, done]);

  function choose(next: string) {
    setSlot(next);
    setNotice(null);
    setStep("details");
  }

  function showErrors(found: Record<string, string>) {
    setErrors(found);
    const timeProblem = TIME_FIELDS.map((field) => found[field]).find(Boolean);
    if (timeProblem) {
      setNotice(timeProblem);
      setSlot(null);
      setStep("time");
      return;
    }
    const first = Object.keys(found)[0];
    if (first) document.getElementById(`booking-${first.replace(".", "-")}`)?.focus();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!slot || !zone) return;
    const payload = { start: slot, timeZone: zone, ...values, answers };
    const checked = parseBookingForm(payload, type.questions);
    if (!checked.ok) {
      showErrors(checked.errors);
      return;
    }
    const form = new FormData(event.currentTarget);
    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key || newKey() },
        body: JSON.stringify({
          ...payload,
          type: type.slug,
          ...(type.linkKey ? { key: type.linkKey } : {}),
          website: form.get("website") ?? "",
          turnstileToken: form.get("turnstileToken") ?? "",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<Done> & {
        error?: string;
        errors?: Record<string, string>;
        slots?: string[];
      };
      if (response.status === 201 && body.start) {
        setDone({
          status: body.status === "requested" ? "requested" : "confirmed",
          manageUrl: body.manageUrl ?? null,
          start: body.start,
          location: body.location ?? "",
        });
        return;
      }
      setAttempt((count) => count + 1); // a bot-check token is good for one try
      setKey(newKey());
      if (response.status === 422 && body.errors) {
        showErrors(body.errors);
        return;
      }
      if (response.status === 409 && body.slots) {
        setSlots(body.slots);
        setSlot(null);
        setStep("time");
      }
      setNotice(body.error ?? "The booking didn't go through. Please try again.");
    } catch {
      setNotice("The booking didn't go through. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  }

  if (!zone) {
    return (
      <div
        aria-busy
        className="h-64 animate-pulse rounded-3xl border border-line bg-surface motion-reduce:animate-none"
      />
    );
  }

  if (done) {
    const when = `${dayLabel(wallDateTime(new Date(done.start), zone).date)}, ${timeLabel(done.start, zone)}`;
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 sm:p-10">
        <p aria-hidden className="grid size-11 place-items-center rounded-full bg-success/15 text-success">
          <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </p>
        <h2 ref={heading} tabIndex={-1} className="mt-5 text-2xl font-semibold tracking-tight outline-none">
          {done.status === "confirmed" ? "Booked." : "Request sent."} {when}
        </h2>
        <p className="mt-3 max-w-xl text-muted">
          {done.status === "confirmed"
            ? `A confirmation with the calendar invite is on its way to ${values.email}.`
            : `I'll confirm by email to ${values.email}, usually within a day. The time is held for you until then.`}{" "}
          Times are in {zone.replaceAll("_", " ")}.
        </p>
        {done.location.startsWith("https://") ? (
          <p className="mt-3 text-sm text-muted">
            Join at <span className="font-mono text-ink">{done.location}</span>
          </p>
        ) : null}
        {done.manageUrl ? (
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href={`${done.manageUrl}/invite.ics`}
              className="inline-flex h-11 items-center rounded-full bg-accent px-5 text-sm font-medium text-accent-ink hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Add to calendar
            </a>
            <a
              href={done.manageUrl}
              className="inline-flex h-11 items-center rounded-full border border-line-strong px-5 text-sm font-medium hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Reschedule or cancel
            </a>
          </div>
        ) : null}
      </div>
    );
  }

  const error = (field: string) => errors[field];
  const describedBy = (field: string) =>
    errors[field] ? `booking-${field.replace(".", "-")}-error` : undefined;

  return (
    <div className="rounded-3xl border border-line bg-surface p-5 sm:p-8">
      {notice ? (
        <p
          role="alert"
          className="mb-5 rounded-xl border border-danger/40 bg-danger/[0.07] px-4 py-3 text-sm"
        >
          {notice}
        </p>
      ) : null}
      {step === "time" ? (
        <div className="grid gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Pick a time</h2>
            <ZoneSelect id="booking-zone" zone={zone} zones={zones} onChange={setZone} />
          </div>
          <SlotPicker slots={slots} zone={zone} day={day} onDay={setDay} value={slot} onChange={choose} />
        </div>
      ) : (
        <form onSubmit={submit} noValidate className="grid gap-5" aria-labelledby="booking-details-title">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2
              id="booking-details-title"
              ref={heading}
              tabIndex={-1}
              className="text-lg font-semibold tracking-tight outline-none"
            >
              {slot ? `${dayLabel(wallDateTime(new Date(slot), zone).date)}, ${timeLabel(slot, zone)}` : ""}
              <span className="ml-2 text-sm font-normal text-muted">
                {type.durationMinutes} minutes, {zone.replaceAll("_", " ")}
              </span>
            </h2>
            <button
              type="button"
              onClick={() => setStep("time")}
              className="text-sm text-accent underline-offset-4 hover:underline"
            >
              Change the time
            </button>
          </div>
          <fieldset disabled={sending} className="grid gap-5">
            <div className="grid gap-5 sm:grid-cols-2">
              {(["name", "email"] as const).map((field) => (
                <div key={field} className="grid gap-2">
                  <label htmlFor={`booking-${field}`} className="text-sm font-medium">
                    {field === "name" ? "Your name" : "Email"}
                  </label>
                  <input
                    id={`booking-${field}`}
                    type={field === "email" ? "email" : "text"}
                    autoComplete={field === "email" ? "email" : "name"}
                    maxLength={field === "email" ? 254 : BOOKING_LIMITS.name}
                    value={values[field]}
                    onChange={(event) =>
                      setValues((current) => ({ ...current, [field]: event.target.value }))
                    }
                    aria-invalid={error(field) ? true : undefined}
                    aria-describedby={describedBy(field)}
                    className={cn(inputClass, "h-12")}
                  />
                  {error(field) ? (
                    <p id={`booking-${field}-error`} className="text-sm text-danger">
                      {error(field)}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {type.questions.map((question) => {
              const field = `answers.${question.id}`;
              return (
                <div key={question.id} className="grid gap-2">
                  <label htmlFor={`booking-answers-${question.id}`} className="text-sm font-medium">
                    {question.label}
                    {question.required ? null : <span className="font-normal text-muted"> (optional)</span>}
                  </label>
                  <textarea
                    id={`booking-answers-${question.id}`}
                    rows={3}
                    maxLength={BOOKING_LIMITS.answer}
                    value={answers[question.id] ?? ""}
                    onChange={(event) =>
                      setAnswers((current) => ({ ...current, [question.id]: event.target.value }))
                    }
                    aria-invalid={error(field) ? true : undefined}
                    aria-describedby={describedBy(field)}
                    className={cn(inputClass, "py-3 leading-7")}
                  />
                  {error(field) ? (
                    <p id={`booking-answers-${question.id}-error`} className="text-sm text-danger">
                      {error(field)}
                    </p>
                  ) : null}
                </div>
              );
            })}
            <div className="grid gap-2">
              <label htmlFor="booking-notes" className="text-sm font-medium">
                Anything else? <span className="font-normal text-muted">(optional)</span>
              </label>
              <textarea
                id="booking-notes"
                rows={3}
                maxLength={BOOKING_LIMITS.notes}
                value={values.notes}
                onChange={(event) => setValues((current) => ({ ...current, notes: event.target.value }))}
                aria-invalid={error("notes") ? true : undefined}
                aria-describedby={describedBy("notes")}
                className={cn(inputClass, "py-3 leading-7")}
              />
              {error("notes") ? (
                <p id="booking-notes-error" className="text-sm text-danger">
                  {error("notes")}
                </p>
              ) : null}
            </div>
            {/* Bots fill in every field; people never see this one. */}
            <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
              <label>
                Website
                <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
              </label>
            </div>
            {turnstileSiteKey ? (
              <Turnstile siteKey={turnstileSiteKey} action="booking" theme="auto" resetKey={attempt} />
            ) : null}
            <p className="text-sm text-muted">
              Your details are used for this call only; see the{" "}
              <a href="/legal/privacy" className="text-ink underline underline-offset-4">
                privacy notice
              </a>
              . Problems? Email{" "}
              <a href={`mailto:${ownerEmail}`} className="text-ink underline underline-offset-4">
                {ownerEmail}
              </a>
              .
            </p>
            <div>
              <button
                type="submit"
                className="inline-flex h-12 items-center rounded-full bg-accent px-6 text-sm font-medium text-accent-ink hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
              >
                {sending ? "Booking…" : type.requiresApproval ? "Request this time" : "Book this time"}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  );
}
