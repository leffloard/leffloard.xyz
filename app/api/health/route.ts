import { getDb } from "@/server/db/client";
import { pendingMigrations } from "@/server/db/migrate";
import { readEnv } from "@/server/env";
import { deepHealth, tokenMatches } from "@/server/health";
import packageJson from "@/package.json";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (url.searchParams.get("deep") !== "1") {
    return Response.json({ ok: true }, { headers: NO_STORE });
  }

  // The deep check reveals configuration state, so only the deploy script (which knows the token) gets it.
  if (!tokenMatches(request.headers.get("x-health-token"), process.env.HEALTH_TOKEN?.trim())) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403, headers: NO_STORE });
  }

  const report = await deepHealth({
    envReport: () => readEnv(),
    pingDb: async () => {
      await (await getDb()).command({ ping: 1 });
    },
    pendingMigrationCount: async () => (await pendingMigrations(await getDb())).length,
    version: process.env.GIT_SHA ? `${packageJson.version}+${process.env.GIT_SHA}` : packageJson.version,
  });
  return Response.json(report, { status: report.ok ? 200 : 503, headers: NO_STORE });
}
