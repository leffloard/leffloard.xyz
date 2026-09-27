import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@/server/clients/store";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { submitInquiry } from "@/server/inquiries/intake";
import { createProject } from "@/server/projects/store";
import { searchEverything } from "@/server/search/everything";
import { createTask } from "@/server/tasks/store";
import { inquiryInput, SITE_URL } from "../helpers/inquiry";
import { clientInput, projectInput } from "../helpers/work";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({ MONGO_URL: url, DB_NAME: name });

beforeEach(async () => {
  await runMigrations(db());
});

afterAll(async () => {
  await closeClient();
});

const NO_ALERTS = { email: null, ownerEmail: null, discordWebhookUrl: null };

describe("the command palette's search", () => {
  it("finds messages, clients, projects and tasks by name", async () => {
    const client = await createClient(db(), clientInput({ name: "Ada Lovelace", company: "Engines Ltd" }));
    const project = await createProject(db(), projectInput(client._id, { title: "Engine shop rebuild" }));
    if (!project) throw new Error("no project");
    await createTask(db(), { title: "Engine photos for the shop", projectId: project._id });
    await createTask(db(), { title: "Something else" });
    await submitInquiry(db(), inquiryInput({ name: "Charles Babbage", subject: "Difference engine bot" }), {
      source: "form",
      siteUrl: SITE_URL,
      channels: NO_ALERTS,
    });

    const results = await searchEverything(db(), "engine");
    expect(results.map((result) => [result.type, result.title])).toEqual([
      ["Message", "Charles Babbage: Difference engine bot"],
      ["Client", "Ada Lovelace"],
      ["Project", "Engine shop rebuild"],
      ["Task", "Engine photos for the shop"],
    ]);
    expect(results[1]).toMatchObject({
      detail: "Engines Ltd · ada@example.com",
      href: `/admin/clients/${client._id.toHexString()}`,
    });
    expect(results[2]?.detail).toMatch(/^PRJ-\d{3}$/);
  });

  it("needs two characters, and reads the text literally", async () => {
    await createClient(db(), clientInput({ name: "A.B. Consulting" }));
    await createClient(db(), clientInput({ name: "AxB Studio", email: "axb@example.com" }));
    expect(await searchEverything(db(), "a")).toEqual([]);
    expect(await searchEverything(db(), "   ")).toEqual([]);
    expect((await searchEverything(db(), "A.B")).map((result) => result.title)).toEqual(["A.B. Consulting"]);
    expect(await searchEverything(db(), ".*")).toEqual([]);
  });
});
