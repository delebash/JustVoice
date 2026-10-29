// SPDX-License-Identifier: MIT
// Chatterbox Turbo and Nano clone again (gap 1, docs/plans/2026-10-03-gap-1-turbo-cloning.md):
// their capability rows are back, a cloned voice maps to Turbo's own request, a line on a build
// older than jv.4 is refused by name before anything loads, and a load warms the built-in voice so
// its memory is measured (the port of tests/test_turbo_cloning.py). Since round E
// (docs/plans/2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp runtime runs the model: the
// build is the one the kit pins here (kit_settings.js `runtimeHas`), the refusal slot.js
// `checkLine`, the line `speak` and the warm-up `warmModel` on the server the kit holds it in.
import { afterEach, expect, test, vi } from "vitest";
import { stores } from "@delebash/core/llm";
import { pinKey } from "@delebash/core/runner/runtimes";
import { endState, fakeServer, useState } from "./engines_helpers.js";
import * as kitSettings from "../src/engines/audiocpp/kit_settings.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import { variantOf } from "../src/engines/audiocpp/kit_models.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { CAPABILITY_DETAILS, lookup } from "../src/engines/capability_details.js";
import { _applyEmotionTag } from "../src/render_core.js";

afterEach(() => endState());

const TURBO = {
  id: "chatterbox-turbo-q8",
  name: "Chatterbox Turbo (350M, English)",
  audiocpp: { family: "chatterbox_turbo", task: "tts", file: "t.gguf" },
};

test("turbo_clone_arrives_in_jv4", () => {
  // The build the kit pins on this computer decides; jv.2 and jv.3 were never published.
  useState();
  for (const [tag, expected] of [
    ["v0.9.0", false],
    ["v0.9.0-jv.1", false],
    ["v0.9.0-jv.3", false],
    ["v0.9.0-jv.4", true],
    ["v0.9.2-jv.6", true],
  ]) {
    stores.getRunnerConfigStore().setSetting(pinKey("audiocpp"), tag);
    expect(kitSettings.runtimeHas("turbo_clone"), tag).toBe(expected);
  }
  // The build the app ships has it, so Turbo is offered.
  expect(kitSettings.shippedHas("turbo_clone")).toBe(true);
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

test("an_emotion_compiles_to_turbos_token", () => {
  const emotion = CAPABILITY_DETAILS["chatterbox-turbo"].inline_tags[0];
  expect(_applyEmotionTag("Who's there?", { emotion: "fearful" }, emotion).startsWith("[fear]")).toBe(true);
  expect(_applyEmotionTag("A line.", { emotion: "sad" }, emotion)).toBe("A line."); // no token for sad
});

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
    /Chatterbox Turbo .* speaks only a cloned voice or its own built-in one/,
  );
});

test("an_older_runtime_refuses_turbo_by_name", async () => {
  const turbo = variantOf("chatterbox-turbo-q8");
  const line = { text: "Hi.", seed: 7, audio_prompt_path: "C:/v.wav" };
  const refusal = () => {
    try {
      slot.checkLine(turbo, line);
    } catch (e) {
      return e;
    }
    return null;
  };
  // The build pinned here lacks it: an update offered when the build the app ships has it …
  vi.spyOn(kitSettings, "runtimeHas").mockReturnValue(false);
  vi.spyOn(kitSettings, "shippedHas").mockReturnValue(true);
  let e = refusal();
  expect(e).toBeInstanceOf(kitSpeech.EngineRequestError);
  expect(e.status).toBe(409);
  expect(e.message).toContain("speech runtime update");
  // … else that this version doesn't have it, by name.
  vi.mocked(kitSettings.shippedHas).mockReturnValue(false);
  e = refusal();
  expect(e.status).toBe(409);
  expect(e.message).toContain("Chatterbox Turbo and Nano voices");
  // A build that has it takes the line: the clip reaches audio.cpp as Turbo's voice_ref.
  vi.mocked(kitSettings.runtimeHas).mockReturnValue(true);
  expect(refusal()).toBeNull();
  const srv = fakeServer();
  const [, meta] = await slot.speak(srv, turbo.row, line);
  expect(srv.calls).toEqual([["speech", { model: "chatterbox-turbo-q8", input: "Hi.", seed: 7, voice_ref: "C:/v.wav" }]]);
  expect(meta).toEqual({ media_type: "audio/wav", sample_rate: 24000, channels: 1, is_wav_container: true });
});

test("a_load_warms_the_built_in_voice", async () => {
  const srv = fakeServer();
  expect(await slot.warmModel(srv, TURBO, "tts")).toBe(false);
  expect(srv.calls).toEqual([["speech", { model: "chatterbox-turbo-q8", input: "Ready.", seed: 1 }]]);
});
