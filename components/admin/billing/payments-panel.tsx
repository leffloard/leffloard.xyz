"use client";

import { useState } from "react";
import {
  recordBankPaymentAction,
  refundPaymentAction,
  resolveReviewAction,
} from "@/app/(admin)/admin/(shell)/billing/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { compactInputClasses, inputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

// An invoice's payments: what arrived and how, with the owner's hand on the ones that need it (recording a
// bank transfer, a refund, a part payment to review). Each of these asks to confirm it's you.

export type PaymentRow = {
  id: string;
  method: string;
  status: "pending" | "confirmed" | "review" | "failed" | "refunded";
  statusLabel: string;
  amount: string;
  amountInput: string;
  when: string;
  detail: string;
};

const TONES = {
  pending: "neutral",
  confirmed: "success",
  review: "warning",
  failed: "neutral",
  refunded: "neutral",
} as const;

function PaymentItem({ row }: { row: PaymentRow }) {
  const { run, pending, message } = useActionRunner();
  const [mode, setMode] = useState<"none" | "refund" | "review">("none");
  const [note, setNote] = useState("");
  const [amount, setAmount] = useState(row.amountInput);
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <li className="grid gap-2 px-5 py-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-mono tabular-nums">{row.amount}</span>
        <span className="text-muted">{row.method}</span>
        <Badge tone={TONES[row.status]}>{row.statusLabel}</Badge>
        <span className="ml-auto text-xs text-muted">{row.when}</span>
      </div>
      {row.detail ? <p className="text-xs break-words text-muted">{row.detail}</p> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {row.status === "confirmed" && mode === "none" ? (
        <div>
          <Button size="sm" variant="ghost" onClick={() => setMode("refund")}>
            Refund…
          </Button>
        </div>
      ) : null}
      {row.status === "review" && mode === "none" ? (
        <div>
          <Button size="sm" onClick={() => setMode("review")}>
            Review…
          </Button>
        </div>
      ) : null}
      {mode === "refund" ? (
        <form
          className="grid gap-2"
          noValidate
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await run("refund", () => refundPaymentAction({ paymentId: row.id, note }));
            setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
            if (result.ok) setMode("none");
          }}
        >
          <FormRow id={`refund-${row.id}`} label="How was it refunded?" error={errors.note}>
            <input
              {...controlProps(`refund-${row.id}`, errors.note)}
              className={compactInputClasses}
              maxLength={500}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          </FormRow>
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="danger" pending={pending === "refund"}>
              Mark as refunded
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              Back
            </Button>
          </div>
        </form>
      ) : null}
      {mode === "review" ? (
        <div className="grid gap-2">
          <FormRow id={`review-${row.id}`} label="Amount that arrived" error={errors.amount}>
            <input
              {...controlProps(`review-${row.id}`, errors.amount)}
              inputMode="decimal"
              className={compactInputClasses}
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </FormRow>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="primary"
              pending={pending === "confirm"}
              onClick={async () => {
                const result = await run("confirm", () =>
                  resolveReviewAction({ paymentId: row.id, decision: "confirm", amount }),
                );
                setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
              }}
            >
              Count it as received
            </Button>
            <Button
              size="sm"
              variant="ghost"
              pending={pending === "fail"}
              onClick={() =>
                run("fail", () => resolveReviewAction({ paymentId: row.id, decision: "fail", amount: "" }))
              }
            >
              Mark as failed
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              Back
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function PaymentsPanel({
  invoiceId,
  rows,
  canRecord,
  left,
  today,
}: {
  invoiceId: string;
  rows: PaymentRow[];
  canRecord: boolean;
  left: string; // what's left to pay, as a form value
  today: string;
}) {
  const { run, pending, message } = useActionRunner();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ amount: left, receivedOn: today, reference: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function record(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("record", () => recordBankPaymentAction({ invoiceId, ...form }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setOpen(false);
  }

  return (
    <Card>
      <CardHeader
        title="Payments"
        action={
          canRecord && !open ? (
            <Button size="sm" onClick={() => setOpen(true)}>
              Record a bank transfer
            </Button>
          ) : null
        }
      />
      {message ? (
        <CardBody>
          <Notice tone={message.tone}>{message.text}</Notice>
        </CardBody>
      ) : null}
      {open ? (
        <CardBody className="border-b border-line">
          <form onSubmit={record} className="grid gap-3" noValidate>
            <div className="grid gap-3 sm:grid-cols-3">
              <FormRow id="pay-amount" label="Amount" error={errors.amount}>
                <input
                  {...controlProps("pay-amount", errors.amount)}
                  inputMode="decimal"
                  className={inputClasses}
                  value={form.amount}
                  onChange={(event) => setForm({ ...form, amount: event.target.value })}
                />
              </FormRow>
              <FormRow id="pay-receivedOn" label="Arrived on" error={errors.receivedOn}>
                <input
                  {...controlProps("pay-receivedOn", errors.receivedOn)}
                  type="date"
                  className={inputClasses}
                  value={form.receivedOn}
                  onChange={(event) => setForm({ ...form, receivedOn: event.target.value })}
                />
              </FormRow>
              <FormRow id="pay-reference" label="Reference (optional)" error={errors.reference}>
                <input
                  {...controlProps("pay-reference", errors.reference)}
                  className={inputClasses}
                  maxLength={140}
                  value={form.reference}
                  onChange={(event) => setForm({ ...form, reference: event.target.value })}
                />
              </FormRow>
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="primary" pending={pending === "record"}>
                Record it
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Back
              </Button>
            </div>
            <p className="text-xs text-muted">The client gets a receipt by email.</p>
          </form>
        </CardBody>
      ) : null}
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((row) => (
            <PaymentItem key={row.id} row={row} />
          ))}
        </ul>
      ) : (
        <CardBody>
          <p className="text-[13px] text-muted">Nothing yet.</p>
        </CardBody>
      )}
    </Card>
  );
}
