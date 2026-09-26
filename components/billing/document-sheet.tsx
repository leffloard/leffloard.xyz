import type { DocumentView } from "@/server/billing/view";

// A quote or an invoice as a page: the same view the PDF is drawn from, so the two always agree. Used in the
// admin's preview and on the client's own page.
export function DocumentSheet({ view }: { view: DocumentView }) {
  const { seller, recipient, payment } = view;
  return (
    <article className="relative min-w-0 rounded-2xl border border-line bg-surface p-5 text-[14px] leading-6 sm:p-8">
      {view.stamp ? (
        <p className="absolute top-5 right-5 rounded border border-accent/60 px-2 py-0.5 font-mono text-[11px] tracking-[0.14em] text-accent uppercase sm:top-8 sm:right-8">
          {view.stamp}
        </p>
      ) : null}
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">{view.heading}</h2>
          <p className="font-mono text-[13px] text-muted">{view.number}</p>
        </div>
        <address
          className={`text-[13px] text-muted not-italic sm:text-right ${view.stamp ? "sm:mt-10" : ""}`}
        >
          <span className="block font-medium text-ink">{seller.name}</span>
          {seller.address ? <span className="block whitespace-pre-line">{seller.address}</span> : null}
          <span className="block">{seller.email}</span>
          {seller.taxId ? <span className="block">Tax ID {seller.taxId}</span> : null}
        </address>
      </header>

      <div className="mt-8 flex flex-wrap justify-between gap-6">
        <div className="min-w-0">
          <p className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">For</p>
          <p className="mt-1 font-medium">{recipient.name}</p>
          {recipient.company ? <p>{recipient.company}</p> : null}
          {recipient.address ? <p className="whitespace-pre-line">{recipient.address}</p> : null}
          {recipient.email ? <p className="text-muted">{recipient.email}</p> : null}
        </div>
        {view.dates.length ? (
          <dl className="grid content-start gap-2 sm:text-right">
            {view.dates.map((date) => (
              <div key={date.label}>
                <dt className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">{date.label}</dt>
                <dd>{date.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
      </div>

      <h3 className="mt-8 text-base font-semibold">{view.title}</h3>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-[13px]">
          <thead>
            <tr className="border-b border-ink/60 text-left font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
              <th scope="col" className="py-2 pr-3 font-normal">
                Description
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                Qty
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                Unit price
              </th>
              <th scope="col" className="py-2 text-right font-normal">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {view.lines.map((line, index) => (
              <tr key={index} className="border-b border-line align-top">
                <td className="py-2 pr-3 whitespace-pre-line">{line.description}</td>
                <td className="py-2 pr-3 text-right font-mono tabular-nums">{line.quantity}</td>
                <td className="py-2 pr-3 text-right font-mono whitespace-nowrap tabular-nums">{line.unit}</td>
                <td className="py-2 text-right font-mono whitespace-nowrap tabular-nums">{line.amount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-3 ml-auto grid max-w-xs gap-1 text-[13px]">
        {view.totals.map((total) => (
          <div
            key={total.label}
            className={`flex justify-between gap-4 ${total.strong ? "border-t border-line pt-1.5 text-sm font-semibold" : "text-muted"}`}
          >
            <dt>{total.label}</dt>
            <dd className={`font-mono tabular-nums ${total.strong ? "" : "text-ink"}`}>{total.value}</dd>
          </div>
        ))}
      </dl>

      {view.schedule.length || view.facts.length ? (
        <dl className="mt-8 grid gap-1.5 border-t border-line pt-5 text-[13px] sm:grid-cols-[220px_minmax(0,1fr)]">
          {view.schedule.map((step) => (
            <div key={step.label} className="contents">
              <dt className="text-muted">{step.label}</dt>
              <dd className="font-mono tabular-nums">{step.amount}</dd>
            </div>
          ))}
          {view.facts.map((fact) => (
            <div key={fact.label} className="contents">
              <dt className="text-muted">{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {payment?.bank ? (
        <section className="mt-8 border-t border-line pt-5 text-[13px]" aria-labelledby="sheet-bank">
          <h4 id="sheet-bank" className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
            Bank transfer
          </h4>
          <dl className="mt-2 grid gap-1.5 sm:grid-cols-[220px_minmax(0,1fr)]">
            <dt className="text-muted">Account holder</dt>
            <dd>{payment.bank.holder}</dd>
            <dt className="text-muted">Bank</dt>
            <dd>{payment.bank.bankName}</dd>
            <dt className="text-muted">IBAN</dt>
            <dd className="font-mono break-all">{payment.bank.iban}</dd>
            {payment.bank.swift ? (
              <>
                <dt className="text-muted">SWIFT / BIC</dt>
                <dd className="font-mono">{payment.bank.swift}</dd>
              </>
            ) : null}
            {payment.reference ? (
              <>
                <dt className="text-muted">Reference</dt>
                <dd className="font-mono">{payment.reference}</dd>
              </>
            ) : null}
          </dl>
        </section>
      ) : null}

      {view.notes ? (
        <section className="mt-8 border-t border-line pt-5 text-[13px]" aria-labelledby="sheet-notes">
          <h4 id="sheet-notes" className="font-mono text-[11px] tracking-[0.14em] text-muted uppercase">
            Notes
          </h4>
          <p className="mt-2 whitespace-pre-line">{view.notes}</p>
        </section>
      ) : null}
      {seller.note ? <p className="mt-8 text-xs text-muted">{seller.note}</p> : null}
    </article>
  );
}
