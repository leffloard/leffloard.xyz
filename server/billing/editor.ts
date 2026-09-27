import "server-only";
import { randomUUID } from "node:crypto";
import type { EditorValue } from "@/components/admin/billing/document-editor";
import {
  formatPercent,
  formatQuantity,
  SCHEDULES,
  type ScheduleKey,
  type ScheduleStep,
} from "@/lib/billing/document";
import type { PaymentMethod } from "@/lib/billing/options";
import { amountInput, money, type Currency } from "@/lib/money";
import type { InvoiceDoc, QuoteDoc, RecurringInvoiceDoc } from "@/server/billing/types";

// Documents as the editor's form values (the text the owner types), and a blank one to start from.

function scheduleKey(steps: ScheduleStep[]): ScheduleKey {
  const shape = steps.map((step) => step.basisPoints).join("/");
  const match = (Object.keys(SCHEDULES) as ScheduleKey[]).find(
    (key) => SCHEDULES[key].steps.map((step) => step.basisPoints).join("/") === shape,
  );
  return match ?? "half";
}

const NO_REPEAT: EditorValue["repeat"] = { interval: "month", nextOn: "", endOn: "" };

function contentValue(doc: QuoteDoc | InvoiceDoc | RecurringInvoiceDoc) {
  const price = (minor: number) => amountInput(money(minor, doc.currency));
  return {
    title: doc.title,
    recipient: {
      name: doc.recipient.name,
      company: doc.recipient.company ?? "",
      email: doc.recipient.email ?? "",
      address: doc.recipient.address,
    },
    currency: doc.currency,
    lines: doc.lines.map((line) => ({
      id: line.id,
      description: line.description,
      quantity: formatQuantity(line.quantityMilli),
      unitPrice: price(line.unitMinor),
    })),
    discount: !doc.discount
      ? { kind: "none" as const, value: "" }
      : doc.discount.kind === "percent"
        ? { kind: "percent" as const, value: formatPercent(doc.discount.basisPoints).replace("%", "") }
        : { kind: "amount" as const, value: price(doc.discount.amountMinor) },
    taxes: doc.taxes.map((tax) => ({
      label: tax.label,
      percent: formatPercent(tax.basisPoints).replace("%", ""),
    })),
    notes: doc.notes,
  };
}

export function blankEditorValue(defaults: {
  title?: string;
  clientId?: string;
  projectId?: string;
  inquiryId?: string;
  recipient?: EditorValue["recipient"];
  currency: Currency;
  methods: PaymentMethod[];
  nextOn?: string;
}): EditorValue {
  return {
    title: defaults.title ?? "",
    clientId: defaults.clientId ?? "",
    projectId: defaults.projectId ?? "",
    inquiryId: defaults.inquiryId ?? "",
    recipient: defaults.recipient ?? { name: "", company: "", email: "", address: "" },
    currency: defaults.currency,
    lines: [{ id: randomUUID(), description: "", quantity: "1", unitPrice: "" }],
    discount: { kind: "none", value: "" },
    taxes: [],
    notes: "",
    schedule: "half",
    timeline: "",
    revisionsIncluded: "2",
    extraRevisionPrice: "",
    methods: defaults.methods,
    repeat: { interval: "month", nextOn: defaults.nextOn ?? "", endOn: "" },
  };
}

export function quoteEditorValue(quote: QuoteDoc): EditorValue {
  return {
    ...contentValue(quote),
    clientId: quote.clientId.toHexString(),
    projectId: "",
    inquiryId: quote.inquiryId?.toHexString() ?? "",
    schedule: scheduleKey(quote.schedule),
    timeline: quote.timeline,
    revisionsIncluded: String(quote.revisionsIncluded),
    extraRevisionPrice:
      quote.extraRevisionMinor === null ? "" : amountInput(money(quote.extraRevisionMinor, quote.currency)),
    methods: [],
    repeat: NO_REPEAT,
  };
}

export function invoiceEditorValue(invoice: InvoiceDoc): EditorValue {
  return {
    ...contentValue(invoice),
    clientId: invoice.clientId?.toHexString() ?? "",
    projectId: invoice.projectId?.toHexString() ?? "",
    inquiryId: "",
    schedule: "half",
    timeline: "",
    revisionsIncluded: "0",
    extraRevisionPrice: "",
    methods: invoice.methods,
    repeat: NO_REPEAT,
  };
}

export function recurringEditorValue(plan: RecurringInvoiceDoc): EditorValue {
  return {
    ...contentValue(plan),
    clientId: plan.clientId?.toHexString() ?? "",
    projectId: plan.projectId?.toHexString() ?? "",
    inquiryId: "",
    schedule: "half",
    timeline: "",
    revisionsIncluded: "0",
    extraRevisionPrice: "",
    methods: plan.methods,
    repeat: { interval: plan.interval, nextOn: plan.nextOn ?? "", endOn: plan.endOn ?? "" },
  };
}
