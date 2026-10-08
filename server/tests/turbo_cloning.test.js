// SPDX-License-Identifier: MIT
// Chatterbox Turbo and Nano clone again (gap 1, docs/plans/2026-10-03-gap-1-turbo-cloning.md):
// their capability rows are back, the slot maps a cloned voice and refuses on an older runtime
// by name, and a Load warms the built-in voice so the memory is booked (the port of
// tests/test_turbo_cloning.py).
//
// Not ported here: test_an_emotion_compiles_to_turbos_token — it reads
// render_core._apply_emotion_tag (a later wave): test.todo.
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { CAPABILITY_DETAILS, lookup } from "../src/engines/capability_details.js";

const TAG = release.cfg.TAG;
afterEach(() => {
  release.cfg.TAG = TAG;
});

const TURBO = {
  id: "chatterbox-turbo-q8",
  name: "Chatterbox Turbo (350M, English)",
  audiocpp: { family: "chatterbox_turbo", task: "tts", file: "t.gguf" },
};

test("turbo_clone_arrives_in_jv4", () => {
  for (const [tag, expected] of [
    ["v0.9.0", false],
    ["v0.9.0-jv.1", false],
    ["v0.9.0-jv.3", false],
    ["v0.9.0-jv.4", true],
    [null, false],
  ]) {
    vi.spyOn(runtime, "installedTag").mockReturnValue(tag);
    expect(runtime.hasFeature("turbo_clone"), String(tag)).toBe(expected);
  }
  release.cfg.TAG = "v0.9.0-jv.1";
  expect(release.pinnedHas("turbo_clone")).toBe(false);
  release.cfg.TAG = "v0.9.0-jv.4";
  expect(release.pinnedHas("turbo_clone")).toBe(true);
});

test("turbo_and_nano_variants_reach_their_own_rows", () => {
  for (const [variant, name] of [
    ["chatterbox-turbo-q8", "Chatterbox Turbo"],
    ["chatterbox-turbo-f16", "Chatterbox Turbo"],
    ["chatterbox-nano-q8", "Chatterbox Nano"],
    ["chatterbox-nano-f16", "Chatterbox Nano"],
  ]) {
    const row = lookup(variant);
    expect(row.display_name).toBe(name);
    expect(row.engine_id).toBe(name.toLowerCase().replaceAll(" ", "-"));
    expect(row.supports_voice_cloning).toBe(true);
    // Turbo's own sampling knobs; exaggeration / CFG / min-p do nothing on Turbo.
    expect(new Set(row.knobs.map((k) => k.key))).toEqual(new Set(["temperature", "repetition_penalty", "top_p", "top_k", "seed"]));
  }
});

test("the_nineteen_tags_are_turbos_and_multilingual_keeps_none", () => {
  const tags = CAPABILITY_DETAILS["chatterbox-turbo"].inline_tags.flatMap((ts) => ts.tags);
  expect(tags.length).toBe(19);
  expect(new Set(tags).size).toBe(19);
  for (const t of ["laugh", "clear throat", "whispering", "narration"]) expect(tags).toContain(t);
  expect(CAPABILITY_DETAILS["chatterbox-nano"].inline_tags).toEqual(CAPABILITY_DETAILS["chatterbox-turbo"].inline_tags);
  expect(lookup("chatterbox-multilingual-v2-q8").inline_tags).toEqual([]);
});

test.todo("an_emotion_compiles_to_turbos_token — waits for render_core.js");

test("a_cloned_voice_maps_to_voice_ref_and_turbos_knobs", () => {
  const req = slot.toSpeechRequest(TURBO, {
    text: "Hello there.",
    seed: 7,
    audio_prompt_path: "C:\\voices\\mara.wav",
    delivery: { temperature: 0.7, engine: { top_k: 500.0, top_p: 0.9, repetition_penalty: 1.3, exaggeration: 0.8, cfg_weight: 0.3 } },
  });
  expect(req).toEqual({
    model: "chatterbox-turbo-q8",
    input: "Hello there.",
    seed: 7,
    voice_ref: "C:/voices/mara.wav",
    options: { repetition_penalty: 1.3, top_p: 0.9, top_k: 500, temperature: 0.7 },
  });
});

test("a_voice_without_a_clip_is_refused_by_name", () => {
  expect(() => slot.toSpeechRequest(TURBO, { text: "Hi.", voice_id: "anything" })).toThrow(
    /Chatterbox Turbo .* speaks only cloned voices/,
  );
});

/** The slot under test: Turbo's row, always alive, its server a recorder. */
function turboSlot() {
  const s = Object.create(slot.AudioCppSlot.prototype);
  Object.assign(s, {
    manifest: { name: "Chatterbox", id: "chatterbox", module: {} },
    _row: TURBO,
    placement: "gpu",
    sent: [],
  });
  s.isAlive = () => true;
  s._srv = () => ({
    speech: async (req) => {
      s.sent.push(req);
      return [Buffer.alloc(0), {}];
    },
  });
  return s;
}

test("an_older_runtime_refuses_turbo_by_name", async () => {
  vi.spyOn(runtime, "hasFeature").mockReturnValue(false);
  vi.spyOn(release, "pinnedHas").mockReturnValue(true);
  let r = await turboSlot()._synth({ text: "Hi.", audio_prompt_path: "C:/v.wav" });
  expect(r.statusCode).toBe(409);
  expect(r.json().detail).toContain("speech runtime update");
  vi.spyOn(release, "pinnedHas").mockReturnValue(false);
  r = await turboSlot()._synth({ text: "Hi.", audio_prompt_path: "C:/v.wav" });
  expect(r.statusCode).toBe(409);
  expect(r.json().detail).toContain("Chatterbox Turbo and Nano voices");
});

test("a_load_warms_the_built_in_voice", async () => {
  const s = turboSlot();
  await s._warm();
  expect(s.sent).toEqual([{ model: "chatterbox-turbo-q8", input: "Ready.", seed: 1 }]);
});
