"use client";

import Link from "next/link";
import { useState } from "react";
import { createClientAction, updateClientAction } from "@/app/(admin)/admin/(shell)/clients/actions";
import { controlProps, FormRow, readForm } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { inputClasses, selectFieldClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { CURRENCIES, CURRENCY_LABELS, type Currency } from "@/lib/money";
import { CLIENT_STATUS_LABELS, CLIENT_STATUSES, type ClientStatus } from "@/lib/work/options";

export type ClientFormValues = {
  id?: string;
  version?: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  website: string;
  location: string;
  timeZone: string;
  currency: Currency;
  status: ClientStatus;
  tags: string;
  notes: string;
  source: string;
};

export function ClientForm({ values, timeZones }: { values: ClientFormValues; timeZones: string[] }) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const editing = Boolean(values.id);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readForm(event.currentTarget);
    const result = await run("save", () =>
      editing
        ? updateClientAction({ ...fields, id: values.id, version: values.version })
        : createClientAction(fields),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  const row = (field: keyof ClientFormValues, label: string, hint?: string, className?: string) => (
    <FormRow id={`client-${field}`} label={label} error={errors[field]} hint={hint} className={className}>
      <input
        {...controlProps(`client-${field}`, errors[field], Boolean(hint))}
        className={inputClasses}
        defaultValue={String(values[field] ?? "")}
        type={field === "email" ? "email" : "text"}
        autoComplete="off"
      />
    </FormRow>
  );

  return (
    <Card>
      <CardBody>
        <form onSubmit={save} className="grid gap-5" noValidate>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            {row("name", "Name", "The person you deal with.")}
            {row("company", "Company")}
            {row("email", "Email")}
            {row("phone", "Phone", "Private. Never shown anywhere else.")}
            {row("website", "Website")}
            {row("location", "Location", "For example Berlin, Germany.")}
            <FormRow
              id="client-timeZone"
              label="Time zone"
              error={errors.timeZone}
              hint="For calls and deadlines."
            >
              <input
                {...controlProps("client-timeZone", errors.timeZone, true)}
                className={inputClasses}
                list="client-time-zones"
                defaultValue={values.timeZone}
                autoComplete="off"
                placeholder="Europe/Istanbul"
              />
              <datalist id="client-time-zones">
                {timeZones.map((zone) => (
                  <option key={zone} value={zone} />
                ))}
              </datalist>
            </FormRow>
            <FormRow
              id="client-currency"
              label="Currency"
              error={errors.currency}
              hint="New projects start in it."
            >
              <select
                {...controlProps("client-currency", errors.currency, true)}
                className={selectFieldClasses}
                defaultValue={values.currency}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {CURRENCY_LABELS[currency]}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow id="client-status" label="Status" error={errors.status}>
              <select
                {...controlProps("client-status", errors.status)}
                className={selectFieldClasses}
                defaultValue={values.status}
              >
                {CLIENT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {CLIENT_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </FormRow>
            {row("source", "Found you through", "For example a referral from Ada, or the contact form.")}
            {row("tags", "Tags", "Separate tags with commas.", "sm:col-span-2")}
            <FormRow id="client-notes" label="Notes" error={errors.notes} className="sm:col-span-2">
              <textarea
                {...controlProps("client-notes", errors.notes)}
                className={textareaClasses}
                rows={5}
                maxLength={5000}
                defaultValue={values.notes}
              />
            </FormRow>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" variant="primary" pending={pending === "save"}>
              {editing ? "Save changes" : "Add client"}
            </Button>
            <Link
              href={editing ? `/admin/clients/${values.id}` : "/admin/clients"}
              className={buttonClasses("ghost")}
            >
              Cancel
            </Link>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
