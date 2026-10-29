#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Re-takes the snapshot the in-app mocks read (CLAUDE.md "A mock is built in the app itself";
// "production minus the plumbing"): the server's own answers, computed in-process from this
// checkout's server code on an app state over a temp data folder — no HTTP server, no speech
// runtime, no model loads, nothing on the GPU, nothing in the app's data folder.
//
//   src/services/mock/liveSnapshot.json            #/mock/personas, #/mock/voices: the seven engines
//       described by our own files — /v1/engines/capabilities, /v1/voices (presets), /v1/engines
//       (each engine's row, and its terms), /v1/effects/catalog, what each model speaks, and its
//       versions (the rows of /v1/voices/{id}/model-version).
//
// (The Speech engines mock's snapshot, speechEnginesSnapshot.json, went with that mock in round E,
// 2026-10-29: the Speech tab is the kit's audio.cpp runtime tab; the Voices mock's engine rows moved
// here.)
//
// Run it when what the mocks show has moved under them: after scripts/audiocpp-catalog.js
// rewrites seed_audiocpp_catalog.json, after a family's notes (engines/audiocpp/curated/) or the capability rows
// change, or when a mock reads a field the snapshot doesn't carry yet. The diff of the JSON file is
// what the mocks will show differently. On Electron's Node, as the server runs (its SQLite
// module is built for it):
//
//   node scripts/node24.js scripts/mock-snapshots.js
//
// (Added 2026-10-16, TASKS "Slice 5's findings: what each one gets" 6.)

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

// The server's modules, imported once the data folder above is set.
const server = (rel) => import(pathToFileURL(path.join(SERVER, rel)).href);

const session = await server("database/session.js");
// The kit as the server has it: the root's and the server's `@delebash/core` are the one checkout
// (each a `file:` dependency on ../just-core/packages/core, one link in the root's node_modules),
// so this is the module the server's database code configures.
const llmDb = await import("@delebash/core/llm/db");
const appState = await server("app_state.js");
session.initDb(dataDir);
llmDb.configureStorage(session.cfg.handle);
llmDb.createAll(session.cfg.handle);
const st = new appState.AppState(dataDir);
appState.setState(st);

const modelCatalog = await server("engines/model_catalog.js");
const enginesApi = await server("api/engines_api.js");
const voicesApi = await server("api/voices_api.js");
const caps = await server("engines/capability_details.js");
const vmod = await server("voice_model.js");
const models = await server("models.js");
const { EFFECT_CATALOG } = await server("audio/effect_catalog.js");

const SEVEN = ["kokoro", "kitten", "pocket", "qwen3", "chatterbox", "voxcpm2", "asr"];
const commit = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
const today = new Date().toISOString().slice(0, 10);

// ── #/mock/personas, #/mock/voices ──────────────────────────────────────────
// Each of the seven engines' rows as /v1/engines lists them (the Voices mock's engine list; where
// each stands is the mock machine's, personaMock.js modelStatus).
const ENGINE_KEYS = [
  "id", "name", "description", "kind", "kinds", "default_variant_id", "supported_oses", "supported_on_this_os",
  "deprecated", "licence", "catalog_status", "tested", "best_for", "terms",
];
const engines = SEVEN.map((id) => {
  const info = enginesApi._infoFromManifest(modelCatalog.getManifest(id), "installed");
  return Object.fromEntries(ENGINE_KEYS.map((k) => [k, info[k] ?? null]));
});
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
  "/v1/engines/capabilities, /v1/voices (presets), /v1/engines (each engine's row, and its terms), /v1/effects/catalog. Model languages: " +
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
      engines,
    },
    null,
    1,
  )}\n`,
);

console.log(`${engines.length} engines, ${Object.keys(capabilities).length} capability rows, ${presets.length} presets`);
session.closeDb();
try {
  rmSync(dataDir, { recursive: true, force: true });
} catch {
  // A file the run still holds open on Windows: the temp folder is the system's to clear.
}
process.exit(0);
