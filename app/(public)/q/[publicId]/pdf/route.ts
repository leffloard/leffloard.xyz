import { clientIp } from "@/lib/ip";
import { pdfFileName, renderDocumentPdf } from "@/server/billing/pdf";
import { PUBLIC_ID_PATTERN } from "@/server/billing/public-id";
import { quoteByPublicId } from "@/server/billing/quotes";
import { getBillingSettings } from "@/server/billing/settings";
import { quoteView } from "@/server/billing/view";
import { PDF_LIMIT } from "@/server/billing/public";
import { limited } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

// A sent quote as a PDF, for the client (drafts are not shown).
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(
  request: Request,
  { params }: { params: Promise<{ publicId: string }> },
): Promise<Response> {
  const publicId = (await params).publicId;
  if (!PUBLIC_ID_PATTERN.test(publicId)) return notFound();
  const db = await getDb();
  const tooMany = await limited(
    db,
    "quote-pdf",
    clientIp(request.headers, getEnv().CLIENT_IP_SOURCE),
    PDF_LIMIT,
  );
  if (tooMany) return tooMany;
  const quote = await quoteByPublicId(db, publicId);
  if (!quote || quote.status === "draft" || quote.status === "withdrawn") return notFound();
  const view = quoteView(quote, await getBillingSettings(db));
  return new Response(new Uint8Array(await renderDocumentPdf(view)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${pdfFileName(view)}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
