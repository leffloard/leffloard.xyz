"use client";

import { useEffect, useRef, useState } from "react";
import { dayLabel, SlotPicker, ZoneSelect } from "@/components/site/booking/slot-picker";
import { cn } from "@/components/ui/cn";
import { isTimeZone, timeZoneNames, wallDateTime } from "@/lib/intake/time";

// A guest's own page for their meeting: when and where it is, and moving or cancelling it.

export type MeetingView = {
  title: string;
  start: string;
  durationMinutes: number;
  status: "requested" | "confirmed" | "declined" | "cancelled";
  guestZone: string;
  location: string | null;
  canChange: boolean;
};

const buttonClass =
  "inline-flex h-11 items-center rounded-full px-5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60";

export function ManageMeeting({ token, meeting: initial }: { token: string; meeting: MeetingView }) {
  const [meeting, setMeeting] = useState(initial);
  const [zone, setZone] = useState(initial.guestZone);
  const [zones, setZones] = useState<string[]>([]);
  const [mode, setMode] = useState<"view" | "move" | "cancel">("view");
  const [slots, setSlots] = useState<string[] | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const status = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    const names = timeZoneNames();
    if (!names.includes(initial.guestZone)) names.unshift(initial.guestZone);
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (detected && isTimeZone(detected) && !names.includes(detected)) names.unshift(detected);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the zone list is read once in the browser
    setZones(names);
  }, [initial.guestZone]);

  useEffect(() => {
    if (message) status.current?.focus();
  }, [message]);

  async function openMove() {
    setMode("move");
    setMessage(null);
    setSlots(null);
    const response = await fetch(`/api/meetings/${token}/slots`);
    const body = (await response.json().catch(() => ({}))) as { slots?: string[]; error?: string };
    if (!response.ok || !body.slots) {
      setMessage({ tone: "error", text: body.error ?? "The open times could not be loaded." });
      setMode("view");
      return;
    }
    setSlots(body.slots.filter((slot) => slot !== meeting.start));
  }

  async function move(start: string) {
    setBusy(true);
    try {
      const response = await fetch(`/api/meetings/${token}/reschedule`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ start }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        start?: string;
        error?: string;
        slots?: string[];
      };
      if (response.ok && body.start) {
        setMeeting((current) => ({ ...current, start: body.start! }));
        setMode("view");
        setMessage({ tone: "ok", text: "Moved. An email with the new time is on its way." });
        return;
      }
      if (body.slots) setSlots(body.slots.filter((slot) => slot !== meeting.start));
      setMessage({ tone: "error", text: body.error ?? "The meeting could not be moved." });
    } finally {
      setBusy(false);
    }
  }

  async function cancel(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`/api/meetings/${token}/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (response.ok) {
        setMeeting((current) => ({ ...current, status: "cancelled", canChange: false }));
        setMode("view");
        setMessage({ tone: "ok", text: "Cancelled. You'll get an email to confirm it." });
        return;
      }
      setMessage({ tone: "error", text: body.error ?? "The meeting could not be cancelled." });
    } finally {
      setBusy(false);
    }
  }

  const wall = wallDateTime(new Date(meeting.start), zone);
  const ended = meeting.status === "cancelled" || meeting.status === "declined";

  return (
    <div className="grid gap-6">
      <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
        <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
          {meeting.status === "confirmed"
            ? "Confirmed"
            : meeting.status === "requested"
              ? "Waiting for confirmation"
              : meeting.status === "declined"
                ? "Declined"
                : "Cancelled"}
        </p>
        <h2 className={cn("mt-3 text-2xl font-semibold tracking-tight", ended && "text-muted line-through")}>
          {dayLabel(wall.date)}, {wall.time}
        </h2>
        <p className="mt-2 text-muted">
          {meeting.title}, {meeting.durationMinutes} minutes
        </p>
        <div className="mt-4">
          <ZoneSelect id="manage-zone" zone={zone} zones={zones.length ? zones : [zone]} onChange={setZone} />
        </div>
        {meeting.location && !ended ? (
          <p className="mt-5 text-sm">
            {meeting.location.startsWith("https://") ? (
              <>
                Join at{" "}
                <a
                  href={meeting.location}
                  className="font-mono text-accent underline-offset-4 hover:underline"
                >
                  {meeting.location}
                </a>
              </>
            ) : (
              meeting.location
            )}
          </p>
        ) : null}
        {message ? (
          <p
            ref={status}
            tabIndex={-1}
            role={message.tone === "error" ? "alert" : "status"}
            className={cn(
              "mt-5 rounded-xl border px-4 py-3 text-sm outline-none",
              message.tone === "error"
                ? "border-danger/40 bg-danger/[0.07]"
                : "border-success/35 bg-success/[0.07]",
            )}
          >
            {message.text}
          </p>
        ) : null}
        {!ended ? (
          <div className="mt-7 flex flex-wrap gap-3">
            <a
              href={`/meeting/${token}/invite.ics`}
              className={cn(buttonClass, "border border-line-strong hover:border-ink/40")}
            >
              Add to calendar
            </a>
            {meeting.canChange ? (
              <>
                <button
                  type="button"
                  onClick={openMove}
                  className={cn(buttonClass, "border border-line-strong hover:border-ink/40")}
                >
                  Reschedule
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode("cancel");
                    setMessage(null);
                  }}
                  className={cn(buttonClass, "border border-danger/40 text-danger hover:bg-danger/10")}
                >
                  Cancel
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === "move" ? (
        <div className="rounded-3xl border border-line bg-surface p-5 sm:p-8">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Pick a new time</h2>
            <button
              type="button"
              onClick={() => setMode("view")}
              className="text-sm text-muted hover:text-ink"
            >
              Keep the current time
            </button>
          </div>
          {slots === null ? (
            <p className="text-sm text-muted">Loading the open times…</p>
          ) : (
            <fieldset disabled={busy}>
              <legend className="sr-only">New time</legend>
              <SlotPicker slots={slots} zone={zone} day={day} onDay={setDay} value={null} onChange={move} />
            </fieldset>
          )}
        </div>
      ) : null}

      {mode === "cancel" ? (
        <form onSubmit={cancel} className="grid gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-8">
          <h2 className="text-lg font-semibold tracking-tight">Cancel this meeting?</h2>
          <div className="grid gap-2">
            <label htmlFor="manage-reason" className="text-sm font-medium">
              Reason <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id="manage-reason"
              rows={3}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="w-full rounded-xl border border-line-strong bg-canvas px-4 py-3 text-base leading-7 focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="submit"
              disabled={busy}
              className={cn(buttonClass, "bg-danger text-white hover:bg-danger/90")}
            >
              Cancel the meeting
            </button>
            <button
              type="button"
              onClick={() => setMode("view")}
              className={cn(buttonClass, "border border-line-strong")}
            >
              Keep it
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
