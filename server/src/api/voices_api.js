// SPDX-License-Identifier: MIT
// /v1/voices — list + CRUD, plus the acquisition paths: clone, design, import, blend (the port of
// justvoice/api/voices_api.py).
//
// PARTIAL — the extraction/imports/MCP wave (wave D) ported only what the MCP server's
// `justvoice.list_voices` reads: the voice DTO builders and `listVoices` (the GET /v1/voices
// handler's body). The API wave fills in the rest of this file (the routes) under the same
// names, and registers `listVoices` as GET /v1/voices.

import { getState } from "../app_state.js";
import { getManager } from "../engines/manager.js";
import { construct, Voice, VoiceList } from "../models.js";
import * as vmod from "../voice_model.js";

/** What speaks a voice, as every screen reads it (voice_model.js). */
export function _facts(vm) {
  return { model: vm.model, model_name: vm.name, directed_by: vm.directedBy, speaks: [...vm.speaks] };
}

export function _storedToDto(rec) {
  const st = getState();
  const vm = vmod.describe(st, rec.engine, vmod.modelForStored(st, rec), rec.language);
  return construct(Voice, {
    id: rec.id,
    engine: rec.engine,
    source: rec.source,
    name: rec.name,
    language: rec.language,
    gender: rec.gender || "",
    design_prompt: rec.source === "designed" ? rec.design_prompt : null,
    ..._facts(vm),
  });
}

export function _presetDto(st, engineId, v) {
  const language = Object.hasOwn(v, "language") ? v.language : "en";
  const vm = vmod.describe(st, engineId, vmod.modelForPreset(engineId), language);
  return construct(Voice, {
    id: v.id ?? null,
    engine: engineId,
    source: "preset",
    name: Object.hasOwn(v, "name") ? v.name : (v.id ?? ""),
    language,
    gender: v.gender || "",
    ..._facts(vm),
  });
}

export function _registryDto(st, engine, p) {
  const engineId = engine.meta.engine_id;
  const vm = vmod.describe(st, engineId, engineId, p.language);
  return construct(Voice, {
    id: p.id,
    engine: engineId,
    source: "preset",
    name: p.name,
    language: p.language,
    gender: p.gender || "",
    sample_url: p.sample_url ?? p.sampleUrl ?? null,
    ..._facts(vm),
  });
}

/** GET /v1/voices — all voices (presets + stored), as a VoiceList. */
export async function listVoices() {
  const st = getState();
  const out = [];

  // 1. Static presets from managed engine manifests (always available, no subprocess needed).
  //    Kokoro ships 54 here; clone-only engines empty.
  const mgr = getManager();
  for (const manifest of mgr.manifests().values()) {
    for (const v of manifest.staticVoices) out.push(_presetDto(st, manifest.id, v));
  }

  // 2. Presets from in-process engines (currently only external-openai-tts).
  for (const engine of st.engines?.all() ?? []) {
    for (const p of await engine.voices()) out.push(_registryDto(st, engine, p));
  }

  // 3. Stored (clones / designs / imports).
  for (const rec of st.voices.list()) out.push(_storedToDto(rec));
  return construct(VoiceList, { voices: out });
}
