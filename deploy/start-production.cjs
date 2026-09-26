"use strict";
// Starts one release of the site with the settings from the shared settings file. The Windows service
// runs `node C:\leffloard\current\start-production.cjs`; the deploy script copies this file into every
// release next to Next.js's server.js.
//
// Settings file: LEFFLOARD_ENV_FILE, or shared\leffloard.env two folders up (C:\leffloard\shared when the
// release is C:\leffloard\releases\<name>). Variables already set in the environment win, so the deploy
// script can start a trial copy on another port. Error messages name line numbers, never values.

const fs = require("node:fs");
const path = require("node:path");

function unquoteDouble(text, lineNumber) {
  let value = "";
  for (let index = 1; index < text.length; index++) {
    const char = text[index];
    if (char === "\\" && index + 1 < text.length) {
      const next = text[++index];
      value += next === "n" ? "\n" : next === "r" ? "\r" : next === "t" ? "\t" : next;
    } else if (char === '"') {
      const rest = text.slice(index + 1).trim();
      if (rest && !rest.startsWith("#")) throw new Error(`Line ${lineNumber}: text after the closing quote.`);
      return value;
    } else {
      value += char;
    }
  }
  throw new Error(`Line ${lineNumber}: the value has no closing quote.`);
}

// KEY=value lines, as in .env files: # comments, optional "export ", '...' taken literally, "..." with
// \n \t \" escapes, and unquoted values ending at " #".
function parseEnvFile(text) {
  const values = {};
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  lines.forEach((raw, index) => {
    const lineNumber = index + 1;
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) throw new Error(`Line ${lineNumber}: expected NAME=value.`);
    const name = match[1];
    const rest = match[2];
    let value;
    if (rest.startsWith('"')) {
      value = unquoteDouble(rest, lineNumber);
    } else if (rest.startsWith("'")) {
      const end = rest.indexOf("'", 1);
      if (end === -1) throw new Error(`Line ${lineNumber}: the value has no closing quote.`);
      value = rest.slice(1, end);
    } else {
      value = rest.replace(/\s+#.*$/, "").trim();
    }
    values[name] = value;
  });
  return values;
}

function applySettings(values, env) {
  for (const [name, value] of Object.entries(values)) {
    if (env[name] === undefined) env[name] = value;
  }
}

function settingsFile(env, releaseDir) {
  return env.LEFFLOARD_ENV_FILE || path.resolve(releaseDir, "..", "..", "shared", "leffloard.env");
}

function main() {
  const file = settingsFile(process.env, __dirname);
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    console.error(`Cannot read the settings file ${file}. See docs/DEPLOY.md, "Settings".`);
    process.exit(1);
  }
  try {
    applySettings(parseEnvFile(text), process.env);
  } catch (error) {
    console.error(`The settings file ${file} has a problem. ${error.message}`);
    process.exit(1);
  }
  process.env.NODE_ENV = "production";
  // Only the Cloudflare Tunnel on the same machine talks to the app.
  process.env.HOSTNAME = process.env.LISTEN_HOST || "127.0.0.1";
  process.env.PORT = process.env.PORT || "3000";
  require(path.join(__dirname, "server.js"));
}

if (require.main === module) main();

module.exports = { parseEnvFile, applySettings, settingsFile };
