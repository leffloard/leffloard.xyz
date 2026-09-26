"use client";

import { useState } from "react";
import {
  createBookingTypeAction,
  deleteBookingTypeAction,
  rotateBookingTypeLinkAction,
  updateBookingTypeAction,
} from "@/app/(admin)/admin/(shell)/calendar/actions";
import { CopyButton } from "@/components/admin/copy-button";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import {
  compactInputClasses,
  inputClasses,
  selectFieldClasses,
  textareaClasses,
} from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { DURATIONS } from "@/lib/booking/availability";

export type BookingTypeForm = {
  slug: string;
  title: string;
  description: string;
  durationMinutes: number;
  visibility: "public" | "portal" | "secret";
  requiresApproval: boolean;
  location: "jitsi" | "discord" | "custom";
  locationDetails: string;
  questions: { label: string; required: boolean }[];
  active: boolean;
};

const MAX_QUESTIONS = 5;

const EMPTY: BookingTypeForm = {
  slug: "",
  title: "",
  description: "",
  durationMinutes: 30,
  visibility: "public",
  requiresApproval: false,
  location: "jitsi",
  locationDetails: "",
  questions: [],
  active: true,
};

// "Project check-in" → "project-check-in".
function slugFrom(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/, "");
}

function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-[13px]">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-[var(--color-accent)]"
      />
      {label}
    </label>
  );
}

// One booking type's form. Without an id it adds a new type and starts empty again afterwards.
export function BookingTypeEditor({
  id,
  initial,
  siteUrl,
  link,
  meetings = 0,
}: {
  id?: string;
  initial?: BookingTypeForm;
  siteUrl: string;
  link?: string; // the saved type's link; a secret type's carries its key
  meetings?: number;
}) {
  const { run, pending, message } = useActionRunner();
  const [form, setForm] = useState<BookingTypeForm>(initial ?? EMPTY);
  const [slugTouched, setSlugTouched] = useState(Boolean(id));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const prefix = id ? `type-${id}` : "type-new";

  function set<K extends keyof BookingTypeForm>(key: K, value: BookingTypeForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function setQuestion(index: number, change: Partial<BookingTypeForm["questions"][number]>) {
    set(
      "questions",
      form.questions.map((question, at) => (at === index ? { ...question, ...change } : question)),
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const input = { ...form, durationMinutes: String(form.durationMinutes) };
    const result = await run("save", () =>
      id ? updateBookingTypeAction({ ...input, id }) : createBookingTypeAction(input),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok && !id) {
      setForm(EMPTY);
      setSlugTouched(false);
    }
  }

  const field = (name: string) => `${prefix}-${name}`;
  const secret = initial?.visibility !== undefined && initial.visibility !== "public";

  return (
    <Card>
      <CardHeader
        title={id ? form.title || "Untitled" : "Add a booking type"}
        description={id ? undefined : "A kind of call people can book, with its own link."}
        action={
          id ? (
            <span className="flex gap-1.5">
              {form.visibility === "secret" ? <Badge>link only</Badge> : null}
              {form.visibility === "portal" ? <Badge>clients</Badge> : null}
              <Badge tone={form.active ? "success" : "neutral"}>
                {form.active ? "taking bookings" : "paused"}
              </Badge>
            </span>
          ) : null
        }
      />
      <CardBody>
        {id && link ? (
          <div className="mb-5 grid gap-2 rounded-lg border border-line bg-canvas px-3 py-2.5 text-[13px]">
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="min-w-0 font-mono text-xs break-all text-accent hover:underline"
            >
              {link}
            </a>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton value={link} label="Copy the link" />
              {secret ? (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={pending === "rotate"}
                  onClick={() => run("rotate", () => rotateBookingTypeLinkAction({ id }))}
                >
                  New link
                </Button>
              ) : null}
            </div>
            {secret ? (
              <p className="text-xs text-muted">
                {initial?.visibility === "portal"
                  ? "Clients book it from their portal; anyone else needs this link."
                  : "Only people with this link can book."}{" "}
                A new link stops the ones you have shared.
              </p>
            ) : null}
          </div>
        ) : null}
        <form onSubmit={save} className="grid gap-4" noValidate>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow id={field("title")} label="Name" error={errors.title}>
              <input
                {...controlProps(field("title"), errors.title)}
                className={inputClasses}
                maxLength={80}
                value={form.title}
                onChange={(event) => {
                  const title = event.target.value;
                  setForm((current) => ({
                    ...current,
                    title,
                    slug: slugTouched ? current.slug : slugFrom(title),
                  }));
                }}
              />
            </FormRow>
            <FormRow
              id={field("slug")}
              label="Link"
              error={errors.slug}
              hint={`${siteUrl}/book/${form.slug || "…"}`}
            >
              <input
                {...controlProps(field("slug"), errors.slug, true)}
                className={inputClasses}
                maxLength={60}
                autoCapitalize="none"
                spellCheck={false}
                value={form.slug}
                onChange={(event) => {
                  setSlugTouched(true);
                  set("slug", event.target.value);
                }}
              />
            </FormRow>
            <FormRow
              id={field("description")}
              label="Description"
              error={errors.description}
              className="sm:col-span-2"
            >
              <textarea
                {...controlProps(field("description"), errors.description)}
                className={textareaClasses}
                rows={2}
                maxLength={500}
                value={form.description}
                onChange={(event) => set("description", event.target.value)}
              />
            </FormRow>
            <FormRow id={field("durationMinutes")} label="Length" error={errors.durationMinutes}>
              <select
                {...controlProps(field("durationMinutes"), errors.durationMinutes)}
                className={selectFieldClasses}
                value={form.durationMinutes}
                onChange={(event) => set("durationMinutes", Number(event.target.value))}
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow id={field("visibility")} label="Who can book it" error={errors.visibility}>
              <select
                {...controlProps(field("visibility"), errors.visibility)}
                className={selectFieldClasses}
                value={form.visibility}
                onChange={(event) => set("visibility", event.target.value as BookingTypeForm["visibility"])}
              >
                <option value="public">Anyone: listed on the booking page</option>
                <option value="portal">Clients: listed in their portal</option>
                <option value="secret">Only people you send the link to</option>
              </select>
            </FormRow>
            <FormRow id={field("location")} label="Where" error={errors.location}>
              <select
                {...controlProps(field("location"), errors.location)}
                className={selectFieldClasses}
                value={form.location}
                onChange={(event) => set("location", event.target.value as BookingTypeForm["location"])}
              >
                <option value="jitsi">Video call (a Jitsi link per meeting)</option>
                <option value="discord">Discord</option>
                <option value="custom">Somewhere else</option>
              </select>
            </FormRow>
            <FormRow
              id={field("locationDetails")}
              label={form.location === "jitsi" ? "Details (optional)" : "Details"}
              error={errors.locationDetails}
              hint={form.location === "discord" ? "Your Discord name or a server invite." : undefined}
            >
              <input
                {...controlProps(
                  field("locationDetails"),
                  errors.locationDetails,
                  form.location === "discord",
                )}
                className={inputClasses}
                maxLength={300}
                value={form.locationDetails}
                onChange={(event) => set("locationDetails", event.target.value)}
              />
            </FormRow>
          </div>

          <fieldset className="grid gap-2">
            <legend className="mb-1.5 text-[13px] font-medium text-ink/90">Questions before booking</legend>
            {form.questions.length === 0 ? (
              <p className="text-xs text-muted">None: people give their name, email and an optional note.</p>
            ) : null}
            {form.questions.map((question, index) => {
              const error = errors[`questions.${index}.label`] ?? errors[`questions.${index}`];
              return (
                <div key={index} className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      aria-label={`Question ${index + 1}`}
                      aria-invalid={error ? true : undefined}
                      className={`${compactInputClasses} min-w-0 flex-1 basis-60`}
                      maxLength={200}
                      value={question.label}
                      onChange={(event) => setQuestion(index, { label: event.target.value })}
                    />
                    <Check
                      id={`${field("question")}-${index}-required`}
                      label="Required"
                      checked={question.required}
                      onChange={(required) => setQuestion(index, { required })}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove question ${index + 1}`}
                      onClick={() =>
                        set(
                          "questions",
                          form.questions.filter((_, at) => at !== index),
                        )
                      }
                    >
                      ×
                    </Button>
                  </div>
                  {error ? <p className="text-xs text-danger">{error}</p> : null}
                </div>
              );
            })}
            {form.questions.length < MAX_QUESTIONS ? (
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => set("questions", [...form.questions, { label: "", required: false }])}
                >
                  + Question
                </Button>
              </div>
            ) : null}
          </fieldset>

          <div className="grid gap-2">
            <Check
              id={field("requiresApproval")}
              label="I confirm each booking first (the time is held until I answer)"
              checked={form.requiresApproval}
              onChange={(value) => set("requiresApproval", value)}
            />
            <Check
              id={field("active")}
              label="Taking bookings"
              checked={form.active}
              onChange={(value) => set("active", value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="primary" pending={pending === "save"}>
              {id ? "Save" : "Add booking type"}
            </Button>
            {id && !confirmDelete ? (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
                Delete…
              </Button>
            ) : null}
            {id && confirmDelete ? (
              <>
                <Button
                  size="sm"
                  variant="danger"
                  pending={pending === "delete"}
                  onClick={() => run("delete", () => deleteBookingTypeAction({ id }))}
                >
                  Delete for good
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep it
                </Button>
                <span className="text-xs text-muted">
                  {meetings
                    ? `Its ${meetings === 1 ? "meeting stays" : `${meetings} meetings stay`} on the calendar. To stop new bookings only, untick "Taking bookings".`
                    : 'To stop new bookings only, untick "Taking bookings".'}
                </span>
              </>
            ) : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
