import { currentAdmin } from "@/server/auth/dal";
import { renderDocumentPdf, pdfFileName } from "@/server/billing/pdf";
import { getQuote } from "@/server/billing/quotes";
import { getBillingSettings } from "@/server/billing/settings";
import { quoteView } from "@/server/billing/view";
import { getDb } from "@/server/db/client";
import { parseId } from "@/server/work/collections";

// A quote as a PDF, drafts included, for the owner.
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await currentAdmin())) return notFound();
  const id = parseId((await params).id);
  const db = await getDb();
  const quote = id ? await getQuote(db, id) : null;
  if (!quote) return notFound();
  const view = quoteView(quote, await getBillingSettings(db));
  return new Response(new Uint8Array(await renderDocumentPdf(view)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${pdfFileName(view)}"`,
      "cache-control": "private, no-store",
    },
  });
}
