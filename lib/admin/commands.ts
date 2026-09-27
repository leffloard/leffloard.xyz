// The command palette's fixed commands, and the keyboard shortcuts that reach them. Shared by the palette
// and its help sheet.

export type Command = {
  id: string;
  label: string;
  href: string;
  group: "Go to" | "Create";
  keywords?: string;
  shortcut?: string; // "g i": press g, then i
};

export const COMMANDS: Command[] = [
  {
    id: "go-today",
    group: "Go to",
    label: "Today",
    href: "/admin",
    shortcut: "g h",
    keywords: "home dashboard",
  },
  {
    id: "go-inbox",
    group: "Go to",
    label: "Inbox",
    href: "/admin/inbox",
    shortcut: "g i",
    keywords: "messages",
  },
  {
    id: "go-calendar",
    group: "Go to",
    label: "Calendar",
    href: "/admin/calendar",
    shortcut: "g c",
    keywords: "meetings calls",
  },
  {
    id: "go-availability",
    group: "Go to",
    label: "Availability",
    href: "/admin/calendar/availability",
    keywords: "hours calendar",
  },
  {
    id: "go-booking-types",
    group: "Go to",
    label: "Booking types",
    href: "/admin/calendar/types",
    keywords: "calendar",
  },
  { id: "go-tasks", group: "Go to", label: "Tasks", href: "/admin/tasks", shortcut: "g t", keywords: "todo" },
  { id: "go-projects", group: "Go to", label: "Projects", href: "/admin/projects", shortcut: "g p" },
  {
    id: "go-clients",
    group: "Go to",
    label: "Clients",
    href: "/admin/clients",
    shortcut: "g l",
    keywords: "crm customers",
  },
  {
    id: "go-billing",
    group: "Go to",
    label: "Billing",
    href: "/admin/billing",
    shortcut: "g b",
    keywords: "quotes invoices",
  },
  { id: "go-quotes", group: "Go to", label: "Quotes", href: "/admin/billing/quotes", keywords: "billing" },
  {
    id: "go-invoices",
    group: "Go to",
    label: "Invoices",
    href: "/admin/billing/invoices",
    keywords: "billing",
  },
  {
    id: "go-payments",
    group: "Go to",
    label: "Payments",
    href: "/admin/billing/payments",
    keywords: "billing review",
  },
  {
    id: "go-recurring",
    group: "Go to",
    label: "Recurring invoices",
    href: "/admin/billing/recurring",
    keywords: "care plans billing",
  },
  {
    id: "go-finance",
    group: "Go to",
    label: "Finance",
    href: "/admin/finance",
    shortcut: "g f",
    keywords: "income profit",
  },
  {
    id: "go-expenses",
    group: "Go to",
    label: "Expenses",
    href: "/admin/finance/expenses",
    keywords: "finance",
  },
  {
    id: "go-time",
    group: "Go to",
    label: "Time",
    href: "/admin/time",
    shortcut: "g w",
    keywords: "timesheet hours",
  },
  {
    id: "go-content",
    group: "Go to",
    label: "Content",
    href: "/admin/content",
    shortcut: "g o",
    keywords: "site cms blog work",
  },
  {
    id: "go-media",
    group: "Go to",
    label: "Media library",
    href: "/admin/content/media",
    keywords: "images uploads",
  },
  {
    id: "go-analytics",
    group: "Go to",
    label: "Analytics",
    href: "/admin/analytics",
    shortcut: "g a",
    keywords: "visitors traffic",
  },
  { id: "go-ai", group: "Go to", label: "AI assistant", href: "/admin/ai", keywords: "claude usage budget" },
  {
    id: "go-notifications",
    group: "Go to",
    label: "Notifications",
    href: "/admin/notifications",
    shortcut: "g n",
    keywords: "alerts quiet hours digest",
  },
  {
    id: "go-security",
    group: "Go to",
    label: "Security",
    href: "/admin/security",
    keywords: "sessions passkeys audit",
  },
  {
    id: "go-settings",
    group: "Go to",
    label: "Settings",
    href: "/admin/settings",
    shortcut: "g s",
    keywords: "email discord blocked",
  },
  {
    id: "go-system",
    group: "Go to",
    label: "System",
    href: "/admin/system",
    shortcut: "g x",
    keywords: "health jobs backups errors csp",
  },
  { id: "new-task", group: "Create", label: "New task", href: "/admin/tasks?new=1", shortcut: "c t" },
  { id: "new-project", group: "Create", label: "New project", href: "/admin/projects/new", shortcut: "c p" },
  { id: "new-client", group: "Create", label: "New client", href: "/admin/clients/new", shortcut: "c l" },
  {
    id: "new-meeting",
    group: "Create",
    label: "New meeting",
    href: "/admin/calendar/new",
    shortcut: "c m",
    keywords: "call",
  },
  {
    id: "new-quote",
    group: "Create",
    label: "New quote",
    href: "/admin/billing/quotes/new",
    shortcut: "c q",
  },
  {
    id: "new-invoice",
    group: "Create",
    label: "New invoice",
    href: "/admin/billing/invoices/new",
    shortcut: "c i",
  },
  {
    id: "new-expense",
    group: "Create",
    label: "New expense",
    href: "/admin/finance/expenses/new",
    shortcut: "c e",
  },
  {
    id: "new-post",
    group: "Create",
    label: "New blog post",
    href: "/admin/content/post/new",
    keywords: "write",
  },
  {
    id: "new-work",
    group: "Create",
    label: "New case study",
    href: "/admin/content/work/new",
    keywords: "portfolio",
  },
];

// "g i" → "/admin/inbox".
export const SHORTCUTS: ReadonlyMap<string, string> = new Map(
  COMMANDS.flatMap((command) => (command.shortcut ? [[command.shortcut, command.href] as const] : [])),
);

// Keys that work on some pages only, for the help sheet.
export const PAGE_SHORTCUTS: { keys: string; action: string }[] = [
  { keys: "j / k", action: "Next and previous in the inbox and task lists" },
  { keys: "x", action: "Tick the selected task" },
  { keys: "n", action: "Add a task, on the Tasks page" },
  { keys: "/", action: "Search the inbox" },
];

// The first key of a two-key shortcut: g goes somewhere, c creates something.
export const PREFIXES = ["g", "c"] as const;

export function matchesCommand(command: Command, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${command.label} ${command.group} ${command.keywords ?? ""}`.toLowerCase();
  return words.every((word) => text.includes(word));
}
