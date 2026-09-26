"use client";

import { useState } from "react";
import {
  endPortalSessionsAction,
  inviteToPortalAction,
  resolvePrivacyRequestAction,
  setPortalAccessAction,
} from "@/app/(admin)/admin/(shell)/clients/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { compactInputClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

// The client's portal: on or off, the invitation, and who is signed in.
export function PortalCard({
  id,
  enabled,
  hasEmail,
  facts,
  sessions,
}: {
  id: string;
  enabled: boolean;
  hasEmail: boolean;
  facts: string[]; // "Invited 3 Oct", "Last signed in 5 Oct"
  sessions: number;
}) {
  const { run, pending, message } = useActionRunner();
  return (
    <Card>
      <CardHeader
        title="Client portal"
        action={<Badge tone={enabled ? "success" : "neutral"}>{enabled ? "on" : "off"}</Badge>}
      />
      <CardBody className="grid gap-3 text-[13px]">
        <p className="text-muted">
          {enabled
            ? "They sign in with a link sent to their email, and see their projects, updates, invoices and calls."
            : "Their projects, updates, invoices and calls, behind a sign-in link sent to their email."}
        </p>
        {facts.length ? (
          <ul className="grid gap-0.5 text-xs text-muted">
            {facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
            {enabled ? (
              <li>{sessions === 1 ? "Signed in on 1 browser" : `Signed in on ${sessions} browsers`}</li>
            ) : null}
          </ul>
        ) : null}
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={enabled ? "secondary" : "primary"}
            pending={pending === "invite"}
            disabled={!hasEmail}
            onClick={() => run("invite", () => inviteToPortalAction({ id }))}
          >
            {enabled ? "Send a new invitation" : "Invite to the portal"}
          </Button>
          {enabled && sessions ? (
            <Button
              size="sm"
              variant="ghost"
              pending={pending === "out"}
              onClick={() => run("out", () => endPortalSessionsAction({ id }))}
            >
              Sign out everywhere
            </Button>
          ) : null}
          {enabled ? (
            <Button
              size="sm"
              variant="ghost"
              pending={pending === "off"}
              onClick={() => run("off", () => setPortalAccessAction({ id, enabled: false }))}
            >
              Turn off
            </Button>
          ) : null}
        </div>
        {!hasEmail ? <p className="text-xs text-muted">Add their email address first.</p> : null}
      </CardBody>
    </Card>
  );
}

export type PrivacyRow = { id: string; kind: "export" | "erase"; note: string; when: string; status: string };

function RequestItem({ row }: { row: PrivacyRow }) {
  const { run, pending, message } = useActionRunner();
  const [resolution, setResolution] = useState("");
  const open = row.status === "open";
  return (
    <li className="grid gap-2 border-l-2 border-line pl-3">
      <p className="flex flex-wrap items-center gap-2">
        <Badge tone={open ? "warning" : "neutral"}>
          {row.kind === "export" ? "Copy of data" : "Deletion"}
        </Badge>
        <span className="text-xs text-muted">{row.when}</span>
        {!open ? <span className="text-xs text-muted">({row.status})</span> : null}
      </p>
      {row.note ? <p className="whitespace-pre-wrap">{row.note}</p> : null}
      {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
      {open && row.kind === "erase" ? (
        <p className="text-xs text-muted">
          Delete client (below) answers it: the request goes with the rest of their data, and the audit log
          keeps the record. Decline it here, with the reason, if the law makes you keep the data.
        </p>
      ) : null}
      {open ? (
        <div className="grid gap-2">
          <label htmlFor={`resolution-${row.id}`} className="text-xs text-muted">
            What you did (for the record)
          </label>
          <input
            id={`resolution-${row.id}`}
            className={compactInputClasses}
            maxLength={500}
            value={resolution}
            onChange={(event) => setResolution(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              pending={pending === "done"}
              onClick={() =>
                run("done", () => resolvePrivacyRequestAction({ id: row.id, status: "done", resolution }))
              }
            >
              Mark as done
            </Button>
            <Button
              size="sm"
              variant="ghost"
              pending={pending === "declined"}
              onClick={() =>
                run("declined", () =>
                  resolvePrivacyRequestAction({ id: row.id, status: "declined", resolution }),
                )
              }
            >
              Decline
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

// Data requests the client made in their portal. Export and delete are on the privacy card below.
export function PrivacyRequestsCard({ rows }: { rows: PrivacyRow[] }) {
  if (!rows.length) return null;
  return (
    <Card>
      <CardHeader title="Data requests" description="From their portal. Answer within 30 days." />
      <CardBody className="text-[13px]">
        <ul className="grid gap-4">
          {rows.map((row) => (
            <RequestItem key={row.id} row={row} />
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
