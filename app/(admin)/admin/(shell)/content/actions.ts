"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok, type ActionResult } from "@/lib/action-result";
import type { LeakFinding } from "@/lib/content/leaks";
import {
  CONTENT_KINDS,
  CONTENT_SCHEMAS,
  isListKind,
  LIST_KINDS,
  type ContentData,
} from "@/lib/content/schemas";
import { ADMIN_TIME_ZONE } from "@/lib/format";
import { idSchema, notesText, versionSchema } from "@/lib/forms";
import { zonedInstant } from "@/lib/intake/time";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import { now } from "@/server/clock";
import {
  createContent,
  deleteContent,
  moveContent,
  publishContent,
  restoreVersion,
  saveContentSettings,
  saveDraft,
  scheduleContent,
  unpublishContent,
  type PublishResult,
  type SaveResult,
} from "@/server/content/editor";
import { setRepoShown, syncGithub } from "@/server/content/github";
import { deleteMedia, setMediaAlt } from "@/server/content/media";
import { getEnv } from "@/server/env";

// The content editor. Every change goes through adminAction(); drafts are checked by the same schemas as
// the editor's form, and publishing runs the leak check (server/content/editor.ts).

const kindSchema = z.enum(CONTENT_KINDS);

// The schema's problems as the form's field errors ("packages.0.name").
function checkData<K extends (typeof CONTENT_KINDS)[number]>(
  kind: K,
  data: unknown,
): { ok: true; data: ContentData[K] } | { ok: false; result: ActionResult<never> } {
  const parsed = CONTENT_SCHEMAS[kind].safeParse(data);
  if (parsed.success) return { ok: true, data: parsed.data as ContentData[K] };
  const fieldErrors: Record<string, string> = {};
  for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".") || "form"] ??= issue.message;
  return {
    ok: false,
    result: { ok: false, error: "Check the highlighted fields.", code: "invalid", fieldErrors },
  };
}

function saveProblem(result: Exclude<SaveResult, { ok: true }>): ActionResult<never> {
  if (result.reason === "field") {
    return {
      ok: false,
      error: "Check the highlighted fields.",
      code: "invalid",
      fieldErrors: { [result.field]: result.message },
    };
  }
  return fail(
    result.reason === "missing"
      ? "This item no longer exists."
      : "It was changed in another tab meanwhile. Reload the page to see the newer version.",
  );
}

export type PublishOutcome = { published: boolean; findings: LeakFinding[] };

// A refusal by the leak check comes back as data, so the editor can list what it found.
function publishOutcome(result: PublishResult, done: string): ActionResult<PublishOutcome> {
  if (result.ok) return ok({ published: true, findings: [] }, done);
  switch (result.reason) {
    case "leaks":
      return ok({ published: false, findings: result.findings });
    case "consent":
      return fail("Record the person's permission first: tick the box and say how they agreed.");
    case "slug":
      return fail("Another published item already uses this address. Change the address name.");
    case "missing":
      return fail("This item no longer exists.");
    case "conflict":
      return fail("It was changed in another tab meanwhile. Reload the page first.");
  }
}

export const createContentAction = adminAction(
  z.object({ kind: z.enum(LIST_KINDS), data: z.unknown() }),
  async (input, { db }) => {
    const checked = checkData(input.kind, input.data);
    if (!checked.ok) return checked.result;
    const result = await createContent(db, input.kind, checked.data as never, now());
    if (!result.ok) return saveProblem(result);
    redirect(`/admin/content/${input.kind}/${result.doc._id.toHexString()}?created=1`);
  },
);

export const saveContentAction = adminAction(
  z.object({ kind: kindSchema, id: idSchema, version: versionSchema, data: z.unknown() }),
  async (input, { db }) => {
    const checked = checkData(input.kind, input.data);
    if (!checked.ok) return checked.result;
    const result = await saveDraft(
      db,
      new ObjectId(input.id),
      input.kind,
      input.version,
      checked.data,
      now(),
    );
    if (!result.ok) return saveProblem(result);
    refresh();
    return ok({ version: result.doc.version }, "Draft saved.");
  },
);

export const publishContentAction = adminAction(
  z.object({ id: idSchema, version: versionSchema }),
  async (input, { db, user, client }) => {
    const result = await publishContent(db, new ObjectId(input.id), input.version, now());
    if (result.ok) {
      await audit(db, {
        action: "content.published",
        actorId: user._id,
        ip: client.ip,
        userAgent: client.userAgent,
        details: { id: input.id, kind: result.doc.kind, key: result.doc.key },
      });
      refresh();
    }
    return publishOutcome(result, "Published. It is on the site now.");
  },
);

export const unpublishContentAction = adminAction(z.object({ id: idSchema }), async (input, { db }) => {
  if (!(await unpublishContent(db, new ObjectId(input.id), now())))
    return fail("This can't be taken off the site.");
  refresh();
  return ok(null, "Taken off the site. The draft stays here.");
});

export const scheduleContentAction = adminAction(
  z.object({
    id: idSchema,
    version: versionSchema,
    // A wall-clock time in Istanbul ("2026-10-01T09:00"), or "" to cancel.
    at: z.string().regex(/^(?:\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?$/, "Pick a day and a time."),
  }),
  async (input, { db }) => {
    let publishAt: Date | null = null;
    if (input.at) {
      publishAt = zonedInstant(input.at.slice(0, 10), input.at.slice(11, 16), ADMIN_TIME_ZONE);
      if (!publishAt || publishAt.getTime() <= now().getTime() + 60_000) {
        return {
          ok: false,
          error: "Check the highlighted fields.",
          code: "invalid",
          fieldErrors: { at: "Pick a moment at least a minute from now." },
        };
      }
    }
    const result = await scheduleContent(db, new ObjectId(input.id), input.version, publishAt);
    if (result.ok) refresh();
    return publishOutcome(result, publishAt ? "Scheduled." : "The schedule is cancelled.");
  },
);

export const restoreVersionAction = adminAction(
  z.object({ id: idSchema, versionId: idSchema, version: versionSchema }),
  async (input, { db }) => {
    const result = await restoreVersion(
      db,
      new ObjectId(input.id),
      new ObjectId(input.versionId),
      input.version,
      now(),
    );
    if (!result.ok) return saveProblem(result);
    refresh();
    return ok(
      { version: result.doc.version },
      "Brought back into the draft. Publish it to put it on the site.",
    );
  },
);

export const moveContentAction = adminAction(
  z.object({ id: idSchema, direction: z.enum(["up", "down"]) }),
  async (input, { db }) => {
    if (!(await moveContent(db, new ObjectId(input.id), input.direction)))
      return fail("This item no longer exists.");
    refresh();
    return ok(null);
  },
);

export const deleteContentAction = adminAction(
  z.object({ id: idSchema, kind: z.enum(LIST_KINDS) }),
  async (input, { db, user, client }) => {
    if (!isListKind(input.kind) || !(await deleteContent(db, new ObjectId(input.id)))) {
      return fail("This item no longer exists.");
    }
    await audit(db, {
      action: "content.deleted",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { id: input.id, kind: input.kind },
    });
    redirect(`/admin/content/${input.kind}`);
  },
  { sudo: true },
);

export const saveContentSettingsAction = adminAction(
  z.object({ bannedWords: notesText(4000), version: z.number().int().min(0) }),
  async (input, { db }) => {
    const words = [
      ...new Set(
        input.bannedWords
          .split("\n")
          .map((word) => word.trim())
          .filter(Boolean),
      ),
    ].slice(0, 200);
    if (!(await saveContentSettings(db, words, input.version, now()))) {
      return fail("They were changed in another tab meanwhile. Reload the page first.");
    }
    refresh();
    return ok(null, "Saved. Publishing now checks for these words.");
  },
);

// --- The media library ---------------------------------------------------------------------------------------

const mediaIdSchema = z.string().regex(/^[a-f0-9]{64}$/, "Unknown image.");

export const setMediaAltAction = adminAction(
  z.object({ id: mediaIdSchema, alt: notesText(300) }),
  async (input, { db }) => {
    if (!(await setMediaAlt(db, input.id, input.alt))) return fail("This image no longer exists.");
    refresh();
    return ok(null, "Description saved.");
  },
);

export const deleteMediaAction = adminAction(z.object({ id: mediaIdSchema }), async (input, { db }) => {
  const result = await deleteMedia(db, input.id);
  if (result === "in-use") {
    return fail("A draft, a published page or a kept version still shows this image. Remove it there first.");
  }
  refresh();
  return ok(null, result === "deleted" ? "Deleted." : "It was already gone.");
});

// --- GitHub ---------------------------------------------------------------------------------------------------

export const syncGithubAction = adminAction(z.object({}), async (_input, { db }) => {
  const env = getEnv();
  const result = await syncGithub(db, { apiUrl: env.GITHUB_API_URL, token: env.GITHUB_TOKEN }, now());
  refresh();
  return result.ok ? ok(null, `Synced: ${result.message}`) : fail(result.message);
});

export const setRepoShownAction = adminAction(
  z.object({ id: z.string().regex(/^[\w.-]{1,100}$/, "Unknown repository."), show: z.boolean() }),
  async (input, { db }) => {
    const result = await setRepoShown(db, input.id.toLowerCase(), input.show);
    if (!result.ok && result.reason === "missing") return fail("This repository is gone.");
    if (!result.ok) {
      return fail(
        `Not shown: the leak check found ${result.findings.map((finding) => finding.label.toLowerCase()).join(", ")} in its name or description.`,
      );
    }
    refresh();
    return ok(null, input.show ? "Shown on the work page." : "Hidden from the work page.");
  },
);
