import "server-only";
import { Document, Link, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import type { DocumentView } from "@/server/billing/view";
import { registerPdfFonts } from "@/server/pdf/fonts";

// A quote or an invoice as an A4 PDF, drawn from the same view as its web page. Amounts carry currency codes
// (the typeface has no lira sign, and accountants prefer the codes anyway).
registerPdfFonts();

const INK = "#111317";
const MUTED = "#5b606b";
const LINE = "#e3e5e8";
const ACCENT = "#0b6a80";

const styles = StyleSheet.create({
  page: {
    fontFamily: "Geist",
    fontSize: 9.5,
    color: INK,
    paddingTop: 44,
    paddingBottom: 56,
    paddingHorizontal: 48,
    lineHeight: 1.45,
  },
  header: { flexDirection: "row", justifyContent: "space-between", marginBottom: 26 },
  heading: { fontSize: 20, fontWeight: 600, letterSpacing: -0.3, lineHeight: 1.25 },
  number: { fontSize: 10, color: MUTED, marginTop: 4 },
  seller: { textAlign: "right", color: MUTED, maxWidth: 240, alignItems: "flex-end" },
  sellerName: { color: INK, fontWeight: 600 },
  parties: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
  label: { fontSize: 7.5, color: MUTED, textTransform: "uppercase", letterSpacing: 1.1, marginBottom: 3 },
  title: { fontSize: 12, fontWeight: 600, marginBottom: 10 },
  tableHead: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: INK, paddingBottom: 4 },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: LINE, paddingVertical: 5 },
  description: { flex: 1, paddingRight: 10 },
  quantity: { width: 44, textAlign: "right" },
  unit: { width: 92, textAlign: "right" },
  amount: { width: 96, textAlign: "right" },
  totals: { marginTop: 8, marginLeft: "auto", width: 240 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  strong: { fontWeight: 600 },
  muted: { color: MUTED },
  section: { marginTop: 18, borderTopWidth: 1, borderTopColor: LINE, paddingTop: 10 },
  pair: { flexDirection: "row", paddingVertical: 1.5 },
  pairLabel: { width: 150, color: MUTED },
  link: { color: ACCENT, textDecoration: "none" },
  stamp: {
    position: "absolute",
    top: 44,
    right: 48,
    fontSize: 10,
    fontWeight: 600,
    color: ACCENT,
    borderWidth: 1,
    borderColor: ACCENT,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  footerNote: { position: "absolute", bottom: 26, left: 48, right: 200, fontSize: 7.5, color: MUTED },
  footerPage: {
    position: "absolute",
    bottom: 26,
    left: 300,
    right: 48,
    textAlign: "right",
    fontSize: 7.5,
    color: MUTED,
  },
});

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pair}>
      <Text style={styles.pairLabel}>{label}</Text>
      <Text style={{ flex: 1 }}>{value}</Text>
    </View>
  );
}

function DocumentPdf({ view }: { view: DocumentView }) {
  const { seller, recipient, payment } = view;
  return (
    <Document title={`${view.heading} ${view.number}`} author={seller.name} subject={view.title}>
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.heading}>{view.heading}</Text>
            <Text style={styles.number}>{view.number}</Text>
          </View>
          <View style={styles.seller}>
            <Text style={styles.sellerName}>{seller.name}</Text>
            {seller.address ? <Text>{seller.address}</Text> : null}
            <Text>{seller.email}</Text>
            {seller.taxId ? <Text>Tax ID {seller.taxId}</Text> : null}
          </View>
        </View>

        <View style={styles.parties}>
          <View style={{ maxWidth: 260 }}>
            <Text style={styles.label}>For</Text>
            <Text style={styles.strong}>{recipient.name}</Text>
            {recipient.company ? <Text>{recipient.company}</Text> : null}
            {recipient.address ? <Text>{recipient.address}</Text> : null}
            {recipient.email ? <Text style={styles.muted}>{recipient.email}</Text> : null}
          </View>
          <View>
            {view.dates.map((date) => (
              <View key={date.label} style={{ marginBottom: 4, alignItems: "flex-end" }}>
                <Text style={styles.label}>{date.label}</Text>
                <Text>{date.value}</Text>
              </View>
            ))}
          </View>
        </View>

        <Text style={styles.title}>{view.title}</Text>
        <View style={styles.tableHead}>
          <Text style={[styles.description, styles.label]}>Description</Text>
          <Text style={[styles.quantity, styles.label]}>Qty</Text>
          <Text style={[styles.unit, styles.label]}>Unit price</Text>
          <Text style={[styles.amount, styles.label]}>Amount</Text>
        </View>
        {view.lines.map((line, index) => (
          <View key={index} style={styles.row} wrap={false}>
            <Text style={styles.description}>{line.description}</Text>
            <Text style={styles.quantity}>{line.quantity}</Text>
            <Text style={styles.unit}>{line.unit}</Text>
            <Text style={styles.amount}>{line.amount}</Text>
          </View>
        ))}
        <View style={styles.totals} wrap={false}>
          {view.totals.map((total) => (
            <View key={total.label} style={styles.totalRow}>
              <Text style={total.strong ? styles.strong : styles.muted}>{total.label}</Text>
              <Text style={total.strong ? styles.strong : undefined}>{total.value}</Text>
            </View>
          ))}
        </View>

        {view.schedule.length ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>Payments</Text>
            {view.schedule.map((step) => (
              <Pair key={step.label} label={step.label} value={step.amount} />
            ))}
          </View>
        ) : null}

        {view.facts.length ? (
          <View style={styles.section} wrap={false}>
            {view.facts.map((fact) => (
              <Pair key={fact.label} label={fact.label} value={fact.value} />
            ))}
          </View>
        ) : null}

        {payment ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>How to pay</Text>
            {payment.bank ? (
              <>
                <Pair label="Bank transfer to" value={payment.bank.holder} />
                <Pair label="Bank" value={payment.bank.bankName} />
                <Pair label="IBAN" value={payment.bank.iban} />
                {payment.bank.swift ? <Pair label="SWIFT / BIC" value={payment.bank.swift} /> : null}
                {payment.reference ? <Pair label="Reference" value={payment.reference} /> : null}
              </>
            ) : null}
            {payment.onlineUrl ? (
              <View style={styles.pair}>
                <Text style={styles.pairLabel}>Pay online</Text>
                <Link src={payment.onlineUrl} style={[styles.link, { flex: 1 }]}>
                  {payment.onlineUrl}
                </Link>
              </View>
            ) : null}
          </View>
        ) : null}

        {view.notes ? (
          <View style={styles.section} wrap={false}>
            <Text style={styles.label}>Notes</Text>
            <Text>{view.notes}</Text>
          </View>
        ) : null}

        {view.stamp ? <Text style={styles.stamp}>{view.stamp.toUpperCase()}</Text> : null}
        <Text style={styles.footerNote} fixed>
          {seller.note || `${seller.name} · ${seller.email}`}
        </Text>
        <Text style={styles.footerPage} fixed>
          {view.number}
        </Text>
      </Page>
    </Document>
  );
}

export function renderDocumentPdf(view: DocumentView): Promise<Buffer> {
  return renderToBuffer(<DocumentPdf view={view} />);
}

// "Q-2026-0003.pdf", or the title for a draft.
export function pdfFileName(view: DocumentView): string {
  const base = view.number === "Draft" ? `draft-${view.title}` : view.number;
  return `${base.replace(/[^A-Za-z0-9._-]+/g, "-").slice(0, 80)}.pdf`;
}
