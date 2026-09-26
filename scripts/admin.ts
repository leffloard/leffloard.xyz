// Owner account tools for the server console. Anyone who can run this already controls the server, so
// these are the recovery paths when everything else is lost.
//
//   npm run admin -- create           create the owner account (two-step sign-in is set up on first sign-in)
//   npm run admin -- status           show the account's sign-in setup
//   npm run admin -- reset-password   set a new password and sign out everywhere
//   npm run admin -- reset-2fa        remove the authenticator app, recovery codes and passkeys
//   npm run admin -- unlock           lift a password sign-in lock
import { loadEnvConfig } from "@next/env";
import { z } from "zod";
import { audit } from "@/server/auth/audit";
import { passkeys } from "@/server/auth/passkeys";
import { revokeAllSessions, sessions } from "@/server/auth/sessions";
import { authTokens } from "@/server/auth/tokens";
import { createOwner, findOwner, setPassword, users } from "@/server/auth/users";
import { closeClient, getDb } from "@/server/db/client";
import { pendingMigrations } from "@/server/db/migrate";
import { EnvError } from "@/server/env";
import { clearLoginFailures, lockedUntil } from "@/server/security/lockout";
import { passwordProblem } from "@/server/security/password";
import { ask, askHidden } from "./lib/prompt";

const CONSOLE = { ip: "server console", userAgent: "npm run admin" };

async function newPassword(email: string): Promise<string> {
  for (;;) {
    const password = await askHidden("New password (at least 12 characters): ");
    const problem = passwordProblem(password, email);
    if (problem) {
      console.log(problem);
      continue;
    }
    if ((await askHidden("Repeat it: ")) === password) return password;
    console.log("The two entries do not match.");
  }
}

async function main(command: string | undefined): Promise<number> {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
    info: () => {},
    error: console.error,
  });
  const db = await getDb();
  if ((await pendingMigrations(db)).length > 0) {
    console.error('The database has pending migrations. Run "npm run migrate" first.');
    return 1;
  }
  const owner = await findOwner(db);

  switch (command) {
    case "create": {
      if (owner) {
        console.error(`The owner account (${owner.email}) already exists. Use reset-password or reset-2fa.`);
        return 1;
      }
      const email = await ask("Email: ");
      if (!z.email().safeParse(email).success) {
        console.error("That is not an email address.");
        return 1;
      }
      const name = (await ask("Your name (shown in the admin): ")) || "Owner";
      const password = await newPassword(email);
      const user = await createOwner(db, { email, name, password });
      await audit(db, { action: "admin.owner.created", actorId: user._id, ...CONSOLE });
      console.log(
        `\nCreated ${user.email}. Sign in at /admin/login; the first sign-in sets up the authenticator app.`,
      );
      return 0;
    }

    case "status": {
      if (!owner) {
        console.log('No owner account yet. Create it with "npm run admin -- create".');
        return 0;
      }
      const [passkeyCount, sessionCount, locked] = await Promise.all([
        passkeys(db).countDocuments({ userId: owner._id }),
        sessions(db).countDocuments({ userId: owner._id }),
        lockedUntil(db, owner.email),
      ]);
      console.log(`Owner:          ${owner.name} <${owner.email}>`);
      console.log(
        `Authenticator:  ${owner.totp ? `on since ${owner.totp.enabledAt.toISOString()}` : "not set up yet"}`,
      );
      console.log(
        `Recovery codes: ${owner.recoveryCodes.filter((code) => code.usedAt === null).length} left`,
      );
      console.log(`Passkeys:       ${passkeyCount}`);
      console.log(`Sessions:       ${sessionCount}`);
      console.log(`Password lock:  ${locked ? `until ${locked.toISOString()}` : "none"}`);
      return 0;
    }

    case "reset-password": {
      if (!owner) return noOwner();
      await setPassword(db, owner._id, await newPassword(owner.email));
      const signedOut = await revokeAllSessions(db, owner._id);
      await clearLoginFailures(db, owner.email);
      await audit(db, {
        action: "admin.owner.password_reset",
        actorId: owner._id,
        ...CONSOLE,
        details: { signedOut },
      });
      console.log("Password changed. Every session was signed out.");
      return 0;
    }

    case "reset-2fa": {
      if (!owner) return noOwner();
      console.log(
        "This removes the authenticator app, all recovery codes and all passkeys, and signs out everywhere.",
      );
      console.log("The next password sign-in will set up a new authenticator app.");
      if ((await ask("Type RESET to continue: ")) !== "RESET") {
        console.log("Nothing was changed.");
        return 1;
      }
      await users(db).updateOne(
        { _id: owner._id },
        { $set: { totp: null, recoveryCodes: [], updatedAt: new Date() } },
      );
      const removedPasskeys = (await passkeys(db).deleteMany({ userId: owner._id })).deletedCount;
      await authTokens(db).deleteMany({ userId: owner._id });
      const signedOut = await revokeAllSessions(db, owner._id);
      await audit(db, {
        action: "admin.owner.second_factors_reset",
        actorId: owner._id,
        ...CONSOLE,
        details: { removedPasskeys, signedOut },
      });
      console.log("Done. Sign in with your password to set up a new authenticator app.");
      return 0;
    }

    case "unlock": {
      if (!owner) return noOwner();
      await clearLoginFailures(db, owner.email);
      await audit(db, { action: "auth.lockout.cleared", actorId: owner._id, ...CONSOLE });
      console.log("Password sign-in is open again.");
      return 0;
    }

    default:
      console.log("Usage: npm run admin -- <create | status | reset-password | reset-2fa | unlock>");
      return command ? 1 : 0;
  }
}

function noOwner(): number {
  console.error('There is no owner account yet. Create it with "npm run admin -- create".');
  return 1;
}

main(process.argv[2])
  .catch((error: unknown) => {
    console.error(error instanceof EnvError ? error.message : error);
    return 1;
  })
  .then(async (code) => {
    await closeClient();
    process.exit(code);
  });
