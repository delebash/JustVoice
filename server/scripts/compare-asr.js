// SPDX-License-Identifier: MIT
// One transcription and one word alignment through the speech runtime's recogniser, from
// Python and from this port (wave B of step 5) — the transcription JSON request and the
// aligner's multipart upload, against the same installed runtime and the same downloaded
// Qwen3-ASR model, on COPIES of JustVoice's dev database (the speech cache through a junction,
// read only). The input is a WAV made by the JS speech path (kokoro, fixed seed). Both answers
// must be equal. Refuses to run beside the app (ports / runtime processes), reports graphics
// memory before and after and that no runtime process is left.
//
//   node scripts/node24.js server/scripts/compare-asr.js      (JV_PYTHON overrides)

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
const TEXT = "The ferry was late again, and nobody on the quay looked surprised.";

const dir = mkdtempSync(join(tmpdir(), "jv-compare-asr-"));
process.env.JUST_AI_HOME = join(dir, "family");
process.env.LLM_RUNNER_CACHE = join(dir, "user-cache");
delete process.env.JUSTVOICE_AUDIOCPP_BUILD;

const procs = await import("@delebash/llm-runner/platform/procs");
const vramMb = async () => String((await procs.run(["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader"], { timeout: 20 })).stdout).trim();
const runtimeProcesses = async () =>
  String((await procs.run(["tasklist", "/FO", "CSV", "/NH"], { timeout: 30 })).stdout)
    .split(/\r?\n/)
    .filter((l) => /audiocpp_server|llama-server/i.test(l));
const listening = async () =>
  String((await procs.run(["netstat", "-ano", "-p", "TCP"], { timeout: 30 })).stdout)
    .split(/\r?\n/)
    .filter((l) => /:(17494|17495|8742|1430|1431)\s/.test(l) && /LISTENING/.test(l));

const busy = [...(await listening()), ...(await runtimeProcesses())];
if (busy.length) {
  console.log(`SKIPPED — JustVoice (or a runtime) is running:\n  ${busy.join("\n  ")}`);
  process.exit(2);
}
console.log(`graphics memory before: ${await vramMb()}`);

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

const llmDb = await import("@delebash/llm-runner/llm/db");
const session = await import("../src/database/session.js");
const { AppState, setState } = await import("../src/app_state.js");
const manager = await import("../src/engines/manager.js");
const runtime = await import("../src/engines/audiocpp/runtime.js");
session.initDb(jsData);
llmDb.configureStorage(session.cfg.handle);
setState(new AppState(jsData));
await runtime.ensureHardware();

// The input: one line from the JS speech path.
let mgr = manager.getManager();
let wav;
try {
  await mgr.load("kokoro", { variant: "kokoro-82m-q8" });
  [wav] = await mgr.synth("kokoro", { voice_id: "af_heart", text: TEXT, language: "en-US", seed: 42 });
} finally {
  await manager.shutdownManager();
}
const wavPath = join(dir, "line.wav");
writeFileSync(wavPath, wav);

// Python.
const r = await procs.run([PY, join(HERE, "compare-asr.py"), pyData, wavPath, TEXT, join(dir, "py.json")], {
  cwd: SERVER,
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  timeout: 900,
});
if (r.returncode !== 0) throw new Error(`compare-asr.py failed:\n${r.stderr}`);
const py = JSON.parse(readFileSync(join(dir, "py.json"), "utf8"));
console.log(`after python: ${(await runtimeProcesses()).length ? "a runtime process is left" : "no runtime process left"}; graphics memory ${await vramMb()}`);

// This port.
mgr = manager.getManager();
const b64 = Buffer.from(wav).toString("base64");
let js;
try {
  await mgr.load("asr", { variant: "qwen3-asr-1.7b-q8" });
  const heard = await mgr.transcribe({ wav_b64: b64, language: "en" });
  const words = await mgr.align({ wav_b64: b64, text: TEXT, language: "en" });
  js = { text: heard, words };
} finally {
  await manager.shutdownManager();
}
await new Promise((res) => setTimeout(res, 1500));
console.log(`after js: ${(await runtimeProcesses()).length ? "a runtime process is left" : "no runtime process left"}; graphics memory ${await vramMb()}`);
console.log(`python heard: ${py.text} | ${py.words.length} words, last ends ${py.words.at(-1)?.end}`);
console.log(`js heard:     ${js.text} | ${js.words.length} words, last ends ${js.words.at(-1)?.end}`);
const same = JSON.stringify(py) === JSON.stringify(js);
console.log(same ? "transcription and word times identical" : `DIFFERENT\n  python ${JSON.stringify(py)}\n  js     ${JSON.stringify(js)}`);
console.log(`(${dir})`);
process.exit(same ? 0 : 1);
