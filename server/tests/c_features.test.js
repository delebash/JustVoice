// SPDX-License-Identifier: MIT
// Pins for the C-features go (2026-08-21): word alignment + captions, the pronunciation scan,
// and voice bundles (the port of tests/test_c_features.py). Each pins the pure core whose
// silent failure would produce a WRONG artifact rather than an error.
import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { alignKnownText } from "../src/alignment.js";
import { groupCues, toSrt, toVtt } from "../src/captions.js";
import { construct, utcNow, VoiceRecord } from "../src/models.js";
import { scanNames } from "../src/pronunciation.js";
import { ZipReader, ZipWriter } from "@delebash/llm-runner/platform/zip";
import { buildBundle, importBundle } from "../src/voice_bundle.js";
import { tmpPath } from "./helpers.js";

// ── Alignment ────────────────────────────────────────────────────────────

test("alignment_matched_words_take_hypothesis_timing", () => {
  const hyp = [
    { word: "the", start: 0.0, end: 0.2 },
    { word: "ancient", start: 0.2, end: 0.8 },
    { word: "library", start: 0.8, end: 1.4 },
  ];
  const out = alignKnownText("The ancient library", hyp, { totalDuration: 1.5 });
  expect(out.map((w) => w.word)).toEqual(["The", "ancient", "library"]);
  expect(out[1].start).toBe(0.2);
  expect(out[1].end).toBe(0.8);
});

test("alignment_survives_an_asr_misread", () => {
  // Whisper hears "Wooster", the caption still says Worcester — with real timing
  // interpolated between its matched neighbours.
  const hyp = [
    { word: "he", start: 0.0, end: 0.3 },
    { word: "visited", start: 0.3, end: 0.9 },
    { word: "Wooster", start: 0.9, end: 1.5 }, // misread
    { word: "today", start: 1.5, end: 2.0 },
  ];
  const out = alignKnownText("He visited Worcester today", hyp, { totalDuration: 2.0 });
  const w = out[2];
  expect(w.word).toBe("Worcester");
  expect(0.9 <= w.start && w.start < w.end && w.end <= 1.5).toBe(true); // inside its slot
  expect(out[3].start).toBe(1.5); // the neighbour keeps its own timing
});

test("alignment_is_monotonic_even_with_garbage_hypothesis", () => {
  const out = alignKnownText("one two three four", [{ word: "zzz", start: 5.0, end: 5.1 }], { totalDuration: 4.0 });
  expect(out.length).toBe(4);
  for (let i = 0; i + 1 < out.length; i++) {
    const [a, b] = [out[i], out[i + 1]];
    expect(a.end <= b.start || Math.abs(a.end - b.start) < 1e-9).toBe(true);
  }
  expect(out.every((w) => w.end >= w.start)).toBe(true);
});

test("alignment_punctuation_does_not_break_matching", () => {
  const hyp = [
    { word: "hello", start: 0.1, end: 0.5 },
    { word: "world", start: 0.5, end: 1.0 },
  ];
  const out = alignKnownText('"Hello, world!"', hyp, { totalDuration: 1.0 });
  expect(out[0].word).toBe('"Hello,');
  expect(out[0].start).toBe(0.1); // matched despite quotes and comma
});

// ── Captions ─────────────────────────────────────────────────────────────

const words = (n, step = 0.4) => Array.from({ length: n }, (_, i) => ({ word: `w${i}`, start: i * step, end: (i + 1) * step }));

test("cues_break_on_length_and_gap", () => {
  let cues = groupCues(words(14));
  expect(cues.every((c) => c.text.length <= 60)).toBe(true);
  expect(cues.length).toBeGreaterThanOrEqual(2);
  // A long pause forces a cue break even mid-count.
  cues = groupCues([...words(3), { word: "later", start: 10.0, end: 10.4 }]);
  expect(cues[cues.length - 1].text).toBe("later");
});

test("vtt_and_srt_formats", () => {
  const w = [
    { word: "hello", start: 0.0, end: 1.5 },
    { word: "there", start: 1.5, end: 3661.25 },
  ];
  const vtt = toVtt(w);
  expect(vtt.startsWith("WEBVTT")).toBe(true);
  expect(vtt).toContain("00:00:00.000 -->");
  const srt = toSrt(w);
  expect(srt.split("\n")[0]).toBe("1");
  expect(srt.split(" --> ")[0]).toContain(","); // SRT uses comma milliseconds
  expect(srt).toContain("01:01:01"); // 3661 s formats as h:m:s
});

// ── Pronunciation scan ───────────────────────────────────────────────────

/** Every line read with the same lexicon words. */
const each = (texts, covered = []) => texts.map((t) => [t, new Set(covered)]);

test("scan_finds_mid_sentence_names_only", () => {
  const texts = [
    "Elara crossed the square. The baker waved at Elara.",
    "Nobody had seen Brindlewood so quiet. Quiet suited it.",
  ];
  const found = Object.fromEntries(scanNames(each(texts)).map((w) => [w.word, w.count]));
  expect(found.Elara).toBe(2); // mid-sentence occurrence qualifies it
  expect(found.Brindlewood).toBe(1);
  // "Quiet" starts a sentence AND appears lowercase — an ordinary word.
  expect("Quiet" in found).toBe(false);
  expect("The" in found || "Nobody" in found).toBe(false);
});

test("scan_respects_lexicon_coverage", () => {
  const out = scanNames(each(["They followed Elara to Brindlewood."], ["elara"]));
  expect(out.map((w) => w.word)).toEqual(["Brindlewood"]);
});

test("scan_coverage_is_per_line", () => {
  // A persona's lexicon reaches only that persona's lines (2026-09-30), so a name it holds
  // still counts where someone else says it.
  const out = scanNames([
    ["They followed Elara home.", new Set(["Elara"])],
    ["Nobody told Elara why.", new Set()],
  ]);
  expect(out).toEqual([{ word: "Elara", count: 1 }]);
});

test("scan_respects_multiword_coverage_but_flags_lone_parts", () => {
  // Review R2: "Mara Vance" covers exactly that phrase — its words must not re-flag inside
  // it, while a LONE "Mara" elsewhere is genuinely uncovered and still surfaces.
  const texts = ["They met Mara Vance at the mill. Later Mara smiled at Vance."];
  const out = Object.fromEntries(scanNames(each(texts, ["Mara Vance"])).map((w) => [w.word, w.count]));
  expect(out).toEqual({ Mara: 1, Vance: 1 }); // only the lone occurrences
});

test("scan_orders_by_frequency", () => {
  const out = scanNames(each(["Ask Wren. Tell Wren everything, and bring Alder to Wren."]));
  expect(out.map((w) => w.word)).toEqual(["Wren", "Alder"]);
});

// ── Voice bundles ────────────────────────────────────────────────────────

const SR = 24000;

function wav(seconds = 1.0) {
  const n = Math.trunc(SR * seconds);
  const pcm = Buffer.alloc(2 * n);
  for (let i = 0; i < n; i++) pcm.writeInt16LE(Math.trunc(9000 * Math.sin((2 * Math.PI * 220 * i) / SR)), 2 * i);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0, "latin1");
  h.writeUInt32LE(36 + pcm.length, 4);
  h.write("WAVEfmt ", 8, "latin1");
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24);
  h.writeUInt32LE(SR * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write("data", 36, "latin1");
  h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

/** The voices store's shape (get / create / refWavPath / writeRefWav), in memory. */
class FakeVoices {
  constructor(root) {
    this.root = root;
    this.records = new Map();
  }
  get(vid) {
    return this.records.get(vid) ?? null;
  }
  create(rec) {
    const out = { ...rec, id: `voice_${this.records.size}` };
    this.records.set(out.id, out);
    return out;
  }
  refWavPath(vid) {
    return path.join(this.root, vid, "ref.wav");
  }
  writeRefWav(vid, data) {
    const p = this.refWavPath(vid);
    mkdirSync(path.dirname(p), { recursive: true });
    writeFileSync(p, data);
  }
}

function rec(kw = {}) {
  const now = utcNow();
  return construct(VoiceRecord, {
    id: "",
    engine: "chatterbox",
    source: "cloned",
    name: "Marius",
    language: "en-US",
    transcript: "hello",
    created_at: now,
    updated_at: now,
    ...kw,
  });
}

const isFile = (p) => {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
};

test("bundle_round_trip_carries_the_clip", () => {
  const store = new FakeVoices(tmpPath());
  const v = store.create(rec());
  store.writeRefWav(v.id, wav());
  const [payload, filename] = buildBundle(store, v.id);
  expect(filename).toBe("Marius.jvvoice.zip");
  expect(new Set(ZipReader.fromBuffer(payload).names())).toEqual(new Set(["voice.json", "ref.wav"]));
  const back = importBundle(store, payload, { knownEngines: new Set(["chatterbox"]) });
  expect(back.name).toBe("Marius");
  expect(back.engine).toBe("chatterbox");
  expect(isFile(store.refWavPath(back.id))).toBe(true);
});

test("bundle_carries_the_model_and_skip_the_words", () => {
  // Until 2026-10-05 the file left the model out, so an imported Turbo clone spoke on the
  // engine's default model.
  const store = new FakeVoices(tmpPath());
  const v = store.create(rec({ model: "chatterbox-turbo", xvector_only: true }));
  store.writeRefWav(v.id, wav());
  const [payload] = buildBundle(store, v.id);
  const back = importBundle(store, payload, { knownEngines: new Set(["chatterbox"]) });
  expect(back.model).toBe("chatterbox-turbo");
  expect(back.xvector_only).toBe(true);
});

test("bundle_refuses_missing_engine_with_the_reason", () => {
  const store = new FakeVoices(tmpPath());
  const v = store.create(rec());
  store.writeRefWav(v.id, wav());
  const [payload] = buildBundle(store, v.id);
  expect(() => importBundle(store, payload, { knownEngines: new Set(["kokoro"]) })).toThrow(/chatterbox/);
});

test("bundle_refuses_a_preset", () => {
  const store = new FakeVoices(tmpPath());
  // A stored record cannot be a preset, so the guard is defensive — build one past validation
  // to reach it.
  const v = store.create({ ...rec(), source: "preset" });
  expect(() => buildBundle(store, v.id)).toThrow(/preset/);
});

test("bundle_refuses_a_clip_voice_without_its_clip", () => {
  // A cloned voice whose bundle lost ref.wav must refuse, not import a voice that can never
  // render.
  const store = new FakeVoices(tmpPath());
  const v = store.create(rec());
  store.writeRefWav(v.id, wav());
  const [payload] = buildBundle(store, v.id);
  // Strip ref.wav out of the archive.
  const zip = new ZipWriter();
  zip.writestr("voice.json", ZipReader.fromBuffer(payload).read("voice.json"));
  const stripped = zip.toBuffer();
  expect(() => importBundle(store, stripped, { knownEngines: new Set(["chatterbox"]) })).toThrow(/reference clip/);
});

test("blended_bundle_needs_no_clip_but_needs_its_vector", () => {
  const store = new FakeVoices(tmpPath());
  const v = store.create(rec({ engine: "kokoro", source: "blended", embedding: [0.1, 0.2], transcript: null }));
  const [payload] = buildBundle(store, v.id);
  const back = importBundle(store, payload, { knownEngines: new Set(["kokoro"]) });
  expect(back.embedding).toEqual([0.1, 0.2]);
});
