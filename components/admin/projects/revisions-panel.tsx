"use client";

import Link from "next/link";
import { useState } from "react";
import {
  addRevisionAction,
  setRevisionBillableAction,
  setRevisionPolicyAction,
  setRevisionStatusAction,
} from "@/app/(admin)/admin/(shell)/projects/actions";
import { controlProps, FormRow } from "@/components/admin/form-row";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";
import { inputClasses, selectClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import {
  MAX_INCLUDED_REVISIONS,
  REVISION_STATUS_LABELS,
  REVISION_STATUSES,
  type RevisionStatus,
} from "@/lib/work/options";

export type RoundRow = {
  id: string;
  number: number;
  title: string;
  details: string;
  status: RevisionStatus;
  billable: boolean;
  price: string | null; // "$60"
  requested: string;
  taskId: string | null;
  inquiryId: string | null;
  fromPortal: boolean;
};

// "2 of 3 included rounds used", with a bar that turns amber on the last one and red past it.
export function RevisionMeter({ used, included }: { used: number; included: number }) {
  const extra = Math.max(used - included, 0);
  const width = included === 0 ? (used ? 100 : 0) : Math.min((used / included) * 100, 100);
  const tone = used > included ? "bg-danger" : used === included && included > 0 ? "bg-warning" : "bg-accent";
  return (
    <div className="grid gap-1.5">
      <p className="text-sm">
        <span className="font-semibold">{Math.min(used, included)}</span> of {included} included{" "}
        {included === 1 ? "round" : "rounds"} used
        {extra ? <span className="text-danger">, plus {extra} extra</span> : null}
      </p>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"
        role="img"
        aria-label={`${used} of ${included} included rounds used`}
      >
        <div className={cn("h-full rounded-full", tone)} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

export function RevisionsPanel({
  projectId,
  nextNumber,
  used,
  included,
  extraPrice,
  extraPriceInput,
  rounds,
}: {
  projectId: string;
  nextNumber: number; // round numbers are never reused, so this can be past used + 1
  used: number;
  included: number;
  extraPrice: string | null;
  extraPriceInput: string;
  rounds: RoundRow[];
}) {
  const { run, pending, message } = useActionRunner();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [addTask, setAddTask] = useState(true);
  const [editingPolicy, setEditingPolicy] = useState(false);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("add", () =>
      addRevisionAction({ projectId, title, details, addTask, inquiryId: "" }),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) {
      setTitle("");
      setDetails("");
    }
  }

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run("policy", () =>
      setRevisionPolicyAction({
        projectId,
        includedRevisions: String(form.get("includedRevisions") ?? ""),
        extraRevisionPrice: String(form.get("extraRevisionPrice") ?? ""),
      }),
    );
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setEditingPolicy(false);
  }

  const nextIsExtra = used + 1 > included;

  return (
    <div className="grid gap-6">
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      <Card>
        <CardHeader
          title="Revision rounds"
          description={
            extraPrice
              ? `Rounds past the included ones cost ${extraPrice} each.`
              : "Rounds past the included ones are priced when they come up."
          }
          action={
            <Button size="sm" variant="ghost" onClick={() => setEditingPolicy((value) => !value)}>
              {editingPolicy ? "Close" : "Change terms"}
            </Button>
          }
        />
        <CardBody className="grid gap-4">
          <RevisionMeter used={used} included={included} />
          {editingPolicy ? (
            <form
              onSubmit={savePolicy}
              className="grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_auto]"
              noValidate
            >
              <FormRow id="policy-includedRevisions" label="Included rounds" error={errors.includedRevisions}>
                <input
                  {...controlProps("policy-includedRevisions", errors.includedRevisions)}
                  className={inputClasses}
                  inputMode="numeric"
                  defaultValue={String(included)}
                  maxLength={2}
                />
              </FormRow>
              <FormRow
                id="policy-extraRevisionPrice"
                label="Price of an extra round"
                error={errors.extraRevisionPrice}
              >
                <input
                  {...controlProps("policy-extraRevisionPrice", errors.extraRevisionPrice)}
                  className={inputClasses}
                  defaultValue={extraPriceInput}
                  placeholder="60"
                />
              </FormRow>
              <div className="flex items-end">
                <Button
                  type="submit"
                  size="sm"
                  variant="primary"
                  className="h-10"
                  pending={pending === "policy"}
                >
                  Save
                </Button>
              </div>
              <p className="text-xs text-muted sm:col-span-3">
                0 to {MAX_INCLUDED_REVISIONS} included rounds. Rounds already added keep their price.
              </p>
            </form>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`Add round ${nextNumber}`}
          description={
            nextIsExtra
              ? `This one is past the ${included} included, so it is billable${extraPrice ? ` at ${extraPrice}` : ""}.`
              : `It uses ${used + 1} of the ${included} included.`
          }
        />
        <CardBody>
          <form onSubmit={add} className="grid gap-3" noValidate>
            <FormRow id="round-title" label="What they asked for" error={errors.title}>
              <input
                {...controlProps("round-title", errors.title)}
                className={inputClasses}
                maxLength={160}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormRow>
            <FormRow id="round-details" label="Details" error={errors.details}>
              <textarea
                {...controlProps("round-details", errors.details)}
                className={textareaClasses}
                rows={3}
                maxLength={10_000}
                value={details}
                onChange={(event) => setDetails(event.target.value)}
              />
            </FormRow>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={addTask}
                  onChange={(event) => setAddTask(event.target.checked)}
                  className="accent-[var(--color-accent)]"
                />
                Add a task for it to the board
              </label>
              <Button type="submit" size="sm" variant="primary" pending={pending === "add"}>
                Add round
              </Button>
            </div>
          </form>
        </CardBody>
      </Card>

      {rounds.length ? (
        <Card>
          <CardHeader title="Rounds" />
          <CardBody>
            <ol className="grid gap-4">
              {rounds.map((round) => (
                <li key={round.id} className="grid gap-2 border-l-2 border-line pl-3">
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <span className="font-mono text-xs text-muted">Round {round.number}</span>
                    <span
                      className={cn("font-medium", round.status === "cancelled" && "text-muted line-through")}
                    >
                      {round.title}
                    </span>
                    {round.billable ? (
                      <Badge tone="warning">extra{round.price ? ` · ${round.price}` : ""}</Badge>
                    ) : round.status !== "cancelled" ? (
                      <Badge>included</Badge>
                    ) : null}
                    {round.fromPortal ? <Badge tone="accent">from the portal</Badge> : null}
                    <span className="text-xs text-muted">{round.requested}</span>
                  </div>
                  {round.details ? (
                    <p className="text-[13px] whitespace-pre-wrap text-ink/85">{round.details}</p>
                  ) : null}
                  <div className="flex flex-wrap items-center gap-3 text-xs">
                    {round.status === "cancelled" ? (
                      <span className="text-muted">Cancelled: it does not count.</span>
                    ) : (
                      <>
                        <label htmlFor={`round-status-${round.id}`} className="sr-only">
                          Status of round {round.number}
                        </label>
                        <select
                          key={round.status}
                          id={`round-status-${round.id}`}
                          className={selectClasses}
                          defaultValue={round.status}
                          disabled={pending !== null}
                          onChange={(event) =>
                            run(round.id, () =>
                              setRevisionStatusAction({
                                id: round.id,
                                status: event.target.value as RevisionStatus,
                              }),
                            )
                          }
                        >
                          {REVISION_STATUSES.map((status) => (
                            <option key={status} value={status}>
                              {REVISION_STATUS_LABELS[status]}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="text-muted underline-offset-2 hover:text-ink hover:underline"
                          onClick={() =>
                            run(`billable-${round.id}`, () =>
                              setRevisionBillableAction({ id: round.id, billable: !round.billable }),
                            )
                          }
                        >
                          {round.billable ? "Count as included" : "Count as extra"}
                        </button>
                      </>
                    )}
                    {round.taskId ? (
                      <Link href={`/admin/tasks/${round.taskId}`} className="text-accent hover:underline">
                        Task
                      </Link>
                    ) : null}
                    {round.inquiryId ? (
                      <Link href={`/admin/inbox/${round.inquiryId}`} className="text-accent hover:underline">
                        Message
                      </Link>
                    ) : null}
                  </div>
                </li>
              ))}
            </ol>
          </CardBody>
        </Card>
      ) : null}
    </div>
  );
}
