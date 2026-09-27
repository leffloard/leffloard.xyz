import "server-only";
import { after } from "next/server";
import type { Goal } from "@/lib/analytics/model";
import { recordGoal } from "@/server/analytics/record";
import { getDb } from "@/server/db/client";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";

// Counts a goal once the visitor has their answer. Only callable while handling a request.
export function goalSoon(headers: Headers, goal: Goal): void {
  const copy = new Headers(headers);
  after(async () => {
    try {
      const env = getEnv();
      await recordGoal(await getDb(), copy, goal, {
        siteUrl: env.SITE_URL,
        ipSource: env.CLIENT_IP_SOURCE,
      });
    } catch (error) {
      log.warn({ err: error, goal }, "counting a goal failed");
    }
  });
}
