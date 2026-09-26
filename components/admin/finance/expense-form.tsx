"use client";

import { useState } from "react";
import { deleteExpenseAction, saveExpenseAction } from "@/app/(admin)/admin/(shell)/finance/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { inputClasses, selectFieldClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS, type ExpenseCategory } from "@/lib/finance/options";
import { CURRENCIES, CURRENCY_LABELS, type Currency } from "@/lib/money";

// An expense: when, how much, what for, who was paid. The receipt's number helps find it later.

export type ExpenseValue = {
  date: string;
  amount: string;
  currency: Currency;
  category: ExpenseCategory;
  vendor: string;
  description: string;
  reference: string;
  projectId: string;
};

export function ExpenseForm({
  id,
  version,
  initial,
  projects,
}: {
  id: string | null;
  version: number;
  initial: ExpenseValue;
  projects: { id: string; label: string }[];
}) {
  const { run, pending, message } = useActionRunner();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);

  function set<K extends keyof ExpenseValue>(key: K, next: ExpenseValue[K]) {
    setValue((current) => ({ ...current, [key]: next }));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("save", () => saveExpenseAction({ id: id ?? "", version, ...value }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  return (
    <form onSubmit={save} className="grid gap-6" noValidate>
      <Card>
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormRow id="expense-date" label="Paid on" error={errors.date}>
            <input
              {...controlProps("expense-date", errors.date)}
              type="date"
              className={inputClasses}
              value={value.date}
              onChange={(event) => set("date", event.target.value)}
            />
          </FormRow>
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-3">
            <FormRow id="expense-amount" label="Amount" error={errors.amount}>
              <input
                {...controlProps("expense-amount", errors.amount)}
                inputMode="decimal"
                className={inputClasses}
                placeholder="12.50"
                value={value.amount}
                onChange={(event) => set("amount", event.target.value)}
              />
            </FormRow>
            <FormRow id="expense-currency" label="Currency" error={errors.currency}>
              <select
                {...controlProps("expense-currency", errors.currency)}
                className={selectFieldClasses}
                value={value.currency}
                onChange={(event) => set("currency", event.target.value as Currency)}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {CURRENCY_LABELS[currency]}
                  </option>
                ))}
              </select>
            </FormRow>
          </div>
          <FormRow id="expense-vendor" label="Paid to" error={errors.vendor}>
            <input
              {...controlProps("expense-vendor", errors.vendor)}
              className={inputClasses}
              maxLength={200}
              placeholder="Hetzner"
              value={value.vendor}
              onChange={(event) => set("vendor", event.target.value)}
            />
          </FormRow>
          <FormRow id="expense-category" label="Category" error={errors.category}>
            <select
              {...controlProps("expense-category", errors.category)}
              className={selectFieldClasses}
              value={value.category}
              onChange={(event) => set("category", event.target.value as ExpenseCategory)}
            >
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {EXPENSE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow
            id="expense-description"
            label="What for (optional)"
            error={errors.description}
            className="sm:col-span-2"
          >
            <input
              {...controlProps("expense-description", errors.description)}
              className={inputClasses}
              maxLength={500}
              placeholder="VPS for client sites, September"
              value={value.description}
              onChange={(event) => set("description", event.target.value)}
            />
          </FormRow>
          <FormRow
            id="expense-reference"
            label="Receipt or invoice number (optional)"
            error={errors.reference}
          >
            <input
              {...controlProps("expense-reference", errors.reference)}
              className={inputClasses}
              maxLength={120}
              value={value.reference}
              onChange={(event) => set("reference", event.target.value)}
            />
          </FormRow>
          <FormRow id="expense-projectId" label="For a project (optional)" error={errors.projectId}>
            <select
              {...controlProps("expense-projectId", errors.projectId)}
              className={selectFieldClasses}
              value={value.projectId}
              onChange={(event) => set("projectId", event.target.value)}
            >
              <option value="">No project</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.label}
                </option>
              ))}
            </select>
          </FormRow>
        </CardBody>
      </Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" pending={pending === "save"}>
          {id ? "Save" : "Add the expense"}
        </Button>
        {id ? (
          confirming ? (
            <span className="flex items-center gap-2 text-[13px]">
              Delete this expense?
              <Button
                size="sm"
                variant="danger"
                pending={pending === "delete"}
                onClick={() => run("delete", () => deleteExpenseAction({ id }))}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Keep it
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              Delete…
            </Button>
          )
        ) : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </div>
    </form>
  );
}
