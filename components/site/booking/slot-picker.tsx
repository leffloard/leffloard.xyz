"use client";

import { useMemo } from "react";
import { cn } from "@/components/ui/cn";
import { SHORT_MONTHS } from "@/lib/format";
import { wallDateTime } from "@/lib/intake/time";
import { weekdayIndex } from "@/lib/work/dates";

// Open times grouped by day, in the visitor's time zone. Keyboard users move through ordinary buttons;
// the chosen day and time are marked with aria-pressed.

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function dayLabel(date: string): string {
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${WEEKDAYS[weekdayIndex(date)]} ${day} ${SHORT_MONTHS[month - 1]}`;
}

export function timeLabel(instant: string, zone: string): string {
  return wallDateTime(new Date(instant), zone).time;
}

export function groupByDay(slots: string[], zone: string): Map<string, string[]> {
  const days = new Map<string, string[]>();
  for (const slot of slots) {
    const date = wallDateTime(new Date(slot), zone).date;
    days.set(date, [...(days.get(date) ?? []), slot]);
  }
  return days;
}

export function SlotPicker({
  slots,
  zone,
  day,
  onDay,
  value,
  onChange,
}: {
  slots: string[];
  zone: string;
  day: string | null;
  onDay: (day: string) => void;
  value: string | null;
  onChange: (slot: string) => void;
}) {
  const days = useMemo(() => groupByDay(slots, zone), [slots, zone]);
  const shownDay = day && days.has(day) ? day : ([...days.keys()][0] ?? null);

  if (days.size === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-muted">
        No open times right now. Write to me instead and we&apos;ll find one.
      </p>
    );
  }

  return (
    <div className="grid gap-5">
      <div role="group" aria-label="Day" className="flex gap-2 overflow-x-auto pb-1">
        {[...days.entries()].map(([date, times]) => {
          const selected = date === shownDay;
          return (
            <button
              key={date}
              type="button"
              aria-pressed={selected}
              onClick={() => onDay(date)}
              className={cn(
                "grid min-w-[88px] shrink-0 gap-0.5 rounded-2xl border px-3 py-2.5 text-left transition-colors",
                "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                selected
                  ? "border-accent bg-accent/[0.08] text-ink"
                  : "border-line-strong text-ink/85 hover:border-ink/30",
              )}
            >
              <span className="text-sm font-medium">{dayLabel(date)}</span>
              <span className="text-xs text-muted">
                {times.length} {times.length === 1 ? "time" : "times"}
              </span>
            </button>
          );
        })}
      </div>
      {shownDay ? (
        <div
          role="group"
          aria-label={`Times on ${dayLabel(shownDay)}`}
          className="grid grid-cols-3 gap-2 sm:grid-cols-4"
        >
          {(days.get(shownDay) ?? []).map((slot) => {
            const selected = slot === value;
            return (
              <button
                key={slot}
                type="button"
                aria-pressed={selected}
                data-slot={slot}
                onClick={() => onChange(slot)}
                className={cn(
                  "h-11 rounded-xl border font-mono text-sm tabular-nums transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
                  selected
                    ? "border-accent bg-accent font-semibold text-accent-ink"
                    : "border-line-strong hover:border-accent/60",
                )}
              >
                {timeLabel(slot, zone)}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

// The visitor's zone, with every zone to choose from.
export function ZoneSelect({
  id,
  zone,
  zones,
  onChange,
}: {
  id: string;
  zone: string;
  zones: string[];
  onChange: (zone: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor={id} className="text-muted">
        Times shown in
      </label>
      <select
        id={id}
        value={zone}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 max-w-full rounded-full border border-line-strong bg-canvas px-3 text-sm text-ink focus:border-accent focus:ring-2 focus:ring-accent/25 focus:outline-none"
      >
        {zones.map((name) => (
          <option key={name} value={name}>
            {name.replaceAll("_", " ")}
          </option>
        ))}
      </select>
    </div>
  );
}
