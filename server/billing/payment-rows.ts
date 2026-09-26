import "server-only";
import type { PaymentRow } from "@/components/admin/billing/payments-panel";
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS } from "@/lib/billing/options";
import { formatDateTime } from "@/lib/format";
import { amountInput, formatMoney, money } from "@/lib/money";
import type { PaymentDoc } from "@/server/billing/types";
import { longDate } from "@/server/billing/view";

// Payments as the admin lists them.
export function paymentRows(docs: PaymentDoc[]): PaymentRow[] {
  return docs.map((payment) => {
    const value = money(payment.amountMinor, payment.currency);
    const provider = payment.provider;
    return {
      id: payment._id.toHexString(),
      method: `${PAYMENT_METHOD_LABELS[payment.method]}${provider ? " (NOWPayments)" : ""}`,
      status: payment.status,
      statusLabel: PAYMENT_STATUS_LABELS[payment.status],
      amount: formatMoney(value),
      amountInput: amountInput(value),
      when: payment.receivedOn
        ? `arrived ${longDate(payment.receivedOn)}`
        : formatDateTime(payment.confirmedAt ?? payment.createdAt),
      detail: [
        payment.reference,
        provider?.paymentId ? `payment ${provider.paymentId}` : "",
        provider?.actuallyPaid ? `paid ${provider.actuallyPaid} ${provider.payCurrency ?? ""}`.trim() : "",
        provider?.lastStatus && payment.status === "pending" ? `NOWPayments: ${provider.lastStatus}` : "",
        payment.reviewReason ?? "",
      ]
        .filter(Boolean)
        .join(" · "),
    };
  });
}
