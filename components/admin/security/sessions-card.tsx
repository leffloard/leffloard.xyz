"use client";

import { revokeOtherSessionsAction, revokeSessionAction } from "@/app/(admin)/admin/(shell)/security/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";

export type SessionRow = {
  id: string;
  current: boolean;
  device: string;
  ip: string;
  methods: string;
  signedIn: string;
  lastActive: string;
};

export function SessionsCard({ sessions }: { sessions: SessionRow[] }) {
  const { run, pending, message } = useActionRunner();
  const others = sessions.filter((session) => !session.current).length;
  return (
    <Card>
      <CardHeader
        id="sessions"
        title="Signed-in devices"
        description="Sessions end after 30 minutes without activity, and after 12 hours at most."
        action={
          others > 0 ? (
            <Button
              size="sm"
              pending={pending === "all"}
              onClick={() => run("all", () => revokeOtherSessionsAction({}))}
            >
              Sign out everywhere else
            </Button>
          ) : null
        }
      />
      <CardBody className="grid gap-3">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        <ul className="divide-y divide-line" aria-labelledby="sessions">
          {sessions.map((session) => (
            <li
              key={session.id}
              className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {session.device}
                  {session.current ? <Badge tone="accent">this device</Badge> : null}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {session.ip} · signed in {session.signedIn} with {session.methods} · active{" "}
                  {session.lastActive}
                </p>
              </div>
              {session.current ? null : (
                <Button
                  size="sm"
                  variant="ghost"
                  pending={pending === session.id}
                  onClick={() => run(session.id, () => revokeSessionAction({ id: session.id }))}
                >
                  Sign out
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardBody>
    </Card>
  );
}
