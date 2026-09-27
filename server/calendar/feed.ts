import "server-only";
import type { Db } from "mongodb";
import { buildCalendar, type IcsEvent } from "@/lib/booking/ics";
import { addDays } from "@/lib/intake/time";
import { OPEN_STAGES } from "@/lib/work/options";
import { BLOCK_LABELS, blocksBetween } from "@/server/calendar/blocks";
import { adminMeetingUrl } from "@/server/calendar/emails";
import { meetingsBetween } from "@/server/calendar/meetings";
import { projects, tasks } from "@/server/work/collections";

// The owner's private calendar feed: meetings and blocks, and the deadlines of tasks, projects and
// milestones as all-day events. Calendar apps subscribe to its secret address and refresh it themselves.

const DAY_MS = 86_400_000;

export async function buildFeed(db: Db, siteUrl: string, at: Date): Promise<string> {
  const host = new URL(siteUrl).hostname;
  const from = new Date(at.getTime() - 30 * DAY_MS);
  const to = new Date(at.getTime() + 180 * DAY_MS);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);
  const [meetingDocs, blockDocs, taskDocs, projectDocs] = await Promise.all([
    meetingsBetween(db, from, to),
    blocksBetween(db, from, to),
    tasks(db)
      .find(
        { status: { $ne: "done" }, due: { $gte: fromDate, $lte: toDate } },
        { projection: { title: 1, due: 1, updatedAt: 1 } },
      )
      .limit(1000)
      .toArray(),
    projects(db)
      .find(
        { stage: { $in: OPEN_STAGES } },
        { projection: { ref: 1, title: 1, dueDate: 1, milestones: 1, updatedAt: 1 } },
      )
      .limit(500)
      .toArray(),
  ]);

  const allDay = (uid: string, summary: string, date: string, stamp: Date): IcsEvent => ({
    uid: `${uid}@${host}`,
    sequence: 0,
    stamp,
    summary,
    start: { date },
    end: { date: addDays(date, 1) },
  });

  const events: IcsEvent[] = [
    ...meetingDocs.map((meeting) => ({
      uid: `meeting-${meeting._id.toHexString()}@${host}`,
      sequence: meeting.sequence,
      stamp: meeting.updatedAt,
      summary: `${meeting.title}: ${meeting.name}${meeting.status === "requested" ? " (request)" : ""}`,
      description: [
        meeting.email,
        ...meeting.answers.map((answer) => `${answer.label}\n${answer.value}`),
        meeting.notes,
        adminMeetingUrl(siteUrl, meeting),
      ]
        .filter(Boolean)
        .join("\n\n"),
      location: meeting.location.url ?? meeting.location.details,
      url: meeting.location.url ?? undefined,
      status: meeting.status === "requested" ? ("TENTATIVE" as const) : ("CONFIRMED" as const),
      start: meeting.startsAt,
      end: meeting.endsAt,
      alarmMinutes: 10,
    })),
    ...blockDocs.map((block) => ({
      uid: `block-${block._id.toHexString()}@${host}`,
      sequence: 0,
      stamp: block.createdAt,
      summary: block.title || BLOCK_LABELS[block.kind],
      start: block.startsAt,
      end: block.endsAt,
    })),
    ...taskDocs.map((task) =>
      allDay(`task-${task._id.toHexString()}-${task.due}`, `Task: ${task.title}`, task.due!, task.updatedAt),
    ),
    ...projectDocs.flatMap((project) => [
      ...(project.dueDate && project.dueDate >= fromDate && project.dueDate <= toDate
        ? [
            allDay(
              `project-${project._id.toHexString()}`,
              `Due: ${project.ref} ${project.title}`,
              project.dueDate,
              project.updatedAt,
            ),
          ]
        : []),
      ...project.milestones
        .filter(
          (milestone) =>
            !milestone.done &&
            milestone.dueDate &&
            milestone.dueDate >= fromDate &&
            milestone.dueDate <= toDate,
        )
        .map((milestone) =>
          allDay(
            `milestone-${project._id.toHexString()}-${milestone.id}`,
            `Milestone: ${milestone.title} (${project.ref})`,
            milestone.dueDate!,
            project.updatedAt,
          ),
        ),
    ]),
  ];

  return buildCalendar({ name: "leffloard", refreshMinutes: 30, events });
}
