import { clientIp } from "@/lib/ip";
import { handleNowPaymentsIpn } from "@/server/billing/ipn";
import { nowPaymentsConfig } from "@/server/billing/nowpayments";
import { limited, notifyContext } from "@/server/calendar/public";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { jsonResponse, readBodyText } from "@/server/http";
import { log } from "@/server/log";
import { sendQueuedSoon } from "@/server/notify/kick";

// NOWPayments' payment callbacks (IPN). Server to server, so no origin check: the signature, and then the
// status read back from NOWPayments' API, are what count (see server/billing/ipn.ts).
//   200 handled, a repeat, or not ours   401 bad signature   400 unreadable   500 try again later

export const dynamic = "force-dynamic";

const MAX_BYTES = 64 * 1024;
const IPN_LIMIT = { limit: 120, windowMs: 60_000 };

export async function POST(request: Request): Promise<Response> {
  const config = nowPaymentsConfig();
  if (!config) return jsonResponse({ error: "Not found." }, 404);
  try {
    const db = await getDb();
    const tooMany = await limited(db, "ipn", clientIp(request.headers, getEnv().CLIENT_IP_SOURCE), IPN_LIMIT);
    if (tooMany) return tooMany;
    const raw = await readBodyText(request, MAX_BYTES);
    if (raw === null) return jsonResponse({ error: "Too large." }, 413);
    const result = await handleNowPaymentsIpn(
      db,
      raw,
      request.headers.get("x-nowpayments-sig"),
      config,
      notifyContext(),
    );
    if (result.outcome === "confirmed" || result.outcome === "review") sendQueuedSoon();
    return jsonResponse({ ok: result.status === 200, outcome: result.outcome }, result.status);
  } catch (error) {
    log.error({ err: error }, "POST /api/payments/nowpayments failed");
    return jsonResponse({ error: "Try again later." }, 500);
  }
}
