"use client";

import { useState } from "react";
import { saveAvailabilityAction } from "@/app/(admin)/admin/(shell)/calendar/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { compactInputClasses, inputClasses, selectClasses, selectFieldClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  BUFFERS,
  CELL_MINUTES,
  MAX_INTERVALS_PER_DAY,
  MAX_OVERRIDES,
  minutesOf,
  STEPS,
  timeOf,
  WEEKDAYS,
  type Interval,
} from "@/lib/booking/availability";

export type AvailabilityForm = {
  version: number;
  timeZone: string;
  weekly: Interval[][];
  overrides: { date: string; intervals: Interval[] }[];
  bufferMinutes: number;
  stepMinutes: number;
  minNoticeHours: number;
  horizonDays: number;
  dailyCap: number;
};

const DAY = 24 * 60;
// Quarter hours: a range starts from 00:00 to 23:45 and ends from 00:15 to 24:00.
const STARTS = Array.from({ length: DAY / CELL_MINUTES }, (_, index) => timeOf(index * CELL_MINUTES));
const ENDS = Array.from({ length: DAY / CELL_MINUTES }, (_, index) => timeOf((index + 1) * CELL_MINUTES));

// The range to add after a day's last one: an hour from where it ends (09:00 on an empty day).
function nextRange(intervals: Interval[]): Interval | null {
  const last = intervals.at(-1);
  const start = last ? (minutesOf(last.end) ?? DAY) : 9 * 60;
  if (start >= DAY) return null;
  return { start: timeOf(start), end: timeOf(Math.min(DAY, start + 60)) };
}

function wholeNumber(value: string): number | null {
  const number = Number(value.trim());
  return value.trim() && Number.isInteger(number) ? number : null;
}

function errorFor(errors: Record<string, string>, prefix: string): string | undefined {
  const key = Object.keys(errors).find((field) => field === prefix || field.startsWith(`${prefix}.`));
  return key ? errors[key] : undefined;
}

function RangesEditor({
  label,
  intervals,
  onChange,
}: {
  label: string;
  intervals: Interval[];
  onChange: (intervals: Interval[]) => void;
}) {
  const next = intervals.length < MAX_INTERVALS_PER_DAY ? nextRange(intervals) : null;
  function update(index: number, change: Partial<Interval>) {
    onChange(intervals.map((interval, at) => (at === index ? { ...interval, ...change } : interval)));
  }
  return (
    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
      {intervals.length === 0 ? <span className="text-[13px] text-muted">Closed</span> : null}
      {intervals.map((interval, index) => (
        <span key={index} className="flex items-center gap-1.5">
          <select
            aria-label={`${label}, range ${index + 1}, from`}
            className={selectClasses}
            value={interval.start}
            onChange={(event) => update(index, { start: event.target.value })}
          >
            {STARTS.map((time) => (
              <option key={time} value={time}>
                {time}
              </option>
            ))}
          </select>
          <span aria-hidden className="text-muted">
            –
          </span>
          <select
            aria-label={`${label}, range ${index + 1}, to`}
            className={selectClasses}
            value={interval.end}
            onChange={(event) => update(index, { end: event.target.value })}
          >
            {ENDS.map((time) => (
              <option key={time} value={time}>
                {time === "24:00" ? "24:00 (midnight)" : time}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Remove ${label}, range ${index + 1}`}
            onClick={() => onChange(intervals.filter((_, at) => at !== index))}
          >
            ×
          </Button>
        </span>
      ))}
      {next ? (
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Add a range on ${label}`}
          onClick={() => onChange([...intervals, next])}
        >
          + Range
        </Button>
      ) : null}
    </div>
  );
}

export function AvailabilityEditor({
  initial,
  timeZones,
}: {
  initial: AvailabilityForm;
  timeZones: string[];
}) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [weekly, setWeekly] = useState(initial.weekly);
  const [overrides, setOverrides] = useState(initial.overrides);
  const [rules, setRules] = useState({
    timeZone: initial.timeZone,
    bufferMinutes: String(initial.bufferMinutes),
    stepMinutes: String(initial.stepMinutes),
    minNoticeHours: String(initial.minNoticeHours),
    horizonDays: String(initial.horizonDays),
    dailyCap: String(initial.dailyCap),
  });

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("save", () =>
      saveAvailabilityAction({
        // After a save the page re-renders with the new version, so the prop is always the latest.
        version: initial.version,
        timeZone: rules.timeZone,
        weekly,
        overrides,
        bufferMinutes: rules.bufferMinutes,
        stepMinutes: rules.stepMinutes,
        minNoticeHours: wholeNumber(rules.minNoticeHours),
        horizonDays: wholeNumber(rules.horizonDays),
        dailyCap: wholeNumber(rules.dailyCap),
      }),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  const setRule =
    (key: keyof typeof rules) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setRules((current) => ({ ...current, [key]: event.target.value }));
  const overridesError = errorFor(errors, "overrides");

  return (
    <form onSubmit={save} className="grid gap-6" noValidate>
      <Card>
        <CardHeader title="Weekly hours" description="When calls can be booked, in your time zone." />
        <ul className="divide-y divide-line">
          {WEEKDAYS.map((day, index) => {
            const error = errorFor(errors, `weekly.${index}`);
            return (
              <li key={day} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <span className="w-24 shrink-0 text-[13px] font-medium">{day}</span>
                  <RangesEditor
                    label={day}
                    intervals={weekly[index] ?? []}
                    onChange={(intervals) =>
                      setWeekly((current) => current.map((ranges, at) => (at === index ? intervals : ranges)))
                    }
                  />
                </div>
                {error ? <p className="mt-1.5 text-xs text-danger">{error}</p> : null}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card>
        <CardHeader
          title="Special dates"
          description="Other hours on one day, like an exam day or a holiday. A date with no ranges is closed."
          action={
            overrides.length < MAX_OVERRIDES ? (
              <Button
                size="sm"
                onClick={() => setOverrides((current) => [...current, { date: "", intervals: [] }])}
              >
                Add a date
              </Button>
            ) : null
          }
        />
        <CardBody className="grid gap-3">
          {overridesError ? <p className="text-xs text-danger">{overridesError}</p> : null}
          {overrides.length ? (
            <ul className="grid gap-3">
              {overrides.map((override, index) => (
                <li key={index} className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <input
                    type="date"
                    aria-label={`Special date ${index + 1}`}
                    className={cn(compactInputClasses, "w-40 shrink-0")}
                    value={override.date}
                    onChange={(event) =>
                      setOverrides((current) =>
                        current.map((item, at) =>
                          at === index ? { ...item, date: event.target.value } : item,
                        ),
                      )
                    }
                  />
                  <RangesEditor
                    label={override.date || `special date ${index + 1}`}
                    intervals={override.intervals}
                    onChange={(intervals) =>
                      setOverrides((current) =>
                        current.map((item, at) => (at === index ? { ...item, intervals } : item)),
                      )
                    }
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setOverrides((current) => current.filter((_, at) => at !== index))}
                  >
                    Remove date
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted">None. Blocks on the calendar also keep times free.</p>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Rules" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormRow
            id="rules-timeZone"
            label="Your time zone"
            error={errors.timeZone}
            hint="Your hours are in this zone. Visitors see the times in their own."
          >
            <input
              {...controlProps("rules-timeZone", errors.timeZone, true)}
              className={inputClasses}
              list="rules-zones"
              autoComplete="off"
              value={rules.timeZone}
              onChange={setRule("timeZone")}
            />
            <datalist id="rules-zones">
              {timeZones.map((zone) => (
                <option key={zone} value={zone} />
              ))}
            </datalist>
          </FormRow>
          <FormRow id="rules-bufferMinutes" label="Gap after each meeting" error={errors.bufferMinutes}>
            <select
              {...controlProps("rules-bufferMinutes", errors.bufferMinutes)}
              className={selectFieldClasses}
              value={rules.bufferMinutes}
              onChange={setRule("bufferMinutes")}
            >
              {BUFFERS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes ? `${minutes} minutes` : "No gap"}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow id="rules-stepMinutes" label="Start times every" error={errors.stepMinutes}>
            <select
              {...controlProps("rules-stepMinutes", errors.stepMinutes)}
              className={selectFieldClasses}
              value={rules.stepMinutes}
              onChange={setRule("stepMinutes")}
            >
              {STEPS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  {minutes === 60 ? "hour" : `${minutes} minutes`}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow
            id="rules-minNoticeHours"
            label="Notice needed (hours)"
            error={errors.minNoticeHours}
            hint="The earliest a call can start, counted from now."
          >
            <input
              {...controlProps("rules-minNoticeHours", errors.minNoticeHours, true)}
              type="number"
              inputMode="numeric"
              min={0}
              max={336}
              className={inputClasses}
              value={rules.minNoticeHours}
              onChange={setRule("minNoticeHours")}
            />
          </FormRow>
          <FormRow id="rules-horizonDays" label="Bookable ahead (days)" error={errors.horizonDays}>
            <input
              {...controlProps("rules-horizonDays", errors.horizonDays)}
              type="number"
              inputMode="numeric"
              min={1}
              max={180}
              className={inputClasses}
              value={rules.horizonDays}
              onChange={setRule("horizonDays")}
            />
          </FormRow>
          <FormRow
            id="rules-dailyCap"
            label="Calls a day at most"
            error={errors.dailyCap}
            hint="Once a day has this many, visitors can't book it; you still can. 0 means no limit."
          >
            <input
              {...controlProps("rules-dailyCap", errors.dailyCap, true)}
              type="number"
              inputMode="numeric"
              min={0}
              max={20}
              className={inputClasses}
              value={rules.dailyCap}
              onChange={setRule("dailyCap")}
            />
          </FormRow>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" pending={pending === "save"}>
          Save hours and rules
        </Button>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </div>
    </form>
  );
}
