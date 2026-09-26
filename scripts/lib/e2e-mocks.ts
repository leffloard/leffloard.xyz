// Local stand-ins for the outside services the end-to-end tests touch:
//   NOWPayments  /v1/invoice, /v1/payment/:id (API), /checkout/:id (its payment page), and
//                POST /control/pay {invoiceId, status} which "pays" and sends the signed callback (IPN);
//   TCMB         /kurlar/today.xml and /kurlar/YYYYMM/DDMMYYYY.xml, with fixed rates on weekdays;
//   GitHub       /github/users/leffloard/repos, two public repositories and a private one.
import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { addDays, todayIn } from "@/lib/intake/time";
import { weekdayIndex } from "@/lib/work/dates";

type Options = { port: number; apiKey: string; ipnSecret: string; rates: Record<string, string> };

type Invoice = { id: string; body: Record<string, unknown> };

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortDeep((value as Record<string, unknown>)[key])]),
    );
  }
  return value;
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? (JSON.parse(text) as Record<string, unknown>) : {};
}

function send(response: ServerResponse, status: number, body: unknown, type = "application/json"): void {
  response.writeHead(status, { "content-type": type });
  response.end(typeof body === "string" ? body : JSON.stringify(body));
}

function bulletin(day: string, rates: Record<string, string>): string {
  const [year, month, date] = day.split("-");
  const currencies = Object.entries(rates)
    .map(
      ([code, rate]) =>
        `  <Currency CrossOrder="0" Kod="${code}" CurrencyCode="${code}"><Unit>1</Unit><ForexBuying>${rate}</ForexBuying></Currency>`,
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Tarih_Date Tarih="${date}.${month}.${year}" Date="${month}/${date}/${year}" Bulten_No="${year}/1">\n${currencies}\n</Tarih_Date>\n`;
}

export function startMocks({ port, apiKey, ipnSecret, rates }: Options): Promise<Server> {
  const invoices = new Map<string, Invoice>();
  const payments = new Map<string, Record<string, unknown>>();
  let sequence = 0;

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);
      const path = url.pathname;
      if (path === "/favicon.ico") return send(response, 204, "", "image/x-icon");

      // --- NOWPayments' API ---
      if (path.startsWith("/v1/")) {
        if (request.headers["x-api-key"] !== apiKey)
          return send(response, 403, { message: "Invalid api key" });
        if (path === "/v1/invoice" && request.method === "POST") {
          const body = await readJson(request);
          const id = String(4_600_000_000 + ++sequence);
          invoices.set(id, { id, body });
          return send(response, 200, {
            id,
            order_id: body.order_id,
            price_amount: String(body.price_amount),
            price_currency: body.price_currency,
            invoice_url: `http://127.0.0.1:${port}/checkout/${id}`,
          });
        }
        const payment = /^\/v1\/payment\/(\d+)$/.exec(path);
        if (payment && payments.has(payment[1]!)) return send(response, 200, payments.get(payment[1]!));
        return send(response, 404, { message: "Not found" });
      }

      // --- NOWPayments' payment page ---
      const page = /^\/checkout\/(\d+)$/.exec(path);
      if (page && invoices.has(page[1]!)) {
        const invoice = invoices.get(page[1]!)!;
        return send(
          response,
          200,
          `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NOWPayments (test)</title></head><body><h1>NOWPayments (test)</h1><p>${String(invoice.body.order_description)}: ${String(invoice.body.price_amount)} ${String(invoice.body.price_currency).toUpperCase()}</p><a href="${String(invoice.body.success_url)}">Back to the shop</a></body></html>`,
          "text/html; charset=utf-8",
        );
      }

      // --- The tests' remote control: pay an invoice, and call back like NOWPayments does ---
      if (path === "/control/pay" && request.method === "POST") {
        const { invoiceId, status = "finished" } = (await readJson(request)) as {
          invoiceId: string;
          status?: string;
        };
        const invoice = invoices.get(String(invoiceId));
        if (!invoice) return send(response, 404, { message: "No such invoice" });
        const price = Number(invoice.body.price_amount);
        const paymentId = String(5_600_000_000 + ++sequence);
        const now = new Date().toISOString();
        const payment = {
          payment_id: Number(paymentId),
          invoice_id: Number(invoice.id),
          payment_status: status,
          pay_address: "TXYZtestaddress",
          price_amount: price,
          price_currency: invoice.body.price_currency,
          pay_amount: price,
          actually_paid: status === "finished" ? price : price / 2,
          pay_currency: "usdttrc20",
          order_id: invoice.body.order_id,
          order_description: invoice.body.order_description,
          created_at: now,
          updated_at: now,
        };
        payments.set(paymentId, payment);
        const signature = createHmac("sha512", ipnSecret)
          .update(JSON.stringify(sortDeep(payment)))
          .digest("hex");
        // The app listens on 127.0.0.1; "localhost" may resolve to ::1 here.
        const callback = String(invoice.body.ipn_callback_url).replace("//localhost:", "//127.0.0.1:");
        const answer = await fetch(callback, {
          method: "POST",
          headers: { "content-type": "application/json", "x-nowpayments-sig": signature },
          body: JSON.stringify(payment),
        });
        return send(response, 200, { paymentId, ipn: { status: answer.status, body: await answer.json() } });
      }

      // --- GitHub's API ---
      if (path === "/github/users/leffloard/repos") {
        const repo = (name: string, extra: Record<string, unknown>) => ({
          name,
          html_url: `https://github.com/leffloard/${name}`,
          description: null,
          language: "TypeScript",
          stargazers_count: 0,
          forks_count: 0,
          topics: [],
          pushed_at: "2026-09-20T10:00:00Z",
          archived: false,
          fork: false,
          private: false,
          ...extra,
        });
        return send(response, 200, [
          repo("MiniEngine", {
            language: "C++",
            stargazers_count: 12,
            description: "A small OpenGL renderer.",
          }),
          repo("tiny-queue", { stargazers_count: 4, description: "A job queue in 200 lines." }),
          repo("private-notes", { private: true }),
        ]);
      }

      // --- TCMB ---
      if (path === "/kurlar/today.xml") {
        // The latest bulletin: the last weekday before today (TCMB's rates for today's transactions).
        let day = addDays(todayIn("Europe/Istanbul", new Date()), -1);
        while (weekdayIndex(day) >= 5) day = addDays(day, -1);
        return send(response, 200, bulletin(day, rates), "application/xml");
      }
      const archive = /^\/kurlar\/(\d{4})(\d{2})\/(\d{2})\d{2}\d{4}\.xml$/.exec(path);
      if (archive) {
        const day = `${archive[1]}-${archive[2]}-${archive[3]}`;
        if (weekdayIndex(day) >= 5) return send(response, 404, "<html>Not found</html>", "text/html");
        return send(response, 200, bulletin(day, rates), "application/xml");
      }
      return send(response, 404, { message: "Not found" });
    })().catch((error: unknown) => send(response, 500, { message: String(error) }));
  });

  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
