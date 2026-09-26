import type { ReactNode } from "react";
import { PageIntro } from "@/components/site/section";

export function LegalPage({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: ReactNode;
}) {
  return (
    <>
      <PageIntro label="Legal" title={title} intro={`Last updated ${updated}.`} />
      <div className="relative border-t border-line px-5 py-14 sm:px-10">
        <span aria-hidden className="crosshair top-0 left-0" />
        <span aria-hidden className="crosshair top-0 left-full" />
        <div className="prose max-w-[70ch]">{children}</div>
      </div>
    </>
  );
}
