import type { ObjectId } from "mongodb";
import type { Discount, LineItem, ScheduleStep, TaxLine, Totals } from "@/lib/billing/document";
import type {
  DocumentLabel,
  InvoiceStatus,
  PaymentMethod,
  PaymentStatus,
  QuoteStatus,
} from "@/lib/billing/options";
import type { RecurringInterval } from "@/lib/billing/recurring";
import type { Currency } from "@/lib/money";

// Billing: the owner's business details, quotes, invoices (and credit notes) and payments. A document is
// edited while it is a draft; sending a quote or issuing an invoice numbers it and freezes what the client
// sees, including the seller's details and bank account as they were that day.

export type BankAccount = {
  id: string;
  label: string; // "Lira account"
  holder: string;
  bankName: string;
  iban: string; // without spaces
  swift: string | null;
  currency: Currency | null; // the currency it takes; null for any
};

export type BusinessProfile = {
  name: string;
  address: string; // several lines
  email: string;
  taxId: string | null; // once registered for tax
  note: string; // printed at the foot of documents
};

export type BillingSettingsDoc = {
  _id: "billing";
  documentLabel: DocumentLabel;
  business: BusinessProfile;
  bankAccounts: BankAccount[];
  paymentTermsDays: number;
  quoteValidityDays: number;
  methods: PaymentMethod[]; // offered on new invoices
  baseCurrency: Currency; // the finance reports' common currency
  version: number;
  updatedAt: Date;
};

// Who a document is for.
export type Recipient = { name: string; company: string | null; email: string | null; address: string };

export type DocumentContent = {
  currency: Currency;
  lines: LineItem[];
  discount: Discount | null;
  taxes: TaxLine[];
  notes: string; // printed on the document
  totals: Totals; // kept in step with the lines, the discount and the taxes
};

export type QuoteDoc = DocumentContent & {
  _id: ObjectId;
  publicId: string; // /q/<publicId>
  number: string | null; // "Q-2026-0003", given when first sent
  status: QuoteStatus;
  title: string;
  clientId: ObjectId; // a quote is for a client: an inbox message becomes one in a click
  inquiryId: ObjectId | null;
  recipient: Recipient;
  schedule: ScheduleStep[];
  timeline: string; // "About 3 weeks"
  revisionsIncluded: number;
  extraRevisionMinor: number | null; // the price of a further round, in the quote's currency
  validUntil: string | null; // YYYY-MM-DD, set when sent
  sentAt: Date | null;
  viewedAt: Date | null; // first opened by the client
  answeredAt: Date | null;
  acceptedBy: { name: string; ip: string | null } | null;
  declineReason: string | null;
  projectId: ObjectId | null; // made when accepted
  depositInvoiceId: ObjectId | null;
  seller?: BusinessProfile | null; // frozen when sent
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type InvoiceKind = "invoice" | "credit";

export type InvoiceDoc = DocumentContent & {
  _id: ObjectId;
  publicId: string; // /i/<publicId>
  kind: InvoiceKind;
  number: string | null; // "INV-2026-0007" or "CN-2026-0001", given at issue
  status: InvoiceStatus;
  title: string;
  clientId: ObjectId | null;
  projectId: ObjectId | null;
  quoteId: ObjectId | null;
  creditFor: ObjectId | null; // the invoice a credit note corrects
  recipient: Recipient;
  seller: BusinessProfile | null; // frozen at issue
  label: DocumentLabel | null; // frozen at issue
  methods: PaymentMethod[];
  bankAccount: BankAccount | null; // frozen at issue, when bank transfer is offered
  paidMinor: number; // confirmed payments
  creditedMinor?: number; // credit notes issued against it
  issueDate: string | null; // YYYY-MM-DD
  dueDate: string | null;
  viewedAt: Date | null;
  remindersSent: number;
  lastReminderAt: Date | null;
  remindersPaused?: boolean; // the owner stopped the automatic reminders
  recurringId?: ObjectId | null; // the recurring plan that issued it
  period?: string | null; // and the plan's date it covers
  paidAt: Date | null;
  voidedAt: Date | null;
  voidReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

// An invoice issued again and again (a care plan, hosting): its content, and when the next one is due.
export type RecurringInvoiceDoc = DocumentContent & {
  _id: ObjectId;
  title: string; // "{period}" becomes the months an invoice covers
  clientId: ObjectId | null;
  projectId: ObjectId | null;
  recipient: Recipient;
  methods: PaymentMethod[];
  interval: RecurringInterval;
  anchorDay: number; // the day of the month invoices fall on
  nextOn: string | null; // YYYY-MM-DD; null once the plan has ended
  endOn: string | null; // no invoice after this date
  active: boolean;
  issuedCount: number;
  lastIssuedOn: string | null;
  lastInvoiceId: ObjectId | null;
  lastError: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
};

export type PaymentDoc = {
  _id: ObjectId;
  invoiceId: ObjectId;
  method: PaymentMethod;
  status: PaymentStatus;
  amountMinor: number; // in the invoice's currency
  currency: Currency;
  // A checkout at a payment provider: its ids, the page the client pays on, and what was actually paid.
  provider: {
    name: "nowpayments";
    invoiceId: string | null;
    paymentId: string | null;
    url: string | null;
    payCurrency: string | null;
    actuallyPaid: string | null;
    lastStatus: string | null;
  } | null;
  receivedOn: string | null; // YYYY-MM-DD, as on the bank statement
  reference: string; // the transfer's reference, or a note
  reviewReason: string | null;
  confirmedAt: Date | null;
  refundedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
