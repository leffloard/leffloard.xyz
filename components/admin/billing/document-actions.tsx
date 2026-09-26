"use client";

import { useState } from "react";
import {
  creditNoteAction,
  deleteInvoiceAction,
  deleteQuoteAction,
  emailInvoiceAgainAction,
  emailQuoteAgainAction,
  issueInvoiceAction,
  reopenQuoteAction,
  sendQuoteAction,
  voidInvoiceAction,
  withdrawQuoteAction,
} from "@/app/(admin)/admin/(shell)/billing/actions";
import { CopyButton } from "@/components/admin/copy-button";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button, buttonClasses } from "@/components/ui/button";
import { textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import type { InvoiceStatus, QuoteStatus } from "@/lib/billing/options";

// What can be done with a quote or an invoice in its current state.

function Bar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

export function QuoteActions({
  id,
  version,
  status,
  numbered,
  link,
  pdf,
}: {
  id: string;
  version: number;
  status: QuoteStatus;
  numbered: boolean; // sent at least once: withdrawn, never deleted
  link: string;
  pdf: string;
}) {
  const { run, pending, message } = useActionRunner();
  const [confirm, setConfirm] = useState<"delete" | "withdraw" | null>(null);
  const deletable = status === "draft" && !numbered;
  return (
    <div className="grid gap-3">
      <Bar>
        {status === "draft" ? (
          <Button
            size="sm"
            variant="primary"
            pending={pending === "send"}
            onClick={() => run("send", () => sendQuoteAction({ id, version }))}
          >
            Send
          </Button>
        ) : null}
        {status === "sent" ? (
          <>
            <CopyButton value={link} label="Copy the client's link" />
            <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClasses("ghost", "sm")}>
              Open it as the client
            </a>
            <Button
              size="sm"
              variant="ghost"
              pending={pending === "again"}
              onClick={() => run("again", () => emailQuoteAgainAction({ id }))}
            >
              Email it again
            </Button>
            <Button
              size="sm"
              pending={pending === "reopen"}
              onClick={() => run("reopen", () => reopenQuoteAction({ id, version }))}
            >
              Change it
            </Button>
          </>
        ) : null}
        <a href={pdf} className={buttonClasses("ghost", "sm")}>
          PDF
        </a>
        {status === "draft" || status === "sent" ? (
          confirm ? (
            <>
              <Button
                size="sm"
                variant="danger"
                pending={pending === confirm}
                onClick={() =>
                  run(confirm, () =>
                    confirm === "delete" ? deleteQuoteAction({ id }) : withdrawQuoteAction({ id, version }),
                  )
                }
              >
                {confirm === "delete" ? "Delete the draft" : "Withdraw the quote"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(null)}>
                Keep it
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(deletable ? "delete" : "withdraw")}>
              {deletable ? "Delete…" : "Withdraw…"}
            </Button>
          )
        ) : null}
      </Bar>
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}

export function InvoiceActions({
  id,
  version,
  status,
  kind,
  paid,
  link,
  pdf,
}: {
  id: string;
  version: number;
  status: InvoiceStatus;
  kind: "invoice" | "credit";
  paid: boolean; // anything paid or credited: it can't be voided any more
  link: string;
  pdf: string;
}) {
  const { run, pending, message } = useActionRunner();
  const [mode, setMode] = useState<"none" | "void" | "delete">("none");
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function voidIt(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("void", () => voidInvoiceAction({ id, version, reason }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setMode("none");
  }

  return (
    <div className="grid gap-3">
      <Bar>
        {status === "draft" ? (
          <Button
            size="sm"
            variant="primary"
            pending={pending === "issue"}
            onClick={() => run("issue", () => issueInvoiceAction({ id, version }))}
          >
            {kind === "credit" ? "Issue the credit note" : "Issue"}
          </Button>
        ) : null}
        {status !== "draft" && kind === "invoice" ? (
          <>
            <CopyButton value={link} label="Copy the client's link" />
            <a href={link} target="_blank" rel="noopener noreferrer" className={buttonClasses("ghost", "sm")}>
              Open it as the client
            </a>
          </>
        ) : null}
        {status === "issued" && kind === "invoice" ? (
          <Button
            size="sm"
            variant="ghost"
            pending={pending === "again"}
            onClick={() => run("again", () => emailInvoiceAgainAction({ id }))}
          >
            Send a reminder
          </Button>
        ) : null}
        <a href={pdf} className={buttonClasses("ghost", "sm")}>
          PDF
        </a>
        {kind === "invoice" && (status === "issued" || status === "paid") ? (
          <Button
            size="sm"
            variant="ghost"
            pending={pending === "credit"}
            onClick={() => run("credit", () => creditNoteAction({ id }))}
          >
            Credit note…
          </Button>
        ) : null}
        {status === "issued" && kind === "invoice" && !paid && mode === "none" ? (
          <Button size="sm" variant="ghost" onClick={() => setMode("void")}>
            Void…
          </Button>
        ) : null}
        {status === "draft" ? (
          mode === "delete" ? (
            <>
              <Button
                size="sm"
                variant="danger"
                pending={pending === "delete"}
                onClick={() => run("delete", () => deleteInvoiceAction({ id }))}
              >
                Delete the draft
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
                Keep it
              </Button>
            </>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setMode("delete")}>
              Delete…
            </Button>
          )
        ) : null}
      </Bar>
      {mode === "void" ? (
        <form onSubmit={voidIt} className="grid gap-3 rounded-lg border border-line p-4" noValidate>
          <FormRow
            id="void-reason"
            label="Why is it void?"
            error={errors.reason}
            hint="Kept with the invoice. Its number stays used."
          >
            <textarea
              {...controlProps("void-reason", errors.reason, true)}
              className={textareaClasses}
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </FormRow>
          <Bar>
            <Button type="submit" size="sm" variant="danger" pending={pending === "void"}>
              Void the invoice
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              Back
            </Button>
          </Bar>
        </form>
      ) : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
    </div>
  );
}
