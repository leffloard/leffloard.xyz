import { writeFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { describe, expect, it } from "vitest";
import { computeTotals, SCHEDULES } from "@/lib/billing/document";
import { pdfFileName, renderDocumentPdf } from "@/server/billing/pdf";
import { DEFAULT_BILLING } from "@/server/billing/settings";
import type { InvoiceDoc, QuoteDoc } from "@/server/billing/types";
import { invoiceView, quoteView } from "@/server/billing/view";

const at = new Date("2026-09-28T06:00:00Z");
const lines = [
  {
    id: "1",
    description: "Design and build: an 8-page site with an editor, booking and a blog",
    quantityMilli: 1000,
    unitMinor: 120_000_00,
  },
  { id: "2", description: "Extra language (Türkçe)", quantityMilli: 1000, unitMinor: 25_000_00 },
  { id: "3", description: "Care plan, months", quantityMilli: 3000, unitMinor: 4_900_00 },
];
const discount = { kind: "percent" as const, basisPoints: 1000 };
const taxes = [{ label: "VAT", basisPoints: 2000 }];
const settings = {
  ...DEFAULT_BILLING,
  business: {
    ...DEFAULT_BILLING.business,
    address: "Pamukkale, Denizli\nTürkiye",
    note: "Not registered for VAT.",
  },
  version: 1,
  updatedAt: at,
};
const quote: QuoteDoc = {
  _id: new ObjectId(),
  publicId: "a".repeat(22),
  number: "Q-2026-0003",
  status: "sent",
  title: "Business site for Çınar Fırın",
  clientId: new ObjectId(),
  inquiryId: null,
  recipient: {
    name: "Ayşe Yılmaz",
    company: "Çınar Fırın Ltd. Şti.",
    email: "ayse@example.com",
    address: "İzmir, Türkiye",
  },
  currency: "TRY",
  lines,
  discount,
  taxes,
  notes: "Hosting and the domain are paid by you directly.",
  totals: computeTotals(lines, discount, taxes),
  schedule: [...SCHEDULES.thirds.steps],
  timeline: "About 3 weeks",
  revisionsIncluded: 2,
  extraRevisionMinor: 2_000_00,
  validUntil: "2026-10-12",
  sentAt: at,
  viewedAt: null,
  answeredAt: null,
  acceptedBy: null,
  declineReason: null,
  projectId: null,
  depositInvoiceId: null,
  version: 2,
  createdAt: at,
  updatedAt: at,
};
const invoice: InvoiceDoc = {
  ...quote,
  kind: "invoice",
  number: "INV-2026-0007",
  status: "issued",
  projectId: null,
  quoteId: null,
  creditFor: null,
  seller: settings.business,
  label: "Payment request",
  methods: ["bank", "crypto"],
  bankAccount: {
    id: "b",
    label: "Lira",
    holder: "Mert Kaan Koparan",
    bankName: "Example Bank",
    iban: "TR330006100519786457841326",
    swift: null,
    currency: "TRY",
  },
  paidMinor: 0,
  issueDate: "2026-09-28",
  dueDate: "2026-10-05",
  remindersSent: 0,
  lastReminderAt: null,
  paidAt: null,
  voidedAt: null,
  voidReason: null,
};

describe("document PDFs", () => {
  it("writes a quote and an invoice, Turkish letters and all", async () => {
    const quoteView_ = quoteView(quote, settings);
    const invoiceView_ = invoiceView(invoice, settings, "https://leffloard.xyz");
    expect(invoiceView_.payment?.bank?.iban).toBe("TR33 0006 1005 1978 6457 8413 26");
    expect(invoiceView_.payment?.onlineUrl).toBe(`https://leffloard.xyz/i/${"a".repeat(22)}`);
    expect(quoteView_.totals.at(-1)).toEqual({ label: "Total", value: "TRY 172,476.00", strong: true });
    const quotePdf = await renderDocumentPdf(quoteView_);
    const invoicePdf = await renderDocumentPdf(invoiceView_);
    for (const pdf of [quotePdf, invoicePdf]) {
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.length).toBeGreaterThan(5_000);
    }
    expect(pdfFileName(quoteView_)).toBe("Q-2026-0003.pdf");
    if (process.env.PDF_OUT) {
      writeFileSync(`${process.env.PDF_OUT}/quote.pdf`, quotePdf);
      writeFileSync(`${process.env.PDF_OUT}/invoice.pdf`, invoicePdf);
    }
  }, 30_000);
});
