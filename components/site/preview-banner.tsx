import { previewing } from "@/server/content/preview";

// Shown on every public page while the owner previews drafts, so a draft is never mistaken for the site.
export async function PreviewBanner() {
  if (!(await previewing())) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 bottom-0 z-50 flex flex-wrap items-center justify-center gap-3 border-t border-warning/40 bg-canvas/95 px-4 py-3 text-sm backdrop-blur"
    >
      <span>
        <strong>Preview.</strong> You are seeing the drafts, including what is not published.
      </span>
      <form method="post" action="/api/preview/exit">
        <button type="submit" className="rounded-full border border-line-strong px-3 py-1 hover:bg-surface">
          Exit preview
        </button>
      </form>
    </div>
  );
}
