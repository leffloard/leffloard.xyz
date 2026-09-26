"use server";

import { ObjectId } from "mongodb";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { fail, ok } from "@/lib/action-result";
import {
  amountSchema,
  dateSchema,
  durationSchema,
  fieldError,
  idSchema,
  notesText,
  optionalIdSchema,
  requiredText,
  tagsSchema,
  urlSchema,
  versionSchema,
} from "@/lib/forms";
import { SERVICE_OPTIONS } from "@/lib/intake/options";
import { CURRENCIES, money, type Currency } from "@/lib/money";
import {
  MAX_INCLUDED_REVISIONS,
  PRICING_MODELS,
  PROJECT_STAGES,
  REVISION_STATUS_LABELS,
  REVISION_STATUSES,
} from "@/lib/work/options";
import { adminAction } from "@/server/auth/action";
import { audit } from "@/server/auth/audit";
import { notifyContext } from "@/server/calendar/public";
import { getInquiry } from "@/server/inquiries/store";
import { sendQueuedSoon } from "@/server/notify/kick";
import { postProjectUpdate } from "@/server/portal/service";
import { deleteProjectUpdate } from "@/server/portal/updates";
import {
  addRevision,
  attachTask,
  CancelledRevisionError,
  setRevisionBillable,
  setRevisionPolicy,
  setRevisionStatus,
} from "@/server/projects/revisions";
import {
  addLink,
  addMilestone,
  createProject,
  deleteProject,
  getProject,
  MAX_LINKS,
  MAX_MILESTONES,
  moveProject,
  removeLink,
  removeMilestone,
  setLinkShared,
  setMilestoneDone,
  updateProject,
  type ProjectInput,
} from "@/server/projects/store";
import { createTask } from "@/server/tasks/store";

const NOT_FOUND = "This project no longer exists.";
const CONFLICT = "This project was changed somewhere else since you opened the form. Reload to see it.";

const SERVICES = SERVICE_OPTIONS.map((option) => option.value) as [string, ...string[]];
const MAX_ESTIMATE_SECONDS = 10_000 * 3600;

const roundsSchema = z
  .string()
  .max(3)
  .regex(/^\d{1,2}$/, "Use a whole number.")
  .transform(Number)
  .refine((value) => value <= MAX_INCLUDED_REVISIONS, `At most ${MAX_INCLUDED_REVISIONS} rounds.`);

const projectFields = z
  .object({
    clientId: idSchema,
    title: requiredText(160, "Give the project a title."),
    service: z.enum([...SERVICES, ""]).transform((value) => value || null),
    summary: notesText(10_000),
    startDate: dateSchema,
    dueDate: dateSchema,
    estimate: durationSchema(MAX_ESTIMATE_SECONDS),
    currency: z.enum(CURRENCIES),
    pricing: z.enum(PRICING_MODELS),
    budget: amountSchema,
    hourlyRate: amountSchema,
    includedRevisions: roundsSchema,
    extraRevisionPrice: amountSchema,
    tags: tagsSchema,
  })
  .superRefine((input, context) => {
    if (input.startDate && input.dueDate && input.dueDate < input.startDate) {
      context.addIssue({ code: "custom", path: ["dueDate"], message: "The due date is before the start." });
    }
    if (input.pricing === "hourly" && input.hourlyRate === null) {
      context.addIssue({ code: "custom", path: ["hourlyRate"], message: "Add the hourly rate." });
    }
  });

type ProjectFields = z.infer<typeof projectFields>;

function toInput(fields: ProjectFields): ProjectInput {
  const amount = (minor: number | null, currency: Currency) =>
    minor === null ? null : money(minor, currency);
  return {
    clientId: new ObjectId(fields.clientId),
    title: fields.title,
    service: fields.service,
    summary: fields.summary,
    startDate: fields.startDate,
    dueDate: fields.dueDate,
    estimateSeconds: fields.estimate,
    currency: fields.currency,
    pricing: fields.pricing,
    budget: amount(fields.budget, fields.currency),
    hourlyRate: amount(fields.hourlyRate, fields.currency),
    revisionPolicy: {
      included: fields.includedRevisions,
      extraPrice: amount(fields.extraRevisionPrice, fields.currency),
    },
    tags: fields.tags,
  };
}

export const createProjectAction = adminAction(
  projectFields.and(z.object({ inquiryId: optionalIdSchema })),
  async (input, { db }) => {
    const inquiryId = input.inquiryId ? new ObjectId(input.inquiryId) : null;
    if (inquiryId && !(await getInquiry(db, inquiryId))) return fail("That inbox message no longer exists.");
    const project = await createProject(db, toInput(input), { inquiryId });
    if (!project) return fieldError("clientId", "That client no longer exists.");
    redirect(`/admin/projects/${project._id.toHexString()}`);
  },
);

export const updateProjectAction = adminAction(
  projectFields.and(z.object({ id: idSchema, version: versionSchema })),
  async (input, { db }) => {
    const result = await updateProject(db, new ObjectId(input.id), input.version, toInput(input));
    if (!result.ok) return fail(result.reason === "conflict" ? CONFLICT : NOT_FOUND);
    redirect(`/admin/projects/${input.id}`);
  },
);

// From the board (a place in a column) or the stage menu (the top of the new column).
export const moveProjectAction = adminAction(
  z.object({
    id: idSchema,
    stage: z.enum(PROJECT_STAGES),
    after: z.union([idSchema, z.literal("top"), z.literal("end")]).default("top"),
  }),
  async (input, { db }) => {
    const after = input.after === "top" ? null : input.after === "end" ? "end" : new ObjectId(input.after);
    const project = await moveProject(db, new ObjectId(input.id), input.stage, after);
    if (!project) return fail(NOT_FOUND);
    refresh();
    return ok(null);
  },
);

export const deleteProjectAction = adminAction(
  z.object({ id: idSchema, confirm: z.string().max(100) }),
  async (input, { db, user, client }) => {
    const id = new ObjectId(input.id);
    const project = await getProject(db, id);
    if (!project) return fail(NOT_FOUND);
    if (input.confirm.trim().toUpperCase() !== project.ref) {
      return fieldError("confirm", `Type ${project.ref} to confirm.`);
    }
    const deleted = await deleteProject(db, id);
    if (!deleted) return fail(NOT_FOUND);
    await audit(db, {
      action: "projects.project.deleted",
      actorId: user._id,
      ip: client.ip,
      userAgent: client.userAgent,
      details: { ref: project.ref, ...deleted },
    });
    redirect("/admin/projects");
  },
  { sudo: true },
);

// --- Milestones and links ---------------------------------------------------------------------------------

export const addMilestoneAction = adminAction(
  z.object({ projectId: idSchema, title: requiredText(160, "Name the milestone."), dueDate: dateSchema }),
  async (input, { db }) => {
    const result = await addMilestone(db, new ObjectId(input.projectId), {
      title: input.title,
      dueDate: input.dueDate,
    });
    if (result === "full") return fail(`A project can have up to ${MAX_MILESTONES} milestones.`);
    if (!result) return fail(NOT_FOUND);
    refresh();
    return ok(null, "Milestone added.");
  },
);

export const setMilestoneDoneAction = adminAction(
  z.object({ projectId: idSchema, milestoneId: z.uuid(), done: z.boolean() }),
  async (input, { db }) => {
    const result = await setMilestoneDone(db, new ObjectId(input.projectId), input.milestoneId, input.done);
    if (!result) return fail("That milestone no longer exists.");
    refresh();
    return ok(null);
  },
);

export const removeMilestoneAction = adminAction(
  z.object({ projectId: idSchema, milestoneId: z.uuid() }),
  async (input, { db }) => {
    if (!(await removeMilestone(db, new ObjectId(input.projectId), input.milestoneId)))
      return fail("That milestone no longer exists.");
    refresh();
    return ok(null, "Milestone removed.");
  },
);

export const addLinkAction = adminAction(
  z.object({
    projectId: idSchema,
    label: requiredText(60, "Name the link, for example Staging."),
    url: urlSchema.refine((value) => value !== null, "Add the address."),
  }),
  async (input, { db }) => {
    const result = await addLink(db, new ObjectId(input.projectId), { label: input.label, url: input.url! });
    if (result === "full") return fail(`A project can have up to ${MAX_LINKS} links.`);
    if (!result) return fail(NOT_FOUND);
    refresh();
    return ok(null, "Link added.");
  },
);

export const removeLinkAction = adminAction(
  z.object({ projectId: idSchema, linkId: z.uuid() }),
  async (input, { db }) => {
    if (!(await removeLink(db, new ObjectId(input.projectId), input.linkId)))
      return fail("That link no longer exists.");
    refresh();
    return ok(null, "Link removed.");
  },
);

// Shows a link in the client's portal, among the project's deliverables, or hides it.
export const setLinkSharedAction = adminAction(
  z.object({ projectId: idSchema, linkId: z.uuid(), shared: z.boolean() }),
  async (input, { db }) => {
    if (!(await setLinkShared(db, new ObjectId(input.projectId), input.linkId, input.shared)))
      return fail("That link no longer exists.");
    refresh();
    return ok(null, input.shared ? "Shared in the client's portal." : "No longer shared.");
  },
);

// --- Updates for the client -----------------------------------------------------------------------------------

export const postProjectUpdateAction = adminAction(
  z.object({
    projectId: idSchema,
    body: requiredText(4000, "Write the update.", true),
    email: z.boolean(),
  }),
  async (input, { db }) => {
    const project = await getProject(db, new ObjectId(input.projectId));
    if (!project) return fail(NOT_FOUND);
    const { emailed } = await postProjectUpdate(db, project, input.body, input.email, notifyContext());
    if (emailed) sendQueuedSoon();
    refresh();
    return ok(
      null,
      input.email && !emailed
        ? "Posted. It couldn't be emailed: email isn't set up, or the client has no address."
        : emailed
          ? "Posted, and emailed to the client."
          : "Posted in the client's portal.",
    );
  },
);

export const deleteProjectUpdateAction = adminAction(
  z.object({ projectId: idSchema, id: idSchema }),
  async (input, { db }) => {
    if (!(await deleteProjectUpdate(db, new ObjectId(input.projectId), new ObjectId(input.id))))
      return fail("That update no longer exists.");
    refresh();
    return ok(null, "Update removed.");
  },
);

// --- Revision rounds ------------------------------------------------------------------------------------------

export const addRevisionAction = adminAction(
  z.object({
    projectId: idSchema,
    title: requiredText(160, "Say what the round is about."),
    details: notesText(10_000),
    addTask: z.boolean().default(true),
    inquiryId: optionalIdSchema,
  }),
  async (input, { db }) => {
    const projectId = new ObjectId(input.projectId);
    const inquiry = input.inquiryId ? await getInquiry(db, new ObjectId(input.inquiryId)) : null;
    if (input.inquiryId && !inquiry) return fail("That inbox message no longer exists.");
    const revision = await addRevision(db, projectId, {
      title: input.title,
      details: input.details,
      inquiryId: inquiry?._id ?? null,
      requestedAt: inquiry?.receivedAt,
    });
    if (!revision) return fail(NOT_FOUND);
    if (input.addTask) {
      const task = await createTask(db, {
        title: `Round ${revision.number}: ${revision.title}`,
        notes: revision.details,
        projectId,
        revisionId: revision._id,
      });
      if (task) await attachTask(db, revision._id, task._id);
    }
    refresh();
    const extra = revision.billable ? " It is past the included rounds, so it is billable." : "";
    return ok(
      { id: revision._id.toHexString(), number: revision.number },
      `Round ${revision.number} added.${extra}`,
    );
  },
);

export const setRevisionStatusAction = adminAction(
  z.object({ id: idSchema, status: z.enum(REVISION_STATUSES) }),
  async (input, { db }) => {
    try {
      const revision = await setRevisionStatus(db, new ObjectId(input.id), input.status);
      if (!revision) return fail("That round no longer exists.");
    } catch (error) {
      if (error instanceof CancelledRevisionError) return fail(error.message);
      throw error;
    }
    refresh();
    return ok(
      null,
      input.status === "cancelled"
        ? "Round cancelled. It no longer counts against the included rounds."
        : `Marked as ${REVISION_STATUS_LABELS[input.status].toLowerCase()}.`,
    );
  },
);

export const setRevisionBillableAction = adminAction(
  z.object({ id: idSchema, billable: z.boolean() }),
  async (input, { db }) => {
    if (!(await setRevisionBillable(db, new ObjectId(input.id), input.billable)))
      return fail("That round no longer exists.");
    refresh();
    return ok(null, input.billable ? "Marked as an extra, billable round." : "Marked as included.");
  },
);

export const setRevisionPolicyAction = adminAction(
  z.object({ projectId: idSchema, includedRevisions: roundsSchema, extraRevisionPrice: amountSchema }),
  async (input, { db }) => {
    const id = new ObjectId(input.projectId);
    const project = await getProject(db, id);
    if (!project) return fail(NOT_FOUND);
    const updated = await setRevisionPolicy(db, id, {
      included: input.includedRevisions,
      extraPrice:
        input.extraRevisionPrice === null ? null : money(input.extraRevisionPrice, project.currency),
    });
    if (!updated) return fail(NOT_FOUND);
    refresh();
    return ok(null, "Revision terms saved. Rounds already added keep their price.");
  },
);
