// SPDX-License-Identifier: MIT
// Our speech models as the kit's runtime_model rows (round E, docs/plans/2026-10-29-round-e-onto-
// the-kit.md §4 step 1 — engines/audiocpp/kit_models.js): every model version our engines offer, its
// files pinned by SHA-256 and size (Pocket TTS's preset voices from its family file), in slots the
// kit's audio.cpp runtime registers from, and the spec it reads — checked against the kit's own
// seeding and its RuntimeService.entriesFor.
import { afterEach, expect, test } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import { stores } from "@delebash/core/llm";
import { seedRuntimeModels } from "@delebash/core/llm/seed";
import { RuntimeService } from "@delebash/core/runner/runtime_service";
import * as session from "../src/database/session.js";
import { CURATED } from "../src/engines/audiocpp/curated/index.js";
import { VOICE_FILES } from "../src/engines/audiocpp/curated/pocket_tts.js";
import * as generated from "../src/engines/audiocpp/generated.js";
import { runtimeModelRows, variantOf } from "../src/engines/audiocpp/kit_models.js";
import { tmpPath } from "./helpers.js";

afterEach(() => endState());

const rows = runtimeModelRows();
const rowOf = (id) => rows.find((r) => r.id === id);
const SHA256 = /^[0-9a-f]{64}$/;

test("every model version our engines offer is one row, its files pinned, its main file in the model slot", () => {
  const versions = [...generated.generatedEngines().values()].flatMap((m) => m.VARIANTS);
  expect(rows.map((r) => r.id)).toEqual(versions.map((v) => v.id));
  expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  for (const r of rows) {
    expect(r.runtime, r.id).toBe("audiocpp");
    expect(["tts", "stt"], r.id).toContain(r.kind);
    expect(r.files.filter((f) => f.slot === "model"), r.id).toHaveLength(1);
    expect(r.files.find((f) => f.slot === "model").path, r.id).toBe(variantOf(r.id).row.audiocpp.file);
    expect(new Set(r.files.map((f) => f.slot)).size, r.id).toBe(r.files.length);
    for (const f of r.files) {
      expect(f.repo && f.revision && f.path, `${r.id} ${f.path}`).toBeTruthy();
      expect(f.bytes, `${r.id} ${f.path}`).toBeGreaterThan(0);
      // every file carries its SHA-256 — the kit's download checks it
      expect(f.sha256, `${r.id} ${f.path}`).toMatch(SHA256);
    }
    expect(r.spec.family && r.spec.task, r.id).toBeTruthy();
    // the card estimate is audio.cpp's, in MB
    expect(r.peakVramMb, r.id).toBe(Math.round((variantOf(r.id).row.min_vram_gb || 0) * 1024));
  }
});

test("a small file Git stores itself carries the SHA-256 its family file gives it, at its revision", () => {
  // catalog.json gives such a file Git's blob id (40 hex), all Hugging Face lists for it
  const gitIds = new Map();
  for (const fam of Object.values(generated.CATALOG.families)) {
    for (const p of fam.packages || []) for (const f of p.source?.files || []) if (/^[0-9a-f]{40}$/.test(f.sha256 || "")) gitIds.set(`${p.source.repo}\u0000${p.source.revision}\u0000${f.path}`, f);
  }
  let seen = 0;
  for (const r of rows) {
    for (const f of r.files) {
      const git = gitIds.get(`${f.repo}\u0000${f.revision}\u0000${f.path}`);
      if (!git) continue;
      seen += 1;
      const entry = Object.values(CURATED).flatMap((c) => c.SMALL_FILES ?? []).find((e) => e.repo === f.repo && e.revision === f.revision);
      expect(f.sha256, `${r.id} ${f.path}`).toBe(entry?.sha256[f.path]);
      expect(f.bytes, `${r.id} ${f.path}`).toBe(git.size_bytes);
    }
  }
  expect(seen).toBeGreaterThan(0);
  expect(rowOf("sanotts-orig").files.find((f) => f.path === "gguf/config.json").sha256).toMatch(SHA256);
});

test("Pocket TTS's preset voices carry their SHA-256 from its family file, at the pinned revision", () => {
  const pocket = rows.filter((r) => r.spec.family === "pocket_tts");
  expect(pocket.length).toBeGreaterThan(0);
  const voices = pocket.flatMap((r) => r.files.filter((f) => f.path.includes("/embeddings/") && !generated.catalogFamily("pocket_tts").packages.some((p) => p.source.files.some((x) => x.path === f.path))));
  // 19 English (alba is in audio.cpp's package) and 20 each of German, Italian, Portuguese and Spanish, at two precisions
  expect(voices).toHaveLength(198);
  expect(new Set(voices.map((f) => f.path)).size).toBe(Object.keys(VOICE_FILES.sha256).length);
  for (const f of voices) {
    expect(f.revision).toBe(VOICE_FILES.revision);
    expect(f.sha256).toBe(VOICE_FILES.sha256[f.path]);
    expect(f.bytes).toBe(CURATED.pocket_tts.VOICES[f.path.split("/").pop().replace(".safetensors", "")].file_bytes);
  }
  for (const r of pocket) for (const f of r.files) expect(f.sha256, `${r.id} ${f.path}`).toMatch(SHA256);
  const en = rowOf("pocket-en-q8");
  expect(en.files).toHaveLength(21);
  expect(en.refSpeed).toEqual({ cpu: 3.9 });
  // French clones only: no presets
  expect(rowOf("pocket-fr-q8").files.some((f) => f.path.includes("/embeddings/") && f.path !== "PocketTTS-GGUF/french/embeddings/cosette.safetensors")).toBe(false);
});

test("the spec says how the kit registers it: companions, a file as an option, eSpeak NG, a process that must stop", () => {
  const asr = rowOf("qwen3-asr-1.7b-q8");
  expect(asr.kind).toBe("stt");
  expect(asr.spec.companions).toEqual([{ role: "aligner", family: "qwen3_forced_aligner", task: "align", slot: "aligner", onDemand: true }]);
  expect(asr.files.find((f) => f.slot === "aligner").path).toBe("Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf");
  const mio = rowOf("miotts-q8");
  expect(mio.spec.sessionFiles).toEqual({ "miotts.codec_model_path": "miotts.codec_model_path" });
  expect(mio.files.find((f) => f.slot === "miotts.codec_model_path").path).toBe(variantOf("miotts-q8").row.audiocpp.session_files["miotts.codec_model_path"]);
  expect(rowOf("kitten-mini-0.8").spec.espeak).toBe(true);
  expect(rowOf("kokoro-82m-q8").spec.espeak).toBeUndefined();
  expect(rows.filter((r) => r.spec.unloadStopsProcess).every((r) => r.spec.family === "f5_tts")).toBe(true);
  expect(rows.some((r) => r.spec.unloadStopsProcess)).toBe(true);
  expect(rowOf("kokoro-82m-q8").refSpeed.cpu).toBeGreaterThan(0);
  expect(rowOf("miotts-q8").refSpeed).toEqual({});
});

test("the kit seeds the rows and registers them the way our slots did", () => {
  useState();
  seedRuntimeModels(session.cfg.handle, rows, ["audiocpp"]);
  const listed = stores.getRunnerConfigStore().listRuntimeModels("audiocpp");
  expect(listed.map((r) => r.id)).toEqual(rows.map((r) => r.id));
  expect(listed.find((r) => r.id === "qwen3-asr-1.7b-q8")).toMatchObject({ kind: "stt", peakVramMb: 6144, spec: rowOf("qwen3-asr-1.7b-q8").spec });

  const dir = tmpPath("jv-kit-rows-");
  const svc = new RuntimeService({ id: "audiocpp", cacheRoot: dir, configFn: () => ({ settings: {} }), modelsFn: () => listed, logDir: dir, stateDir: dir });
  svc.modelFor = (id) => ({ key: id, files: Object.fromEntries(listed.find((r) => r.id === id).files.map((f) => [f.slot, `/m/${f.path}`])) });
  svc.extrasEnv = () => ({ AUDIOCPP_ESPEAK_LIBRARY: "/espeak/lib", AUDIOCPP_ESPEAK_DATA: "/espeak/data" });
  // the aligner registers only for a line that needs it
  expect(svc.entriesFor("qwen3-asr-1.7b-q8").map((e) => e.toConfig())).toEqual([
    { id: "qwen3-asr-1.7b-q8", family: "qwen3_asr", task: "asr", mode: "offline", path: `/m/${variantOf("qwen3-asr-1.7b-q8").row.audiocpp.file}` },
  ]);
  expect(svc.entriesFor("qwen3-asr-1.7b-q8", { needs: ["aligner"] })[1].toConfig()).toEqual({
    id: "qwen3-asr-1.7b-q8::aligner", family: "qwen3_forced_aligner", task: "align", mode: "offline", path: "/m/Qwen3-ForcedAligner-0.6B-GGUF/qwen3-forced-aligner-0.6b-q8_0.gguf",
  });
  const codec = variantOf("miotts-q8").row.audiocpp.session_files["miotts.codec_model_path"];
  expect(svc.entriesFor("miotts-q8")[0].toConfig().session_options).toEqual({ "miotts.codec_model_path": `/m/${codec}` });
  expect(svc.entriesFor("kitten-mini-0.8")[0].toConfig().session_options).toEqual({
    "kitten_tts.espeak_data_path": "/espeak/data",
    "kitten_tts.espeak_library_path": "/espeak/lib",
  });
});
