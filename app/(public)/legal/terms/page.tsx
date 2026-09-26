import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage } from "@/components/site/legal";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms that apply to quotes, projects, payments and ownership of the work.",
  alternates: { canonical: "/legal/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of service" updated="26 September 2026">
      <p>
        These terms apply to work I, {site.name}, do for you. A signed quote can add to them or change them;
        if the quote and these terms disagree, the quote wins.
      </p>
      <h2>Quotes and scope</h2>
      <p>
        Every project starts with a written quote: what will be built, the price, the milestones and the
        timeline. A quote is valid for 14 days. Work outside the agreed scope is quoted separately before it
        starts.
      </p>
      <h2>Payment</h2>
      <p>
        Payment follows the schedule in the quote (see <Link href="/pricing#terms">payment terms</Link>).
        Invoices are due within 7 days. If a payment is late, I may pause work until it arrives, and the
        timeline moves by the same amount.
      </p>
      <h2>Revisions</h2>
      <p>
        Each package includes a set number of revision rounds. A round is one consolidated list of changes to
        the delivered work. Further rounds are quoted before they start.
      </p>
      <h2>Ownership</h2>
      <p>
        When the project is paid in full, you own the code and all rights to it. Until then, it may not be
        used in production. I may reuse general techniques and my own open-source libraries, and I may mention
        the project in my portfolio unless you ask me not to.
      </p>
      <h2>Your part</h2>
      <p>
        You provide the content, access and decisions the project needs, on time. You make sure you have the
        rights to anything you give me, such as logos, text and images.
      </p>
      <h2>Warranty and liability</h2>
      <p>
        Bugs in the delivered scope are fixed free of charge for 14 days after launch. Beyond that, the work
        is provided as delivered. My total liability for any project is limited to the amount paid for it, and
        I am not liable for indirect losses such as lost profit or data.
      </p>
      <h2>Ending a project</h2>
      <p>
        Either side may end a project in writing. You pay for the work done up to that point; see the{" "}
        <Link href="/legal/refunds">refund policy</Link> for what happens to payments already made.
      </p>
      <h2>Law</h2>
      <p>These terms are governed by the laws of the Republic of Turkey.</p>
    </LegalPage>
  );
}
