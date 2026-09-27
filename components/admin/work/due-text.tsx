import { cn } from "@/components/ui/cn";
import type { DueTone } from "@/lib/work/dates";

const TONES: Record<DueTone, string> = {
  overdue: "text-danger",
  today: "text-warning",
  soon: "text-ink/85",
  later: "text-muted",
};

// "Due" text coloured by how close it is.
export function DueText({ due, className }: { due: { text: string; tone: DueTone }; className?: string }) {
  return <span className={cn("whitespace-nowrap", TONES[due.tone], className)}>{due.text}</span>;
}
