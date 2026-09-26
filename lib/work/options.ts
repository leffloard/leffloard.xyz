// The fixed choices of the work modules: clients, projects, tasks, revisions and the client log.

export const CLIENT_STATUSES = ["lead", "active", "past", "archived"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export const CLIENT_STATUS_LABELS: Record<ClientStatus, string> = {
  lead: "Lead",
  active: "Active",
  past: "Past",
  archived: "Archived",
};

export const PROJECT_STAGES = ["planned", "active", "review", "delivered", "paused", "cancelled"] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const PROJECT_STAGE_LABELS: Record<ProjectStage, string> = {
  planned: "Planned",
  active: "In progress",
  review: "In review",
  delivered: "Delivered",
  paused: "Paused",
  cancelled: "Cancelled",
};

// The board's columns. Paused and cancelled projects are in the list view.
export const BOARD_STAGES = ["planned", "active", "review", "delivered"] as const satisfies ProjectStage[];

// Stages with work still to do.
export const OPEN_STAGES: ProjectStage[] = ["planned", "active", "review", "paused"];

export const PRICING_MODELS = ["fixed", "hourly"] as const;
export type PricingModel = (typeof PRICING_MODELS)[number];

export const PRICING_LABELS: Record<PricingModel, string> = {
  fixed: "Fixed price",
  hourly: "Hourly",
};

export const TASK_STATUSES = ["todo", "doing", "done"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  doing: "Doing",
  done: "Done",
};

export const TASK_VIEWS = ["today", "overdue", "upcoming", "anytime", "someday", "done"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_VIEW_LABELS: Record<TaskView, string> = {
  today: "Today",
  overdue: "Overdue",
  upcoming: "Upcoming",
  anytime: "Anytime",
  someday: "Someday",
  done: "Done",
};

// The "When" choices of the quick-add row.
export const TASK_WHEN = ["none", "today", "tomorrow", "next-week", "someday", "date"] as const;
export type TaskWhen = (typeof TASK_WHEN)[number];

export const TASK_WHEN_LABELS: Record<TaskWhen, string> = {
  none: "No date",
  today: "Today",
  tomorrow: "Tomorrow",
  "next-week": "Next Monday",
  someday: "Someday",
  date: "On a date…",
};

export const RECURRENCES = ["daily", "weekdays", "weekly", "biweekly", "monthly"] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const RECURRENCE_LABELS: Record<Recurrence, string> = {
  daily: "Every day",
  weekdays: "Every weekday",
  weekly: "Every week",
  biweekly: "Every two weeks",
  monthly: "Every month",
};

export const REVISION_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
export type RevisionStatus = (typeof REVISION_STATUSES)[number];

export const REVISION_STATUS_LABELS: Record<RevisionStatus, string> = {
  open: "Requested",
  in_progress: "In progress",
  done: "Done",
  cancelled: "Cancelled",
};

export const ACTIVITY_KINDS = ["note", "call", "email", "meeting"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const ACTIVITY_LABELS: Record<ActivityKind, string> = {
  note: "Note",
  call: "Call",
  email: "Email",
  meeting: "Meeting",
};

// Kinds that count as talking to the client (they move "last contact").
export const CONTACT_KINDS: ActivityKind[] = ["call", "email", "meeting"];

export const MAX_INCLUDED_REVISIONS = 20;

export function isOneOf<T extends string>(options: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}
