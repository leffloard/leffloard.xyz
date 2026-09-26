import type { Metadata } from "next";
import Link from "next/link";
import { VerifyButton } from "@/components/site/portal/verify-button";
import { PageIntro, Section } from "@/components/site/section";
import { getDb } from "@/server/db/client";
import { peekPortalLink } from "@/server/portal/access";

export const metadata: Metadata = { title: "Sign in" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

// The page a sign-in link opens. Opening it spends nothing: the button does.
export default async function PortalVerifyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = first((await searchParams).t);
  const found = await peekPortalLink(await getDb(), token);
  if (!found) {
    return (
      <>
        <PageIntro
          label="Client portal"
          title="This link has expired or was already used."
          intro="Sign-in links work once, within 20 minutes (an invitation's, within a week)."
        />
        <Section>
          <Link href="/portal/login" className="text-ink underline underline-offset-4">
            Ask for a new link
          </Link>
        </Section>
      </>
    );
  }
  const who = found.client.company ? `${found.client.name}, ${found.client.company}` : found.client.name;
  return (
    <>
      <PageIntro
        label="Client portal"
        title={`Welcome, ${found.client.name}.`}
        intro={`Signing in as ${who}.`}
      />
      <Section>
        <VerifyButton token={token} label="Sign in" />
      </Section>
    </>
  );
}
