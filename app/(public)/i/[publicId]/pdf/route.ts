import { clientIp } from "@/lib/ip";
import { invoiceByPublicId } from "@/server/billing/invoices";
import { pdfFileName, renderDocumentPdf } from "@/server/billing/pdf";
import { PUBLIC_ID_PATTERN } from "@/server/billing/public-id";
import { getBillingSettings } from "@/server/billing/settings";
import { invoiceView } from "@/server/billing/view";
import { PDF_LIMIT } from "@/server/billing/public";
import { limited } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";

// An issued invoice or credit note as a PDF, for the client.
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
    "invoice-pdf",
    clientIp(request.headers, getEnv().CLIENT_IP_SOURCE),
    PDF_LIMIT,
  );
  if (tooMany) return tooMany;
  const invoice = await invoiceByPublicId(db, publicId);
  if (!invoice) return notFound();
  const view = invoiceView(invoice, await getBillingSettings(db), getEnv().SITE_URL);
  return new Response(new Uint8Array(await renderDocumentPdf(view)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${pdfFileName(view)}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
