// SPDX-License-Identifier: MIT
// `justvoice-server` — run the server standalone, and as the desktop app's server process (the
// port of justvoice/serve.py and justvoice/__main__.py — this file IS the module entry).
//
//   node scripts/node24.js server/src/serve.js serve [--host H] [--port P] [--data-dir D] [--log-level L]
//
// The family entry shape (docgen's serve was the donor): `serve` is the canonical form and the
// bare form works too. Host/port default from the SETTINGS STORE (the no-hardcoded-tunables law),
// with CLI/env overrides (JUSTVOICE_HOST, JUSTVOICE_PORT, JUSTVOICE_DATA_DIR,
// JUSTVOICE_LOG_LEVEL). The command line is read the way Python's argparse read it — the same
// help, the same errors, exit 2 on a bad one — then the kit's runServer runs the server (it
// posts `ready` to the desktop shell, stops on SIGINT/SIGTERM, the shell's `stop`, or POST
// /v1/shutdown). A relative --data-dir is made absolute: each engine runs as its own process
// with its own working directory, so a relative path would resolve somewhere else entirely by
// the time an engine looks for its weights (hit 2026-08-22). Domain subcommands live in cli.js.
//
// Seeding stays HERE, not in createApp(), on purpose: the test suite's createApp(tmp) apps start
// from an empty database (the family's named winner for the seeding call-site).

import path from "node:path";
import { pathToFileURL } from "node:url";
import { runServer } from "@delebash/llm-runner/platform";
import { addSink, getLogger, LEVELS, setLevel } from "@delebash/llm-runner/platform/log";
import { pyInt } from "@delebash/llm-runner/platform/py";
import { createApp } from "./app.js";
import { getState } from "./app_state.js";
import { seedWorkspace } from "./database/seed.js";
import * as leftovers from "./engines/leftovers.js";
import { defaultDataDir } from "./paths.js";
import { networkHost } from "./sync.js";
import { VERSION } from "./version.js";

export const PROG = "justvoice-server";
const USAGE = `usage: ${PROG} [-h] [--host HOST] [--port PORT] [--data-dir DATA_DIR]
                        [--log-level LOG_LEVEL]
                        [{serve}]
`;
const help = () => `${USAGE}
JustVoice server

positional arguments:
  {serve}

options:
  -h, --help            show this help message and exit
  --host HOST           default: the settings store's server.host
  --port PORT           default: the settings store's server.port
  --data-dir DATA_DIR   default: ${defaultDataDir()}
  --log-level LOG_LEVEL
`;

/** argparse's error: the usage, then `<prog>: error: <message>`, exit 2. */
export class UsageError extends Error {}

const LONG = ["--help", "--host", "--port", "--data-dir", "--log-level"];

/** argparse's long-option abbreviation: an exact name, else a unique prefix. */
function matchLong(name) {
  if (LONG.includes(name)) return name;
  const hits = LONG.filter((o) => o.startsWith(name));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new UsageError(`ambiguous option: ${name} could match ${hits.join(", ")}`);
  return null;
}

/**
 * The command line as Python's argparse read it: `{help: true}`, or `{host, port, dataDir,
 * logLevel}` with the env defaults filled in (null = the settings store's). Throws UsageError
 * with argparse's words.
 */
export function parseCli(argv, env = process.env) {
  const out = {
    host: env.JUSTVOICE_HOST ?? null,
    port: env.JUSTVOICE_PORT ? env.JUSTVOICE_PORT : null,
    dataDir: env.JUSTVOICE_DATA_DIR ?? null,
    logLevel: env.JUSTVOICE_LOG_LEVEL ?? "info",
  };
  let portGiven = false;
  const positionals = [];
  const unrecognized = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-h") return { help: true };
    if (a.startsWith("--") && a !== "--") {
      const eq = a.indexOf("=");
      const name = matchLong(eq < 0 ? a : a.slice(0, eq));
      if (name === null) {
        unrecognized.push(a);
        continue;
      }
      if (name === "--help") return { help: true };
      let value;
      if (eq >= 0) value = a.slice(eq + 1);
      else if (i + 1 < argv.length && !argv[i + 1].startsWith("-")) value = argv[++i];
      else throw new UsageError(`argument ${name}: expected one argument`);
      if (name === "--host") out.host = value;
      else if (name === "--port") {
        out.port = value;
        portGiven = true;
      } else if (name === "--data-dir") out.dataDir = value;
      else out.logLevel = value;
    } else if (a.startsWith("-") && a !== "-") {
      unrecognized.push(a);
    } else {
      positionals.push(a);
    }
  }
  if (positionals.length && positionals[0] !== "serve") {
    throw new UsageError(`argument command: invalid choice: '${positionals[0]}' (choose from serve)`);
  }
  unrecognized.push(...positionals.slice(1));
  if (unrecognized.length) throw new UsageError(`unrecognized arguments: ${unrecognized.join(" ")}`);
  if (out.port !== null) {
    try {
      out.port = pyInt(out.port);
    } catch (e) {
      // A bad JUSTVOICE_PORT failed Python's `int()` before argparse ran (a ValueError);
      // a bad --port is argparse's own error.
      if (!portGiven) throw e;
      throw new UsageError(`argument --port: invalid int value: '${out.port}'`);
    }
  }
  return out;
}

const LOG_LEVELS = { DEBUG: LEVELS.DEBUG, INFO: LEVELS.INFO, WARNING: LEVELS.WARNING, WARN: LEVELS.WARNING, ERROR: LEVELS.ERROR, CRITICAL: LEVELS.CRITICAL };

/** logging's default `asctime`: local time, "2026-10-08 12:34:56,789". */
function asctime(created) {
  const d = new Date(created * 1000);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())},${p(d.getMilliseconds(), 3)}`;
}

/** The entry: read the command line, then run the server until it is stopped. */
export async function main(argv = process.argv.slice(2)) {
  let args;
  try {
    args = parseCli(argv);
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    process.stderr.write(`${USAGE}${PROG}: error: ${e.message}\n`);
    return process.exit(2);
  }
  if (args.help) {
    process.stdout.write(help());
    return process.exit(0);
  }
  const level = LOG_LEVELS[String(args.logLevel).toUpperCase()];
  if (level === undefined) throw new Error(`Unknown level: '${String(args.logLevel).toUpperCase()}'`);
  setLevel(level);
  // logging.basicConfig: every record at the level and above to stderr, in Python's format.
  addSink((r) => process.stderr.write(`${asctime(r.created)} [${r.levelname}] ${r.name}: ${r.msg}${r.exc ? `\n${r.exc}` : ""}\n`));

  // runServer reads --host/--port only to listen; the values here are already resolved.
  const runArgv = ["serve", ...(args.dataDir ? ["--data-dir", args.dataDir] : [])];
  const handle = await runServer({
    argv: runArgv,
    envPrefix: null,
    build: async ({ dataDir }) => {
      // ABSOLUTE, always (runServer resolved --data-dir); the family ladder otherwise.
      const dd = dataDir ? path.resolve(dataDir) : defaultDataDir();
      const app = await createApp(dd);
      await seedWorkspace();
      // Engines a dead server left running still hold their GPU memory; stop them before this
      // server starts its own (2026-09-29). Only this install's engines, and only those whose
      // server is gone — engines/leftovers.js.
      try {
        await leftovers.stopLeftoverEngines("startup sweep");
      } catch (e) {
        getLogger("justvoice.serve").warning(`leftover-engine sweep failed: ${e?.message ?? e}`);
      }
      // CLI/env overrides sit on top of the settings-derived host/port; sync's "let my other
      // devices connect" (with a pairing token) widens the settings' host to the network
      // (server/src/sync.js).
      const settings = getState().settings.get();
      const host = args.host || (networkHost() ?? settings.server.host);
      const port = args.port || settings.server.port;
      process.stdout.write(`JustVoice ${VERSION} — http://${host}:${port}/  (data: ${dd})\n`);
      return { app, host, port };
    },
  });
  // POST /v1/shutdown ends the server through this handle (uvicorn's `should_exit`).
  handle.app.serverHandle = { stop: handle.stop };
  return handle;
}

// Run when started as a program: by the desktop shell (a utilityProcess has `parentPort`), or
// as `node …/serve.js` — not when a test imports it.
const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (process.parentPort || entry === import.meta.url) await main();
