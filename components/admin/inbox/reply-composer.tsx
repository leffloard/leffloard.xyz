"use client";

import { useState } from "react";
import { replyAction } from "@/app/(admin)/admin/(shell)/inbox/actions";
import { AiDraft } from "@/components/admin/ai/ai-draft";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { inputClasses, selectClasses, textareaClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

export function ReplyComposer({
  id,
  to,
  defaultSubject,
  canEmail,
  isSpam,
  aiDisabledReason,
}: {
  id: string;
  to: string;
  defaultSubject: string;
  canEmail: boolean;
  isSpam: boolean;
  aiDisabledReason: string | null;
}) {
  const { run, pending, message } = useActionRunner();
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState("");
  const [then, setThen] = useState<"open" | "done" | "keep">("open");
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const result = await run("send", () => replyAction({ id, subject, body, then }));
    setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
    if (result.ok) setBody("");
  }

  if (!canEmail) {
    return (
      <Card>
        <CardHeader title="Reply" />
        <CardBody>
          <Notice tone="warning">
            Email is not set up on the server, so replies can&apos;t be sent from here yet. Set SMTP_HOST,
            SMTP_USERNAME, SMTP_PASSWORD and SMTP_FROM, then restart. Until then, answer from your mail app:{" "}
            {to}
          </Notice>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title="Reply" description={`To ${to}. Your reply quotes their message below it.`} />
      <CardBody>
        <form onSubmit={send} className="grid gap-3">
          {isSpam ? (
            <Notice tone="warning">This message is in spam. Move it back before replying.</Notice>
          ) : null}
          {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
          <div className="grid gap-1.5">
            <label htmlFor="reply-subject" className="text-[13px] font-medium">
              Subject
            </label>
            <input
              id="reply-subject"
              className={inputClasses}
              value={subject}
              maxLength={200}
              aria-invalid={errors.subject ? true : undefined}
              aria-describedby={errors.subject ? "reply-subject-error" : undefined}
              onChange={(event) => setSubject(event.target.value)}
            />
            {errors.subject ? (
              <p id="reply-subject-error" className="text-xs text-danger">
                {errors.subject}
              </p>
            ) : null}
          </div>
          {isSpam ? null : (
            <div className="grid gap-2 rounded-md border border-dashed border-line-strong p-3">
              <p className="text-[13px] font-medium">AI draft</p>
              <AiDraft
                body={{ feature: "reply", inquiryId: id }}
                action="Draft a reply"
                notes={{
                  label: "What should the reply say? (optional)",
                  placeholder: "Available from October; ask about their hosting",
                }}
                onUse={(text) => setBody(text)}
                useLabel="Put it in the message"
                disabledReason={aiDisabledReason}
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <label htmlFor="reply-body" className="text-[13px] font-medium">
              Message
            </label>
            <textarea
              id="reply-body"
              className={textareaClasses}
              rows={8}
              maxLength={10_000}
              value={body}
              aria-invalid={errors.body ? true : undefined}
              aria-describedby={errors.body ? "reply-body-error" : undefined}
              onChange={(event) => setBody(event.target.value)}
            />
            {errors.body ? (
              <p id="reply-body-error" className="text-xs text-danger">
                {errors.body}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="reply-then" className="text-[13px] text-muted">
                Then
              </label>
              <select
                id="reply-then"
                className={selectClasses}
                value={then}
                onChange={(event) => setThen(event.target.value as typeof then)}
              >
                <option value="open">keep it open</option>
                <option value="done">mark it done</option>
                <option value="keep">leave the status</option>
              </select>
            </div>
            <Button type="submit" variant="primary" pending={pending === "send"} disabled={isSpam}>
              Send reply
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
