"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Turnstile } from "@/components/ui/turnstile";
import { LIMITS, parseInquiryForm, type FormErrors, type FormField } from "@/lib/intake/form";
import {
  BUDGET_OPTIONS,
  CALL_DURATIONS,
  DEFAULT_CALL_DURATION,
  MAX_DAYS_AHEAD,
  SERVICE_OPTIONS,
  TIMELINE_OPTIONS,
  type InquiryKind,
} from "@/lib/intake/options";
import { addDays, isTimeZone, timeZoneNames, todayIn } from "@/lib/intake/time";

// The contact form: a three-step project brief, or a one-step question, revision request or call request.
// The same rules as the server run here first, so mistakes show up before sending.

type Values = {
  service: string;
  subject: string;
  message: string;
  budget: string;
  timeline: string;
  links: string;
  company: string;
  projectReference: string;
  timeZone: string;
  date: string;
  time: string;
  duration: string;
  name: string;
  email: string;
  contact: string;
  aiOptOut: boolean;
};

const EMPTY: Values = {
  service: "",
  subject: "",
  message: "",
  budget: "",
  timeline: "",
  links: "",
  company: "",
  projectReference: "",
  timeZone: "",
  date: "",
  time: "",
  duration: String(DEFAULT_CALL_DURATION),
  name: "",
  email: "",
  contact: "",
  aiOptOut: false,
};

const KINDS: { value: InquiryKind; title: string; text: string }[] = [
  { value: "brief", title: "Start a project", text: "A website, bot, sign-in system or desktop app." },
  { value: "question", title: "Ask a question", text: "About pricing, timing or anything else." },
  { value: "revision", title: "Change my project", text: "For work I have delivered to you." },
  { value: "call", title: "Request a call", text: "Suggest a time; I confirm it by email." },
];

const BRIEF_STEPS: { title: string; fields: FormField[] }[] = [
  { title: "The project", fields: ["service", "subject", "message"] },
  { title: "Scope", fields: ["budget", "timeline", "links", "company"] },
  { title: "About you", fields: ["name", "email", "contact"] },
];

// ?type= in links from old pages and emails.
const TYPE_ALIASES: Record<string, InquiryKind> = {
  brief: "brief",
  project: "brief",
  question: "question",
  inquiry: "question",
  revision: "revision",
  call: "call",
  appointment: "call",
};

type Status =
  | { state: "editing" }
  | { state: "sending" }
  | { state: "sent"; name: string; email: string }
  | { state: "error"; message: string };

const inputClass = cn(
  "w-full rounded-xl border border-line-strong bg-canvas px-4 text-base text-ink transition-colors",
  "placeholder:text-muted/70 focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none",
  "aria-invalid:border-danger disabled:opacity-60",
);

function newKey(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

export function ContactForm({
  email,
  turnstileSiteKey,
  nonce,
}: {
  email: string;
  turnstileSiteKey?: string;
  nonce?: string;
}) {
  const [kind, setKind] = useState<InquiryKind>("brief");
  const [step, setStep] = useState(0);
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<Status>({ state: "editing" });
  const [zones, setZones] = useState<string[]>([]);
  const [key, setKey] = useState("");
  const [attempt, setAttempt] = useState(0);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const doneHeading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  // Browser-only details: the visitor's time zone, the zone list, and ?type= from the address.
  useEffect(() => {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const requested = TYPE_ALIASES[new URLSearchParams(window.location.search).get("type") ?? ""];
    const known = zone && isTimeZone(zone);
    const names = timeZoneNames();
    // Browsers report some zones ("UTC") that the canonical list leaves out.
    if (known && !names.includes(zone)) names.unshift(zone);
    /* eslint-disable react-hooks/set-state-in-effect -- reading the browser once after hydration */
    setZones(names);
    setKey(newKey());
    if (known) setValues((current) => ({ ...current, timeZone: current.timeZone || zone }));
    if (requested) setKind(requested);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (moved.current) stepHeading.current?.focus();
  }, [step, kind]);

  useEffect(() => {
    if (status.state === "sent") doneHeading.current?.focus();
  }, [status.state]);

  const steps = kind === "brief" ? BRIEF_STEPS : null;
  const lastStep = !steps || step === steps.length - 1;
  const sending = status.state === "sending";

  function set<K extends keyof Values>(field: K, value: Values[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    if (errors[field as FormField]) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function payload() {
    return { kind, ...values };
  }

  function focusField(field: FormField) {
    requestAnimationFrame(() => document.getElementById(`contact-${field}`)?.focus());
  }

  function chooseKind(next: InquiryKind) {
    moved.current = true;
    setKind(next);
    setStep(0);
    setErrors({});
  }

  function next() {
    if (!steps) return;
    const result = parseInquiryForm(payload(), new Date());
    const stepErrors: FormErrors = {};
    if (!result.ok) {
      for (const field of steps[step]!.fields)
        if (result.errors[field]) stepErrors[field] = result.errors[field];
    }
    const invalid = Object.keys(stepErrors) as FormField[];
    if (invalid.length) {
      setErrors(stepErrors);
      focusField(invalid[0]!);
      return;
    }
    setErrors({});
    moved.current = true;
    setStep(step + 1);
  }

  function back() {
    moved.current = true;
    setErrors({});
    setStep(Math.max(0, step - 1));
  }

  function showErrors(found: FormErrors) {
    setErrors(found);
    const fields = Object.keys(found) as FormField[];
    if (steps) {
      const index = steps.findIndex((entry) => entry.fields.some((field) => fields.includes(field)));
      if (index !== -1 && index !== step) {
        moved.current = true;
        setStep(index);
      }
    }
    if (fields[0]) focusField(fields[0]);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!lastStep) return next();
    const checked = parseInquiryForm(payload(), new Date());
    if (!checked.ok) return showErrors(checked.errors);

    const form = new FormData(event.currentTarget);
    setStatus({ state: "sending" });
    try {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": key || newKey() },
        body: JSON.stringify({
          ...payload(),
          website: form.get("website") ?? "",
          turnstileToken: form.get("turnstileToken") ?? "",
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; errors?: FormErrors };
      if (response.status === 201) {
        setStatus({ state: "sent", name: firstName(values.name), email: values.email });
        setValues((current) => ({ ...EMPTY, timeZone: current.timeZone }));
        setStep(0);
        setKey(newKey());
        return;
      }
      if (response.status === 422 && body.errors) {
        setStatus({ state: "editing" });
        return showErrors(body.errors);
      }
      setAttempt((count) => count + 1); // a used bot-check token can't be sent twice
      setStatus({
        state: "error",
        message: body.error ?? "The message could not be sent. Please try again.",
      });
    } catch {
      setStatus({
        state: "error",
        message: "The message could not be sent. Check your connection and try again.",
      });
    }
  }

  if (status.state === "sent") {
    return (
      <div className="rounded-3xl border border-line bg-surface p-6 sm:p-10">
        <p aria-hidden className="grid size-11 place-items-center rounded-full bg-success/15 text-success">
          <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </p>
        <h3
          ref={doneHeading}
          tabIndex={-1}
          className="mt-5 text-2xl font-semibold tracking-tight outline-none"
        >
          Thanks, {status.name}. Your message is in.
        </h3>
        <p className="mt-3 max-w-xl text-muted">
          I&apos;ll answer at {status.email}. If something is urgent, email me at{" "}
          <a href={`mailto:${email}`} className="text-accent underline underline-offset-4">
            {email}
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => setStatus({ state: "editing" })}
          className="mt-8 inline-flex h-11 items-center rounded-full border border-line-strong px-5 text-sm font-medium hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Send another message
        </button>
      </div>
    );
  }

  const error = (field: FormField) => errors[field];

  return (
    <form
      onSubmit={submit}
      noValidate
      aria-labelledby="contact-form-title"
      className="rounded-3xl border border-line bg-surface p-5 sm:p-8"
    >
      <h3 id="contact-form-title" className="sr-only">
        Contact form
      </h3>
      <fieldset disabled={sending}>
        <legend className="text-sm font-medium">What do you need?</legend>
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {KINDS.map((option) => (
            <label
              key={option.value}
              className={cn(
                "relative cursor-pointer rounded-2xl border border-line-strong p-4 transition-colors hover:border-ink/30",
                "has-checked:border-accent has-checked:bg-accent/[0.07] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
              )}
            >
              <input
                type="radio"
                name="kind"
                value={option.value}
                checked={kind === option.value}
                onChange={() => chooseKind(option.value)}
                className="sr-only"
              />
              <span className="block font-medium">{option.title}</span>
              <span className="mt-0.5 block text-sm text-muted">{option.text}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-8 border-t border-line pt-7">
        {steps ? (
          <div className="mb-6">
            <div className="flex items-baseline justify-between gap-3">
              <h4
                ref={stepHeading}
                tabIndex={-1}
                className="text-lg font-semibold tracking-tight outline-none"
              >
                {steps[step]!.title}
              </h4>
              <p className="font-mono text-xs text-muted">
                Step {step + 1} of {steps.length}
              </p>
            </div>
            <div aria-hidden className="mt-3 grid grid-cols-3 gap-1.5">
              {steps.map((entry, index) => (
                <span
                  key={entry.title}
                  className={cn(
                    "h-1 rounded-full transition-colors",
                    index <= step ? "bg-accent" : "bg-line-strong",
                  )}
                />
              ))}
            </div>
          </div>
        ) : (
          <h4
            ref={stepHeading}
            tabIndex={-1}
            className="mb-6 text-lg font-semibold tracking-tight outline-none"
          >
            {KINDS.find((option) => option.value === kind)!.title}
          </h4>
        )}

        <fieldset disabled={sending} className="grid gap-5">
          {kind === "brief" && step === 0 ? (
            <>
              <Choice
                field="service"
                legend="What kind of project?"
                options={SERVICE_OPTIONS}
                value={values.service}
                error={error("service")}
                onChange={(value) => set("service", value)}
              />
              <TextField
                field="subject"
                label="The project in one line"
                placeholder="A booking site for my barbershop"
                maxLength={LIMITS.subject}
                value={values.subject}
                error={error("subject")}
                onChange={(value) => set("subject", value)}
              />
              <TextArea
                field="message"
                label="What should it do, and who is it for?"
                hint="The problem it solves, the main features, anything you already have."
                maxLength={LIMITS.message}
                rows={6}
                value={values.message}
                error={error("message")}
                onChange={(value) => set("message", value)}
              />
            </>
          ) : null}

          {kind === "brief" && step === 1 ? (
            <>
              <Choice
                field="budget"
                legend="Budget"
                hint="A rough range helps me suggest the right scope. Optional."
                options={BUDGET_OPTIONS}
                value={values.budget}
                error={error("budget")}
                onChange={(value) => set("budget", value)}
              />
              <Choice
                field="timeline"
                legend="When do you need it?"
                hint="Optional."
                options={TIMELINE_OPTIONS}
                value={values.timeline}
                error={error("timeline")}
                onChange={(value) => set("timeline", value)}
              />
              <TextArea
                field="links"
                label="Links (optional)"
                hint="Your current site, examples you like, documents."
                maxLength={LIMITS.links}
                rows={3}
                value={values.links}
                error={error("links")}
                onChange={(value) => set("links", value)}
              />
              <TextField
                field="company"
                label="Company or project name (optional)"
                maxLength={LIMITS.company}
                value={values.company}
                error={error("company")}
                onChange={(value) => set("company", value)}
              />
            </>
          ) : null}

          {kind === "revision" ? (
            <TextField
              field="projectReference"
              label="Which project or order?"
              placeholder="The name or number from your invoice"
              maxLength={LIMITS.projectReference}
              value={values.projectReference}
              error={error("projectReference")}
              onChange={(value) => set("projectReference", value)}
            />
          ) : null}

          {kind !== "brief" ? (
            <>
              <TextField
                field="subject"
                label="Subject"
                maxLength={LIMITS.subject}
                value={values.subject}
                error={error("subject")}
                onChange={(value) => set("subject", value)}
              />
              <TextArea
                field="message"
                label={
                  kind === "revision"
                    ? "What should change?"
                    : kind === "call"
                      ? "What would you like to talk about?"
                      : "Your question"
                }
                maxLength={LIMITS.message}
                rows={5}
                value={values.message}
                error={error("message")}
                onChange={(value) => set("message", value)}
              />
            </>
          ) : null}

          {kind === "call" ? <CallFields values={values} zones={zones} error={error} set={set} /> : null}

          {lastStep ? (
            <>
              <div className="grid gap-5 sm:grid-cols-2">
                <TextField
                  field="name"
                  label="Your name"
                  autoComplete="name"
                  maxLength={LIMITS.name}
                  value={values.name}
                  error={error("name")}
                  onChange={(value) => set("name", value)}
                />
                <TextField
                  field="email"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  maxLength={LIMITS.email}
                  value={values.email}
                  error={error("email")}
                  onChange={(value) => set("email", value)}
                />
              </div>
              <TextField
                field="contact"
                label="Discord or Telegram (optional)"
                maxLength={LIMITS.contact}
                value={values.contact}
                error={error("contact")}
                onChange={(value) => set("contact", value)}
              />
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-4 accent-[var(--color-accent)]"
                  checked={values.aiOptOut}
                  onChange={(event) => set("aiOptOut", event.target.checked)}
                />
                <span>
                  Don&apos;t use AI tools on my message.
                  <span className="block text-muted">
                    I may use an AI assistant to sort messages and draft replies. Tick this and it never sees
                    yours.
                  </span>
                </span>
              </label>
              {/* Bots fill in every field; people never see this one. */}
              <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
                <label>
                  Website
                  <input type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" />
                </label>
              </div>
              {turnstileSiteKey ? (
                <Turnstile
                  siteKey={turnstileSiteKey}
                  action="contact"
                  theme="auto"
                  nonce={nonce}
                  resetKey={attempt}
                />
              ) : null}
              <p className="text-sm text-muted">
                Sent to me only. How I handle it is in the{" "}
                <a href="/legal/privacy" className="text-ink underline underline-offset-4">
                  privacy notice
                </a>
                .
              </p>
            </>
          ) : null}
        </fieldset>

        {status.state === "error" ? (
          <p
            role="alert"
            className="mt-5 rounded-xl border border-danger/40 bg-danger/[0.07] px-4 py-3 text-sm"
          >
            {status.message} You can also email{" "}
            <a href={`mailto:${email}`} className="underline underline-offset-4">
              {email}
            </a>
            .
          </p>
        ) : null}

        <div className="mt-7 flex flex-wrap items-center gap-3">
          {steps && step > 0 ? (
            <button
              type="button"
              onClick={back}
              disabled={sending}
              className="inline-flex h-12 items-center rounded-full border border-line-strong px-5 text-sm font-medium hover:border-ink/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              Back
            </button>
          ) : null}
          <button
            type="submit"
            disabled={sending}
            aria-busy={sending || undefined}
            className="inline-flex h-12 items-center gap-2 rounded-full bg-ink px-6 text-sm font-medium text-canvas transition-colors hover:bg-ink/85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60"
          >
            {sending ? (
              <span
                aria-hidden
                className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none"
              />
            ) : null}
            {lastStep ? (sending ? "Sending…" : "Send message") : "Continue"}
          </button>
        </div>
      </div>
    </form>
  );
}

function describedBy(field: FormField, error?: string, hint?: ReactNode): string | undefined {
  return (
    [error ? `contact-${field}-error` : null, hint ? `contact-${field}-hint` : null]
      .filter(Boolean)
      .join(" ") || undefined
  );
}

function FieldMessages({ field, error, hint }: { field: FormField; error?: string; hint?: ReactNode }) {
  return (
    <>
      {hint ? (
        <p id={`contact-${field}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`contact-${field}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : null}
    </>
  );
}

function TextField({
  field,
  label,
  value,
  onChange,
  error,
  hint,
  type = "text",
  ...rest
}: {
  field: FormField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  type?: string;
  placeholder?: string;
  maxLength?: number;
  autoComplete?: string;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={`contact-${field}`} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={`contact-${field}`}
        name={field}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(field, error, hint)}
        className={cn(inputClass, "h-12")}
        {...rest}
      />
      <FieldMessages field={field} error={error} hint={hint} />
    </div>
  );
}

function TextArea({
  field,
  label,
  value,
  onChange,
  error,
  hint,
  rows,
  maxLength,
}: {
  field: FormField;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: ReactNode;
  rows: number;
  maxLength: number;
}) {
  const length = Array.from(value).length;
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`contact-${field}`} className="text-sm font-medium">
          {label}
        </label>
        {length > maxLength * 0.8 ? (
          <span className={cn("font-mono text-xs", length > maxLength ? "text-danger" : "text-muted")}>
            {length} / {maxLength}
          </span>
        ) : null}
      </div>
      <textarea
        id={`contact-${field}`}
        name={field}
        rows={rows}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(field, error, hint)}
        className={cn(inputClass, "py-3 leading-7")}
      />
      <FieldMessages field={field} error={error} hint={hint} />
    </div>
  );
}

function Choice({
  field,
  legend,
  hint,
  options,
  value,
  error,
  onChange,
}: {
  field: FormField;
  legend: string;
  hint?: string;
  options: readonly { value: string; label: string }[];
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <fieldset className="grid gap-2" aria-describedby={describedBy(field, error, hint)}>
      <legend className="text-sm font-medium">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((option, index) => (
          <label
            key={option.value}
            className={cn(
              "cursor-pointer rounded-full border border-line-strong px-4 py-2 text-sm transition-colors hover:border-ink/30",
              "has-checked:border-accent has-checked:bg-accent/10 has-checked:text-ink has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-accent",
              error && "border-danger/60",
            )}
          >
            <input
              id={index === 0 ? `contact-${field}` : undefined}
              type="radio"
              name={field}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
      <FieldMessages field={field} error={error} hint={hint} />
    </fieldset>
  );
}

function CallFields({
  values,
  zones,
  error,
  set,
}: {
  values: Values;
  zones: string[];
  error: (field: FormField) => string | undefined;
  set: <K extends keyof Values>(field: K, value: Values[K]) => void;
}) {
  const zone = values.timeZone && isTimeZone(values.timeZone) ? values.timeZone : "UTC";
  const today = zones.length ? todayIn(zone, new Date()) : undefined;
  return (
    <>
      <div className="grid gap-2">
        <label htmlFor="contact-timeZone" className="text-sm font-medium">
          Your time zone
        </label>
        <select
          id="contact-timeZone"
          value={values.timeZone}
          onChange={(event) => set("timeZone", event.target.value)}
          aria-invalid={error("timeZone") ? true : undefined}
          aria-describedby={describedBy("timeZone", error("timeZone"))}
          className={cn(inputClass, "h-12")}
        >
          <option value="">Choose…</option>
          {zones.map((name) => (
            <option key={name} value={name}>
              {name.replaceAll("_", " ")}
            </option>
          ))}
        </select>
        <FieldMessages field="timeZone" error={error("timeZone")} />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <TextFieldDate
          field="date"
          label="Date"
          type="date"
          value={values.date}
          min={today}
          max={today ? addDays(today, MAX_DAYS_AHEAD) : undefined}
          error={error("date")}
          onChange={(value) => set("date", value)}
        />
        <TextFieldDate
          field="time"
          label="Time"
          type="time"
          value={values.time}
          error={error("time")}
          onChange={(value) => set("time", value)}
        />
      </div>
      <Choice
        field="duration"
        legend="How long?"
        options={CALL_DURATIONS.map((minutes) => ({ value: String(minutes), label: `${minutes} minutes` }))}
        value={values.duration}
        error={error("duration")}
        onChange={(value) => set("duration", value)}
      />
    </>
  );
}

function TextFieldDate({
  field,
  label,
  type,
  value,
  min,
  max,
  error,
  onChange,
}: {
  field: FormField;
  label: string;
  type: "date" | "time";
  value: string;
  min?: string;
  max?: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-2">
      <label htmlFor={`contact-${field}`} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={`contact-${field}`}
        type={type}
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(field, error)}
        className={cn(inputClass, "h-12")}
      />
      <FieldMessages field={field} error={error} />
    </div>
  );
}
