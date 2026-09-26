"use client";

import Link from "next/link";
import { useState } from "react";
import { createProjectAction, updateProjectAction } from "@/app/(admin)/admin/(shell)/projects/actions";
import { controlProps, FormRow, readForm } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses, selectFieldClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SERVICE_OPTIONS } from "@/lib/intake/options";
import { CURRENCIES, CURRENCY_LABELS, type Currency } from "@/lib/money";
import {
  MAX_INCLUDED_REVISIONS,
  PRICING_LABELS,
  PRICING_MODELS,
  type PricingModel,
} from "@/lib/work/options";

export type ProjectFormValues = {
  id?: string;
  version?: number;
  inquiryId?: string;
  clientId: string;
  title: string;
  service: string;
  summary: string;
  startDate: string;
  dueDate: string;
  estimate: string;
  currency: Currency;
  pricing: PricingModel;
  budget: string;
  hourlyRate: string;
  includedRevisions: string;
  extraRevisionPrice: string;
  tags: string;
};

export function ProjectForm({
  values,
  clients,
  cancelHref,
}: {
  values: ProjectFormValues;
  clients: { id: string; label: string }[];
  cancelHref: string;
}) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pricing, setPricing] = useState<PricingModel>(values.pricing);
  const editing = Boolean(values.id);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readForm(event.currentTarget);
    const result = await run("save", () =>
      editing
        ? updateProjectAction({ ...fields, id: values.id, version: values.version })
        : createProjectAction({ ...fields, inquiryId: values.inquiryId ?? "" }),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  const input = (
    field: keyof ProjectFormValues,
    label: string,
    options: { hint?: string; type?: string } = {},
  ) => (
    <FormRow id={`project-${field}`} label={label} error={errors[field]} hint={options.hint}>
      <input
        {...controlProps(`project-${field}`, errors[field], Boolean(options.hint))}
        className={inputClasses}
        type={options.type ?? "text"}
        defaultValue={String(values[field] ?? "")}
        autoComplete="off"
      />
    </FormRow>
  );

  return (
    <form onSubmit={save} className="grid gap-6" noValidate>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Card>
        <CardHeader title="The work" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormRow id="project-clientId" label="Client" error={errors.clientId}>
            <select
              {...controlProps("project-clientId", errors.clientId)}
              className={selectFieldClasses}
              defaultValue={values.clientId}
            >
              <option value="">Choose a client…</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.label}
                </option>
              ))}
            </select>
          </FormRow>
          {input("title", "Title")}
          <FormRow id="project-service" label="Service" error={errors.service}>
            <select
              {...controlProps("project-service", errors.service)}
              className={selectFieldClasses}
              defaultValue={values.service}
            >
              <option value="">Not set</option>
              {SERVICE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormRow>
          {input("tags", "Tags", { hint: "Separate tags with commas." })}
          {input("startDate", "Start", { type: "date" })}
          {input("dueDate", "Due", { type: "date" })}
          {input("estimate", "Estimate", { hint: "Hours, for example 40 or 12.5." })}
          <FormRow
            id="project-summary"
            label="Scope and notes"
            error={errors.summary}
            className="sm:col-span-2"
          >
            <textarea
              {...controlProps("project-summary", errors.summary)}
              className={textareaClasses}
              rows={6}
              maxLength={10_000}
              defaultValue={values.summary}
            />
          </FormRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Price and revisions" />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormRow id="project-currency" label="Currency" error={errors.currency}>
            <select
              {...controlProps("project-currency", errors.currency)}
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
          <fieldset className="grid content-start gap-1.5">
            <legend className="mb-1.5 text-[13px] font-medium text-ink/90">Pricing</legend>
            <div className="flex h-10 items-center gap-5">
              {PRICING_MODELS.map((model) => (
                <label key={model} className="flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="pricing"
                    value={model}
                    checked={pricing === model}
                    onChange={() => setPricing(model)}
                    className="accent-[var(--color-accent)]"
                  />
                  {PRICING_LABELS[model]}
                </label>
              ))}
            </div>
          </fieldset>
          {input("budget", pricing === "fixed" ? "Price" : "Budget cap (optional)", {
            hint: "For example 1,200 or 1200.50.",
          })}
          {pricing === "hourly" ? (
            input("hourlyRate", "Hourly rate")
          ) : (
            <input type="hidden" name="hourlyRate" value="" />
          )}
          {input("includedRevisions", "Included revision rounds", {
            hint: `0 to ${MAX_INCLUDED_REVISIONS}. The packages include 1, 2 or 3.`,
          })}
          {input("extraRevisionPrice", "Price of an extra round", {
            hint: "Leave empty to agree it each time.",
          })}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" pending={pending === "save"}>
          {editing ? "Save changes" : "Create project"}
        </Button>
        <Link href={cancelHref} className={buttonClasses("ghost")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
