// SPDX-License-Identifier: MIT
// One real line through the speech runtime, from Python and from this port (wave B of step
// 5): each side boots on its own COPY of JustVoice's dev database (data
// — only justvoice.db is copied; the speech models are reached through a junction to the real
// speech cache), loads the same model through its engine manager (placement, admission, the
// calibrating warm-up, the runtime process started through the kit's spawn door) against the
// same installed runtime (the source-tree runtime under server/justvoice/engines/audiocpp —
// the JS data root's `engines-runtime` is a junction to that folder), speaks one line with a
// fixed seed, and stops everything. The WAVs are compared byte for byte (else length and
// peak). Before anything starts it checks nothing listens on JustVoice's ports and no
// audiocpp_server / llama-server runs — and refuses to run beside the app; afterwards it
// checks no runtime process is left, and reports graphics memory before and after.
//
//   node scripts/node24.js server/scripts/compare-synth.js [engine] [variant]
//      (default: kokoro kokoro-82m-q8; JV_PYTHON overrides)

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const REPO = resolve(SERVER, "..");
const PY = process.env.JV_PYTHON || join(SERVER, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const DEV_DATA = join(REPO, "data");
const PY_RUNTIME = join(SERVER, "justvoice", "engines");
const [engine = "kokoro", variant = "kokoro-82m-q8"] = process.argv.slice(2);
const REQUEST = {
  engine,
  variant,
  body: { voice_id: engine === "kitten" ? "kitten_bella" : "af_heart", text: "The ferry was late again, and nobody on the quay looked surprised.", language: "en-US", seed: 42 },
};

const dir = mkdtempSync(join(tmpdir(), "jv-compare-synth-"));
process.env.JUST_AI_HOME = join(dir, "family");
process.env.LLM_RUNNER_CACHE = join(dir, "user-cache");
delete process.env.JUSTVOICE_AUDIOCPP_BUILD;

const procs = await import("@delebash/llm-runner/platform/procs");
async function vramMb() {
  const r = await procs.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader"], { timeout: 20 });
  return String(r.stdout).trim();
}
async function runtimeProcesses() {
  const r = await procs.run(["tasklist", "/FO", "CSV", "/NH"], { timeout: 30 });
  return String(r.stdout)
    .split(/\r?\n/)
    .filter((l) => /audiocpp_server|llama-server/i.test(l));
}
async function listening() {
  const r = await procs.run(["netstat", "-ano", "-p", "TCP"], { timeout: 30 });
  return String(r.stdout)
    .split(/\r?\n/)
    .filter((l) => /:(17494|17495|8742|1430|1431)\s/.test(l) && /LISTENING/.test(l));
}

// ── the guard: never beside the user's app ───────────────────────────────────
const busy = [...(await listening()), ...(await runtimeProcesses())];
if (busy.length) {
  console.log(`SKIPPED — JustVoice (or a runtime) is running:\n  ${busy.join("\n  ")}`);
  process.exit(2);
}
const vramBefore = await vramMb();
console.log(`graphics memory before: ${vramBefore}`);

function dataCopy(name, { runtime = false } = {}) {
  const d = join(dir, name);
  mkdirSync(d, { recursive: true });
  copyFileSync(join(DEV_DATA, "justvoice.db"), join(d, "justvoice.db"));
  symlinkSync(join(DEV_DATA, "speech-cache"), join(d, "speech-cache"), "junction");
  if (runtime) symlinkSync(PY_RUNTIME, join(d, "engines-runtime"), "junction");
  return d;
}
const pyData = dataCopy("py-data");
const jsData = dataCopy("js-data", { runtime: true });
writeFileSync(join(dir, "request.json"), JSON.stringify(REQUEST));

// ── Python ──────────────────────────────────────────────────────────────────────
const r = await procs.run(
  [PY, join(HERE, "compare-synth.py"), pyData, join(dir, "request.json"), join(dir, "py.wav"), join(dir, "py.json")],
  { cwd: SERVER, env: { ...process.env, PYTHONIOENCODING: "utf-8" }, timeout: 900 },
);
if (r.returncode !== 0) throw new Error(`compare-synth.py failed:\n${r.stderr}`);
const leftPy = await runtimeProcesses();
const brief = (x) => JSON.stringify({ ...x, loaded: { ...x.loaded, voices: `[${x.loaded.voices.length} voices]` } });
console.log(`python: ${brief(JSON.parse(readFileSync(join(dir, "py.json"), "utf8")))}`);
console.log(`after python: ${leftPy.length ? leftPy.join(" | ") : "no runtime process left"}; graphics memory ${await vramMb()}`);

// ── this port ───────────────────────────────────────────────────────────────────
const llmDb = await import("@delebash/llm-runner/llm/db");
const session = await import("../src/database/session.js");
const { AppState, setState } = await import("../src/app_state.js");
const manager = await import("../src/engines/manager.js");
const runtime = await import("../src/engines/audiocpp/runtime.js");
session.initDb(jsData);
llmDb.configureStorage(session.cfg.handle);
setState(new AppState(jsData));
await runtime.ensureHardware();
const mgr = manager.getManager();
let jsWav;
let info;
try {
  const t0 = performance.now();
  const loaded = await mgr.load(engine, { variant });
  const t1 = performance.now();
  const [wav, headers] = await mgr.synth(engine, REQUEST.body);
  const t2 = performance.now();
  jsWav = Buffer.from(wav);
  info = {
    loaded,
    headers,
    device: mgr.resolvedDeviceFor(engine),
    placement_reason: mgr.placementReasonFor(engine),
    variant: mgr.currentVariantId(engine),
    load_s: Math.round((t1 - t0) / 10) / 100,
    synth_s: Math.round((t2 - t1) / 10) / 100,
  };
} finally {
  await manager.shutdownManager();
}
writeFileSync(join(dir, "js.wav"), jsWav);
console.log(`js: ${brief(info)}`);
await new Promise((res) => setTimeout(res, 1500));
const leftJs = await runtimeProcesses();
console.log(`after js: ${leftJs.length ? leftJs.join(" | ") : "no runtime process left"}; graphics memory ${await vramMb()}`);

// ── compare ─────────────────────────────────────────────────────────────────────
const pyWav = readFileSync(join(dir, "py.wav"));
function stats(w) {
  const data = w.subarray(44);
  let peak = 0;
  for (let i = 0; i + 1 < data.length; i += 2) peak = Math.max(peak, Math.abs(data.readInt16LE(i)));
  return { bytes: w.length, rate: w.readUInt32LE(24), channels: w.readUInt16LE(22), seconds: data.length / 2 / w.readUInt32LE(24), peak };
}
if (pyWav.equals(jsWav)) console.log(`WAVs byte-identical: ${JSON.stringify(stats(pyWav))}`);
else console.log(`WAVs differ: python ${JSON.stringify(stats(pyWav))} | js ${JSON.stringify(stats(jsWav))}`);
console.log(`(${dir})`);
process.exit(0);
