"use client";

import Link from "next/link";
import { useState } from "react";
import { createMeetingAction } from "@/app/(admin)/admin/(shell)/calendar/actions";
import { controlProps, FormRow, readForm } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { inputClasses, selectFieldClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { DURATIONS } from "@/lib/booking/availability";

export function NewMeetingForm({
  clients,
  defaults,
  canEmail,
  timeZones,
}: {
  clients: { id: string; label: string }[];
  defaults: { clientId: string; date: string; title: string };
  canEmail: boolean;
  timeZones: string[];
}) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tellGuest, setTellGuest] = useState(canEmail);
  const [clientId, setClientId] = useState(defaults.clientId);
  const [location, setLocation] = useState("jitsi");

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readForm(event.currentTarget);
    const result = await run("save", () => createMeetingAction({ ...fields, tellGuest }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={save} className="grid gap-5" noValidate>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow id="meeting-title" label="Meeting" error={errors.title}>
              <input
                {...controlProps("meeting-title", errors.title)}
                className={inputClasses}
                maxLength={120}
                defaultValue={defaults.title}
              />
            </FormRow>
            <FormRow
              id="meeting-clientId"
              label="Client"
              // With a client chosen, their name and email come from the client record.
              error={errors.clientId ?? (clientId ? (errors.email ?? errors.name) : undefined)}
              hint="Or fill in the name and email below."
            >
              <select
                {...controlProps(
                  "meeting-clientId",
                  errors.clientId ?? (clientId ? (errors.email ?? errors.name) : undefined),
                  true,
                )}
                className={selectFieldClasses}
                value={clientId}
                onChange={(event) => setClientId(event.target.value)}
              >
                <option value="">Not a client</option>
                {clients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.label}
                  </option>
                ))}
              </select>
            </FormRow>
            {clientId ? (
              <>
                <input type="hidden" name="name" value="" />
                <input type="hidden" name="email" value="" />
              </>
            ) : (
              <>
                <FormRow id="meeting-name" label="With" error={errors.name}>
                  <input
                    {...controlProps("meeting-name", errors.name)}
                    className={inputClasses}
                    maxLength={100}
                  />
                </FormRow>
                <FormRow id="meeting-email" label="Their email" error={errors.email}>
                  <input
                    {...controlProps("meeting-email", errors.email)}
                    type="email"
                    className={inputClasses}
                  />
                </FormRow>
              </>
            )}
            <FormRow id="meeting-date" label="Day" error={errors.date}>
              <input
                {...controlProps("meeting-date", errors.date)}
                type="date"
                className={inputClasses}
                defaultValue={defaults.date}
              />
            </FormRow>
            <FormRow id="meeting-time" label="Time (your time zone)" error={errors.time}>
              <input
                {...controlProps("meeting-time", errors.time)}
                type="time"
                step={900}
                className={inputClasses}
                defaultValue="17:00"
              />
            </FormRow>
            <FormRow id="meeting-duration" label="Length" error={errors.duration}>
              <select
                {...controlProps("meeting-duration", errors.duration)}
                className={selectFieldClasses}
                defaultValue="30"
              >
                {DURATIONS.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow
              id="meeting-timeZone"
              label="Their time zone (optional)"
              error={errors.timeZone}
              hint="For the times in their email."
            >
              <input
                {...controlProps("meeting-timeZone", errors.timeZone, true)}
                className={inputClasses}
                list="meeting-zones"
                autoComplete="off"
              />
              <datalist id="meeting-zones">
                {timeZones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </FormRow>
            <FormRow id="meeting-location" label="Where">
              <select
                {...controlProps("meeting-location")}
                className={selectFieldClasses}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              >
                <option value="jitsi">Video call (a Jitsi link is made)</option>
                <option value="discord">Discord</option>
                <option value="custom">Somewhere else</option>
              </select>
            </FormRow>
            {location === "jitsi" ? (
              <input type="hidden" name="locationDetails" value="" />
            ) : (
              <FormRow id="meeting-locationDetails" label="Details" error={errors.locationDetails}>
                <input
                  {...controlProps("meeting-locationDetails", errors.locationDetails)}
                  className={inputClasses}
                  maxLength={300}
                />
              </FormRow>
            )}
            <FormRow id="meeting-ownerNote" label="Private note" className="sm:col-span-2">
              <textarea
                {...controlProps("meeting-ownerNote")}
                className={textareaClasses}
                rows={3}
                maxLength={5000}
              />
            </FormRow>
          </div>
          <label className="flex items-center gap-2 text-[13px]">
            <input
              type="checkbox"
              checked={tellGuest}
              disabled={!canEmail}
              onChange={(event) => setTellGuest(event.target.checked)}
              className="accent-[var(--color-accent)]"
            />
            Email them the invite{canEmail ? "" : " (email is not set up)"}
          </label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="primary" pending={pending === "save"}>
              Add meeting
            </Button>
            <Link href="/admin/calendar" className={buttonClasses("ghost")}>
              Cancel
            </Link>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
