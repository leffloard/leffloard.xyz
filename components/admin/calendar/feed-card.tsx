"use client";

import { useState } from "react";
import { disableFeedAction, rotateFeedAction } from "@/app/(admin)/admin/(shell)/calendar/actions";
import { CopyButton } from "@/components/admin/copy-button";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

// The private calendar feed: its address holds the secret, so it is shown once, right after it is made.
export function FeedCard({ enabled }: { enabled: boolean }) {
  const { run, pending, message } = useActionRunner();
  const [url, setUrl] = useState<string | null>(null);

  async function rotate() {
    const result = await run("rotate", () => rotateFeedAction({}));
    if (result.ok) setUrl(result.data.url);
  }

  async function disable() {
    const result = await run("disable", () => disableFeedAction({}));
    if (result.ok) setUrl(null);
  }

  return (
    <Card>
      <CardHeader
        title="Calendar feed"
        description="Your meetings, blocks and deadlines in Google Calendar, Apple Calendar or Outlook."
        action={<Badge tone={enabled ? "success" : "neutral"}>{enabled ? "on" : "off"}</Badge>}
      />
      <CardBody className="grid gap-4 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {url ? (
          <div className="grid gap-2">
            <p className="font-medium">Your feed address</p>
            <code className="block overflow-x-auto rounded-md border border-line bg-canvas px-3 py-2 font-mono text-xs break-all">
              {url}
            </code>
            <CopyButton value={url} label="Copy the address" />
            <p className="text-xs text-muted">
              It is shown only now. In Google Calendar: Other calendars → From URL. In Apple Calendar: File →
              New Calendar Subscription. Calendar apps refresh it every few hours.
            </p>
          </div>
        ) : (
          <p className="text-muted">
            {enabled
              ? "The feed is on. Its address was shown when you made it; make a new one if you lost it or it leaked."
              : "Anyone with the address can read the feed, so it holds a long secret and you can replace it at any time."}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={enabled ? "secondary" : "primary"}
            pending={pending === "rotate"}
            onClick={rotate}
          >
            {enabled ? "Make a new address" : "Turn the feed on"}
          </Button>
          {enabled ? (
            <Button size="sm" variant="ghost" pending={pending === "disable"} onClick={disable}>
              Turn off
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted">Both ask you to confirm it&apos;s you.</p>
      </CardBody>
    </Card>
  );
}
