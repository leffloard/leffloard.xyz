// Local stand-ins for the outside services the end-to-end tests touch:
//   NOWPayments  /v1/invoice, /v1/payment/:id (API), /checkout/:id (its payment page), and
//                POST /control/pay {invoiceId, status} which "pays" and sends the signed callback (IPN);
//                POST /control/anthropic {fail} makes Claude's API refuse every request, or stop refusing;
//   TCMB         /kurlar/today.xml and /kurlar/YYYYMM/DDMMYYYY.xml, with fixed rates on weekdays;
//   GitHub       /github/users/leffloard/repos, two public repositories and a private one;
//   Anthropic    /anthropic/v1/messages (streamed answers per feature, found from the prompt's task) and
//                /anthropic/v1/models/:id.
import { createHash, createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { addDays, todayIn } from "@/lib/intake/time";
import { weekdayIndex } from "@/lib/work/dates";

type Options = {
  port: number;
  apiKey: string;
  ipnSecret: string;
  rates: Record<string, string>;
  anthropicKey: string;
};

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

// A Messages API answer as server-sent events: a thinking block, then the text in a few pieces.
async function streamAnswer(response: ServerResponse, model: string, text: string, cached: boolean) {
  response.writeHead(200, { "content-type": "text/event-stream", "request-id": "req_e2e" });
  const write = (event: Record<string, unknown>) =>
    response.write(`event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`);
  write({
    type: "message_start",
    message: {
      id: "msg_e2e",
      type: "message",
      role: "assistant",
      model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: {
        input_tokens: 800,
        output_tokens: 1,
        cache_creation_input_tokens: cached ? 0 : 1500,
        cache_read_input_tokens: cached ? 1500 : 0,
      },
    },
  });
  write({
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "", signature: "" },
  });
  write({ type: "content_block_stop", index: 0 });
  write({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  const size = Math.ceil(text.length / 4);
  for (let at = 0; at < text.length; at += size) {
    write({
      type: "content_block_delta",
      index: 1,
      delta: { type: "text_delta", text: text.slice(at, at + size) },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  write({ type: "content_block_stop", index: 1 });
  write({
    type: "message_delta",
    delta: { stop_reason: "end_turn", stop_sequence: null, stop_details: null },
    usage: { output_tokens: 250 },
  });
  write({ type: "message_stop" });
  response.end();
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

// Claude's answers, by the task the system prompt ends with (server/ai/prompts.ts).
const CLAUDE_ANSWERS: [RegExp, string][] = [
  [
    /^Task: triage/,
    JSON.stringify({
      category: "project",
      priority: "high",
      priorityReason: "A clear request with a deadline.",
      spamLikelihood: 3,
      fit: "strong",
      service: "discord-bots",
      summary: "Wants a moderation bot for a large Discord server.",
      labels: ["discord bot"],
      questions: ["How many members does the server have?"],
      flags: [],
    }),
  ],
  [
    /^Task: turn a client's request into a draft quote/,
    JSON.stringify({
      title: "Moderation bot",
      lines: [
        { item: "discord-bots/pro", description: "Moderation bot with tickets and logging", quantity: 1 },
        { item: null, description: "Hosting setup", quantity: 1 },
      ],
      timeline: "1 to 2 weeks",
      revisions: 2,
      assumptions: ["One Discord server"],
      questions: ["Which moderation rules do you need?"],
    }),
  ],
  [
    /^Task: draft \w+'s email reply/,
    "Hi Alan,\n\nThanks for your message. A moderation bot like this fits the Pro package, from $480.\n\nMert",
  ],
  [/^Task: prepare/, "Who\nA returning guest.\n\nQuestions to ask\n- What is the budget?"],
  [
    /^Task: write \w+'s weekly review/,
    "The week\nOne new message arrived.\n\nNeeds attention\nNothing overdue.\n\nNext week\n- Answer new messages within a day.",
  ],
  [/^Task: rewrite/, "A tighter version of the text."],
  [/^Task: draft a case study/, "A short opening paragraph.\n\n## Context\n\nFrom the facts sheet."],
];

export function startMocks({ port, apiKey, ipnSecret, rates, anthropicKey }: Options): Promise<Server> {
  const cachedPrompts = new Set<string>();
  const invoices = new Map<string, Invoice>();
  const payments = new Map<string, Record<string, unknown>>();
  let sequence = 0;
  // Set by POST /control/anthropic: Claude's API refuses every request until it is set back.
  let anthropicFails = false;

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

      if (path === "/control/anthropic" && request.method === "POST") {
        const { fail } = (await readJson(request)) as { fail?: boolean };
        anthropicFails = fail === true;
        return send(response, 200, { fail: anthropicFails });
      }

      // --- Anthropic's API ---
      if (path.startsWith("/anthropic/v1/")) {
        if (request.headers["x-api-key"] !== anthropicKey) {
          return send(response, 401, {
            type: "error",
            error: { type: "authentication_error", message: "invalid x-api-key" },
          });
        }
        const model = /^\/anthropic\/v1\/models\/([\w.-]+)$/.exec(path);
        if (model && request.method === "GET") {
          return send(response, 200, {
            type: "model",
            id: model[1],
            display_name: "Claude Opus 5",
            created_at: "2026-01-01T00:00:00Z",
          });
        }
        if (path === "/anthropic/v1/messages" && request.method === "POST") {
          if (anthropicFails) {
            return send(response, 400, {
              type: "error",
              error: { type: "invalid_request_error", message: "The test mock refuses this request." },
            });
          }
          const body = await readJson(request);
          const system = (body.system as { text: string }[] | undefined) ?? [];
          const task = system.at(-1)?.text ?? "";
          const text = CLAUDE_ANSWERS.find(([pattern]) => pattern.test(task))?.[1] ?? "OK.";
          // The shared part of the prompt is cached after its first use, as the API does.
          const key = createHash("sha256")
            .update(system[0]?.text ?? "")
            .digest("hex");
          const cached = cachedPrompts.has(key);
          cachedPrompts.add(key);
          await streamAnswer(response, String(body.model), text, cached);
          return;
        }
        return send(response, 404, {
          type: "error",
          error: { type: "not_found_error", message: "Not found" },
        });
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
