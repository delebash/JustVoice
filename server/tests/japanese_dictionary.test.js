// SPDX-License-Identifier: MIT
// The optional Japanese dictionary (gap 7, docs/plans/2026-10-03-gap-7-more-languages.md): a
// Japanese line without it is refused by name, and the catalogs follow the build (the port of
// tests/test_japanese_dictionary.py). Since round E (docs/plans/2026-10-29-round-e-onto-the-kit.md)
// the dictionary is the kit's audio.cpp runtime's add-on ("unidic") — the kit downloads, verifies,
// unpacks and points the runtime at it, and its runtime tab offers it — so what stays here is the
// refusal, asked of the kit (kit_speech.js `addonInstalled`), and the languages and voices our
// catalog offers on the build the app ships (kit_settings.js `shippedHas`).
import { afterEach, expect, test, vi } from "vitest";
import { buildHas, runtimeOf } from "@delebash/core/runner/runtimes";
import { endSpeech, fakeSpeechRuntime } from "./engines_helpers.js";
import { ownEngine } from "../src/engines/audiocpp/generated.js";
import * as kitSettings from "../src/engines/audiocpp/kit_settings.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { discoverEngines } from "../src/engines/model_catalog.js";

afterEach(() => endSpeech());

// Chatterbox and Kokoro built again under the build a test sets (Python reloaded their manifests;
// since the adoption plan's slice 4 they are built from audio.cpp's files and our notes).
const chatterbox = { build: () => ownEngine("chatterbox") };
const kokoro = { build: () => ownEngine("kokoro") };

/** The build the app ships, as if it were `tag`. */
const shipping = (tag) => vi.spyOn(kitSettings, "shippedHas").mockImplementation((feature) => buildHas(runtimeOf("audiocpp"), tag, feature));

const kokoroRow = () => discoverEngines().get("kokoro").module.VARIANTS.find((r) => r.id === "kokoro-82m-q8");
const CB = { id: "chatterbox-multilingual-v2-q8", audiocpp: { family: "chatterbox", task: "clon", file: "c.gguf" } };

test("a_japanese_line_is_refused_by_name_until_the_dictionary_is_here", async () => {
  fakeSpeechRuntime();
  expect(() => slot.toSpeechRequest(kokoroRow(), { voice_id: "jf_alpha", text: "こんにちは。" })).toThrow(
    "Japanese needs the Japanese dictionary — install it on AI Settings → Speech engines.",
  );
  expect(() => slot.toSpeechRequest(CB, { text: "こんにちは。", language: "ja", audio_prompt_path: "C:/v.wav" })).toThrow(/Japanese dictionary/);
  // A line asks for it as one it can't take (400), in those words; nothing is spoken.
  const svc = fakeSpeechRuntime();
  const e = await kitSpeech.speak("kokoro", "kokoro-82m-q8", { voice_id: "jf_alpha", text: "こんにちは。" }).catch((x) => x);
  expect(e).toBeInstanceOf(kitSpeech.EngineRequestError);
  expect(e.status).toBe(400);
  expect(e.message).toContain("Japanese needs the Japanese dictionary");
  expect(svc.server.calls).toEqual([]);
  // Other languages never ask for it.
  expect(slot.toSpeechRequest(kokoroRow(), { voice_id: "af_heart", text: "Hi." }).language).toBe("en-us");
  fakeSpeechRuntime({ addons: ["unidic"] });
  expect(slot.toSpeechRequest(kokoroRow(), { voice_id: "jf_alpha", text: "こんにちは。" }).language).toBe("ja");
  expect(slot.toSpeechRequest(CB, { text: "こんにちは。", language: "ja", audio_prompt_path: "C:/v.wav" }).language).toBe("ja");
});

test("languages_and_voices_follow_the_pin", () => {
  // Python reloaded the manifests under each pin; here their build-dependent half is built again.
  shipping("v0.9.0-jv.1");
  expect(chatterbox.build().VARIANTS[0].languages.length).toBe(19);
  expect(kokoro.build().STATIC_VOICES.length).toBe(49);
  shipping("v0.9.0-jv.4");
  const cb = chatterbox.build();
  for (const l of ["he", "ru", "zh", "ja"]) expect(cb.VARIANTS[0].languages).toContain(l);
  expect(cb.VARIANTS[0].name).toBe("Chatterbox Multilingual (23 languages)");
  expect(kokoro.build().STATIC_VOICES.length).toBe(54);
});
