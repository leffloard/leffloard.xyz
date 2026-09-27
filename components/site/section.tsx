import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";

// A page section on the drawing grid: an index label ("01 / Work"), a title, and crosshair marks where its
// top border meets the frame. Without a title the label is the section's heading, so what the section holds
// (cards with their own headings, a form) sits one level below it.
export function Section({
  id,
  index,
  label,
  title,
  intro,
  action,
  children,
  className,
}: {
  id?: string;
  index?: string;
  label?: string;
  title?: ReactNode;
  intro?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const headingId = id ? `${id}-title` : undefined;
  const Label = title ? "p" : "h2";
  return (
    <section
      id={id}
      aria-labelledby={title || label ? headingId : undefined}
      className={cn("relative border-t border-line", className)}
    >
      <span aria-hidden className="crosshair top-0 left-0" />
      <span aria-hidden className="crosshair top-0 left-full" />
      <div className="px-5 py-16 sm:px-10 sm:py-24">
        {label || title ? (
          <header className="reveal mb-10 grid gap-4 sm:mb-14 md:grid-cols-12">
            {label ? (
              <Label
                id={title ? undefined : headingId}
                className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase md:col-span-3 md:pt-2"
              >
                {index ? (
                  <span aria-hidden className="text-accent">
                    {index} /{" "}
                  </span>
                ) : null}
                {label}
              </Label>
            ) : null}
            <div className={cn("md:col-span-9", !label && "md:col-start-4")}>
              {title ? (
                <h2
                  id={headingId}
                  className="max-w-3xl text-3xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-[2.6rem]"
                >
                  {title}
                </h2>
              ) : null}
              {intro ? (
                <p className="mt-4 max-w-2xl text-base text-pretty text-muted sm:text-lg">{intro}</p>
              ) : null}
              {action ? <div className="mt-6">{action}</div> : null}
            </div>
          </header>
        ) : null}
        {children}
      </div>
    </section>
  );
}

export function PageIntro({
  label,
  title,
  intro,
  children,
}: {
  label: string;
  title: ReactNode;
  intro?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="relative px-5 pt-16 pb-14 sm:px-10 sm:pt-24 sm:pb-20">
      <p className="rise font-mono text-[11px] tracking-[0.14em] text-muted uppercase">{label}</p>
      <h1
        className="rise mt-5 max-w-4xl text-4xl leading-[1.02] font-semibold tracking-[-0.03em] text-balance sm:text-6xl"
        style={{ "--delay": "80ms" } as React.CSSProperties}
      >
        {title}
      </h1>
      {intro ? (
        <p
          className="rise mt-6 max-w-2xl text-lg text-pretty text-muted"
          style={{ "--delay": "160ms" } as React.CSSProperties}
        >
          {intro}
        </p>
      ) : null}
      {children}
    </div>
  );
}
