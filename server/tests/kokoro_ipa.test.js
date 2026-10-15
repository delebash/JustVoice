// SPDX-License-Identifier: MIT
// A lexicon's IPA reaches Kokoro again (gap 3): canonical IPA becomes Kokoro's symbols, the
// words of a line are marked "[word](/phonemes/)" for our audio.cpp, by the host's own rule,
// and only when the installed runtime splices (the port of tests/test_kokoro_ipa.py).
import { writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as release from "../src/engines/audiocpp/release.js";
import * as slot from "../src/engines/audiocpp/slot.js";
import { toSpeechRequest } from "../src/engines/audiocpp/slot.js";
import * as blending from "../src/engines/blending.js";
import { lacking, splice, toKokoro, vocabOf } from "../src/engines/kokoro/ipa.js";
import * as runtime from "../src/engines/audiocpp/runtime.js";
import { CAPABILITY_DETAILS } from "../src/engines/capability_details.js";
import { discoverEngines } from "../src/engines/manager.js";
import * as renderCore from "../src/render_core.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

const TAG = release.cfg.TAG;
afterEach(async () => {
  release.cfg.TAG = TAG;
  await closeApps();
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

// ── A symbol Kokoro lacks (decided 2026-10-15, the narrowings review F12) ───────────────────

/** A minimal audio.cpp GGUF carrying one embedded config.json with `vocab` — what Kokoro's
 * real file carries (114 symbols). */
function kokoroGguf(vocab) {
  const u32 = (n) => Buffer.from(Uint32Array.of(n).buffer);
  const u64 = (n) => {
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(BigInt(n));
    return b;
  };
  const str = (t) => Buffer.concat([u64(Buffer.byteLength(t)), Buffer.from(t, "utf8")]);
  const config = Buffer.from(JSON.stringify({ vocab: Object.fromEntries([...vocab].map((ch, i) => [ch, i])) }));
  const kv = [
    Buffer.concat([str("audiocpp.embedded_files.names"), u32(9), u32(8), u64(1), str("config.json")]),
    Buffer.concat([str("audiocpp.embedded_files.offsets"), u32(9), u32(10), u64(2), u64(0), u64(config.length)]),
    Buffer.concat([str("audiocpp.embedded_files.data"), u32(9), u32(0), u64(config.length), config]),
  ];
  const file = path.join(tmpPath(), "kokoro.gguf");
  writeFileSync(file, Buffer.concat([Buffer.from("GGUF"), u32(3), u64(0), u64(kv.length), ...kv]));
  return file;
}
// Enough of Kokoro's symbols for these words — and no ʍ, which Kokoro lacks.
const SYMBOLS = " ˈˌːbiʧəmlIkɡOwʊstərhWsAnvæ";

test("kokoros_symbols_come_from_its_own_model_file", () => {
  const vocab = vocabOf(kokoroGguf(SYMBOLS));
  expect(vocab.has("ʧ")).toBe(true);
  expect(lacking(toKokoro("/ˈbiːtʃəm/"), vocab)).toBeNull();
  expect(lacking(toKokoro("/ʍɛn/"), vocab)).toBe("ʍ");
  expect(vocabOf(path.join(tmpPath(), "missing.gguf"))).toBeNull();
  expect(lacking("ʍ", null)).toBeNull(); // nothing to check against: the runtime names it
});

test("a_word_with_a_symbol_kokoro_lacks_is_read_the_normal_way", () => {
  const vocab = vocabOf(kokoroGguf(SYMBOLS));
  const map = { Beauchamp: "/ˈbiːtʃəm/", Whateley: "/ˈʍeɪtli/" };
  expect(splice("Beauchamp met Whateley.", map, vocab)).toBe("[Beauchamp](/ˈbiːʧəm/) met Whateley.");
  // The match is the host's still: "Mara" isn't marked inside a "Mara Vance" left alone.
  expect(splice("Mara Vance and Mara.", { "Mara Vance": "ʍ", Mara: "mæɹə" }, new Set([..."mæə"]))).toBe("Mara Vance and Mara.");
  expect(splice("Mara Vance and Mara.", { "Mara Vance": "ʍ", Mara: "mæə" }, new Set([..."mæə"]))).toBe("Mara Vance and [Mara](/mæə/).");
  // The Kokoro request reads the symbols from the row's own file.
  vi.spyOn(slot, "kokoroVocab").mockReturnValue(vocab);
  const row = discoverEngines().get("kokoro").module.VARIANTS.find((r) => r.id === "kokoro-82m-q8");
  const req = toSpeechRequest(row, { voice_id: "af_heart", text: "Beauchamp met Whateley.", language: "en-US", delivery: { ipa_map: map } });
  expect(req.input).toBe("[Beauchamp](/ˈbiːʧəm/) met Whateley.");
});

test("saving_a_lexicon_names_the_symbol_kokoro_lacks", async () => {
  // Lexicons' warning on Save: "Kokoro can't say “ʍ” — it will speak this word the normal way."
  const { c } = await appClient();
  const entries = [{ grapheme: "Whateley", phoneme_ipa: "/ˈʍeɪtli/" }, { grapheme: "Beauchamp", phoneme_ipa: "/ˈbiːtʃəm/" }];
  // Kokoro not downloaded: nothing to check against.
  let r = await c.post("/v1/lexicons", { json: { name: "Names", entries } });
  expect(r.status, r.text).toBe(201);
  expect(r.json().kokoro_cant_say).toEqual([]);
  vi.spyOn(blending, "_kokoroGguf").mockReturnValue(kokoroGguf(SYMBOLS));
  r = await c.put(`/v1/lexicons/${r.json().id}`, { json: { name: "Names", entries } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().kokoro_cant_say).toEqual([{ grapheme: "Whateley", symbols: ["ʍ"] }]);
  // Every symbol it lacks, once each, in order.
  r = await c.put(`/v1/lexicons/${r.json().id}`, { json: { name: "Names", entries: [{ grapheme: "Bael", phoneme_ipa: "/ɫʍiɫ/" }] } });
  expect(r.json().kokoro_cant_say).toEqual([{ grapheme: "Bael", symbols: ["ɫ", "ʍ"] }]);
});
