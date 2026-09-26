import { currentAdmin } from "@/server/auth/dal";
import { getInvoice } from "@/server/billing/invoices";
import { pdfFileName, renderDocumentPdf } from "@/server/billing/pdf";
import { getBillingSettings } from "@/server/billing/settings";
import { invoiceView } from "@/server/billing/view";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { parseId } from "@/server/work/collections";

// An invoice or credit note as a PDF, drafts included, for the owner.
export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!(await currentAdmin())) return notFound();
  const id = parseId((await params).id);
  const db = await getDb();
  const invoice = id ? await getInvoice(db, id) : null;
  if (!invoice) return notFound();
  const view = invoiceView(invoice, await getBillingSettings(db), getEnv().SITE_URL);
  return new Response(new Uint8Array(await renderDocumentPdf(view)), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${pdfFileName(view)}"`,
      "cache-control": "private, no-store",
    },
  });
}
