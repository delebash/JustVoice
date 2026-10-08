// SPDX-License-Identifier: MIT
// A lexicon's IPA reaches Kokoro again (gap 3): canonical IPA becomes Kokoro's symbols, the
// words of a line are marked "[word](/phonemes/)" for our audio.cpp, by the host's own rule,
// and only when the installed runtime splices (the port of tests/test_kokoro_ipa.py).
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as release from "../src/engines/audiocpp/release.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import { splice, toKokoro } from "../src/engines/kokoro/ipa.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import { CAPABILITY_DETAILS } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/manager.js";
import * as renderCore from "../src/render_core.js";

const TAG = release.cfg.TAG;
afterEach(() => {
  release.cfg.TAG = TAG;
});

test("canonical_ipa_becomes_kokoros_symbols", () => {
  for (const [ipa, kokoro] of [
    ["/ˈbiːtʃəm/", "ˈbiːʧəm"], // affricate → one symbol
    ["/laɪk/", "lIk"], // a diphthong → one symbol, so "like" keeps its off-glide
    ["[ˈwʊs.tər]", "ˈwʊstər"], // brackets and syllable dots go
    ["d͡ʒɔɪ", "ʤY"], // tie bar
    ["/ɡoʊ/", "ɡO"],
    ["go", "ɡo"], // ASCII g is ɡ to Kokoro
    ["/ˈhaʊs/", "ˈhWs"],
    ["/ˈboʊt/ /ˈbəʊt/", "ˈbOt/ /ˈbQt"], // only the outer slashes are a wrapper
  ]) {
    expect(toKokoro(ipa), ipa).toBe(kokoro);
  }
});

const marked = (text) => [...text.matchAll(/\[([^\]]+)\]\(\//g)].map((m) => m[1]).sort();

test("the_splice_marks_exactly_the_words_the_host_keeps", () => {
  // The table test_project_lexicon recorded from the pre-switch splice: the words spoken from
  // IPA for each text. The new splice must mark the same ones.
  const full = { Worcester: "W", "Mara Vance": "MV", Mara: "M", "Dr.": "D", "A.": "AA" };
  const spoken = {
    "To Worcester.": ["Worcester"],
    "worcester and Mara Vance": ["Mara Vance", "worcester"],
    "Mara came. Mara Vance left.": ["Mara", "Mara Vance"],
    Worcestershire: [],
    "Nobody here.": [],
    "Marathon Dr.A.": ["A.", "Dr."],
    "Worcester Dr. Worcester": ["Worcester", "Worcester"],
    "Dr.": [],
    "   ": [],
  };
  for (const [text, words] of Object.entries(spoken)) expect(marked(splice(text, full)), text).toEqual([...words].sort());
});

test("kokoro_gets_the_spliced_line", () => {
  const row = discoverEngines()
    .get("kokoro")
    .module.VARIANTS.find((r) => r.id === "kokoro-82m-q8");
  const req = toSpeechRequest(row, {
    voice_id: "af_heart",
    text: "Beauchamp came home.",
    language: "en-US",
    delivery: { ipa_map: { Beauchamp: "/ˈbiːtʃəm/" } },
  });
  expect(req.input).toBe("[Beauchamp](/ˈbiːʧəm/) came home.");
});

test("ipa_is_used_only_when_the_installed_runtime_splices", () => {
  const kokoro = CAPABILITY_DETAILS.kokoro;
  const had = kokoro.supports_phoneme_input;
  try {
    kokoro.supports_phoneme_input = true;
    vi.spyOn(runtime, "hasFeature").mockImplementation((name) => name === "inline_ipa");
    expect(renderCore._supportsPhonemeInput("kokoro")).toBe(true);
    vi.spyOn(runtime, "hasFeature").mockReturnValue(false);
    expect(renderCore._supportsPhonemeInput("kokoro")).toBe(false); // its respelling is used
    kokoro.supports_phoneme_input = false;
    vi.spyOn(runtime, "hasFeature").mockReturnValue(true);
    expect(renderCore._supportsPhonemeInput("kokoro")).toBe(false);
  } finally {
    kokoro.supports_phoneme_input = had;
  }
});

test("the_capability_follows_the_pin", () => {
  release.cfg.TAG = "v0.9.0";
  expect(release.pinnedHas("inline_ipa")).toBe(false);
  release.cfg.TAG = "v0.9.0-jv.4";
  expect(release.pinnedHas("inline_ipa")).toBe(true);
});
