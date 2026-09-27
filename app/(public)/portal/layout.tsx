import type { Metadata } from "next";
import { PortalNav } from "@/components/site/portal/portal-nav";
import { currentPortalClient } from "@/server/portal/dal";

// The client portal, inside the site's frame. Pages are per client, never indexed, and send no referrer.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Client portal", template: "%s · Client portal" },
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const context = await currentPortalClient();
  return (
    <>
      {context ? <PortalNav name={context.client.company ?? context.client.name} /> : null}
      {children}
    </>
  );
}
