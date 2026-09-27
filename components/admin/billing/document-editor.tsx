"use client";

import { useMemo, useState } from "react";
import {
  saveInvoiceAction,
  saveQuoteAction,
  saveRecurringAction,
} from "@/app/(admin)/admin/(shell)/billing/actions";
import { QuoteAssist } from "@/components/admin/ai/quote-assist";
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
  computeTotals,
  lineAmount,
  MAX_LINES,
  MAX_TAXES,
  parsePercent,
  parseQuantity,
  SCHEDULES,
  scheduleAmounts,
  type Discount,
  type LineItem,
  type ScheduleKey,
} from "@/lib/billing/document";
import type { QuoteSuggestion } from "@/lib/ai/schemas";
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PaymentMethod } from "@/lib/billing/options";
import {
  RECURRING_INTERVAL_LABELS,
  RECURRING_INTERVALS,
  type RecurringInterval,
} from "@/lib/billing/recurring";
import { CURRENCIES, CURRENCY_LABELS, formatMoney, money, parseAmount, type Currency } from "@/lib/money";

// The quote and invoice editor: who it's for, the lines, a discount and taxes, and (for a quote) its terms or
// (for an invoice) the ways to pay; a recurring invoice adds how often it's issued. Totals are worked out as
// you type, with the same rules the server uses.

export type EditorLine = { id: string; description: string; quantity: string; unitPrice: string };

export type EditorValue = {
  title: string;
  clientId: string;
  projectId: string;
  inquiryId: string;
  recipient: { name: string; company: string; email: string; address: string };
  currency: Currency;
  lines: EditorLine[];
  discount: { kind: "none" | "percent" | "amount"; value: string };
  taxes: { label: string; percent: string }[];
  notes: string;
  schedule: ScheduleKey;
  timeline: string;
  revisionsIncluded: string;
  extraRevisionPrice: string;
  methods: PaymentMethod[];
  repeat: { interval: RecurringInterval; nextOn: string; endOn: string };
};

export type ClientOption = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  currency: Currency;
};

export type CatalogItem = { label: string; description: string; unitPrice: string };

function newLine(): EditorLine {
  const id = typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
  return { id: id.replace(/[^A-Za-z0-9-]/g, "").slice(0, 64), description: "", quantity: "1", unitPrice: "" };
}

// Lines as numbers, skipping any that can't be read yet (the server shows their errors on save).
function readLines(lines: EditorLine[]): LineItem[] {
  const read: LineItem[] = [];
  for (const line of lines) {
    const quantity = parseQuantity(line.quantity);
    const price = parseAmount(line.unitPrice);
    if (quantity.ok && price.ok && price.minor !== null) {
      read.push({
        id: line.id,
        description: line.description,
        quantityMilli: quantity.value,
        unitMinor: price.minor,
      });
    }
  }
  return read;
}

function readDiscount(discount: EditorValue["discount"]): Discount | null {
  if (discount.kind === "percent") {
    const percent = parsePercent(discount.value);
    return percent.ok ? { kind: "percent", basisPoints: percent.value } : null;
  }
  if (discount.kind === "amount") {
    const amount = parseAmount(discount.value);
    return amount.ok && amount.minor ? { kind: "amount", amountMinor: amount.minor } : null;
  }
  return null;
}

export function DocumentEditor({
  kind,
  id,
  version,
  initial,
  clients,
  projects = [],
  catalog,
  cryptoReady,
  ai = null,
}: {
  kind: "quote" | "invoice" | "credit" | "recurring";
  id: string | null;
  version: number;
  initial: EditorValue;
  clients: ClientOption[];
  projects?: { id: string; label: string; clientId: string }[];
  catalog: CatalogItem[];
  cryptoReady: boolean;
  // A quote made from an inbox message: the AI can suggest its lines.
  ai?: { inquiryId: string; disabledReason: string | null } | null;
}) {
  const { run, pending, message } = useActionRunner();
  const [value, setValue] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const quote = kind === "quote";
  const recurring = kind === "recurring";
  const payable = kind === "invoice" || recurring;

  function set<K extends keyof EditorValue>(key: K, next: EditorValue[K]) {
    setValue((current) => ({ ...current, [key]: next }));
  }
  function setRecipient(change: Partial<EditorValue["recipient"]>) {
    setValue((current) => ({ ...current, recipient: { ...current.recipient, ...change } }));
  }
  function setLine(index: number, change: Partial<EditorLine>) {
    setValue((current) => ({
      ...current,
      lines: current.lines.map((line, at) => (at === index ? { ...line, ...change } : line)),
    }));
  }

  // Choosing a client fills in who it's for (and their currency, while there are no prices yet).
  function chooseClient(clientId: string) {
    const client = clients.find((option) => option.id === clientId);
    setValue((current) => ({
      ...current,
      clientId,
      projectId: projects.some((project) => project.id === current.projectId && project.clientId === clientId)
        ? current.projectId
        : "",
      recipient: client
        ? {
            name: client.name,
            company: client.company ?? "",
            email: client.email ?? "",
            address: current.recipient.address,
          }
        : current.recipient,
      currency: client && current.lines.every((line) => !line.unitPrice) ? client.currency : current.currency,
    }));
  }

  // The AI's lines replace a blank first line, or follow the lines already there; the title, timeline and
  // revision rounds are filled in only while the timeline is still empty.
  function applySuggestion(suggestion: QuoteSuggestion) {
    setValue((current) => {
      const blank = current.lines.every((line) => !line.description.trim() && !line.unitPrice.trim());
      const added = suggestion.lines.map((line) => ({
        ...newLine(),
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
      }));
      const lines = (blank ? added : [...current.lines, ...added]).slice(0, MAX_LINES);
      const fresh = !current.timeline.trim();
      return {
        ...current,
        title: current.title.trim() ? current.title : suggestion.title,
        lines: lines.length ? lines : current.lines,
        timeline: fresh ? suggestion.timeline : current.timeline,
        revisionsIncluded: fresh ? suggestion.revisionsIncluded : current.revisionsIncluded,
      };
    });
  }

  const preview = useMemo(() => {
    const lines = readLines(value.lines);
    try {
      const totals = computeTotals(
        lines,
        readDiscount(value.discount),
        value.taxes.flatMap((tax) => {
          const percent = parsePercent(tax.percent);
          return percent.ok ? [{ label: tax.label || "Tax", basisPoints: percent.value }] : [];
        }),
      );
      return { totals, tooLarge: false };
    } catch {
      return { totals: null, tooLarge: true };
    }
  }, [value.lines, value.discount, value.taxes]);

  const format = (minor: number) => formatMoney(money(minor, value.currency));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const common = {
      id: id ?? "",
      version,
      title: value.title,
      recipient: value.recipient,
      currency: value.currency,
      lines: value.lines,
      discount: value.discount,
      taxes: value.taxes,
      notes: value.notes,
    };
    const result = await run("save", () =>
      quote
        ? saveQuoteAction({
            ...common,
            clientId: value.clientId,
            inquiryId: value.inquiryId,
            schedule: value.schedule,
            timeline: value.timeline,
            revisionsIncluded: value.revisionsIncluded,
            extraRevisionPrice: value.extraRevisionPrice,
          })
        : recurring
          ? saveRecurringAction({
              ...common,
              clientId: value.clientId,
              projectId: value.projectId,
              methods: value.methods,
              interval: value.repeat.interval,
              nextOn: value.repeat.nextOn,
              endOn: value.repeat.endOn,
            })
          : saveInvoiceAction({
              ...common,
              clientId: value.clientId,
              projectId: value.projectId,
              methods: kind === "credit" ? [] : value.methods,
            }),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
  }

  const clientProjects = projects.filter((project) => project.clientId === value.clientId);
  const scheduleShares = preview.totals
    ? scheduleAmounts(
        preview.totals,
        value.taxes.flatMap((tax) => {
          const percent = parsePercent(tax.percent);
          return percent.ok ? [{ label: tax.label || "Tax", basisPoints: percent.value }] : [];
        }),
        [...SCHEDULES[value.schedule].steps],
      )
    : null;

  return (
    <form onSubmit={save} className="grid gap-6" noValidate>
      <Card>
        <CardHeader title={quote ? "Who it's for" : "Billed to"} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <FormRow
            id="doc-clientId"
            label={quote ? "Client" : "Client (optional)"}
            error={errors.clientId}
            hint={quote ? "A quote belongs to a client: make one from an inbox message." : undefined}
          >
            <select
              {...controlProps("doc-clientId", errors.clientId, quote)}
              className={selectFieldClasses}
              value={value.clientId}
              onChange={(event) => chooseClient(event.target.value)}
            >
              <option value="">{quote ? "Choose a client…" : "No client"}</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company ? `${client.name} (${client.company})` : client.name}
                </option>
              ))}
            </select>
          </FormRow>
          {payable || kind === "credit" ? (
            <FormRow id="doc-projectId" label="Project (optional)" error={errors.projectId}>
              <select
                {...controlProps("doc-projectId", errors.projectId)}
                className={selectFieldClasses}
                value={value.projectId}
                onChange={(event) => set("projectId", event.target.value)}
                disabled={!clientProjects.length}
              >
                <option value="">No project</option>
                {clientProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.label}
                  </option>
                ))}
              </select>
            </FormRow>
          ) : (
            <div />
          )}
          <FormRow id="doc-recipient-name" label="Name" error={errors["recipient.name"]}>
            <input
              {...controlProps("doc-recipient-name", errors["recipient.name"])}
              className={inputClasses}
              maxLength={120}
              value={value.recipient.name}
              onChange={(event) => setRecipient({ name: event.target.value })}
            />
          </FormRow>
          <FormRow id="doc-recipient-company" label="Company (optional)" error={errors["recipient.company"]}>
            <input
              {...controlProps("doc-recipient-company", errors["recipient.company"])}
              className={inputClasses}
              maxLength={120}
              value={value.recipient.company}
              onChange={(event) => setRecipient({ company: event.target.value })}
            />
          </FormRow>
          <FormRow
            id="doc-recipient-email"
            label="Email"
            error={errors["recipient.email"]}
            hint={quote ? "The quote's link goes here." : undefined}
          >
            <input
              {...controlProps("doc-recipient-email", errors["recipient.email"], quote)}
              type="email"
              className={inputClasses}
              value={value.recipient.email}
              onChange={(event) => setRecipient({ email: event.target.value })}
            />
          </FormRow>
          <FormRow id="doc-recipient-address" label="Address (optional)" error={errors["recipient.address"]}>
            <textarea
              {...controlProps("doc-recipient-address", errors["recipient.address"])}
              className={cn(textareaClasses, "min-h-10")}
              rows={2}
              maxLength={500}
              value={value.recipient.address}
              onChange={(event) => setRecipient({ address: event.target.value })}
            />
          </FormRow>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="What it's for" />
        <CardBody className="grid gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_200px]">
            <FormRow
              id="doc-title"
              label="Title"
              error={errors.title}
              hint={
                recurring
                  ? "Write {period} where the months each invoice covers go: in the title, the lines or the notes."
                  : undefined
              }
            >
              <input
                {...controlProps("doc-title", errors.title, recurring)}
                className={inputClasses}
                maxLength={120}
                placeholder={recurring ? "Care plan: {period}" : "Business site for Çınar Fırın"}
                value={value.title}
                onChange={(event) => set("title", event.target.value)}
              />
            </FormRow>
            <FormRow id="doc-currency" label="Currency" error={errors.currency}>
              <select
                {...controlProps("doc-currency", errors.currency)}
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

          {quote && ai ? (
            <QuoteAssist
              inquiryId={ai.inquiryId}
              currency={value.currency}
              disabledReason={ai.disabledReason}
              onApply={applySuggestion}
            />
          ) : null}
          <fieldset className="grid gap-3">
            <legend className="mb-1 text-[13px] font-medium text-ink/90">Lines</legend>
            <div className="hidden grid-cols-[minmax(0,1fr)_80px_130px_120px_32px] gap-2 text-xs text-muted sm:grid">
              <span>Description</span>
              <span>Qty</span>
              <span>Unit price</span>
              <span className="text-right">Amount</span>
              <span />
            </div>
            {value.lines.map((line, index) => {
              const label = `Line ${index + 1}`;
              const lineErrors = ["description", "quantity", "unitPrice"]
                .map((field) => errors[`lines.${index}.${field}`])
                .filter(Boolean);
              const quantity = parseQuantity(line.quantity);
              const price = parseAmount(line.unitPrice);
              const amount =
                quantity.ok && price.ok && price.minor !== null
                  ? format(lineAmount({ quantityMilli: quantity.value, unitMinor: price.minor }))
                  : "—";
              return (
                <div key={line.id} className="grid gap-1.5 border-b border-line pb-3 sm:border-0 sm:pb-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_80px_110px_32px] items-start gap-2 sm:grid-cols-[minmax(0,1fr)_80px_130px_120px_32px]">
                    <textarea
                      aria-label={`${label}, description`}
                      aria-invalid={errors[`lines.${index}.description`] ? true : undefined}
                      className={cn(
                        compactInputClasses,
                        "col-span-4 h-auto min-h-8 py-1.5 leading-5 sm:col-span-1",
                      )}
                      rows={1}
                      maxLength={2000}
                      value={line.description}
                      onChange={(event) => setLine(index, { description: event.target.value })}
                    />
                    <input
                      aria-label={`${label}, quantity`}
                      aria-invalid={errors[`lines.${index}.quantity`] ? true : undefined}
                      inputMode="decimal"
                      className={compactInputClasses}
                      value={line.quantity}
                      onChange={(event) => setLine(index, { quantity: event.target.value })}
                    />
                    <input
                      aria-label={`${label}, unit price`}
                      aria-invalid={errors[`lines.${index}.unitPrice`] ? true : undefined}
                      inputMode="decimal"
                      placeholder="0.00"
                      className={compactInputClasses}
                      value={line.unitPrice}
                      onChange={(event) => setLine(index, { unitPrice: event.target.value })}
                    />
                    <span className="hidden self-center text-right font-mono text-[13px] tabular-nums sm:block">
                      {amount}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${label.toLowerCase()}`}
                      disabled={value.lines.length === 1}
                      onClick={() =>
                        set(
                          "lines",
                          value.lines.filter((_, at) => at !== index),
                        )
                      }
                    >
                      ×
                    </Button>
                  </div>
                  {lineErrors.map((error) => (
                    <p key={error} className="text-xs text-danger">
                      {error}
                    </p>
                  ))}
                </div>
              );
            })}
            {errors.lines ? <p className="text-xs text-danger">{errors.lines}</p> : null}
            <div className="flex flex-wrap items-center gap-2">
              {value.lines.length < MAX_LINES ? (
                <Button size="sm" variant="ghost" onClick={() => set("lines", [...value.lines, newLine()])}>
                  + Line
                </Button>
              ) : null}
              {catalog.length && value.lines.length < MAX_LINES ? (
                <>
                  <label htmlFor="doc-catalog" className="sr-only">
                    Add from the services
                  </label>
                  <select
                    id="doc-catalog"
                    className={selectClasses}
                    value=""
                    onChange={(event) => {
                      const item = catalog[Number(event.target.value)];
                      if (!item) return;
                      const blank =
                        value.lines.length === 1 &&
                        !value.lines[0]!.description &&
                        !value.lines[0]!.unitPrice;
                      const added = {
                        ...newLine(),
                        description: item.description,
                        unitPrice: item.unitPrice,
                      };
                      set("lines", blank ? [added] : [...value.lines, added]);
                    }}
                  >
                    <option value="">Add from the services…</option>
                    {catalog.map((item, index) => (
                      <option key={item.label} value={index}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </>
              ) : null}
            </div>
          </fieldset>

          <div className="grid gap-4 border-t border-line pt-4 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="grid content-start gap-4">
              <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
                <FormRow id="doc-discount-kind" label="Discount">
                  <select
                    {...controlProps("doc-discount-kind")}
                    className={selectFieldClasses}
                    value={value.discount.kind}
                    onChange={(event) =>
                      set("discount", {
                        ...value.discount,
                        kind: event.target.value as EditorValue["discount"]["kind"],
                      })
                    }
                  >
                    <option value="none">None</option>
                    <option value="percent">Percentage</option>
                    <option value="amount">Amount</option>
                  </select>
                </FormRow>
                {value.discount.kind !== "none" ? (
                  <FormRow
                    id="doc-discount-value"
                    label={value.discount.kind === "percent" ? "Percentage off" : "Amount off"}
                    error={errors["discount.value"]}
                  >
                    <input
                      {...controlProps("doc-discount-value", errors["discount.value"])}
                      inputMode="decimal"
                      className={inputClasses}
                      value={value.discount.value}
                      onChange={(event) => set("discount", { ...value.discount, value: event.target.value })}
                    />
                  </FormRow>
                ) : null}
              </div>
              <fieldset className="grid gap-2">
                <legend className="mb-1 text-[13px] font-medium text-ink/90">Taxes</legend>
                {value.taxes.length === 0 ? (
                  <p className="text-xs text-muted">None. Add one if you charge VAT or another tax.</p>
                ) : null}
                {value.taxes.map((tax, index) => (
                  <div key={index} className="grid gap-1">
                    <div className="flex items-center gap-2">
                      <input
                        aria-label={`Tax ${index + 1}, name`}
                        aria-invalid={errors[`taxes.${index}.label`] ? true : undefined}
                        className={cn(compactInputClasses, "min-w-0 flex-1")}
                        maxLength={40}
                        placeholder="VAT"
                        value={tax.label}
                        onChange={(event) =>
                          set(
                            "taxes",
                            value.taxes.map((item, at) =>
                              at === index ? { ...item, label: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <input
                        aria-label={`Tax ${index + 1}, percentage`}
                        aria-invalid={errors[`taxes.${index}.percent`] ? true : undefined}
                        inputMode="decimal"
                        className={cn(compactInputClasses, "w-24")}
                        placeholder="20"
                        value={tax.percent}
                        onChange={(event) =>
                          set(
                            "taxes",
                            value.taxes.map((item, at) =>
                              at === index ? { ...item, percent: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <span className="text-[13px] text-muted">%</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Remove tax ${index + 1}`}
                        onClick={() =>
                          set(
                            "taxes",
                            value.taxes.filter((_, at) => at !== index),
                          )
                        }
                      >
                        ×
                      </Button>
                    </div>
                    {[errors[`taxes.${index}.label`], errors[`taxes.${index}.percent`]]
                      .filter(Boolean)
                      .map((error) => (
                        <p key={error} className="text-xs text-danger">
                          {error}
                        </p>
                      ))}
                  </div>
                ))}
                {value.taxes.length < MAX_TAXES ? (
                  <div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => set("taxes", [...value.taxes, { label: "VAT", percent: "20" }])}
                    >
                      + Tax
                    </Button>
                  </div>
                ) : null}
              </fieldset>
            </div>
            <dl
              aria-live="polite"
              className="grid content-start gap-1.5 rounded-lg border border-line bg-canvas p-4 text-[13px]"
            >
              {preview.totals ? (
                <>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted">Subtotal</dt>
                    <dd className="font-mono tabular-nums">{format(preview.totals.subtotalMinor)}</dd>
                  </div>
                  {preview.totals.discountMinor ? (
                    <div className="flex justify-between gap-4">
                      <dt className="text-muted">Discount</dt>
                      <dd className="font-mono tabular-nums">-{format(preview.totals.discountMinor)}</dd>
                    </div>
                  ) : null}
                  {preview.totals.taxes.map((tax, index) => (
                    <div key={index} className="flex justify-between gap-4">
                      <dt className="text-muted">{tax.label}</dt>
                      <dd className="font-mono tabular-nums">{format(tax.amountMinor)}</dd>
                    </div>
                  ))}
                  <div className="mt-1 flex justify-between gap-4 border-t border-line pt-2 text-sm font-semibold">
                    <dt>Total</dt>
                    <dd className="font-mono tabular-nums">{format(preview.totals.totalMinor)}</dd>
                  </div>
                </>
              ) : (
                <p className="text-danger">The total is too large: check the quantities and prices.</p>
              )}
            </dl>
          </div>
        </CardBody>
      </Card>

      {quote ? (
        <Card>
          <CardHeader title="Terms" />
          <CardBody className="grid gap-4 sm:grid-cols-2">
            <FormRow id="doc-schedule" label="Payments" error={errors.schedule} className="sm:col-span-2">
              <select
                {...controlProps("doc-schedule", errors.schedule)}
                className={selectFieldClasses}
                value={value.schedule}
                onChange={(event) => set("schedule", event.target.value as ScheduleKey)}
              >
                {(Object.keys(SCHEDULES) as ScheduleKey[]).map((key) => (
                  <option key={key} value={key}>
                    {SCHEDULES[key].label}
                  </option>
                ))}
              </select>
            </FormRow>
            {scheduleShares ? (
              <p className="text-xs text-muted sm:col-span-2">
                {SCHEDULES[value.schedule].steps
                  .map((step, index) => `${step.label}: ${format(scheduleShares[index] ?? 0)}`)
                  .join(" · ")}
                . The first is invoiced when the client accepts.
              </p>
            ) : null}
            <FormRow id="doc-timeline" label="Timeline (optional)" error={errors.timeline}>
              <input
                {...controlProps("doc-timeline", errors.timeline)}
                className={inputClasses}
                maxLength={120}
                placeholder="About 3 weeks"
                value={value.timeline}
                onChange={(event) => set("timeline", event.target.value)}
              />
            </FormRow>
            <FormRow
              id="doc-revisionsIncluded"
              label="Revision rounds included"
              error={errors.revisionsIncluded}
            >
              <input
                {...controlProps("doc-revisionsIncluded", errors.revisionsIncluded)}
                inputMode="numeric"
                className={inputClasses}
                value={value.revisionsIncluded}
                onChange={(event) => set("revisionsIncluded", event.target.value)}
              />
            </FormRow>
            <FormRow
              id="doc-extraRevisionPrice"
              label="Price of each further round (optional)"
              error={errors.extraRevisionPrice}
            >
              <input
                {...controlProps("doc-extraRevisionPrice", errors.extraRevisionPrice)}
                inputMode="decimal"
                className={inputClasses}
                value={value.extraRevisionPrice}
                onChange={(event) => set("extraRevisionPrice", event.target.value)}
              />
            </FormRow>
          </CardBody>
        </Card>
      ) : null}

      {recurring ? (
        <Card>
          <CardHeader
            title="How often"
            description="Each invoice is issued in the morning of its date and emailed to the client."
          />
          <CardBody className="grid gap-4 sm:grid-cols-3">
            <FormRow id="doc-interval" label="Issued" error={errors.interval}>
              <select
                {...controlProps("doc-interval", errors.interval)}
                className={selectFieldClasses}
                value={value.repeat.interval}
                onChange={(event) =>
                  set("repeat", { ...value.repeat, interval: event.target.value as RecurringInterval })
                }
              >
                {RECURRING_INTERVALS.map((interval) => (
                  <option key={interval} value={interval}>
                    {RECURRING_INTERVAL_LABELS[interval]}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow
              id="doc-nextOn"
              label={id ? "Next invoice on" : "First invoice on"}
              error={errors.nextOn}
              hint="Later ones fall on the same day of the month."
            >
              <input
                {...controlProps("doc-nextOn", errors.nextOn, true)}
                type="date"
                className={inputClasses}
                value={value.repeat.nextOn}
                onChange={(event) => set("repeat", { ...value.repeat, nextOn: event.target.value })}
              />
            </FormRow>
            <FormRow id="doc-endOn" label="Last one by (optional)" error={errors.endOn}>
              <input
                {...controlProps("doc-endOn", errors.endOn)}
                type="date"
                className={inputClasses}
                value={value.repeat.endOn}
                onChange={(event) => set("repeat", { ...value.repeat, endOn: event.target.value })}
              />
            </FormRow>
          </CardBody>
        </Card>
      ) : null}

      {payable ? (
        <Card>
          <CardHeader title="Ways to pay" description="Only these show on the client's page." />
          <CardBody className="grid gap-2 text-[13px]">
            {PAYMENT_METHODS.map((method) => {
              const available = method === "bank" || (method === "crypto" && cryptoReady);
              const note =
                method === "crypto" && !cryptoReady
                  ? " (set up NOWPayments first)"
                  : method === "card"
                    ? " (no card provider connected yet)"
                    : "";
              return (
                <label key={method} className={cn("flex items-center gap-2", !available && "text-muted")}>
                  <input
                    type="checkbox"
                    disabled={!available}
                    checked={available && value.methods.includes(method)}
                    onChange={(event) =>
                      set(
                        "methods",
                        event.target.checked
                          ? [...value.methods, method]
                          : value.methods.filter((item) => item !== method),
                      )
                    }
                    className="accent-[var(--color-accent)]"
                  />
                  {PAYMENT_METHOD_LABELS[method]}
                  {note}
                </label>
              );
            })}
            {errors.methods ? <p className="text-xs text-danger">{errors.methods}</p> : null}
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardBody>
          <FormRow
            id="doc-notes"
            label="Notes on the document (optional)"
            error={errors.notes}
            hint={quote ? "Scope limits, what the client provides, what isn't included." : undefined}
          >
            <textarea
              {...controlProps("doc-notes", errors.notes, quote)}
              className={textareaClasses}
              rows={3}
              maxLength={2000}
              value={value.notes}
              onChange={(event) => set("notes", event.target.value)}
            />
          </FormRow>
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" pending={pending === "save"}>
          {id
            ? "Save"
            : quote
              ? "Create the quote"
              : kind === "credit"
                ? "Create the credit note"
                : recurring
                  ? "Create the plan"
                  : "Create the invoice"}
        </Button>
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      </div>
    </form>
  );
}
