import { site } from "@/content/site";
import { goalSoon } from "@/server/analytics/kick";
import { renderCvPdf } from "@/server/content/cv-pdf";
import { publishedContent } from "@/server/content/site";

// Made on request from the published content, like the /cv page.
export const dynamic = "force-dynamic";

const HEADERS = {
  "content-type": "application/pdf",
  "content-disposition": `inline; filename="${site.name.replaceAll(" ", "-")}-CV.pdf"`,
};

export async function GET(request: Request): Promise<Response> {
  const pdf = await renderCvPdf(await publishedContent());
  goalSoon(request.headers, "cv");
  return new Response(new Uint8Array(pdf), { headers: HEADERS });
}

// Link checkers ask with HEAD: answered without making the PDF, and not counted as a download.
export function HEAD(): Response {
  return new Response(null, { headers: HEADERS });
}
