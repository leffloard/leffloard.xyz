// The states and choices of quotes, invoices and payments, with the words the admin and clients see.

export const QUOTE_STATUSES = ["draft", "sent", "accepted", "declined", "withdrawn"] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

// "expired" is not stored: a sent quote past its date reads as expired, and can no longer be accepted.
export type QuoteState = QuoteStatus | "expired";

export const QUOTE_STATE_LABELS: Record<QuoteState, string> = {
  draft: "Draft",
  sent: "Sent",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  expired: "Expired",
};

export function quoteState(
  quote: { status: QuoteStatus; validUntil: string | null },
  today: string,
): QuoteState {
  return quote.status === "sent" && quote.validUntil !== null && quote.validUntil < today
    ? "expired"
    : quote.status;
}

export const INVOICE_STATUSES = ["draft", "issued", "paid", "void"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

// "overdue" is not stored either: an issued invoice past its due date.
export type InvoiceState = InvoiceStatus | "overdue";

export const INVOICE_STATE_LABELS: Record<InvoiceState, string> = {
  draft: "Draft",
  issued: "Awaiting payment",
  paid: "Paid",
  void: "Void",
  overdue: "Overdue",
};

export function invoiceState(
  invoice: { status: InvoiceStatus; dueDate: string | null },
  today: string,
): InvoiceState {
  return invoice.status === "issued" && invoice.dueDate !== null && invoice.dueDate < today
    ? "overdue"
    : invoice.status;
}

export const PAYMENT_METHODS = ["bank", "crypto", "card"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  bank: "Bank transfer",
  crypto: "Cryptocurrency",
  card: "Card",
};

// What the document says at its top. Until the owner is registered for tax (and issues e-Arşiv invoices), a
// request for payment is the honest name.
export const DOCUMENT_LABELS = ["Payment request", "Invoice"] as const;
export type DocumentLabel = (typeof DOCUMENT_LABELS)[number];

export const PAYMENT_STATUSES = ["pending", "confirmed", "review", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  pending: "Waiting",
  confirmed: "Received",
  review: "Needs your review",
  failed: "Failed",
  refunded: "Refunded",
};
