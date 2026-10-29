#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Re-takes the two snapshots the in-app mocks read (CLAUDE.md "A mock is built in the app itself";
// "production minus the plumbing"): the server's own answers, computed in-process from this
// checkout's server code on an app state over a temp data folder — no HTTP server, no speech
// runtime, no model loads, nothing on the GPU, nothing in the app's data folder.
//
//   src/services/mock/speechEnginesSnapshot.json   #/mock/speech-engines: every managed engine as
//       /v1/engines lists it, and its models as /v1/engines/{id}/models answers them — how each is
//       directed, its load options (each set stored once, in `load_option_sets`) — without this
//       machine's state (on disk, loaded, where it runs, measured), which speechEnginesMock.js
//       makes up.
//   src/services/mock/liveSnapshot.json            #/mock/personas: the seven engines described by
//       our own files — /v1/engines/capabilities, /v1/voices (presets), /v1/engines (terms),
//       /v1/effects/catalog, what each model speaks, and its versions (the rows of
//       /v1/voices/{id}/model-version).
//
// Run it when what the mocks show has moved under them: after scripts/audiocpp-catalog.js
// rewrites catalog.json, after a family's notes (engines/audiocpp/curated/) or the capability rows
// change, or when a mock reads a field the snapshot doesn't carry yet. The diff of the two JSON
// files is what the mocks will show differently. On Electron's Node, as the server runs (its SQLite
// module is built for it):
//
//   node scripts/node24.js scripts/mock-snapshots.js
//
// (Added 2026-10-16, TASKS "Slice 5's findings: what each one gets" 6.)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const SERVER = path.join(ROOT, "server", "src");
const OUT = path.join(ROOT, "src", "services", "mock");

// A temp data folder, and the pinned release rather than a development build.
const dataDir = mkdtempSync(path.join(tmpdir(), "jv-mock-snapshots-"));
process.env.JUSTVOICE_DATA_DIR = dataDir;
delete process.env.JUSTVOICE_AUDIOCPP_BUILD;

// The kit resolved as the server resolves it, so the database it configures is the server's.
const serverRequire = createRequire(path.join(SERVER, "app_state.js"));
const kit = (spec) => import(pathToFileURL(serverRequire.resolve(spec)).href);
const server = (rel) => import(pathToFileURL(path.join(SERVER, rel)).href);

const session = await server("database/session.js");
const llmDb = await kit("@delebash/core/llm/db");
const appState = await server("app_state.js");
session.initDb(dataDir);
llmDb.configureStorage(session.cfg.handle);
llmDb.createAll(session.cfg.handle);
const st = new appState.AppState(dataDir);
appState.setState(st);

const modelCatalog = await server("engines/model_catalog.js");
const enginesApi = await server("api/engines_api.js");
const voicesApi = await server("api/voices_api.js");
const runtimeOptions = await server("engines/audiocpp/runtime_options.js");
const caps = await server("engines/capability_details.js");
const vmod = await server("voice_model.js");
const models = await server("models.js");
const { EFFECT_CATALOG } = await server("audio/effect_catalog.js");

const SEVEN = ["kokoro", "kitten", "pocket", "qwen3", "chatterbox", "voxcpm2", "asr"];
const commit = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const today = new Date().toISOString().slice(0, 10);
const catalogRef = (await server("engines/audiocpp/generated.js")).CATALOG.generated_from;

// ── #/mock/speech-engines ───────────────────────────────────────────────────
const ENGINE_KEYS = [
  "id", "name", "description", "kind", "kinds", "default_variant_id", "supported_oses", "supported_on_this_os",
  "deprecated", "licence", "catalog_status", "tested", "best_for", "terms",
];
const VARIANT_KEYS = [
  "id", "name", "description", "size_mb", "languages", "languages_note", "voice_cloning", "voice_design",
  "preset_voices", "hf_repo", "min_vram_gb", "need_gb",
];
const optionSets = [];
const optionIndex = new Map();
const engines = [];
for (const m of modelCatalog.manifests().values()) {
  const info = enginesApi._infoFromManifest(m, "installed");
  const e = Object.fromEntries(ENGINE_KEYS.map((k) => [k, info[k] ?? null]));
  const rows = new Map(modelCatalog._variantRows(m.id).map((r) => [r.id, r]));
  e.variants = modelCatalog.modelsFor(m.id).map((v) => {
    const row = rows.get(v.id);
    const out = Object.fromEntries(VARIANT_KEYS.map((k) => [k, v[k] ?? null]));
    out.cpu_realtime = row?.cpu_realtime ?? null;
    out.directed_by = m.kind === "tts" ? vmod.directedBy(vmod.modelOfVariant(v.id)) : null;
    const options = row ? runtimeOptions.describe(m.id, row) : [];
    const key = JSON.stringify(options);
    if (!optionIndex.has(key)) {
      optionIndex.set(key, optionSets.length);
      optionSets.push(options);
    }
    out.runtime_options = optionIndex.get(key);
    return out;
  });
  engines.push(e);
}
const enginesSource =
  `The server's own answers, computed from this checkout's code on ${today} (${commit}; catalog.json from ` +
  `the fork's ${catalogRef.audiocpp_ref} ${String(catalogRef.audiocpp_commit).slice(0, 8)}, models ` +
  `${String(catalogRef.model_revision).slice(0, 8)}) by scripts/mock-snapshots.js: /v1/engines (each managed ` +
  "engine) and /v1/engines/{id}/models (its models, with how each is directed and its load options — each " +
  "variant's `runtime_options` an index into `load_option_sets`, the sets being shared) — without this " +
  "machine's state (on disk, loaded, where it runs, measured memory), which speechEnginesMock.js makes up.";
// One engine, and one option set, per line: a re-take's diff reads per engine.
writeFileSync(
  path.join(OUT, "speechEnginesSnapshot.json"),
  `{\n"_source": ${JSON.stringify(enginesSource)},\n"load_option_sets": [\n${optionSets.map((x) => JSON.stringify(x)).join(",\n")}\n],\n` +
    `"engines": [\n${engines.map((x) => JSON.stringify(x)).join(",\n")}\n]\n}\n`,
);

// ── #/mock/personas ─────────────────────────────────────────────────────────
const sevenVariants = new Set(SEVEN.flatMap((id) => modelCatalog.modelsFor(id).map((v) => v.id)));
const capabilities = {};
for (const [key, detail] of Object.entries(caps.CAPABILITY_DETAILS)) {
  const ours = SEVEN.includes(key) || sevenVariants.has(key) || [...sevenVariants].some((vid) => vid.startsWith(`${key}-`));
  if (ours) capabilities[key] = detail;
}
const wire = models.construct(models.EngineCapabilitiesResponse, { engines: capabilities, emotion_values: [...models.EMOTION_VALUES] });
const presets = [];
for (const id of SEVEN) {
  for (const v of modelCatalog.getManifest(id).staticVoices) presets.push(JSON.parse(JSON.stringify(voicesApi._presetDto(st, id, v))));
}
const languages = {};
const versions = {};
for (const id of SEVEN) {
  if (modelCatalog.getManifest(id).kind !== "tts") continue;
  const sizes = new Map(modelCatalog.modelsFor(id).map((v) => [v.id, v.size_mb]));
  for (const model of vmod.modelsOfEngine(id)) {
    languages[model] = vmod.modelSpeaks(id, model);
    versions[model] = {
      model_name: vmod.modelName(model, id),
      versions: modelCatalog
        ._variantRows(id)
        .filter((r) => vmod.modelOfVariant(r.id) === model)
        .map((r) => ({ id: r.id, name: r.name || r.id, size_mb: sizes.get(r.id) || null, languages: r.languages || [] })),
    };
  }
}
const terms = {};
for (const id of SEVEN) {
  const t = enginesApi._termsOf(modelCatalog.getManifest(id));
  if (t) terms[id] = t;
}
const personaSource =
  "The server's own answers for the seven engines described by our own files (Kokoro, KittenTTS, Pocket TTS, " +
  `Qwen3-TTS, Chatterbox, VoxCPM2, Speech recognition), computed from this checkout's code on ${today} ` +
  `(${commit}) by scripts/mock-snapshots.js, the pinned speech runtime taken as installed: ` +
  "/v1/engines/capabilities, /v1/voices (presets), /v1/engines (terms), /v1/effects/catalog. Model languages: " +
  "what /v1/voices says each model speaks; versions: /v1/voices/{id}/model-version's rows.";
writeFileSync(
  path.join(OUT, "liveSnapshot.json"),
  `${JSON.stringify(
    {
      _source: personaSource,
      capabilities: wire.engines,
      emotion_values: wire.emotion_values,
      presets,
      terms,
      effects: EFFECT_CATALOG,
      languages,
      versions,
    },
    null,
    1,
  )}\n`,
);

console.log(`${engines.length} engines, ${optionSets.length} load-option sets; ${Object.keys(capabilities).length} capability rows, ${presets.length} presets`);
session.closeDb();
try {
  rmSync(dataDir, { recursive: true, force: true });
} catch {
  // A file the run still holds open on Windows: the temp folder is the system's to clear.
}
process.exit(0);
