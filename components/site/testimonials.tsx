import type { Testimonial } from "@/lib/content/types";

// Quotes from clients, published only with their permission (the content editor checks it).
export function Testimonials({ items }: { items: Testimonial[] }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {items.map((item) => (
        <li key={item.id} className="reveal rounded-2xl border border-line bg-surface/50 p-6 sm:p-7">
          <figure>
            <blockquote className="text-lg leading-relaxed text-pretty">
              &ldquo;{item.quote}&rdquo;
            </blockquote>
            <figcaption className="mt-4 text-sm text-muted">
              <span className="font-medium text-ink">{item.name}</span>
              {item.role ? `, ${item.role}` : ""}
            </figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
