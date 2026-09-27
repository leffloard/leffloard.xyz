// Income and expenses month by month, as paired bars. Drawn on the server; the table beside it carries the
// same numbers for screen readers and for reading exact amounts.

export type ChartMonth = { key: string; short: string; income: number; expense: number };

const HEIGHT = 160;
const LABEL = 18;

export function MonthChart({ months, summary }: { months: ChartMonth[]; summary: string }) {
  const top = Math.max(1, ...months.map((month) => Math.max(month.income, month.expense)));
  const slot = 60;
  const width = Math.max(1, months.length) * slot;
  const bar = 16;
  const scale = (value: number) => Math.round((Math.max(0, value) / top) * (HEIGHT - 8));
  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${width} ${HEIGHT + LABEL}`}
        className="h-auto w-full"
      >
        <line x1={0} x2={width} y1={HEIGHT} y2={HEIGHT} className="stroke-line-strong" strokeWidth={1} />
        {months.map((month, index) => {
          const x = index * slot + (slot - bar * 2 - 2) / 2;
          const income = scale(month.income);
          const expense = scale(month.expense);
          return (
            <g key={month.key}>
              <rect x={x} y={HEIGHT - income} width={bar} height={income} rx={2} className="fill-accent" />
              <rect
                x={x + bar + 2}
                y={HEIGHT - expense}
                width={bar}
                height={expense}
                rx={2}
                className="fill-muted/45"
              />
              <text
                x={index * slot + slot / 2}
                y={HEIGHT + 14}
                textAnchor="middle"
                className="fill-muted text-[11px]"
              >
                {month.short}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-accent" /> Income
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-muted/45" /> Expenses
        </span>
      </figcaption>
    </figure>
  );
}
