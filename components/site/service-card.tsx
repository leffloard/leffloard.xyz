import Link from "next/link";
import { Arrow } from "@/components/site/link-button";
import { Spotlight } from "@/components/site/spotlight";
import type { Service } from "@/content/services";

export function formatPrice(amount: number): string {
  return `$${amount.toLocaleString("en-US")}`;
}

export function ServiceCard({ service, index }: { service: Service; index: number }) {
  const from = Math.min(...service.packages.map((item) => item.price));
  return (
    <Spotlight className="h-full">
      <Link
        href={`/services/${service.slug}`}
        className="group flex h-full flex-col p-6 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent sm:p-7"
      >
        <span className="font-mono text-[11px] tracking-[0.12em] text-muted">
          {String(index + 1).padStart(2, "0")}
        </span>
        <h3 className="mt-8 text-xl font-semibold tracking-tight">{service.title}</h3>
        <p className="mt-2 text-[15px] text-pretty text-muted">{service.short}</p>
        <div className="mt-auto flex items-end justify-between gap-3 pt-8">
          <p className="text-sm">
            <span className="text-muted">from </span>
            <span className="font-semibold">{formatPrice(from)}</span>
          </p>
          <Arrow className="size-4 text-muted group-hover:text-ink" />
        </div>
      </Link>
    </Spotlight>
  );
}
