// SPDX-License-Identifier: MIT
// Every declared knob must be a knob the engine actually receives (the port of
// tests/test_engine_knob_wiring.py). Since the 2026-10-01 switch the "adapter" is one
// function — `engines/audiocpp/slot.js: toSpeechRequest` — so these drive it directly: set
// every declared knob, and the value must come out the other side.
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { nestEngineKeys } from "../src/delivery_merge.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { CAPABILITY_DETAILS, lookup } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/manager.js";
import { Delivery, modelFields } from "../src/models.js";

// Capability row → a catalog variant that renders with it, and how the body must look for
// that family to take the request at all (a clone needs a clip, VoiceDesign a description).
const ROW_VARIANT = {
  kokoro: ["kokoro", "kokoro-82m-q8", { voice_id: "af_heart" }],
  chatterbox: ["chatterbox", "chatterbox-multilingual-v2-q8", { audio_prompt_path: "/v/ref.wav" }],
  "chatterbox-multilingual": ["chatterbox", "chatterbox-multilingual-v2-q8", { audio_prompt_path: "/v/ref.wav" }],
  qwen3: ["qwen3", "qwen3-cv-1.7b-q8", { voice_id: "Ryan" }],
  "qwen3-cv": ["qwen3", "qwen3-cv-1.7b-q8", { voice_id: "Ryan" }],
  "qwen3-base": ["qwen3", "qwen3-base-1.7b-q8", { audio_prompt_path: "/v/ref.wav", ref_text: "Hi there." }],
  "chatterbox-turbo": ["chatterbox", "chatterbox-turbo-q8", { audio_prompt_path: "/v/ref.wav" }],
  "chatterbox-nano": ["chatterbox", "chatterbox-nano-q8", { audio_prompt_path: "/v/ref.wav" }],
  "qwen3-vd": ["qwen3", "qwen3-vd-1.7b-q8", { delivery: { instruct: "A gravel voice." } }],
  kitten: ["kitten", "kitten-mini-0.8", { voice_id: "kitten_leo" }],
  pocket: ["pocket", "pocket-en-q8", { voice_id: "pocket_alba" }],
  voxcpm2: ["voxcpm2", "voxcpm2-q8", { audio_prompt_path: "/v/ref.wav" }],
};

// Where each knob lands in audio.cpp's request ("options.x" = inside options).
const LANDS_AT = {
  speed: "speed",
  seed: "seed",
  temperature: "options.temperature",
  talker_temperature: "options.temperature",
  exaggeration: "options.exaggeration",
  cfg_weight: "options.guidance_scale",
  repetition_penalty: "options.repetition_penalty",
  top_p: "options.top_p",
  talker_top_k: "options.top_k",
  talker_top_p: "options.top_p",
  top_k: "options.top_k",
  cfg_value: "options.guidance_scale",
  inference_timesteps: "options.num_inference_steps",
  // Audit 2026-10-04 §7 / §13.5 (5h): options audio.cpp reads that the app now offers.
  min_p: "options.min_p",
  s3gen_cfg_rate: "options.s3gen_cfg_rate",
  subtalker_temperature: "options.subtalker_temperature",
  subtalker_top_k: "options.subtalker_top_k",
  subtalker_top_p: "options.subtalker_top_p",
  retry_badcase_max_times: "options.retry_badcase_max_times",
  retry_badcase_ratio_threshold: "options.retry_badcase_ratio_threshold",
};
const TOP_LEVEL = new Set(["speed", "seed"]); // canonical Delivery fields / the request's own seed

function row(engine, variant) {
  // PENDING_VARIANTS: rows written and published that wait for the pinned runtime's feature —
  // their knobs must reach the runtime too.
  const module = discoverEngines().get(engine).module;
  return [...module.VARIANTS, ...(module.PENDING_VARIANTS || [])].find((r) => r.id === variant);
}

test("every_capability_row_has_a_variant_to_drive", () => {
  expect(new Set(Object.keys(ROW_VARIANT))).toEqual(new Set(Object.keys(CAPABILITY_DETAILS)));
});

test("every_declared_knob_reaches_the_runtime", () => {
  // No slider may exist that the engine never receives. (Python parametrized over the rows.)
  for (const capId of Object.keys(CAPABILITY_DETAILS).sort()) {
    const [engine, variant, base] = ROW_VARIANT[capId];
    for (const knob of CAPABILITY_DETAILS[capId].knobs) {
      expect(Object.hasOwn(LANDS_AT, knob.key), `${capId}: knob ${knob.key} has no audio.cpp mapping`).toBe(true);
      const value = knob.max !== knob.default ? knob.max : knob.min;
      const body = { text: "Hi.", language: "en", ...base };
      const delivery = { ...(base.delivery || {}) };
      if (knob.key === "seed") body.seed = Math.trunc(value);
      else if (TOP_LEVEL.has(knob.key)) delivery[knob.key] = value;
      else delivery.engine = { [knob.key]: value };
      body.delivery = delivery;
      const req = toSpeechRequest(row(engine, variant), body);
      const where = LANDS_AT[knob.key];
      const got = where.startsWith("options.") ? (req.options || {})[where.slice(8)] : req[where];
      expect(got, `${capId}: ${knob.key}=${value} reached audio.cpp as ${got}`).toBeCloseTo(value, 6);
    }
  }
});

test("variant_lookup_walks_suffixes_not_just_the_base", () => {
  expect(lookup("chatterbox-multilingual-v2-q8").engine_id).toBe("chatterbox-multilingual");
  expect(lookup("qwen3-base-1.7b-q8").engine_id).toBe("qwen3-base");
  expect(lookup("chatterbox").engine_id).toBe("chatterbox");
  // An unrelated id with a tail falls through to nothing, not to a wrong row.
  expect(lookup("totally-unknown-engine")).toBeNull();
});

test("every_manifest_variant_resolves_to_a_row", () => {
  // Speech recognition has no capability row by design — nothing to tune.
  const unresolved = [];
  for (const [engineId, m] of discoverEngines()) {
    if (lookup(engineId) === null) continue;
    for (const v of m.module.VARIANTS || []) if (lookup(v.id) === null) unresolved.push(`${engineId}:${v.id}`);
  }
  expect(unresolved).toEqual([]);
});

test("nest_engine_keys_moves_private_knobs_under_engine", () => {
  const out = nestEngineKeys({ speed: 1.1, gain_db: -2.0, exaggeration: 0.7, cfg_weight: 0.3 });
  expect(out.speed).toBe(1.1);
  expect(out.gain_db).toBe(-2.0);
  expect(out.engine).toEqual({ exaggeration: 0.7, cfg_weight: 0.3 });
});

test("nest_engine_keys_keeps_an_explicit_nested_value", () => {
  // A key written deliberately under `engine` beats the flat one.
  expect(nestEngineKeys({ exaggeration: 0.7, engine: { exaggeration: 0.2 } }).engine.exaggeration).toBe(0.2);
});

test("nest_engine_keys_is_idempotent_and_empty_safe", () => {
  const once = nestEngineKeys({ exaggeration: 0.7, speed: 1.0 });
  expect(nestEngineKeys(once)).toEqual(once);
  expect(nestEngineKeys({})).toEqual({});
  expect(nestEngineKeys(null)).toEqual({});
});

test("canonical_delivery_fields_are_never_nested", () => {
  // Everything Delivery declares stays top-level, or engines lose it.
  const flat = Object.fromEntries(modelFields(Delivery).filter((k) => k !== "engine").map((k) => [k, 1]));
  const out = nestEngineKeys(flat);
  expect("engine" in out).toBe(false);
  expect(new Set(Object.keys(out))).toEqual(new Set(Object.keys(flat)));
});

test("every_capability_row_has_its_own_display_name", () => {
  // A picker listing two rows under one name is the duplicate this fixed.
  const names = Object.values(CAPABILITY_DETAILS).map((d) => d.display_name);
  expect(new Set(names).size).toBe(names.length);
});
