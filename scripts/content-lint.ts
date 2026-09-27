// The leak check over the whole site: every published copy, every draft that differs from it, and the
// repositories on the work page, with the words listed under Content → Leak check.
//
//   npm run content:lint
//
// Exit codes: 0 nothing found, 1 something found (listed), 2 the check could not run.
import { loadEnvConfig } from "@next/env";
import { scanContent } from "@/server/content/editor";
import { closeClient, getDb } from "@/server/db/client";
import { EnvError } from "@/server/env";

async function main(): Promise<number> {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", {
    info: () => {},
    error: console.error,
  });
  try {
    const rows = await scanContent(await getDb());
    if (!rows.length) {
      console.log("Nothing found.");
      return 0;
    }
    for (const row of rows) {
      console.log(`${row.kind} "${row.title}" (${row.copy}):`);
      for (const finding of row.findings) console.log(`  ${finding.label}: ${finding.excerpt}`);
    }
    return 1;
  } catch (error) {
    console.error(error instanceof EnvError ? error.message : `The check failed: ${String(error)}`);
    return 2;
  } finally {
    await closeClient();
  }
}

void main().then((code) => process.exit(code));
