import type { Metadata } from "next";
import Link from "next/link";
import { DataRequestForm, SignOutButtons } from "@/components/site/portal/account-controls";
import { PageIntro, Section } from "@/components/site/section";
import { site } from "@/content/site";
import { formatDate } from "@/lib/format";
import { getDb } from "@/server/db/client";
import { requirePortalClient } from "@/server/portal/dal";
import { privacyRequestsFor } from "@/server/portal/privacy";

export const metadata: Metadata = { title: "Account" };

export default async function PortalAccountPage() {
  const { client, session } = await requirePortalClient();
  const requests = await privacyRequestsFor(await getDb(), client._id);
  const open = (kind: "export" | "erase") =>
    requests.some((request) => request.kind === kind && request.status === "open");
  const details: [string, string | null][] = [
    ["Name", client.name],
    ["Company", client.company],
    ["Email", client.email],
    ["Location", client.location],
  ];
  return (
    <>
      <PageIntro label="Client portal" title="Your account" />
      <Section label="Details" title="What I have on file">
        <dl className="grid max-w-xl gap-3">
          {details
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="grid grid-cols-[120px_minmax(0,1fr)] gap-3">
                <dt className="text-muted">{label}</dt>
                <dd className="break-words">{value}</dd>
              </div>
            ))}
        </dl>
        <p className="mt-6 text-sm text-muted">
          To change them, email{" "}
          <a href={`mailto:${site.email}`} className="text-ink underline underline-offset-4">
            {site.email}
          </a>
          .
        </p>
      </Section>
      <Section label="Sign-in" title="Signing in">
        <p className="mb-5 text-muted">
          Signed in since {formatDate(session.createdAt)}. A session ends after a week without a visit.
        </p>
        <SignOutButtons />
      </Section>
      <Section
        label="Privacy"
        title="Your data"
        intro={
          <>
            What I keep and why is in the{" "}
            <Link href="/legal/privacy" className="text-ink underline underline-offset-4">
              privacy notice
            </Link>
            .
          </>
        }
      >
        <div className="grid gap-4 md:grid-cols-2">
          <DataRequestForm kind="export" open={open("export")} />
          <DataRequestForm kind="erase" open={open("erase")} />
        </div>
        {requests.some((request) => request.status !== "open") ? (
          <ul className="mt-6 grid gap-1 text-sm text-muted">
            {requests
              .filter((request) => request.status !== "open")
              .map((request) => (
                <li key={request._id.toHexString()}>
                  {request.kind === "export" ? "Copy" : "Deletion"} asked {formatDate(request.createdAt)}:{" "}
                  {request.status === "done" ? "done" : "declined"}
                  {request.resolution ? ` (${request.resolution})` : ""}.
                </li>
              ))}
          </ul>
        ) : null}
      </Section>
    </>
  );
}
