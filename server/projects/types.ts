import type { ObjectId } from "mongodb";
import type { Currency, Money } from "@/lib/money";
import type { PricingModel, ProjectStage, RevisionStatus } from "@/lib/work/options";

export type Milestone = {
  id: string;
  title: string;
  dueDate: string | null; // YYYY-MM-DD
  done: boolean;
  doneAt: Date | null;
};

export type ProjectLink = { id: string; label: string; url: string };

export type RevisionPolicy = {
  included: number; // revision rounds included in the price
  extraPrice: Money | null; // the price of each further round
};

export type ProjectDoc = {
  _id: ObjectId;
  ref: string; // "PRJ-042"
  clientId: ObjectId;
  title: string;
  service: string | null; // a SERVICE_OPTIONS value
  stage: ProjectStage;
  rank: string; // position in its board column (lib/rank.ts)
  summary: string; // scope and private notes
  startDate: string | null; // YYYY-MM-DD
  dueDate: string | null;
  estimateSeconds: number | null;
  currency: Currency;
  pricing: PricingModel;
  budget: Money | null; // the fixed price, or a cap for hourly work
  hourlyRate: Money | null;
  revisionPolicy: RevisionPolicy;
  revisionsUsed: number; // rounds that count (not cancelled)
  revisionSeq: number; // the last round number handed out
  milestones: Milestone[];
  links: ProjectLink[];
  tags: string[];
  inquiryId: ObjectId | null; // the message it started from
  createdAt: Date;
  updatedAt: Date;
  stageChangedAt: Date;
  deliveredAt: Date | null;
  version: number;
};

export type RevisionDoc = {
  _id: ObjectId;
  projectId: ObjectId;
  clientId: ObjectId;
  number: number; // "Round 3", unique per project
  title: string;
  details: string;
  status: RevisionStatus;
  billable: boolean; // beyond the included rounds
  price: Money | null; // the extra-round price when it was requested
  inquiryId: ObjectId | null;
  taskId: ObjectId | null;
  requestedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
