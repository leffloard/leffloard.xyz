import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/components/ui/cn";

// A ranked list (pages, sources, countries...) with a bar behind each row showing its share of the top
// row.

export type ListRow = { key: string; label: string; value: number; detail?: string };

export function CountList({
  title,
  description,
  rows,
  nameLabel,
  valueLabel,
  empty,
  mono = false,
  limit = 10,
  className,
}: {
  title: string;
  description?: ReactNode;
  rows: ListRow[];
  nameLabel: string;
  valueLabel: string;
  empty: string;
  mono?: boolean;
  limit?: number;
  className?: string;
}) {
  const top = Math.max(1, ...rows.map((row) => row.value));
  const shown = rows.slice(0, limit);
  return (
    <Card className={className}>
      <CardHeader title={title} description={description} />
      <CardBody>
        {shown.length === 0 ? (
          <p className="text-[13px] text-muted">{empty}</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-xs text-muted">
                <th scope="col" className="pb-1.5 text-left font-normal">
                  {nameLabel}
                </th>
                <th scope="col" className="pb-1.5 text-right font-normal">
                  {valueLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.key}>
                  <td className="relative w-full max-w-0 py-1 pr-3">
                    <span
                      aria-hidden
                      className="absolute inset-y-0.5 left-0 rounded-sm bg-accent/10"
                      style={{ width: `${Math.max(1, (row.value / top) * 100)}%` }}
                    />
                    <span className={cn("relative block truncate px-1.5", mono && "font-mono text-xs")}>
                      {row.label}
                    </span>
                  </td>
                  <td className="py-1 text-right whitespace-nowrap">
                    <span className="font-mono tabular-nums">{row.value.toLocaleString("en-US")}</span>
                    {row.detail ? <span className="ml-2 text-xs text-muted">{row.detail}</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
