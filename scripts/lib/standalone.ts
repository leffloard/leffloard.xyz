import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";

export const STANDALONE_DIR = path.resolve(".next", "standalone");
export const STANDALONE_SERVER = path.join(STANDALONE_DIR, "server.js");

// `output: "standalone"` leaves the static files and public/ out of the server bundle. They are
// copied in here, the same way the deploy script does it. Returns false when there is no build yet.
export function assembleStandalone(): boolean {
  if (!existsSync(STANDALONE_SERVER)) return false;
  const staticTarget = path.join(STANDALONE_DIR, ".next", "static");
  rmSync(staticTarget, { recursive: true, force: true });
  cpSync(path.resolve(".next", "static"), staticTarget, { recursive: true });
  if (existsSync("public")) cpSync("public", path.join(STANDALONE_DIR, "public"), { recursive: true });
  return true;
}
