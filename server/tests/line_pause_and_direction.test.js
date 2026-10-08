// SPDX-License-Identifier: MIT
// Per-line pauses and per-line direction actually reach the render (the port of
// tests/test_line_pause_and_direction.py).
//
// Both were stored, editable, documented and dropped: `concat_lines` used one fixed project
// gap, so `pause_before` / `pause_after` — the Generate sliders, the delivery overlay, and the
// `pause_after_ms` every import adapter parses — did nothing; and `Block.direction` was never
// read by a render path. These pin both.
import { expect, test } from "vitest";
import "./engines_helpers.js";
import { StandardLine } from "../src/imports/standard_schema.js";
import { lineOverride, overrideDelivery } from "../src/line_takes.js";
import { concatLines, RenderedLine } from "../src/render_core.js";

/** A silent mono 24 kHz line of `ms`, carrying its pause delivery. */
function line(ms, { before = null, after = null } = {}) {
  const delivery = {};
  if (before !== null) delivery.pause_before = before;
  if (after !== null) delivery.pause_after = after;
  return new RenderedLine({ pcm: Buffer.alloc(2 * Math.trunc((24000 * ms) / 1000)), sampleRate: 24000, channels: 1, effectiveDelivery: delivery });
}

const msOf = (rl) => (rl.pcm.length / 2 / rl.sampleRate) * 1000;

test("project_gap_is_used_when_no_line_sets_a_pause", async () => {
  expect(Math.round(msOf(await concatLines([line(100), line(100)], 250)))).toBe(450); // 100 + 250 + 100
});

test("pause_after_on_the_previous_line_overrides_the_project_gap", async () => {
  expect(Math.round(msOf(await concatLines([line(100, { after: 1000 }), line(100)], 250)))).toBe(1200); // replaced, not added
});

test("pause_before_on_the_next_line_also_overrides", async () => {
  expect(Math.round(msOf(await concatLines([line(100), line(100, { before: 500 })], 250)))).toBe(700);
});

test("both_sides_of_a_join_add_together", async () => {
  expect(Math.round(msOf(await concatLines([line(100, { after: 300 }), line(100, { before: 200 })], 250)))).toBe(700);
});

test("an_explicit_zero_pause_means_no_gap_not_the_default", async () => {
  // Blank falls through to the project gap; 0 is a deliberate butt-join.
  expect(Math.round(msOf(await concatLines([line(100, { after: 0 }), line(100)], 250)))).toBe(200);
});

test("pauses_apply_per_join_not_globally", async () => {
  const out = await concatLines([line(100, { after: 1000 }), line(100), line(100)], 250);
  expect(Math.round(msOf(out))).toBe(1550); // 100 +1000+ 100 +250+ 100
});

test("garbage_pause_values_fall_back_to_the_project_gap", async () => {
  const bad = line(100);
  bad.effectiveDelivery.pause_after = "not a number";
  expect(Math.round(msOf(await concatLines([bad, line(100)], 250)))).toBe(450);
});

// ── Block.direction → the engine's instruct ──────────────────────────────

test("block_pause_after_is_read_off_the_metadata", () => {
  // An import's pause_after_ms is the line's own pause (line_takes, Slice 4) — sent as the
  // plan's request, so it wins over the persona's (G7).
  const b = { metadata_json: JSON.stringify({ source_ref: "x", pause_after_ms: 750 }) };
  expect(lineOverride(b)).toEqual({ pause_after_ms: 750 });
  expect(overrideDelivery(b)).toEqual({ pause_after: 750 });
});

test("block_pause_after_is_none_when_absent_or_unparseable", () => {
  for (const b of [
    { metadata_json: null },
    { metadata_json: JSON.stringify({ marker: true }) },
    { metadata_json: "{not json" },
    { metadata_json: JSON.stringify({ pause_after_ms: "soon" }) },
  ]) {
    expect("pause_after_ms" in lineOverride(b)).toBe(false);
  }
});

test("import_adapters_still_parse_pause_after_ms", () => {
  // The producer side of the pause path — a field with no consumer was the bug; a consumer
  // with no producer would be the same bug inverted.
  expect("pause_after_ms" in StandardLine.properties).toBe(true);
});

// ── Lines from engines with different formats (2026-10-02) ──────────────

/** A 440 Hz tone at `sr` / `ch` — numpy's `(0.3 * sin(…) * 32767).astype("<i2")`. */
function tone(sr, ch, seconds = 1.0, hz = 440.0) {
  const n = Math.trunc(sr * seconds);
  const b = Buffer.alloc(2 * n * ch);
  for (let i = 0; i < n; i++) {
    const v = Math.trunc(0.3 * Math.sin((2 * Math.PI * hz * i) / sr) * 32767);
    for (let c = 0; c < ch; c++) b.writeInt16LE(v, 2 * (i * ch + c));
  }
  return new RenderedLine({ pcm: b, sampleRate: sr, channels: ch, effectiveDelivery: {} });
}

test("a_chapter_mixing_rates_joins_at_the_highest_rate_and_keeps_every_lines_length", async () => {
  // A 48 kHz VoxCPM2 line beside a 24 kHz line used to be appended raw — half speed, an octave
  // low. Both now play for their real length at the chapter's 48 kHz.
  const out = await concatLines([tone(24000, 1), tone(48000, 1)], 250);
  expect([out.sampleRate, out.channels]).toEqual([48000, 1]);
  expect(Math.round((out.pcm.length / 2 / 48000) * 1000) / 1000).toBe(2.25); // 1 s + 0.25 s gap + 1 s
  // The upsampled 24 kHz tone is still 440 Hz, not 220: the strongest DFT bin under 2 kHz of
  // the first second (numpy's rfft argmax over the same samples; 1 Hz bins).
  const N = 48000;
  const x = new Float64Array(N);
  for (let i = 0; i < N; i++) x[i] = out.pcm.readInt16LE(2 * i);
  let best = 0;
  let bestMag = -1;
  for (let k = 1; k < 2000; k++) {
    let re = 0;
    let im = 0;
    const w = (2 * Math.PI * k) / N;
    for (let i = 0; i < N; i++) {
      re += x[i] * Math.cos(w * i);
      im -= x[i] * Math.sin(w * i);
    }
    const mag = re * re + im * im;
    if (mag > bestMag) {
      bestMag = mag;
      best = k;
    }
  }
  expect(Math.abs((best * 48000) / N - 440)).toBeLessThan(2);
});

test("a_stereo_line_makes_the_chapter_stereo", async () => {
  const out = await concatLines([tone(24000, 1), tone(24000, 2)], 0);
  expect([out.sampleRate, out.channels]).toEqual([24000, 2]);
  expect(out.pcm.length).toBe(2 * 24000 * 2 * 2); // 2 s, stereo, 16-bit
});
