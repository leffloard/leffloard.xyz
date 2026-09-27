// Runs the production build locally, the way the server runs it: "npm run build", then "npm start".
import { spawn } from "node:child_process";
import { loadEnvConfig } from "@next/env";
import { assembleStandalone, STANDALONE_SERVER } from "./lib/standalone";

loadEnvConfig(process.cwd(), false, { info: () => {}, error: console.error });

if (!assembleStandalone()) {
  console.error('No production build found. Run "npm run build" first.');
  process.exit(1);
}

const server = spawn(process.execPath, [STANDALONE_SERVER], {
  stdio: "inherit",
  // HOSTNAME is set explicitly: some shells export the machine name under that variable.
  env: { ...process.env, PORT: process.env.PORT ?? "3000", HOSTNAME: "127.0.0.1" },
});
server.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGINT", () => server.kill("SIGINT"));
process.on("SIGTERM", () => server.kill("SIGTERM"));
