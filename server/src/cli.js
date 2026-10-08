// SPDX-License-Identifier: MIT
// The domain CLI — dev utilities (the port of justvoice/cli.py, a typer app):
//
//   node scripts/node24.js server/src/cli.js <command>
//     default-settings   print the seed settings
//     open-api           (Python printed FastAPI's OpenAPI document — the JavaScript server
//                        has none; the command says so and exits 1)
//     self-test          GET /v1/health on the server the default settings name
//
// The SERVER entry is serve.js (one door per purpose). Typer's boxed help is written plainly.

import path from "node:path";
import { pathToFileURL } from "node:url";
import * as http from "@delebash/llm-runner/platform/http";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { construct, floatify, Settings } from "./models.js";

export const PROG = "justvoice-cli";

const COMMANDS = {
  "default-settings": "Print the seed settings (defaults).",
  "open-api": "Generate the OpenAPI spec (writes to stdout).",
  "self-test": "Run smoke tests against a booted server.",
};

const help = () =>
  `Usage: ${PROG} [OPTIONS] COMMAND [ARGS]...\n\n JustVoice domain CLI\n\nOptions:\n  --help  Show this message and exit.\n\nCommands:\n${Object.entries(
    COMMANDS,
  )
    .map(([c, d]) => `  ${c.padEnd(17)} ${d}`)
    .join("\n")}\n`;

/** Print the seed settings (defaults) — `json.dumps(Settings().model_dump(), indent=2)`. */
export function defaultSettings() {
  return pyJson(floatify(Settings, construct(Settings, {})), { indent: 2 });
}

/** GET /v1/health on the default settings' host/port → [exit code, output lines]. */
export async function selfTest() {
  const s = construct(Settings, {});
  const url = `http://${s.server.host}:${s.server.port}`;
  const out = [];
  try {
    const r = await http.fetch(`${url}/v1/health`, { timeoutMs: 5000 });
    const text = await r.text();
    out.push(`GET ${url}/v1/health → ${r.status}`);
    // httpx's raise_for_status
    if (r.status >= 400) throw new Error(`${r.status >= 500 ? "Server" : "Client"} error '${r.status}' for url '${url}/v1/health'`);
    out.push(pyJson(JSON.parse(text), { indent: 2 }));
    return [0, out];
  } catch (e) {
    out.push(`FAILED: ${e?.message ?? e}`);
    return [1, out];
  }
}

export async function main(argv = process.argv.slice(2)) {
  const [cmd] = argv;
  if (cmd === undefined) {
    process.stdout.write(help());
    return process.exit(2);
  }
  if (cmd === "--help") {
    process.stdout.write(help());
    return process.exit(0);
  }
  if (cmd === "default-settings") {
    process.stdout.write(`${defaultSettings()}\n`);
    return process.exit(0);
  }
  if (cmd === "open-api") {
    process.stderr.write("open-api: the JavaScript server has no OpenAPI document (FastAPI generated it).\n");
    return process.exit(1);
  }
  if (cmd === "self-test") {
    const [code, lines] = await selfTest();
    (code ? process.stderr : process.stdout).write(`${lines.join("\n")}\n`);
    return process.exit(code);
  }
  process.stderr.write(`Usage: ${PROG} [OPTIONS] COMMAND [ARGS]...\nTry '${PROG} --help' for help.\n\nError: No such command '${cmd}'.\n`);
  return process.exit(2);
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (entry === import.meta.url) await main();
