// SPDX-License-Identifier: MIT
// The speech-engine layer's parity check (wave B of step 5): Python's engine layer and this
// port each read their own COPY of JustVoice's dev database (src-tauri/target/debug/data —
// read only: only justvoice.db is copied; the speech models are reached through a junction
// to the real speech cache, never copied or written), against the same installed runtime
// (Python's source-tree runtime under server/justvoice/engines/audiocpp — the JS data root's
// `engines-runtime` is a junction to that folder). Every read answer — manifests, the model
// catalog, capability rows, the manager's per-variant answers (split sizes, CPU speed, price,
// placement), the runtime's install answers, runtime options, the speech cache, the entries a
// load registers, the request mapping for a fixed set of synth bodies (the JSON text sent)
// — is dumped by both and compared, key order included; paths are compared relative to each
// side's runtime and data roots.
//
//   node scripts/node24.mjs server/scripts/compare-engines.mjs [--dev]      (JV_PYTHON overrides)
//
// --dev: both sides run as under `npm run dev` — JUSTVOICE_AUDIOCPP_BUILD names a stand-in
// development build (a bin folder with the server file, its CMake cache and jv-dev-build.json
// for commit a2601edf, clean), so the dev build is read, every feature is on, and the
// measured peaks the dev database holds for that build price their models.

import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = resolve(HERE, "..");
const REPO = resolve(SERVER, "..");
const PY = process.env.JV_PYTHON || join(SERVER, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const DEV_DATA = join(REPO, "src-tauri", "target", "debug", "data");
const PY_RUNTIME = join(SERVER, "justvoice", "engines");

const dir = mkdtempSync(join(tmpdir(), "jv-compare-engines-"));
process.env.JUST_AI_HOME = join(dir, "family");
process.env.LLM_RUNNER_CACHE = join(dir, "user-cache");
delete process.env.JUSTVOICE_AUDIOCPP_BUILD;
if (process.argv.includes("--dev")) {
  const bin = join(dir, "audio.cpp", "build", "jv-dev", "bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, process.platform === "win32" ? "audiocpp_server.exe" : "audiocpp_server"), "x");
  writeFileSync(join(bin, "jv-dev-build.json"), JSON.stringify({ commit: "a2601edf", dirty: false, source: "..\\audio.cpp" }));
  writeFileSync(join(dirname(bin), "CMakeCache.txt"), "ENGINE_ENABLE_CUDA:BOOL=ON\nENGINE_ENABLE_VULKAN:BOOL=OFF\n");
  process.env.JUSTVOICE_AUDIOCPP_BUILD = bin;
}

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

const procs = await import("@delebash/llm-runner/platform/procs");
const pyOut = join(dir, "py.json");
const r = await procs.run([PY, join(HERE, "compare-engines.py"), pyData, pyOut], {
  cwd: SERVER,
  env: { ...process.env, PYTHONIOENCODING: "utf-8" },
  timeout: 300,
});
if (r.returncode !== 0) throw new Error(`compare-engines.py failed:\n${r.stderr}`);

// ── the JS side ─────────────────────────────────────────────────────────────────
const llmDb = await import("@delebash/llm-runner/llm/db");
const session = await import("../src/database/session.js");
const { AppState, setState } = await import("../src/app_state.js");
const manager = await import("../src/engines/manager.js");
const modelCatalog = await import("../src/engines/model_catalog.js");
const capability = await import("../src/engines/capability_details.js");
const leftovers = await import("../src/engines/leftovers.js");
const runtime = await import("../src/engines/audiocpp/runtime.js");
const release = await import("../src/engines/audiocpp/release.js");
const slot = await import("../src/engines/audiocpp/slot.js");
const espeak = await import("../src/engines/audiocpp/espeak.js");
const japanese = await import("../src/engines/audiocpp/japanese.js");
const runtimeOptions = await import("../src/engines/audiocpp/runtime_options.js");
const speechCache = await import("../src/speech_cache.js");
const { EngineManager, enginesRuntimeRoot } = manager;
const SAMPLES = JSON.parse(readFileSync(join(HERE, "compare-engines-samples.json"), "utf8"));

session.initDb(jsData);
llmDb.configureStorage(session.cfg.handle);
setState(new AppState(jsData));
await runtime.ensureHardware();

const errName = (e) => `${e?.name ?? "Error"}: ${e?.message ?? e}`;
async function attempt(fn) {
  try {
    return { ok: await fn() };
  } catch (e) {
    return { error: errName(e) };
  }
}
const plain = (v) => JSON.parse(JSON.stringify(v ?? null, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x)));

const mgr = new EngineManager();
const manifests = mgr.manifests();
const out = { runtime_root: enginesRuntimeRoot(), data_dir: jsData };

const engines = {};
for (const [eid, m] of manifests) {
  const mod = m.module;
  engines[eid] = {
    id: m.id,
    name: m.name,
    description: m.description,
    license: m.license,
    weights_license: m.weightsLicense,
    kind: m.kind,
    kinds: m.kinds,
    capabilities: m.capabilities,
    requirements: m.requirements,
    static_voices: m.staticVoices,
    default_variant_id: m.defaultVariantId,
    isolation: m.isolation,
    supported_oses: m.supportedOses,
    deprecated: m.deprecated,
    supports_current_os: m.supportsCurrentOs(),
    uses_audiocpp: m.usesAudiocpp,
    is_installed: m.isInstalled,
    terms: mod.TERMS ?? null,
    variants: mod.VARIANTS ?? [],
    pending: mod.PENDING_VARIANTS ?? [],
    audiocpp_voice: mod.AUDIOCPP_VOICE ?? null,
  };
}
out.engines = plain(engines);

const catalog = {};
for (const eid of manifests.keys()) {
  const variants = modelCatalog.modelsFor(eid);
  const dv = modelCatalog.defaultVariantFor(eid);
  catalog[eid] = {
    models: variants,
    default: dv ? dv.id : null,
    sources: Object.fromEntries(variants.map((v) => [v.id, modelCatalog.sourcesFor(eid, v.id)])),
  };
}
out.catalog = plain(catalog);
out.capabilities = plain(capability.CAPABILITY_DETAILS);
const lookups = {};
for (const m of manifests.values()) {
  for (const row of [...(m.module.VARIANTS || []), ...(m.module.PENDING_VARIANTS || [])]) {
    const hit = capability.lookup(row.id);
    lookups[row.id] = hit ? hit.engine_id : null;
  }
}
for (const probe of ["chatterbox", "qwen3-cv", "totally-unknown-engine", "chatterbox-multilingual-v2-q8"]) {
  const hit = capability.lookup(probe);
  lookups[probe] = hit ? hit.engine_id : null;
}
out.lookups = lookups;

const exe = runtime.installedExe();
const backend = exe ? runtime.backendOf(exe) : null;
const featureNames = [...Object.keys(release.FEATURES), "no_such_feature"];
const sa = runtime.selectedAsset();
const ep = espeak.paths(enginesRuntimeRoot());
out.runtime = plain({
  configured_backend: runtime.configuredBackend(),
  configured_gpu: runtime.configuredGpu(),
  physical_cores: runtime.physicalCores(),
  cpu_threads: runtime.cpuThreads(),
  gpu_threads: runtime.gpuThreads(),
  start_timeout: runtime.startTimeout(),
  request_timeout: runtime.requestTimeout(),
  cpu_min_realtime: runtime.cpuMinRealtime(),
  available_backends: runtime.availableBackends(),
  selected_asset: sa,
  installed_exe: exe,
  installed_tag: runtime.installedTag(),
  backend,
  has_feature: Object.fromEntries(featureNames.map((f) => [f, runtime.hasFeature(f)])),
  pinned_has: Object.fromEntries(featureNames.map((f) => [f, release.pinnedHas(f)])),
  binaries: release.binaries(),
  espeak_paths: ep ? ep.map(String) : null,
  dictionary_dir: japanese.dictionaryDir(enginesRuntimeRoot()),
  child_env: Object.fromEntries(Object.entries(runtime._childEnv()).filter(([k]) => k.startsWith("AUDIOCPP_"))),
  managed_runtime: slot.managedRuntime(),
  leftover_roots: leftovers._audiocppRoots(),
});

const perVariant = {};
for (const [eid, m] of manifests) {
  const kind = m.kind;
  for (const row of m.module.VARIANTS || []) {
    const vid = row.id;
    perVariant[`${eid}/${vid}`] = plain({
      split_chars_for: mgr.splitCharsFor(eid, vid),
      effective_split: mgr.effectiveSplit(eid, vid),
      cpu_speed: mgr.cpuSpeed(kind, eid, vid),
      price_backend: mgr._priceMb(kind, eid, vid, backend),
      price_cpu: mgr._priceMb(kind, eid, vid, "cpu"),
      placement: await attempt(() => mgr.placementFor(m, kind, vid)),
      user_placement: EngineManager._userPlacement(eid, vid),
      on_disk: speechCache.variantOnDisk(jsData, eid, vid),
      disk_bytes: speechCache.variantDiskBytes(jsData, eid, vid),
      runtime_options: runtimeOptions.describe(eid, row),
      session_options: runtimeOptions.sessionOptionsFor(eid, row),
      entries: await attempt(() => slot._entriesFor(m, row).map((e) => e.toConfig())),
      variant_spec: (slot.variantSpec(m, vid) || {}).id ?? null,
    });
  }
}
out.per_variant = perVariant;

// The same placements with an AI model on the card (6.8 GB booked, as gemma measured).
const arbiter = await import("@delebash/llm-runner/runner/arbiter");
arbiter.getArbiter().reserve("llm:gemma", 6800, { kind: "llm", evictFn: () => {}, source: "measured" });
const beside = {};
for (const [eid, m] of manifests) {
  for (const row of m.module.VARIANTS || []) beside[`${eid}/${row.id}`] = plain(await attempt(() => mgr.placementFor(m, m.kind, row.id)));
}
arbiter.getArbiter().release("llm:gemma");
out.placement_beside_ai = beside;

out.manager = plain({
  status: Object.fromEntries([...manifests.keys()].map((e) => [e, mgr.status(e)])),
  resolved_default: Object.fromEntries([...manifests.keys()].map((e) => [e, mgr.resolvedDefaultVariant(e)])),
  any_on_disk: Object.fromEntries([...manifests.keys()].map((e) => [e, speechCache.anyVariantOnDisk(jsData, e)])),
  current_id: mgr.currentId(),
  runtime_build: manager._runtimeBuild(),
  installed_entries_tts: await attempt(() => slot.installedEntries("tts").map((e) => e.toConfig())),
  installed_entries_stt: await attempt(() => slot.installedEntries("stt").map((e) => e.toConfig())),
});

const requests = [];
for (const s of SAMPLES) {
  const m = manifests.get(s.engine);
  const row = [...m.module.VARIANTS, ...(m.module.PENDING_VARIANTS || [])].find((x) => x.id === s.variant);
  requests.push({
    name: s.name,
    ...(await attempt(() => {
      const req = slot.toSpeechRequest(row, s.body);
      return { req, text: runtime._jsonBody(req).toString("utf8"), features: slot.featuresNeeded(row, s.body) };
    })),
  });
}
out.requests = plain(requests);
out.calibration = Object.fromEntries([0, 39, 40, 120, 128, 200, 240, 400, 800, 5000].map((n) => [String(n), slot.calibrationText(n)]));
out.refusals = Object.fromEntries([...Object.keys(release.FEATURES), "mystery"].map((f) => [f, slot.featureRefusal(f)]));
writeFileSync(join(dir, "js.json"), JSON.stringify(out, null, 1));

// ── compare ─────────────────────────────────────────────────────────────────────
const py = JSON.parse(readFileSync(pyOut, "utf8"));
/** Each side's runtime and data roots as placeholders, in every spelling a path takes. */
function normalise(doc) {
  let text = JSON.stringify(doc);
  const pairs = [
    [doc.runtime_root, "<RT>"],
    [doc.data_dir, "<DATA>"],
  ];
  for (const [p, tag] of pairs) {
    for (const form of [p, p.replaceAll("\\", "/"), p.toLowerCase(), p.replaceAll("\\", "/").toLowerCase()]) {
      text = text.split(JSON.stringify(form).slice(1, -1)).join(tag);
    }
  }
  return JSON.parse(text);
}
const a = normalise(py);
const b = normalise(out);
const diffs = [];
function walk(x, y, at) {
  if (x !== null && y !== null && typeof x === "object" && typeof y === "object") {
    if (Array.isArray(x) !== Array.isArray(y)) {
      diffs.push(`${at}: array vs object`);
      return;
    }
    const kx = Object.keys(x);
    const ky = Object.keys(y);
    if (!Array.isArray(x) && kx.join("\u0001") !== ky.join("\u0001")) {
      const onlyA = kx.filter((k) => !ky.includes(k));
      const onlyB = ky.filter((k) => !kx.includes(k));
      diffs.push(`${at}: keys differ${onlyA.length ? ` (python only: ${onlyA})` : ""}${onlyB.length ? ` (js only: ${onlyB})` : ""}${!onlyA.length && !onlyB.length ? " (order)" : ""}`);
    }
    for (const k of new Set([...kx, ...ky])) walk(x[k], y[k], `${at}.${k}`);
    return;
  }
  if (x !== y) diffs.push(`${at}: python ${JSON.stringify(x)} | js ${JSON.stringify(y)}`);
}
walk(a, b, "$");
let leaves = 0;
(function count(v) {
  if (v !== null && typeof v === "object") for (const k of Object.keys(v)) count(v[k]);
  else leaves += 1;
})(a);
console.log(`compared ${leaves} values in ${Object.keys(a).length} sections (${dir})`);
for (const d of diffs.slice(0, 80)) console.log(`  DIFF ${d}`);
console.log(diffs.length ? `${diffs.length} difference(s)` : "0 differences");
process.exit(diffs.length ? 1 : 0);
