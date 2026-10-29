// SPDX-License-Identifier: MIT
// The audio.cpp switch (docs/plans/2026-10-01-audiocpp-switch.md): the catalog, the request
// mapping per family, and the aligner's input rate. No binary, no GPU (the port of
// tests/test_audiocpp_switch.py; Python's parametrized tests loop over their cases). Since round E
// (docs/plans/2026-10-29-round-e-onto-the-kit.md) the kit's audio.cpp runtime installs, configures
// and runs the models — its release rows, its servers' config rows and eSpeak NG, the runtime's
// settings, where a model runs and deleting its files are the kit's, tested there (the spec that
// asks it for eSpeak NG's options is kit_models.test.js's); what stays here is ours.
import { afterAll, expect, test } from "vitest";
import "./engines_helpers.js";
import { parseWavHeader, writeWavContainer } from "../src/audio/wav.js";
import * as dspClient from "../src/audio/dsp_client.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { CATALOG } from "../src/engines/audiocpp/generated.js";
import { lookup } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/model_catalog.js";

// Our own conversions of models audio.cpp doesn't publish — CustomVoice 0.6B (gap 4), Turbo and
// Nano (gap 1) — as our fork's catalog names them (the adoption plan's slice 4: the repositories come
// from audio.cpp's files, where the manifests named them before).
const source = (family, id) => CATALOG.families[family].packages.find((p) => p.id === id).source;
const qwen3Manifest = { CV_06_REPO: source("qwen3_tts", "qwen3_tts_0_6b_customvoice_q8_0").repo, CV_06_REVISION: source("qwen3_tts", "qwen3_tts_0_6b_customvoice_q8_0").revision };
const chatterboxManifest = {
  TURBO_REPO: source("chatterbox_turbo", "chatterbox_turbo_clone_q8_0").repo,
  TURBO_REVISION: source("chatterbox_turbo", "chatterbox_turbo_clone_q8_0").revision,
  NANO_REPO: source("chatterbox_turbo", "chatterbox_nano_q8_0").repo,
  NANO_REVISION: source("chatterbox_turbo", "chatterbox_nano_q8_0").revision,
};

afterAll(() => dspClient.stop());

const row = (engine, variant) => discoverEngines().get(engine).module.VARIANTS.find((r) => r.id === variant);

// ─── the catalog ─────────────────────────────────────────────────────────────

test("every_switched_engine_runs_on_audiocpp", () => {
  for (const engine of ["kokoro", "qwen3", "chatterbox", "asr"]) {
    const m = discoverEngines().get(engine);
    expect(m.module.VARIANTS.every((r) => Boolean(r.audiocpp)), engine).toBe(true);
    expect(m.module.VARIANTS.map((r) => r.id)).toContain(m.defaultVariantId);
    // audio.cpp's own repo (its catalog's `model_repo`), or our conversion of a model it does
    // not publish (gap 4; Turbo and Nano, gap 1, offered from v0.9.0-jv.4), or QwenCleo-ASR's
    // own (the adoption plan's E14/F5, as audio.cpp's catalog gives it).
    const pinned = {
      [CATALOG.generated_from.model_repo]: CATALOG.generated_from.model_revision,
      [qwen3Manifest.CV_06_REPO]: qwen3Manifest.CV_06_REVISION,
      [chatterboxManifest.TURBO_REPO]: chatterboxManifest.TURBO_REVISION,
      [chatterboxManifest.NANO_REPO]: chatterboxManifest.NANO_REVISION,
      [source("qwen3_asr", "qwencleo_asr_q8_0").repo]: source("qwen3_asr", "qwencleo_asr_q8_0").revision,
    };
    for (const r of m.module.VARIANTS) {
      const src = r.sources[0];
      expect(Object.hasOwn(pinned, src.hf_repo), r.id).toBe(true);
      expect(src.revision).toBe(pinned[src.hf_repo]); // a commit, never a branch
      expect(src.files).toContain(r.audiocpp.file);
    }
  }
});

test("every_switched_variant_reaches_a_capability_row", () => {
  for (const engine of ["kokoro", "qwen3", "chatterbox"]) {
    for (const r of discoverEngines().get(engine).module.VARIANTS) expect(lookup(r.id), r.id).not.toBeNull();
  }
});

test("qwen3_family_still_reads_off_the_variant_id", async () => {
  // voice_model.modelOfVariant walks the id down to its capability row:
  // qwen3-<family>-<size>-<precision> → qwen3-<family>.
  const { modelOfVariant } = await import("../src/voice_model.js");
  const ids = discoverEngines().get("qwen3").module.VARIANTS.map((r) => r.id);
  expect(new Set(ids.map((i) => modelOfVariant(i)))).toEqual(new Set(["qwen3-cv", "qwen3-base", "qwen3-vd"]));
});

test("kokoro_offers_only_voices_audiocpp_can_speak", () => {
  // Since v0.9.0-jv.4 the pinned runtime reads Japanese: all 54, the five Japanese among them.
  const voices = discoverEngines().get("kokoro").staticVoices;
  expect(voices.length).toBe(54);
  expect(voices.filter((v) => v.language === "ja").length).toBe(5);
});

test("the_aligner_rides_with_speech_recognition", () => {
  const r = row("asr", "qwen3-asr-1.7b-q8");
  const comp = r.audiocpp.companions[0];
  expect(comp.role).toBe("aligner");
  expect(r.sources[0].files).toContain(comp.file);
});

test("turbo_has_its_own_row_again_and_only_multilingual_has_min_p", () => {
  expect(lookup("chatterbox-turbo-q8").engine_id).toBe("chatterbox-turbo");
  expect(lookup("chatterbox-multilingual").knobs.map((k) => k.key)).toContain("min_p");
  expect(lookup("chatterbox-turbo").knobs.map((k) => k.key)).not.toContain("min_p");
});

// ─── request mapping ─────────────────────────────────────────────────────────

test("kokoro_maps_voice_language_speed_and_seed", () => {
  const req = toSpeechRequest(row("kokoro", "kokoro-82m-q8"), {
    voice_id: "bf_emma",
    text: "Hello.",
    language: null,
    seed: 7,
    delivery: { speed: 1.1 },
  });
  expect(req).toEqual({ model: "kokoro-82m-q8", input: "Hello.", seed: 7, voice: "bf_emma", language: "en-gb", speed: 1.1 });
});

test("kokoro_sends_no_language_it_does_not_speak", () => {
  // The narrowings review, F11: audio.cpp then uses the voice's own (its spec: "defaults to the
  // selected voice prefix") — never US English for a British voice.
  const req = toSpeechRequest(row("kokoro", "kokoro-82m-q8"), { voice_id: "bf_emma", text: "Hallo.", language: "de-DE", seed: 7 });
  expect(req).toEqual({ model: "kokoro-82m-q8", input: "Hallo.", seed: 7, voice: "bf_emma" });
  expect("language" in req).toBe(false);
});

test("qwen3_customvoice_takes_speaker_instruct_and_a_language_name", () => {
  for (const variant of ["qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8"]) {
    const req = toSpeechRequest(row("qwen3", variant), {
      voice_id: "Ryan",
      text: "Hi.",
      language: "en-US",
      delivery: { instruct: "Whisper it.", temperature: 0.7, engine: { talker_top_k: 40, repetition_penalty: 1.1 } },
    });
    expect(req.language).toBe("English"); // "en" is rejected by audio.cpp
    expect(req.options).toEqual({ speaker: "Ryan", instruct: "Whisper it.", temperature: 0.7, top_k: 40, repetition_penalty: 1.1 });
  }
});

test("qwen3_base_clones_from_the_clip_and_its_transcript", () => {
  const req = toSpeechRequest(row("qwen3", "qwen3-base-1.7b-q8"), {
    voice_id: "v1",
    text: "Hi.",
    audio_prompt_path: "C:\\voices\\v1\\ref.wav",
    ref_text: "The reference words.",
  });
  expect(req.voice_ref).toBe("C:/voices/v1/ref.wav");
  expect(req.reference_text).toBe("The reference words.");
  expect("speaker" in (req.options || {})).toBe(false);
});

test("qwen3_refuses_the_wrong_family_by_name", () => {
  for (const cv of ["qwen3-cv-1.7b-q8", "qwen3-cv-0.6b-q8"]) {
    expect(() => toSpeechRequest(row("qwen3", cv), { voice_id: "x", text: "Hi.", audio_prompt_path: "a.wav" })).toThrow(/cannot clone/);
  }
  expect(() => toSpeechRequest(row("qwen3", "qwen3-base-1.7b-q8"), { voice_id: "Ryan", text: "Hi." })).toThrow(/clone-only/);
});

test("qwen3_voicedesign_speaks_from_its_description", () => {
  const req = toSpeechRequest(row("qwen3", "qwen3-vd-1.7b-q8"), {
    voice_id: "d1",
    text: "Hi.",
    delivery: { instruct: "A gravel-voiced harbour-master." },
  });
  expect(req.instructions).toBe("A gravel-voiced harbour-master.");
  expect(() => toSpeechRequest(row("qwen3", "qwen3-vd-1.7b-q8"), { voice_id: "d1", text: "Hi." })).toThrow(/description/);
});

test("chatterbox_maps_cfg_to_guidance_scale_per_line", () => {
  const req = toSpeechRequest(row("chatterbox", "chatterbox-multilingual-v2-q8"), {
    voice_id: "c1",
    text: "Hallo.",
    language: "de",
    audio_prompt_path: "/v/ref.wav",
    delivery: { temperature: 0.8, engine: { exaggeration: 0.7, cfg_weight: 0.3 } },
  });
  expect(req.voice_ref).toBe("/v/ref.wav");
  expect(req.language).toBe("de");
  expect(req.options).toEqual({ exaggeration: 0.7, guidance_scale: 0.3, temperature: 0.8 });
});

test("chatterbox_needs_a_clip", () => {
  expect(() => toSpeechRequest(row("chatterbox", "chatterbox-multilingual-v2-q8"), { voice_id: "c1", text: "Hi." })).toThrow(
    /cloned voices/,
  );
});

// ─── the aligner's input rate ────────────────────────────────────────────────

function toneWav(rate, seconds, channels = 1) {
  const n = Math.trunc(rate * seconds);
  const b = Buffer.alloc(n * channels * 2);
  for (let i = 0; i < n; i++) {
    const v = Math.trunc(Math.sin((2 * Math.PI * 220 * i) / rate) * 8000);
    for (let c = 0; c < channels; c++) b.writeInt16LE(v, (i * channels + c) * 2);
  }
  return writeWavContainer(b, rate, channels);
}

test("the_aligner_gets_16k_mono_so_its_seconds_are_right", async () => {
  // audio.cpp v0.9.0 reports aligned seconds at the INPUT rate: a 24 kHz render came back at
  // 2/3 of its real times. The slot sends 16 kHz mono, same length.
  for (const [rate, channels] of [
    [24000, 1],
    [44100, 2],
    [48000, 1],
  ]) {
    const [fmt] = parseWavHeader(await slot.asAudio16kMono(toneWav(rate, 2.0, channels)));
    expect([fmt.sampleRate, fmt.channels]).toEqual([16000, 1]);
    expect(Math.abs(fmt.durationSec - 2.0)).toBeLessThanOrEqual(0.01);
  }
});

test("16k_mono_goes_as_it_is", async () => {
  const w = toneWav(16000, 1.0);
  expect(await slot.asAudio16kMono(w)).toBe(w);
});

// ── VoxCPM2 (gap 9) ──────────────────────────────────────────────────────

test("voxcpm2_clones_from_the_clip_and_sends_direction_as_its_prefix", () => {
  const req = toSpeechRequest(row("voxcpm2", "voxcpm2-q8"), {
    voice_id: "v1",
    text: "The lights came on.",
    audio_prompt_path: "C:\\voices\\v1\\ref.wav",
    ref_text: "The reference words.",
    delivery: { instruct: "Whispered, (tired)" },
  });
  expect(req.voice_ref).toBe("C:/voices/v1/ref.wav");
  // A directed line goes without the clip's words: with them VoxCPM2 ignores or speaks the
  // direction (its authors; decided 2026-10-11 — RESEARCH §10.6, §10.8).
  expect(req.reference_text).toBeUndefined();
  // Brackets inside the direction would end the tag early; they go.
  expect(req.input).toBe("(Whispered, tired)The lights came on.");
});

test("voxcpm2_designs_from_a_description_and_refuses_a_voice_with_neither", () => {
  const req = toSpeechRequest(row("voxcpm2", "voxcpm2-q8"), { text: "Hi.", delivery: { instruct: "A deep, slow, elderly man's voice" } });
  expect(req.input).toBe("(A deep, slow, elderly man's voice)Hi.");
  expect("voice_ref" in req).toBe(false);
  expect(() => toSpeechRequest(row("voxcpm2", "voxcpm2-q8"), { voice_id: "x", text: "Hi." })).toThrow(
    /neither a reference clip nor a description/,
  );
});

test("voxcpm2_speaks_a_lines_own_brackets_as_dashes", () => {
  // VoxCPM2 does not speak parenthesised text, anywhere in the line (measured 2026-10-02).
  const r = row("voxcpm2", "voxcpm2-q8");
  expect(toSpeechRequest(r, { text: "He left (quietly, without a word) and shut it.", audio_prompt_path: "a.wav" }).input).toBe(
    "He left — quietly, without a word — and shut it.",
  );
  expect(toSpeechRequest(r, { text: "(Aside) He left.", audio_prompt_path: "a.wav" }).input).toBe("Aside — He left.");
  expect(toSpeechRequest(r, { text: "(Aside) He left.", delivery: { instruct: "Dry" } }).input).toBe("(Dry)Aside — He left.");
});
