"use client";

import Link from "next/link";
import { useState } from "react";
import {
  createClientFromInquiryAction,
  linkInquiryAction,
  unlinkInquiryAction,
} from "@/app/(admin)/admin/(shell)/clients/actions";
import { addRevisionAction } from "@/app/(admin)/admin/(shell)/projects/actions";
import { useActionRunner } from "@/components/admin/use-action-runner";
import { Button, buttonClasses } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { selectClasses } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";

type Option = { id: string; label: string };

// Turns an inbox message into work: the sender becomes a client (or is linked to one), and the message
// can start a project or become a revision round of one.
export function ClientCard({
  inquiryId,
  isRevision,
  isSpam,
  client,
  matches,
  clients,
  projects,
  revision,
}: {
  inquiryId: string;
  isRevision: boolean;
  isSpam: boolean;
  client: { id: string; name: string } | null;
  matches: Option[]; // clients with the sender's address
  clients: Option[];
  projects: Option[]; // the linked client's open projects
  revision: { title: string; details: string };
}) {
  const { run, pending, message } = useActionRunner();
  const [chosenClient, setChosenClient] = useState("");
  const [chosenProject, setChosenProject] = useState(projects[0]?.id ?? "");

  if (isSpam) return null;

  return (
    <Card>
      <CardHeader title="Client" />
      <CardBody className="grid gap-3 text-[13px]">
        {message ? <Notice tone={message.tone}>{message.text}</Notice> : null}
        {client ? (
          <>
            <p>
              From{" "}
              <Link href={`/admin/clients/${client.id}`} className="font-medium text-accent hover:underline">
                {client.name}
              </Link>
              .
            </p>
            <div className="flex flex-wrap gap-2">
              <Link
                href={`/admin/projects/new?inquiry=${inquiryId}`}
                className={buttonClasses(isRevision ? "secondary" : "primary", "sm")}
              >
                Start a project
              </Link>
              <Button
                size="sm"
                variant="ghost"
                pending={pending === "unlink"}
                onClick={() => run("unlink", () => unlinkInquiryAction({ inquiryId }))}
              >
                Unlink
              </Button>
            </div>
            {isRevision && projects.length ? (
              <div className="grid gap-1.5 border-t border-line pt-3">
                <label htmlFor="revision-project" className="font-medium">
                  Add as a revision round to
                </label>
                <div className="flex flex-wrap gap-2">
                  <select
                    id="revision-project"
                    className={selectClasses}
                    value={chosenProject}
                    onChange={(event) => setChosenProject(event.target.value)}
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    variant="primary"
                    pending={pending === "revision"}
                    onClick={() =>
                      run("revision", () =>
                        addRevisionAction({
                          projectId: chosenProject,
                          title: revision.title,
                          details: revision.details,
                          addTask: true,
                          inquiryId,
                        }),
                      )
                    }
                  >
                    Add round
                  </Button>
                </div>
                <p className="text-xs text-muted">Also adds a task for it to the project&apos;s board.</p>
              </div>
            ) : null}
          </>
        ) : (
          <>
            {matches.map((match) => (
              <div key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  This address belongs to <span className="font-medium">{match.label}</span>.
                </span>
                <Button
                  size="sm"
                  variant="primary"
                  pending={pending === `match-${match.id}`}
                  onClick={() =>
                    run(`match-${match.id}`, () => linkInquiryAction({ inquiryId, clientId: match.id }))
                  }
                >
                  Link
                </Button>
              </div>
            ))}
            <div>
              <Button
                size="sm"
                variant={matches.length ? "secondary" : "primary"}
                pending={pending === "create"}
                onClick={() => run("create", () => createClientFromInquiryAction({ inquiryId }))}
              >
                Make the sender a client
              </Button>
            </div>
            {clients.length ? (
              <div className="grid gap-1.5 border-t border-line pt-3">
                <label htmlFor="link-client" className="font-medium">
                  Or link to a client
                </label>
                <div className="flex flex-wrap gap-2">
                  <select
                    id="link-client"
                    className={selectClasses}
                    value={chosenClient}
                    onChange={(event) => setChosenClient(event.target.value)}
                  >
                    <option value="">Choose a client…</option>
                    {clients.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={!chosenClient}
                    pending={pending === "link"}
                    onClick={() =>
                      run("link", () => linkInquiryAction({ inquiryId, clientId: chosenClient }))
                    }
                  >
                    Link
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        )}
      </CardBody>
    </Card>
  );
}
