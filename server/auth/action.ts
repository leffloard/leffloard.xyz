import "server-only";
import type { Db } from "mongodb";
import { unstable_rethrow } from "next/navigation";
import type { z } from "zod";
import { fail, type ActionResult } from "@/lib/action-result";
import { currentAdmin, type AdminContext } from "@/server/auth/dal";
import type { Client, SignedIn } from "@/server/auth/login";
import { currentClient } from "@/server/auth/request";
import { hasSudo } from "@/server/auth/sessions";
import { getDb } from "@/server/db/client";
import { log } from "@/server/log";
import { hasUnsafeKeys } from "@/server/security/nosql";

// The one way to write an admin server action. Server actions are public POST endpoints, so each call is
// checked here again: Access, session, "confirm it's you" for sensitive changes, and strict input parsing.

export type ActionContext = AdminContext & { db: Db; client: Client; signedIn: SignedIn };

type Options = { sudo?: boolean };

export function adminAction<Schema extends z.ZodType, T>(
  schema: Schema,
  handler: (input: z.infer<Schema>, context: ActionContext) => Promise<ActionResult<T>>,
  options: Options = {},
): (input: unknown) => Promise<ActionResult<T>> {
  return async (input: unknown) => {
    const admin = await currentAdmin();
    if (!admin) return fail("Your session has ended. Sign in again.", "unauthorized");
    if (options.sudo && !hasSudo(admin.session))
      return fail("Confirm it's you to continue.", "sudo_required");
    if (hasUnsafeKeys(input)) return fail("The request was not understood.", "invalid");

    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      const fieldErrors: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join(".") || "form";
        fieldErrors[field] ??= issue.message;
      }
      return { ok: false, error: "Check the highlighted fields.", code: "invalid", fieldErrors };
    }

    try {
      const context: ActionContext = {
        ...admin,
        db: await getDb(),
        client: await currentClient(),
        signedIn: { user: admin.user, sessionId: admin.session._id },
      };
      return await handler(parsed.data, context);
    } catch (error) {
      unstable_rethrow(error); // redirect(), notFound() and friends are not failures
      log.error({ err: error }, "admin action failed");
      return fail("Something went wrong. Nothing was changed.");
    }
  };
}

// FormData to a plain object of strings (files are ignored; the last value wins).
export function formFields(formData: FormData): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (typeof value === "string") fields[key] = value;
  }
  return fields;
}
