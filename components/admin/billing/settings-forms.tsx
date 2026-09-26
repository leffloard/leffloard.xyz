"use client";

import { useState } from "react";
import {
  saveBankAccountsAction,
  saveBillingProfileAction,
} from "@/app/(admin)/admin/(shell)/billing/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import {
  compactInputClasses,
  inputClasses,
  selectClasses,
  selectFieldClasses,
  textareaClasses,
} from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  DOCUMENT_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type DocumentLabel,
  type PaymentMethod,
} from "@/lib/billing/options";
import { CURRENCIES, CURRENCY_LABELS, type Currency } from "@/lib/money";

export type ProfileValue = {
  version: number;
  documentLabel: DocumentLabel;
  business: { name: string; address: string; email: string; taxId: string; note: string };
  paymentTermsDays: string;
  quoteValidityDays: string;
  methods: PaymentMethod[];
  baseCurrency: Currency;
};

export function ProfileForm({ initial, cryptoReady }: { initial: ProfileValue; cryptoReady: boolean }) {
  const { run, pending, message } = useActionRunner();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const setBusiness = (change: Partial<ProfileValue["business"]>) =>
    setValue((current) => ({ ...current, business: { ...current.business, ...change } }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    // After a save the page re-renders with the new version, so the prop is always the latest.
    const result = await run("save", () => saveBillingProfileAction({ ...value, version: initial.version }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  return (
    <Card>
      <CardHeader title="Your details on documents" description="Printed on new quotes and invoices." />
      <CardBody>
        <form onSubmit={save} className="grid gap-4" noValidate>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormRow
              id="bill-documentLabel"
              label="What invoices are called"
              error={errors.documentLabel}
              hint="Payment request until you're registered for tax and issue e-Arşiv invoices; not legal advice."
              className="sm:col-span-2"
            >
              <select
                {...controlProps("bill-documentLabel", errors.documentLabel, true)}
                className={selectFieldClasses}
                value={value.documentLabel}
                onChange={(event) =>
                  setValue({ ...value, documentLabel: event.target.value as DocumentLabel })
                }
              >
                {DOCUMENT_LABELS.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow id="bill-name" label="Name" error={errors["business.name"]}>
              <input
                {...controlProps("bill-name", errors["business.name"])}
                className={inputClasses}
                maxLength={120}
                value={value.business.name}
                onChange={(event) => setBusiness({ name: event.target.value })}
              />
            </FormRow>
            <FormRow id="bill-email" label="Email" error={errors["business.email"]}>
              <input
                {...controlProps("bill-email", errors["business.email"])}
                type="email"
                className={inputClasses}
                value={value.business.email}
                onChange={(event) => setBusiness({ email: event.target.value })}
              />
            </FormRow>
            <FormRow id="bill-address" label="Address" error={errors["business.address"]}>
              <textarea
                {...controlProps("bill-address", errors["business.address"])}
                className={cn(textareaClasses, "min-h-16")}
                rows={2}
                maxLength={500}
                value={value.business.address}
                onChange={(event) => setBusiness({ address: event.target.value })}
              />
            </FormRow>
            <FormRow id="bill-taxId" label="Tax ID (optional)" error={errors["business.taxId"]}>
              <input
                {...controlProps("bill-taxId", errors["business.taxId"])}
                className={inputClasses}
                maxLength={40}
                value={value.business.taxId}
                onChange={(event) => setBusiness({ taxId: event.target.value })}
              />
            </FormRow>
            <FormRow
              id="bill-note"
              label="Note at the foot (optional)"
              error={errors["business.note"]}
              hint="For example: Not registered for VAT."
              className="sm:col-span-2"
            >
              <input
                {...controlProps("bill-note", errors["business.note"], true)}
                className={inputClasses}
                maxLength={300}
                value={value.business.note}
                onChange={(event) => setBusiness({ note: event.target.value })}
              />
            </FormRow>
            <FormRow
              id="bill-paymentTermsDays"
              label="Invoices due after (days)"
              error={errors.paymentTermsDays}
            >
              <input
                {...controlProps("bill-paymentTermsDays", errors.paymentTermsDays)}
                inputMode="numeric"
                className={inputClasses}
                value={value.paymentTermsDays}
                onChange={(event) => setValue({ ...value, paymentTermsDays: event.target.value })}
              />
            </FormRow>
            <FormRow
              id="bill-quoteValidityDays"
              label="Quotes valid for (days)"
              error={errors.quoteValidityDays}
            >
              <input
                {...controlProps("bill-quoteValidityDays", errors.quoteValidityDays)}
                inputMode="numeric"
                className={inputClasses}
                value={value.quoteValidityDays}
                onChange={(event) => setValue({ ...value, quoteValidityDays: event.target.value })}
              />
            </FormRow>
            <FormRow
              id="bill-baseCurrency"
              label="Currency of the finance reports"
              error={errors.baseCurrency}
              hint="Totals in other currencies are converted at the central bank's rate of the day."
            >
              <select
                {...controlProps("bill-baseCurrency", errors.baseCurrency, true)}
                className={selectFieldClasses}
                value={value.baseCurrency}
                onChange={(event) => setValue({ ...value, baseCurrency: event.target.value as Currency })}
              >
                {CURRENCIES.map((currency) => (
                  <option key={currency} value={currency}>
                    {CURRENCY_LABELS[currency]}
                  </option>
                ))}
              </select>
            </FormRow>
            <fieldset className="grid content-start gap-2 text-[13px]">
              <legend className="mb-1.5 font-medium text-ink/90">Ways to pay on new invoices</legend>
              {PAYMENT_METHODS.filter((method) => method !== "card").map((method) => {
                const available = method === "bank" || cryptoReady;
                return (
                  <label key={method} className={cn("flex items-center gap-2", !available && "text-muted")}>
                    <input
                      type="checkbox"
                      disabled={!available}
                      checked={value.methods.includes(method)}
                      onChange={(event) =>
                        setValue({
                          ...value,
                          methods: event.target.checked
                            ? [...value.methods, method]
                            : value.methods.filter((item) => item !== method),
                        })
                      }
                      className="accent-[var(--color-accent)]"
                    />
                    {PAYMENT_METHOD_LABELS[method]}
                    {available ? "" : " (set up NOWPayments first)"}
                  </label>
                );
              })}
              {errors.methods ? <p className="text-xs text-danger">{errors.methods}</p> : null}
            </fieldset>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" variant="primary" pending={pending === "save"}>
              Save details
            </Button>
            {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export type BankAccountValue = {
  id: string;
  label: string;
  holder: string;
  bankName: string;
  iban: string;
  swift: string;
  currency: Currency | "any";
};

function newAccount(): BankAccountValue {
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}`;
  return { id, label: "", holder: "", bankName: "", iban: "", swift: "", currency: "TRY" };
}

const FIELDS: { key: keyof Omit<BankAccountValue, "id" | "currency">; label: string; wide?: boolean }[] = [
  { key: "label", label: "Name (for you)" },
  { key: "holder", label: "Account holder" },
  { key: "bankName", label: "Bank" },
  { key: "iban", label: "IBAN", wide: true },
  { key: "swift", label: "SWIFT / BIC (optional)" },
];

export function BankAccountsForm({ initial, version }: { initial: BankAccountValue[]; version: number }) {
  const { run, pending, message } = useActionRunner();
  const [accounts, setAccounts] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function update(index: number, change: Partial<BankAccountValue>) {
    setAccounts((current) =>
      current.map((account, at) => (at === index ? { ...account, ...change } : account)),
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("save", () => saveBankAccountsAction({ version, accounts }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  return (
    <Card>
      <CardHeader
        title="Bank accounts"
        description="Printed on invoices that offer bank transfer, matched to the invoice's currency."
      />
      <CardBody>
        <form onSubmit={save} className="grid gap-5" noValidate>
          {accounts.length === 0 ? (
            <p className="text-[13px] text-muted">
              None yet. Invoices can&apos;t offer bank transfer until you add one.
            </p>
          ) : null}
          {accounts.map((account, index) => (
            <fieldset key={account.id} className="grid gap-3 rounded-lg border border-line p-4">
              <legend className="px-1 text-[13px] font-medium">
                {account.label || `Account ${index + 1}`}
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {FIELDS.map((field) => {
                  const id = `bank-${index}-${field.key}`;
                  const error = errors[`accounts.${index}.${field.key}`];
                  return (
                    <FormRow
                      key={field.key}
                      id={id}
                      label={field.label}
                      error={error}
                      className={field.wide ? "sm:col-span-2" : undefined}
                    >
                      <input
                        id={id}
                        aria-invalid={error ? true : undefined}
                        aria-describedby={error ? `${id}-error` : undefined}
                        className={cn(
                          field.key === "iban" || field.key === "swift" ? "font-mono" : "",
                          compactInputClasses,
                          "h-9",
                        )}
                        maxLength={field.key === "iban" ? 64 : 120}
                        autoComplete="off"
                        spellCheck={false}
                        value={account[field.key]}
                        onChange={(event) => update(index, { [field.key]: event.target.value })}
                      />
                    </FormRow>
                  );
                })}
                <FormRow id={`bank-${index}-currency`} label="Takes">
                  <select
                    id={`bank-${index}-currency`}
                    className={cn(selectClasses, "h-9 w-full")}
                    value={account.currency}
                    onChange={(event) =>
                      update(index, { currency: event.target.value as BankAccountValue["currency"] })
                    }
                  >
                    <option value="any">Any currency</option>
                    {CURRENCIES.map((currency) => (
                      <option key={currency} value={currency}>
                        {CURRENCY_LABELS[currency]}
                      </option>
                    ))}
                  </select>
                </FormRow>
              </div>
              <div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setAccounts(accounts.filter((_, at) => at !== index))}
                >
                  Remove this account
                </Button>
              </div>
            </fieldset>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            {accounts.length < 5 ? (
              <Button size="sm" onClick={() => setAccounts([...accounts, newAccount()])}>
                Add an account
              </Button>
            ) : null}
            <Button type="submit" size="sm" variant="primary" pending={pending === "save"}>
              Save bank accounts
            </Button>
          </div>
          <p className="text-xs text-muted">
            Saving asks you to confirm it&apos;s you, is written to the activity log, and emails you, so a
            stolen session can&apos;t quietly change where clients send money.
          </p>
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        </form>
      </CardBody>
    </Card>
  );
}
