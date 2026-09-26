import type { ObjectId } from "mongodb";
import { money } from "@/lib/money";
import type { ClientInput } from "@/server/clients/store";
import type { ProjectInput } from "@/server/projects/store";

export function clientInput(overrides: Partial<ClientInput> = {}): ClientInput {
  return {
    name: "Ada Lovelace",
    company: "Analytical Engines Ltd",
    email: "ada@example.com",
    phone: null,
    website: null,
    location: "London, UK",
    timeZone: "Europe/London",
    currency: "USD",
    status: "lead",
    tags: [],
    notes: "",
    source: null,
    ...overrides,
  };
}

export function projectInput(clientId: ObjectId, overrides: Partial<ProjectInput> = {}): ProjectInput {
  return {
    clientId,
    title: "Shop rebuild",
    service: "websites",
    summary: "",
    startDate: null,
    dueDate: null,
    estimateSeconds: null,
    currency: "USD",
    pricing: "fixed",
    budget: money(120_000, "USD"),
    hourlyRate: null,
    revisionPolicy: { included: 2, extraPrice: money(6_000, "USD") },
    tags: [],
    ...overrides,
  };
}
