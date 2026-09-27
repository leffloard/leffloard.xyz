"use client";

import { useState } from "react";
import { saveNotificationSettingsAction } from "@/app/(admin)/admin/(shell)/notifications/actions";
import { DigestActions } from "@/components/admin/notifications/digest-actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  ALERT_KIND_INFO,
  ALERT_KINDS,
  MAX_QUIET_RANGES,
  WEEKDAYS_SHORT,
  type NotificationSettingsForm as FormValue,
  type QuietRange,
} from "@/lib/notifications/model";

// Where each kind of alert goes, when to hold them, and the morning digest. The notification centre always
// gets every alert.

export function NotificationSettingsForm({
  initial,
  channels,
}: {
  initial: FormValue;
  channels: { email: boolean; discord: boolean };
}) {
  const { run, pending, message } = useActionRunner();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function set<K extends keyof FormValue>(key: K, next: FormValue[K]) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  function setRange(index: number, next: Partial<QuietRange>) {
    set(
      "quietRanges",
      value.quietRanges.map((range, at) => (at === index ? { ...range, ...next } : range)),
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("save", () => saveNotificationSettingsAction(value));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setValue((current) => ({ ...current, version: result.data.version }));
  }

  return (
    <Card>
      <CardHeader
        title="Settings"
        description="Every alert shows here. Choose which also go by email and to Discord, and when to hold them."
      />
      <CardBody>
        <form onSubmit={save} className="grid gap-6 text-[13px]" noValidate>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}

          <fieldset className="grid gap-2">
            <legend className="mb-2 text-sm font-medium">Where alerts go</legend>
            {!channels.email || !channels.discord ? (
              <p className="text-xs text-muted">
                {!channels.email ? "Email alerts need SMTP_* and NOTIFY_EMAIL_TO on the server. " : ""}
                {!channels.discord ? "Discord alerts need DISCORD_WEBHOOK_URL on the server." : ""}
              </p>
            ) : null}
            <table className="w-full">
              <thead>
                <tr className="text-xs text-muted">
                  <th scope="col" className="pb-1 text-left font-normal">
                    Alert
                  </th>
                  <th scope="col" className="w-20 pb-1 text-center font-normal">
                    Email
                  </th>
                  <th scope="col" className="w-20 pb-1 text-center font-normal">
                    Discord
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {ALERT_KINDS.map((kind) => (
                  <tr key={kind}>
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      <span className="block">{ALERT_KIND_INFO[kind].label}</span>
                      <span className="block text-xs text-muted">{ALERT_KIND_INFO[kind].description}</span>
                    </th>
                    {(["email", "discord"] as const).map((channel) => (
                      <td key={channel} className="py-2 text-center">
                        <input
                          type="checkbox"
                          aria-label={`${ALERT_KIND_INFO[kind].label} by ${channel === "email" ? "email" : "Discord"}`}
                          checked={value.routes[kind][channel]}
                          onChange={(event) =>
                            set("routes", {
                              ...value.routes,
                              [kind]: { ...value.routes[kind], [channel]: event.target.checked },
                            })
                          }
                          className="accent-[var(--color-accent)]"
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Quiet hours</legend>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={value.quietEnabled}
                onChange={(event) => set("quietEnabled", event.target.checked)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                Hold email and Discord alerts during these hours
                <span className="block text-xs text-muted">
                  They go out when the quiet period ends (Istanbul time). The notification centre shows them
                  at once.
                </span>
              </span>
            </label>
            {value.quietRanges.map((range, index) => {
              const prefix = `quietRanges.${index}`;
              const error = errors[`${prefix}.days`] ?? errors[`${prefix}.start`] ?? errors[`${prefix}.end`];
              return (
                <div key={index} className="grid gap-2 rounded-lg border border-line p-3">
                  <div
                    className="flex flex-wrap gap-x-3 gap-y-1"
                    role="group"
                    aria-label={`Quiet period ${index + 1}, days`}
                  >
                    {WEEKDAYS_SHORT.map((day, dayIndex) => (
                      <label key={day} className="flex items-center gap-1 text-xs">
                        <input
                          type="checkbox"
                          checked={range.days.includes(dayIndex)}
                          onChange={(event) =>
                            setRange(index, {
                              days: event.target.checked
                                ? [...range.days, dayIndex].sort()
                                : range.days.filter((other) => other !== dayIndex),
                            })
                          }
                          className="accent-[var(--color-accent)]"
                        />
                        {day}
                      </label>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-2 text-xs text-muted">
                      From
                      <input
                        type="time"
                        value={range.start}
                        onChange={(event) => setRange(index, { start: event.target.value })}
                        className={`${inputClasses} w-28`}
                        aria-label={`Quiet period ${index + 1}, from`}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted">
                      to
                      <input
                        type="time"
                        value={range.end}
                        onChange={(event) => setRange(index, { end: event.target.value })}
                        className={`${inputClasses} w-28`}
                        aria-label={`Quiet period ${index + 1}, to`}
                      />
                    </label>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        set(
                          "quietRanges",
                          value.quietRanges.filter((_, at) => at !== index),
                        )
                      }
                    >
                      Remove<span className="sr-only"> quiet period {index + 1}</span>
                    </Button>
                  </div>
                  {error ? (
                    <p className="text-xs text-danger" role="alert">
                      {error}
                    </p>
                  ) : null}
                </div>
              );
            })}
            {value.quietRanges.length < MAX_QUIET_RANGES ? (
              <div>
                <Button
                  size="sm"
                  onClick={() =>
                    set("quietRanges", [
                      ...value.quietRanges,
                      { days: [0, 1, 2, 3, 4], start: "08:30", end: "15:30" },
                    ])
                  }
                >
                  Add a quiet period
                </Button>
              </div>
            ) : null}
          </fieldset>

          <fieldset className="grid gap-3">
            <legend className="mb-2 text-sm font-medium">Daily digest</legend>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={value.digestEnabled}
                onChange={(event) => set("digestEnabled", event.target.checked)}
                className="mt-0.5 accent-[var(--color-accent)]"
              />
              <span>
                Email me a summary of the day each morning
                <span className="block text-xs text-muted">
                  Meetings, tasks due, messages waiting, money to collect and yesterday&apos;s visits.
                </span>
              </span>
            </label>
            <label className="flex items-center gap-2 text-xs text-muted">
              At
              <input
                type="time"
                value={value.digestTime}
                onChange={(event) => set("digestTime", event.target.value)}
                className={`${inputClasses} w-28`}
                aria-label="Daily digest time"
              />
              (Istanbul time)
            </label>
            {errors.digestTime ? <p className="text-xs text-danger">{errors.digestTime}</p> : null}
            <DigestActions canSend={channels.email} />
          </fieldset>

          <div>
            <Button type="submit" variant="primary" pending={pending === "save"}>
              Save
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
