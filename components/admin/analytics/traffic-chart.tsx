// Visitors and page views over a range, as overlapping bars: page views behind, visitors in front. Drawn on
// the server; the table below it carries the same numbers for screen readers.

export type ChartPoint = { key: string; label: string; visitors: number; views: number };

const WIDTH = 720;
const HEIGHT = 150;
const LABEL = 18;

// Every label for a few bars, fewer as the bars get thin.
function labelEvery(count: number): number {
  if (count <= 12) return 1;
  if (count <= 24) return 3;
  if (count <= 31) return 5;
  return 15;
}

export function TrafficChart({
  points,
  summary,
  caption,
}: {
  points: ChartPoint[];
  summary: string;
  caption: string;
}) {
  const top = Math.max(1, ...points.map((point) => Math.max(point.views, point.visitors)));
  const slot = WIDTH / Math.max(1, points.length);
  const bar = Math.max(2, Math.min(28, slot * 0.7));
  const scale = (value: number) => Math.round((Math.max(0, value) / top) * (HEIGHT - 8));
  const every = labelEvery(points.length);
  return (
    <figure className="m-0">
      <svg
        role="img"
        aria-label={summary}
        viewBox={`0 0 ${WIDTH} ${HEIGHT + LABEL}`}
        className="h-auto w-full"
      >
        <line x1={0} x2={WIDTH} y1={HEIGHT} y2={HEIGHT} className="stroke-line-strong" strokeWidth={1} />
        {points.map((point, index) => {
          const x = index * slot + (slot - bar) / 2;
          const views = scale(point.views);
          const visitors = scale(point.visitors);
          return (
            <g key={point.key}>
              <rect x={x} y={HEIGHT - views} width={bar} height={views} rx={2} className="fill-muted/30" />
              <rect
                x={x + bar * 0.2}
                y={HEIGHT - visitors}
                width={bar * 0.6}
                height={visitors}
                rx={2}
                className="fill-accent"
              />
              {index % every === 0 ? (
                <text
                  x={index * slot + slot / 2}
                  y={HEIGHT + 14}
                  textAnchor="middle"
                  className="fill-muted text-[11px]"
                >
                  {point.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-accent" /> Visitors
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-2.5 rounded-sm bg-muted/30" /> Page views
        </span>
        <span>{caption}</span>
      </figcaption>
      <table className="sr-only">
        <caption>{summary}</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Visitors</th>
            <th scope="col">Page views</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.key}>
              <th scope="row">{point.label}</th>
              <td>{point.visitors}</td>
              <td>{point.views}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// A row of small bars without labels (the last 30 minutes, the last two weeks).
export function SparkBars({ values, label }: { values: number[]; label: string }) {
  const top = Math.max(1, ...values);
  const slot = 6;
  const height = 32;
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${values.length * slot} ${height}`}
      className="h-8 w-full"
      preserveAspectRatio="none"
    >
      {values.map((value, index) => {
        const bar = value > 0 ? Math.max(2, Math.round((value / top) * height)) : 1;
        return (
          <rect
            key={index}
            x={index * slot + 1}
            y={height - bar}
            width={slot - 2}
            height={bar}
            rx={1}
            className={value > 0 ? "fill-accent" : "fill-line-strong"}
          />
        );
      })}
    </svg>
  );
}
