import { afterEach, describe, expect, it } from "vitest";
import { base32Decode } from "@/lib/base32";
import { hotp, totpStep } from "@/lib/totp";
import {
  changePassword,
  completeSetup,
  confirmSudo,
  passwordStep,
  pendingSetup,
  secondFactorStep,
  type Client,
} from "@/server/auth/login";
import {
  createSession,
  findValidSession,
  listSessions,
  SESSION_IDLE_MS,
  SESSION_MAX_MS,
} from "@/server/auth/sessions";
import type { UserDoc } from "@/server/auth/types";
import { createOwner, findOwner } from "@/server/auth/users";
import { resetClock, setClock } from "@/server/clock";
import { setupTestDb } from "./db";
import { setupTestEnv } from "./env";

setupTestEnv();
const { db } = setupTestDb();

const OWNER = { email: "owner@example.com", name: "Owner", password: "purple kettle on the balcony" };
const client = (ip = "203.0.113.5"): Client => ({ ip, ipKey: ip, userAgent: "vitest" });

afterEach(() => resetClock());

function codeAt(secret: string, offsetSteps = 0): string {
  return hotp(base32Decode(secret), totpStep(new Date()) + offsetSteps);
}

// Creates the owner and runs the first sign-in through the authenticator setup.
async function enrolledOwner(): Promise<{ user: UserDoc; secret: string; recoveryCodes: string[] }> {
  await createOwner(db(), OWNER);
  const step = await passwordStep(db(), OWNER, client());
  if (step.status !== "setup_required") throw new Error(`expected setup, got ${step.status}`);
  const setup = await pendingSetup(db(), step.pendingToken);
  const done = await completeSetup(
    db(),
    { pendingToken: step.pendingToken, code: codeAt(setup!.secret) },
    client(),
  );
  if (done.status !== "ok") throw new Error(`setup failed: ${done.status}`);
  return { user: (await findOwner(db()))!, secret: setup!.secret, recoveryCodes: done.recoveryCodes };
}

async function pendingSecondFactor(ip?: string): Promise<string> {
  const step = await passwordStep(db(), OWNER, client(ip));
  if (step.status !== "second_factor") throw new Error(`expected second factor, got ${step.status}`);
  return step.pendingToken;
}

describe("passwordStep", () => {
  it("gives the same answer for an unknown email and a wrong password", async () => {
    await createOwner(db(), OWNER);
    expect(await passwordStep(db(), { email: "nobody@example.com", password: "whatever" }, client())).toEqual(
      {
        status: "invalid",
      },
    );
    expect(await passwordStep(db(), { ...OWNER, password: "wrong password" }, client())).toEqual({
      status: "invalid",
    });
  });

  it("sends a new owner to the authenticator setup, and never signs in with the password alone", async () => {
    await createOwner(db(), OWNER);
    const step = await passwordStep(db(), { ...OWNER, email: " OWNER@example.com " }, client());
    expect(step.status).toBe("setup_required");
    expect(await db().collection("sessions").countDocuments()).toBe(0);
  });

  it("locks the address after five failures, even for the right password", async () => {
    await createOwner(db(), OWNER);
    for (let attempt = 0; attempt < 4; attempt++) {
      expect((await passwordStep(db(), { ...OWNER, password: "nope" }, client())).status).toBe("invalid");
    }
    expect((await passwordStep(db(), { ...OWNER, password: "nope" }, client())).status).toBe("locked");
    expect((await passwordStep(db(), OWNER, client())).status).toBe("locked");
    expect(await db().collection("audit_log").countDocuments({ action: "auth.login.locked" })).toBe(1);
  });

  it("rate-limits one address, whatever the account", async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      await passwordStep(
        db(),
        { email: `user${attempt}@example.com`, password: "x" },
        client("198.51.100.9"),
      );
    }
    const blocked = await passwordStep(
      db(),
      { email: "last@example.com", password: "x" },
      client("198.51.100.9"),
    );
    expect(blocked.status).toBe("rate_limited");
    const elsewhere = await passwordStep(
      db(),
      { email: "last@example.com", password: "x" },
      client("198.51.100.10"),
    );
    expect(elsewhere.status).toBe("invalid");
  });
});

describe("authenticator setup", () => {
  it("stores the secret encrypted, gives ten recovery codes and starts a session", async () => {
    const { user, secret, recoveryCodes } = await enrolledOwner();
    expect(recoveryCodes).toHaveLength(10);
    expect(user.totp?.secret).toMatch(/^v1\./);
    expect(JSON.stringify(user)).not.toContain(secret);
    expect(user.recoveryCodes.every((code) => code.usedAt === null && /^[0-9a-f]{64}$/.test(code.hash))).toBe(
      true,
    );
    expect(
      await db()
        .collection("sessions")
        .countDocuments({ methods: ["password", "totp"] }),
    ).toBe(1);
  });

  it("works once per setup and refuses wrong codes", async () => {
    await createOwner(db(), OWNER);
    const step = await passwordStep(db(), OWNER, client());
    if (step.status !== "setup_required") throw new Error("expected setup");
    const setup = (await pendingSetup(db(), step.pendingToken))!;
    expect(
      await completeSetup(db(), { pendingToken: step.pendingToken, code: "000000" }, client()),
    ).toMatchObject({
      status: "invalid",
      attemptsLeft: 4,
    });
    const ok = await completeSetup(
      db(),
      { pendingToken: step.pendingToken, code: codeAt(setup.secret) },
      client(),
    );
    expect(ok.status).toBe("ok");
    const again = await completeSetup(
      db(),
      { pendingToken: step.pendingToken, code: codeAt(setup.secret, 1) },
      client(),
    );
    expect(again.status).toBe("expired");
  });
});

describe("secondFactorStep", () => {
  it("accepts a fresh code once and never the same code again", async () => {
    const { secret } = await enrolledOwner();
    const next = codeAt(secret, 1);
    const first = await secondFactorStep(
      db(),
      { pendingToken: await pendingSecondFactor(), code: next },
      client(),
    );
    expect(first).toMatchObject({ status: "ok", method: "totp" });
    const replay = await secondFactorStep(
      db(),
      { pendingToken: await pendingSecondFactor(), code: next },
      client(),
    );
    expect(replay).toMatchObject({ status: "invalid", attemptsLeft: 4 });
  });

  it("allows five tries per sign-in, and each failure counts towards the lock", async () => {
    await enrolledOwner();
    const pendingToken = await pendingSecondFactor();
    for (let left = 4; left >= 1; left--) {
      expect(await secondFactorStep(db(), { pendingToken, code: "000000" }, client())).toEqual({
        status: "invalid",
        attemptsLeft: left,
      });
    }
    const last = await secondFactorStep(db(), { pendingToken, code: "000000" }, client());
    expect(last.status).toBe("locked");
  });

  it("lets each recovery code in exactly once, even when two requests race", async () => {
    const { recoveryCodes } = await enrolledOwner();
    const [a, b] = await Promise.all([
      secondFactorStep(
        db(),
        { pendingToken: await pendingSecondFactor(), code: recoveryCodes[0]! },
        client(),
      ),
      secondFactorStep(
        db(),
        { pendingToken: await pendingSecondFactor(), code: recoveryCodes[0]! },
        client(),
      ),
    ]);
    expect([a.status, b.status].sort()).toEqual(["invalid", "ok"]);
    const ok = a.status === "ok" ? a : b;
    expect(ok).toMatchObject({ method: "recovery", recoveryCodesLeft: 9 });
  });

  it("refuses an expired or unknown pending sign-in", async () => {
    await enrolledOwner();
    expect(await secondFactorStep(db(), { pendingToken: "made-up", code: "123456" }, client())).toEqual({
      status: "expired",
    });
    expect(await secondFactorStep(db(), { pendingToken: undefined, code: "123456" }, client())).toEqual({
      status: "expired",
    });
  });
});

describe("sessions", () => {
  it("end after 30 idle minutes, and after 12 hours however active", async () => {
    const user = await createOwner(db(), OWNER);
    const start = new Date("2026-09-26T10:00:00Z").getTime();
    const minutes = (value: number) => setClock(() => new Date(start + value * 60_000));
    minutes(0);
    const input = { userId: user._id, ip: "203.0.113.5", userAgent: "vitest", methods: ["passkey" as const] };
    const active = (await createSession(db(), input)).token;
    const idle = (await createSession(db(), input)).token;

    minutes(29);
    expect(await findValidSession(db(), idle)).not.toBeNull();
    minutes(60);
    expect(await findValidSession(db(), idle)).toBeNull();

    for (let at = 20; at < SESSION_MAX_MS / 60_000; at += 20) {
      minutes(at);
      expect(await findValidSession(db(), active)).not.toBeNull();
    }
    minutes(SESSION_MAX_MS / 60_000 + 1);
    expect(await findValidSession(db(), active)).toBeNull();
    expect(await findValidSession(db(), "not-a-token")).toBeNull();
    expect(SESSION_IDLE_MS).toBe(30 * 60_000);
  });

  it("store only a hash of the cookie token", async () => {
    const user = await createOwner(db(), OWNER);
    const { token } = await createSession(db(), {
      userId: user._id,
      ip: "x",
      userAgent: "vitest",
      methods: ["passkey"],
    });
    const stored = await db().collection("sessions").findOne({});
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(stored?._id).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("signed-in changes", () => {
  it("confirmSudo needs the password and a fresh code", async () => {
    const { user, secret } = await enrolledOwner();
    const [session] = await listSessions(db(), user._id);
    const signedIn = { user: (await findOwner(db()))!, sessionId: session!._id };
    expect(
      await confirmSudo(db(), { password: "wrong", code: codeAt(secret, 1) }, signedIn, client()),
    ).toEqual({
      status: "invalid",
    });
    const ok = await confirmSudo(
      db(),
      { password: OWNER.password, code: codeAt(secret, 1) },
      signedIn,
      client(),
    );
    expect(ok.status).toBe("ok");
  });

  it("changing the password signs out every other session", async () => {
    const { secret } = await enrolledOwner();
    await secondFactorStep(
      db(),
      { pendingToken: await pendingSecondFactor(), code: codeAt(secret, 1) },
      client(),
    );
    const user = (await findOwner(db()))!;
    const [keep] = await listSessions(db(), user._id);
    expect(await listSessions(db(), user._id)).toHaveLength(2);

    const signedIn = { user, sessionId: keep!._id };
    expect(
      await changePassword(db(), { current: "wrong", next: "a brand new passphrase" }, signedIn, client()),
    ).toEqual({ status: "invalid", problem: "The current password is not correct." });
    expect(
      await changePassword(db(), { current: OWNER.password, next: "short" }, signedIn, client()),
    ).toEqual({
      status: "invalid",
      problem: "Use at least 12 characters.",
    });
    expect(
      await changePassword(
        db(),
        { current: OWNER.password, next: "a brand new passphrase" },
        signedIn,
        client(),
      ),
    ).toEqual({ status: "ok", signedOut: 1 });
    expect((await passwordStep(db(), OWNER, client())).status).toBe("invalid");
    expect(
      (await passwordStep(db(), { ...OWNER, password: "a brand new passphrase" }, client())).status,
    ).toBe("second_factor");
  });
});
