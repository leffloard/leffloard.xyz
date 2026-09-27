// Native <details>: works without JavaScript and is announced correctly by screen readers.
export function Faq({ items }: { items: readonly { q: string; a: string }[] }) {
  return (
    <div className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <details key={item.q} className="group py-5">
          <summary className="flex cursor-pointer list-none items-start justify-between gap-6 text-lg font-medium [&::-webkit-details-marker]:hidden">
            {item.q}
            <span
              aria-hidden
              className="mt-1.5 font-mono text-sm text-muted transition-transform group-open:rotate-45"
            >
              +
            </span>
          </summary>
          <p className="mt-3 max-w-2xl text-pretty text-muted">{item.a}</p>
        </details>
      ))}
    </div>
  );
}
