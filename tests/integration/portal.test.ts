import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { money } from "@/lib/money";
import { createClient, deleteClient, exportClient } from "@/server/clients/store";
import { resetClock, setClock } from "@/server/clock";
import { closeClient } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { readChannels } from "@/server/notify/channels";
import type { OutboxDoc } from "@/server/notify/outbox";
import {
  activePortalSessions,
  findPortalSession,
  peekPortalLink,
  setPortalAccess,
  signInWithLink,
} from "@/server/portal/access";
import { openPrivacyRequests, resolvePrivacyRequest } from "@/server/portal/privacy";
import {
  inviteToPortal,
  postProjectUpdate,
  requestDataAction,
  requestRevision,
  requestSignInLink,
} from "@/server/portal/service";
import { portalProject, portalProjects } from "@/server/portal/views";
import { createProject, getProject, updateProject } from "@/server/projects/store";
import { clientInput, projectInput } from "../helpers/work";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

const { db, url, name } = setupTestDb();
setupTestEnv({
  MONGO_URL: url,
  DB_NAME: name,
  EMAIL_DELIVERY: "log",
  NOTIFY_EMAIL_TO: "owner@leffloard.test",
});

const NOW = new Date("2026-09-28T06:00:00Z");
const META = { ip: "203.0.113.9", userAgent: "vitest" };
const notify = () => ({ siteUrl: "https://leffloard.test", channels: readChannels() });

beforeEach(async () => {
  await runMigrations(db());
  setClock(() => NOW);
});

afterEach(() => resetClock());

afterAll(async () => {
  await closeClient();
});

const outbox = () => db().collection<OutboxDoc>("outbox").find().sort({ _id: 1 }).toArray();

// The links in the last email to an address.
async function linksSentTo(address: string): Promise<string[]> {
  const mail = (await outbox()).filter((item) =>
    (item.payload as { to: { address: string }[] }).to.some((to) => to.address === address),
  );
  const text = (mail.at(-1)?.payload as { text: string } | undefined)?.text ?? "";
  return [...text.matchAll(/\/portal\/verify\?t=([A-Za-z0-9_-]+)/g)].map((match) => match[1]!);
}

describe("signing in", () => {
  it("sends a link only to clients with the portal on, and the link works once", async () => {
    const ada = await createClient(db(), clientInput(), {}, NOW);
    await requestSignInLink(db(), "ada@example.com", notify(), NOW);
    expect(await outbox()).toEqual([]);

    await setPortalAccess(db(), ada._id, true, NOW);
    await requestSignInLink(db(), " Ada@Example.com ", notify(), NOW);
    const [token] = await linksSentTo("ada@example.com");
    expect(token).toBeDefined();
    expect((await outbox())[0]!.label).toBe("Portal sign-in link to Ada Lovelace");
    expect((await outbox())[0]!.label).not.toContain(token!);

    // Opening the link (a mail scanner, say) doesn't spend it; signing in does, once.
    expect((await peekPortalLink(db(), token!, NOW))?.client._id).toEqual(ada._id);
    const signedIn = await signInWithLink(db(), token!, META, NOW);
    expect(signedIn?.client._id).toEqual(ada._id);
    expect(await signInWithLink(db(), token!, META, NOW)).toBeNull();
    expect((await findPortalSession(db(), signedIn!.token, NOW))?.client.name).toBe("Ada Lovelace");
    expect(await findPortalSession(db(), "not-a-real-session-token-at-all", NOW)).toBeNull();
  });

  it("lets a link expire, a quiet session end, and turning the portal off end them all", async () => {
    const ada = await createClient(db(), clientInput(), {}, NOW);
    await setPortalAccess(db(), ada._id, true, NOW);
    await requestSignInLink(db(), "ada@example.com", notify(), NOW);
    const [late] = await linksSentTo("ada@example.com");
    expect(await signInWithLink(db(), late!, META, new Date(NOW.getTime() + 21 * 60_000))).toBeNull();

    await requestSignInLink(db(), "ada@example.com", notify(), NOW);
    const [token] = await linksSentTo("ada@example.com");
    const signedIn = (await signInWithLink(db(), token!, META, NOW))!;
    const eightDays = new Date(NOW.getTime() + 8 * 86_400_000);
    expect(await findPortalSession(db(), signedIn.token, eightDays)).toBeNull();

    const again = (await signInWithLink(db(), (await inviteLink(ada._id))!, META, NOW))!;
    expect(await activePortalSessions(db(), ada._id, NOW)).toBe(2);
    await setPortalAccess(db(), ada._id, false, NOW);
    expect(await findPortalSession(db(), again.token, NOW)).toBeNull();
    expect(await activePortalSessions(db(), ada._id, NOW)).toBe(0);
  });

  it("sends one email with a link per client when an address belongs to several", async () => {
    const one = await createClient(db(), clientInput({ company: "Analytical Engines" }), {}, NOW);
    const two = await createClient(db(), clientInput({ company: "Difference Works" }), {}, NOW);
    await setPortalAccess(db(), one._id, true, NOW);
    await setPortalAccess(db(), two._id, true, NOW);
    await requestSignInLink(db(), "ada@example.com", notify(), NOW);
    expect(await outbox()).toHaveLength(1);
    const tokens = await linksSentTo("ada@example.com");
    expect(tokens).toHaveLength(2);
    const clients = await Promise.all(tokens.map((token) => peekPortalLink(db(), token, NOW)));
    expect(clients.map((found) => found?.client.company).sort()).toEqual([
      "Analytical Engines",
      "Difference Works",
    ]);
  });

  async function inviteLink(clientId: Parameters<typeof inviteToPortal>[1]): Promise<string | undefined> {
    const invited = await inviteToPortal(db(), clientId, notify(), NOW);
    expect(invited).toMatchObject({ ok: true, emailed: true });
    return (await linksSentTo("ada@example.com"))[0];
  }

  it("invites a client with a link that lasts a week", async () => {
    const ada = await createClient(db(), clientInput(), {}, NOW);
    const invited = await inviteToPortal(db(), ada._id, notify(), NOW);
    expect(invited.ok && invited.client.portal).toEqual({
      enabled: true,
      invitedAt: NOW,
      lastSignInAt: null,
    });
    const [token] = await linksSentTo("ada@example.com");
    const sixDays = new Date(NOW.getTime() + 6 * 86_400_000);
    const signedIn = await signInWithLink(db(), token!, META, sixDays);
    expect(signedIn?.client.portal?.lastSignInAt).toEqual(sixDays);

    const noEmail = await createClient(db(), clientInput({ email: null }), {}, NOW);
    expect(await inviteToPortal(db(), noEmail._id, notify(), NOW)).toEqual({
      ok: false,
      message: "Add the client's email address first.",
    });
  });
});

describe("what a client sees and asks for", () => {
  async function setUp() {
    const ada = await createClient(db(), clientInput(), {}, NOW);
    const grace = await createClient(
      db(),
      clientInput({ name: "Grace Hopper", email: "grace@example.com" }),
      {},
      NOW,
    );
    await setPortalAccess(db(), ada._id, true, NOW);
    const project = (await createProject(
      db(),
      projectInput(ada._id, { revisionPolicy: { included: 1, extraPrice: money(6_000, "USD") } }),
      {},
      NOW,
    ))!;
    const other = (await createProject(db(), projectInput(grace._id, { title: "Grace's site" }), {}, NOW))!;
    await createProject(db(), projectInput(ada._id, { title: "Dropped" }), { stage: "cancelled" }, NOW);
    return { ada, grace, project, other };
  }

  it("shows a client their own projects only", async () => {
    const { ada, project, other } = await setUp();
    expect((await portalProjects(db(), ada._id)).map((item) => item.title)).toEqual(["Shop rebuild"]);
    expect(await portalProject(db(), ada._id, project._id)).not.toBeNull();
    expect(await portalProject(db(), ada._id, other._id)).toBeNull();
  });

  it("counts revision rounds, and asks before one that costs extra", async () => {
    const { ada, project, other } = await setUp();
    const first = await requestRevision(
      db(),
      ada,
      project._id,
      { title: "Bigger logo", details: "On the home page.", chargeAgreed: false, agreedPrice: null },
      notify(),
      NOW,
    );
    expect(first).toMatchObject({ ok: true, revision: { number: 1, billable: false, fromPortal: true } });

    // The second round is beyond the included one: not written without the client's agreement.
    const refused = await requestRevision(
      db(),
      ada,
      project._id,
      { title: "New colours", details: "", chargeAgreed: false, agreedPrice: null },
      notify(),
      NOW,
    );
    expect(refused).toEqual({ ok: false, problem: "charge", price: money(6_000, "USD") });
    expect((await getProject(db(), project._id))?.revisionsUsed).toBe(1);

    // Agreeing to a price that is no longer the price counts for nothing: the client is asked again.
    const oldPrice = await requestRevision(
      db(),
      ada,
      project._id,
      { title: "New colours", details: "", chargeAgreed: true, agreedPrice: money(4_000, "USD") },
      notify(),
      NOW,
    );
    expect(oldPrice).toEqual({ ok: false, problem: "charge", price: money(6_000, "USD") });

    const agreed = await requestRevision(
      db(),
      ada,
      project._id,
      { title: "New colours", details: "", chargeAgreed: true, agreedPrice: money(6_000, "USD") },
      notify(),
      NOW,
    );
    expect(agreed).toMatchObject({
      ok: true,
      revision: { number: 2, billable: true, price: money(6_000, "USD") },
    });
    expect((await outbox()).map((item) => item.label)).toEqual([
      "Revision asked for in the portal: PRJ-001",
      "Revision asked for in the portal: PRJ-001",
    ]);

    // Another client's project is not theirs to ask about.
    expect(
      await requestRevision(
        db(),
        ada,
        other._id,
        { title: "x", details: "", chargeAgreed: true, agreedPrice: null },
        notify(),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "missing" });

    // A paused project takes no requests, even from a page opened before it was paused.
    await db()
      .collection("projects")
      .updateOne({ _id: project._id }, { $set: { stage: "paused" } });
    expect(
      await requestRevision(
        db(),
        ada,
        project._id,
        { title: "One more", details: "", chargeAgreed: true, agreedPrice: money(6_000, "USD") },
        notify(),
        NOW,
      ),
    ).toEqual({ ok: false, problem: "paused" });
    expect((await getProject(db(), project._id))?.revisionsUsed).toBe(2);
  });

  it("takes one open data request of each kind, and tells the owner once", async () => {
    const { ada } = await setUp();
    const first = await requestDataAction(db(), ada, "export", "For my records.", notify(), NOW);
    expect(first.created).toBe(true);
    const again = await requestDataAction(db(), ada, "export", "", notify(), NOW);
    expect(again).toMatchObject({ created: false, request: { _id: first.request._id } });
    expect((await outbox()).map((item) => item.label)).toEqual(["Data request in the portal: Ada Lovelace"]);
    // Today lists it with the day it must be answered by.
    expect(await openPrivacyRequests(db())).toEqual([
      {
        id: first.request._id.toHexString(),
        clientId: ada._id.toHexString(),
        clientName: "Ada Lovelace",
        kind: "export",
        answerBy: new Date(NOW.getTime() + 30 * 86_400_000),
      },
    ]);

    await resolvePrivacyRequest(db(), first.request._id, "done", "Sent by email.", NOW);
    expect(await openPrivacyRequests(db())).toEqual([]);
    expect((await requestDataAction(db(), ada, "export", "", notify(), NOW)).created).toBe(true);
  });

  it("posts the owner's updates, emailing them when asked", async () => {
    const { project, other } = await setUp();
    const quiet = await postProjectUpdate(db(), project, "Staging is up.", false, notify(), NOW);
    expect(quiet.emailed).toBe(false);
    const loud = await postProjectUpdate(db(), project, "It's live!", true, notify(), NOW);
    expect(loud.emailed).toBe(true);
    const [mail] = await outbox();
    expect(mail).toMatchObject({ label: "Update on PRJ-001 to Ada Lovelace" });
    expect((mail!.payload as { text: string }).text).toContain(
      `https://leffloard.test/portal/projects/${project._id.toHexString()}`,
    );

    // Without email set up nothing is queued, and the update doesn't say it was emailed.
    const offline = await postProjectUpdate(
      db(),
      project,
      "Docs are in.",
      true,
      { siteUrl: "https://leffloard.test", channels: { ...readChannels(), email: null } },
      NOW,
    );
    expect(offline.emailed).toBe(false);
    const stored = await db()
      .collection("project_updates")
      .find({}, { projection: { _id: 0, body: 1, emailed: 1 } })
      .sort({ _id: 1 })
      .toArray();
    expect(stored).toEqual([
      { body: "Staging is up.", emailed: false },
      { body: "It's live!", emailed: true },
      { body: "Docs are in.", emailed: false },
    ]);

    // A client without the portal gets the update, but no way to a portal they can't open.
    await postProjectUpdate(db(), other, "Draft designs attached.", true, notify(), NOW);
    const graceMail = (await outbox()).at(-1)!;
    expect(graceMail.label).toBe("Update on PRJ-002 to Grace Hopper");
    expect((graceMail.payload as { text: string }).text).toContain("Draft designs attached.");
    expect((graceMail.payload as { text: string }).text).not.toContain("/portal");
  });

  it("moves updates with a project that changes clients, and exports and deletes them with it", async () => {
    const { ada, grace, project } = await setUp();
    await postProjectUpdate(db(), project, "Staging is up.", false, notify(), NOW);
    const current = (await getProject(db(), project._id))!;
    const moved = await updateProject(
      db(),
      project._id,
      current.version,
      { ...projectInput(grace._id), revisionPolicy: current.revisionPolicy },
      NOW,
    );
    expect(moved.ok).toBe(true);
    expect((await exportClient(db(), ada._id, NOW))?.projectUpdates).toEqual([]);
    expect((await exportClient(db(), grace._id, NOW))?.projectUpdates).toHaveLength(1);
    expect((await deleteClient(db(), ada._id))?.portal).toBe(0);
    expect(await db().collection("project_updates").countDocuments()).toBe(1);
    expect((await deleteClient(db(), grace._id))?.portal).toBe(1);
    expect(await db().collection("project_updates").countDocuments()).toBe(0);
  });
});
