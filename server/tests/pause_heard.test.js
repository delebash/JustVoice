// SPDX-License-Identifier: MIT
// The pause between lines is the pause heard, and a paragraph's lines join closer (decided
// 2026-10-07) — the port of tests/test_pause_heard.py.
//
// Kokoro pads every take with ~265 ms of silence before and ~715 ms after (exact digital zero),
// so a 600 ms pause played as ~1.6 s; and Analyze cuts a paragraph — a quote, its dialogue tag,
// the quote's rest — into lines joined at that same gap. (The trims run in audiocpp_dsp.)
import { expect, test, vi } from "vitest";
import "./engines_helpers.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import * as dspClient from "../src/audio/dsp_client.js";
import { paragraphJoins } from "../src/line_takes.js";
import { ChapterLine, construct, GenerationSettings, Settings } from "../src/models.js";
import * as renderCore from "../src/render_core.js";
import { concatLines, RenderedLine, TRIM_BELOW_DBFS, TRIM_KEEP_MS } from "../src/render_core.js";

const SR = 24000;
const ms = (nSamples) => Math.round((nSamples / SR) * 1000);

/** A take as a model hands it over: silence, sound, silence. */
function padded(leadMs, soundMs, trailMs, level = 8000) {
  const z = (m) => Array(Math.trunc((SR * m) / 1000)).fill(0);
  const samples = [...z(leadMs), ...Array(Math.trunc((SR * soundMs) / 1000)).fill(level), ...z(trailMs)];
  const b = Buffer.alloc(2 * samples.length);
  samples.forEach((v, i) => b.writeInt16LE(v, 2 * i));
  return b;
}

/** A line's silence trim, as concatLines asks the DSP program for it. */
const trimPcm = (pcm, sr, ch) => dspClient.fit(pcm, sr, ch, sr, ch, { trimBelowDbfs: TRIM_BELOW_DBFS, trimKeepMs: TRIM_KEEP_MS });

test("a_takes_own_silence_is_cut_to_the_margin", async () => {
  const out = await trimPcm(padded(265, 1000, 715), SR, 1);
  expect(ms(out.length / 2)).toBe(TRIM_KEEP_MS + 1000 + TRIM_KEEP_MS);
});

test("a_quiet_tail_above_the_threshold_is_kept", async () => {
  // A word's decay at −60 dBFS is sound, not padding — −45 dBFS cut up to 710 ms of one.
  const quiet = Math.trunc(32768 * 10 ** (-60 / 20)); // ≈ 33
  const tail = Buffer.alloc(2 * (Math.trunc(SR * 0.4) + Math.trunc(SR * 0.7)));
  for (let i = 0; i < Math.trunc(SR * 0.4); i++) tail.writeInt16LE(quiet, 2 * i);
  const pcm = Buffer.concat([padded(0, 500, 0), tail]);
  expect(ms((await trimPcm(pcm, SR, 1)).length / 2)).toBe(500 + 400 + TRIM_KEEP_MS);
});

test("a_silent_line_is_kept_as_it_is", async () => {
  const pcm = Buffer.alloc(2 * SR);
  expect((await trimPcm(pcm, SR, 1)).equals(pcm)).toBe(true);
});

test("the_join_plays_the_pause_set_not_the_padding", async () => {
  const line = () => new RenderedLine({ pcm: padded(265, 1000, 715), sampleRate: SR, channels: 1, effectiveDelivery: {} });
  const out = await concatLines([line(), line()], 600);
  // 50 + 1000 + 50 | 600 | 50 + 1000 + 50 — the padding (265 + 715 ms each) is gone.
  expect(ms(out.pcm.length / 2)).toBe(2 * (TRIM_KEEP_MS * 2 + 1000) + 600);
});

test("lines_of_one_paragraph_are_found_by_their_source_ref", () => {
  const ref = ([id, r]) => ({ id, metadata_json: r ? `{"source_ref": "${r}"}` : "{}" });
  const blocks = [
    ["a", "ch1#scene:s1#block:1"],
    ["b", "ch1#scene:s1#block:2"],
    ["c", "ch1#scene:s1#block:2"],
    ["d", "ch1#scene:s1#block:2"],
    ["e", null],
    ["f", null],
  ].map(ref);
  // c and d follow b and c in the same paragraph; lines with no source_ref never join closer.
  expect(paragraphJoins(blocks)).toEqual(new Set(["b", "c"]));
});

test("the_join_uses_the_pause_within_a_paragraph_and_the_scene_break", async () => {
  expect(construct(GenerationSettings, {}).pause_within_paragraph_ms).toBe(250);
  const settings = construct(Settings, {});
  settings.generation.pause_within_paragraph_ms = 250;
  settings.generation.pause_at_scene_break_ms = 2000;
  const st = { settings: { get: () => settings } };
  const seen = {};
  vi.spyOn(renderCore, "concatLines").mockImplementation(async (rendered, silenceMs) => {
    seen.rendered = rendered;
    seen.gap = silenceMs;
  });
  const lines = [
    construct(ChapterLine, { voice: "v", text: "“You flicker,”", paragraph_next: true }),
    construct(ChapterLine, { voice: "v", text: "she told it,", paragraph_next: true }),
    construct(ChapterLine, { voice: "v", text: "“and you’re steady.”", scene_break_after: true }),
    construct(ChapterLine, { voice: "v", text: "Next scene." }),
  ];
  const rendered = lines.map(() => new RenderedLine({ pcm: Buffer.alloc(0), sampleRate: SR, channels: 1, effectiveDelivery: { pause_after: 900 } }));
  await renderChapterApi._join(st, lines, rendered, 600);
  const after = seen.rendered.map((rl) => rl.effectiveDelivery.pause_after);
  // The paragraph's and the scene break's pauses win over a persona's 900 ms; the last line
  // keeps its own delivery.
  expect(after).toEqual([250, 250, 2000, 900]);
  expect(seen.gap).toBe(600);
  expect(rendered[0].effectiveDelivery.pause_after).toBe(900); // a cached line is never changed
});
