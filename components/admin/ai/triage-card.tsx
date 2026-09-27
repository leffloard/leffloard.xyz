"use client";

import Link from "next/link";
import { triageInquiryAction } from "@/app/(admin)/admin/(shell)/ai/actions";
import { saveLabelsAction } from "@/app/(admin)/admin/(shell)/inbox/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { MAX_LABELS } from "@/lib/intake/labels";

// The AI assistant's reading of an inbox message: what it is, how urgent, how well it fits, and what to ask.
// Suggestions only: the labels are added when the owner clicks.

export type TriageView = {
  category: string;
  priority: "high" | "normal" | "low";
  priorityReason: string;
  spamLikelihood: number;
  fit: string;
  service: string | null;
  summary: string;
  labels: string[];
  questions: string[];
  flags: string[];
  when: string;
};

const PRIORITY_TONES = { high: "accent", normal: "neutral", low: "neutral" } as const;

export function TriageCard({
  inquiryId,
  triage,
  labels,
  disabledReason,
}: {
  inquiryId: string;
  triage: TriageView | null;
  labels: string[];
  disabledReason: string | null;
}) {
  const { run, pending, message } = useActionRunner();
  const missing = triage ? triage.labels.filter((label) => !labels.includes(label)) : [];
  const room = MAX_LABELS - labels.length;

  return (
    <Card>
      <CardHeader
        title="AI triage"
        description={triage ? `Suggestions, ${triage.when}.` : "What it is, how urgent, and what to ask."}
      />
      <CardBody className="grid gap-3 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {triage ? (
          <>
            <p className="flex flex-wrap gap-1.5">
              <Badge>{triage.category}</Badge>
              <Badge tone={PRIORITY_TONES[triage.priority]}>{triage.priority} priority</Badge>
              <Badge>{triage.fit} fit</Badge>
              {triage.spamLikelihood >= 60 ? <Badge tone="warning">likely spam</Badge> : null}
            </p>
            <p>{triage.summary}</p>
            <p className="text-xs text-muted">
              {triage.priorityReason}
              {triage.service ? ` Matches ${triage.service}.` : ""}
            </p>
            {triage.flags.length ? (
              <Notice tone="warning">
                <ul className="list-disc pl-4">
                  {triage.flags.map((flag) => (
                    <li key={flag}>{flag}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}
            {triage.questions.length ? (
              <div>
                <h3 className="text-xs text-muted">Worth asking</h3>
                <ul className="mt-1 list-disc pl-4">
                  {triage.questions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {missing.length && room > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {missing.slice(0, room).map((label) => (
                  <Badge key={label}>{label}</Badge>
                ))}
                <Button
                  size="sm"
                  variant="ghost"
                  pending={pending === "labels"}
                  onClick={() =>
                    run("labels", () =>
                      saveLabelsAction({ id: inquiryId, labels: [...labels, ...missing.slice(0, room)] }),
                    )
                  }
                >
                  Add these labels
                </Button>
              </div>
            ) : null}
          </>
        ) : null}
        {disabledReason ? (
          <p className="text-xs text-muted">
            {disabledReason}{" "}
            <Link href="/admin/ai" className="text-accent underline underline-offset-2">
              AI settings
            </Link>
          </p>
        ) : (
          <div>
            <Button
              size="sm"
              pending={pending === "triage"}
              onClick={() => run("triage", () => triageInquiryAction({ inquiryId }))}
            >
              {triage ? "Triage again" : "Triage with AI"}
            </Button>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
