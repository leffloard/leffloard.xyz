import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SignInForm } from "@/components/site/portal/sign-in-form";
import { PageIntro, Section } from "@/components/site/section";
import { getEnv } from "@/server/env";
import { currentPortalClient } from "@/server/portal/dal";

export const metadata: Metadata = { title: "Sign in" };

export default async function PortalSignInPage() {
  if (await currentPortalClient()) redirect("/portal");
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <PageIntro
        label="Client portal"
        title="Sign in to your portal."
        intro="Your projects, their updates and deliverables, revisions, invoices and calls. No password: you get a link by email."
      />
      <Section>
        <div className="grid max-w-xl gap-6">
          <SignInForm turnstileSiteKey={getEnv().TURNSTILE_SITE_KEY} nonce={nonce} />
          <p className="text-sm text-muted">
            Not a client yet?{" "}
            <Link href="/contact" className="text-ink underline underline-offset-4">
              Tell me about your project
            </Link>
            .
          </p>
        </div>
      </Section>
    </>
  );
}
