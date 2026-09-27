import "server-only";
import type { Db, ObjectId } from "mongodb";
import { ADMIN_TIME_ZONE, formatDateTime } from "@/lib/format";
import { todayIn } from "@/lib/intake/time";
import { getEnv } from "@/server/env";
import { log } from "@/server/log";
import { readChannels } from "@/server/notify/channels";
import { alertOwner } from "@/server/notify/owner";

// The failure counts at which a lock starts or grows (server/security/lockout.ts).
const LOCK_STEPS = new Set([5, 10, 20]);

type Lock = {
  failures: number;
  until: Date;
  userId: ObjectId | null;
  // "code": wrong authenticator or recovery codes after the right password.
  step: "password" | "code";
};

// Sign-in was locked after repeated failures. The owner hears of:
// - every lock caused by wrong codes after the right password: the password is known to someone;
// - each step of their own account's lock (5, 10 and 20 failures), however often it happens;
// - addresses that aren't an account (someone guessing), once a day.
// None says which address or where the attempts came from: the Security page and the audit log have that,
// and it needn't go to email or Discord. A failure to record the alert never changes the sign-in's answer.
export async function alertSignInLocked(db: Db, lock: Lock, at: Date): Promise<void> {
  const account = lock.userId !== null;
  if (lock.step === "password" && !LOCK_STEPS.has(lock.failures)) return;
  const day = todayIn(ADMIN_TIME_ZONE, at);
  const until = `${formatDateTime(lock.until)} (Istanbul time)`;
  const [title, body] =
    lock.step === "code"
      ? [
          "Your password was right, the codes were wrong",
          `Someone entered your password, then wrong authenticator or recovery codes, and sign-in is locked until ${until}. Change your password on the Security page now; a passkey still signs you in.`,
        ]
      : account
        ? [
            `Password sign-in locked after ${lock.failures} failed attempts`,
            `Signing in to your account with the password is locked until ${until}. A passkey still works.`,
          ]
        : [
            "Failed sign-ins with an address that isn't an account",
            `Password sign-in was locked for an address that isn't an account, after ${lock.failures} failed attempts.`,
          ];
  // Each lock of the account ends at its own time; the others share the day.
  const key = account ? `signin-locked:${lock.until.getTime()}` : `signin-locked:${day}:unknown`;
  const security = `${getEnv().SITE_URL}/admin/security`;
  try {
    await alertOwner(
      db,
      readChannels(),
      {
        kind: "problem",
        key,
        label: `Sign-in lock, ${day}`,
        title,
        body,
        href: "/admin/security",
        email: (to) => ({
          to: [{ address: to }],
          subject: title,
          text: `${body}\n\nIf it wasn't you, the Security page shows where the attempts came from and signs out other devices: ${security}\n`,
        }),
        discord: () => ({
          embeds: [
            {
              title,
              color: 0xf87171,
              description: body,
              fields: [],
              footer: { text: "leffloard.xyz security" },
              timestamp: at.toISOString(),
            },
          ],
          allowed_mentions: { parse: [] },
        }),
      },
      at,
    );
  } catch (error) {
    log.error({ err: error }, "The alert about a sign-in lock could not be recorded");
  }
}
