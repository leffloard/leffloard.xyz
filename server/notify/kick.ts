import "server-only";
import { after } from "next/server";
import { getDb } from "@/server/db/client";
import { log } from "@/server/log";
import { drainOutbox } from "@/server/notify/outbox";

// Sends what was just queued once the response has gone out, instead of waiting for the next scheduler
// tick. Only callable while handling a request (route handler or server action).
export function sendQueuedSoon(): void {
  after(async () => {
    try {
      await drainOutbox(await getDb());
    } catch (error) {
      log.error({ err: error }, "sending queued notifications failed");
    }
  });
}
