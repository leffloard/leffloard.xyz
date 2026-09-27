import type { Metadata } from "next";
import { LegalPage } from "@/components/site/legal";
import { site } from "@/content/site";

export const metadata: Metadata = {
  title: "Refund policy",
  description: "When payments are refunded, how, and how long it takes.",
  alternates: { canonical: "/legal/refunds" },
};

export default function RefundsPage() {
  return (
    <LegalPage title="Refund policy" updated="26 September 2026">
      <h2>Before work starts</h2>
      <p>If you cancel before any work has started, the full payment is refunded.</p>
      <h2>During a project</h2>
      <p>
        If the project ends early, you pay for the work done up to that point, and any payment beyond that is
        refunded. Milestones you have already accepted are not refunded.
      </p>
      <h2>If I cannot deliver</h2>
      <p>If I cannot finish the agreed work, every payment for the undelivered part is refunded in full.</p>
      <h2>Subscriptions</h2>
      <p>Care plans and hosting can be cancelled at any time and stop at the end of the paid month.</p>
      <h2>How refunds are paid</h2>
      <p>
        Refunds go back through the original payment method within 14 days. Cryptocurrency payments are
        refunded in the same currency and amount that was received, minus the network fee for sending it.
      </p>
      <h2>Questions</h2>
      <p>
        Email <a href={`mailto:${site.email}`}>{site.email}</a>.
      </p>
    </LegalPage>
  );
}
