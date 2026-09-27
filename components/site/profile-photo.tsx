import { existsSync } from "node:fs";
import path from "node:path";
import Image from "next/image";
import { cn } from "@/components/ui/cn";
import { site } from "@/content/site";

// The owner's photo, if public/images/profile.jpg exists at build time; otherwise a monogram.
const PHOTO = "/images/profile.jpg";
const hasPhoto = existsSync(path.join(process.cwd(), "public", PHOTO));

export function ProfilePhoto({ className }: { className?: string }) {
  if (hasPhoto) {
    return (
      <Image
        src={PHOTO}
        alt={`Portrait of ${site.name}`}
        width={640}
        height={800}
        sizes="(min-width: 768px) 30vw, 90vw"
        className={cn("aspect-[4/5] w-full rounded-2xl border border-line object-cover", className)}
        priority
      />
    );
  }
  const initials = site.name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("");
  return (
    <div
      role="img"
      aria-label={site.name}
      className={cn(
        "relative flex aspect-[4/5] w-full items-center justify-center overflow-hidden rounded-2xl border border-line bg-surface",
        className,
      )}
    >
      <div
        aria-hidden
        className="absolute inset-0 [background-image:linear-gradient(to_right,var(--color-line)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-line)_1px,transparent_1px)] [background-size:32px_32px]"
      />
      <span className="relative font-mono text-6xl tracking-tight text-muted">{initials}</span>
    </div>
  );
}
