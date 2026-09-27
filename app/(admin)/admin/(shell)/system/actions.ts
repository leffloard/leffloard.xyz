"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { ok } from "@/lib/action-result";
import { plural } from "@/lib/format";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import { clearErrors } from "@/server/system/errors";
import { clearCspReports } from "@/server/system/status";

// Clearing the logs needs "confirm it's you": they can show what an attacker tried.

export const clearErrorLogAction = adminAction(
  z.object({}).strict(),
  async (_input, { db, user, client }) => {
    const removed = await clearErrors(db);
    await audit(db, {
      action: "system.errors.cleared",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { removed },
    });
    refresh();
    return ok(null, `${plural(removed, "error")} cleared.`);
  },
  { sudo: true },
);

export const clearCspReportsAction = adminAction(
  z.object({}).strict(),
  async (_input, { db, user, client }) => {
    const removed = await clearCspReports(db);
    await audit(db, {
      action: "system.csp.cleared",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { removed },
    });
    refresh();
    return ok(null, `${plural(removed, "report")} cleared.`);
  },
  { sudo: true },
);
