// SPDX-License-Identifier: MIT
// Tests for the mastering preset values + their conformance to spec (the port of
// tests/test_mastering_presets.py) — the preset defaults target the correct spec without
// running ffmpeg.
import { expect, test } from "vitest";
import { construct, MasterPreset, MasterPresetSettings, modelDump } from "../src/models.js";

const presets = () => construct(MasterPresetSettings, {});

test("acx_preset_centers_in_acx_lufs_range", () => {
  // ACX spec: -23 LUFS <= integrated loudness <= -18 LUFS; centered at -20.
  const p = presets();
  expect(p.acx.loudness_target_lufs).toBeGreaterThanOrEqual(-23.0);
  expect(p.acx.loudness_target_lufs).toBeLessThanOrEqual(-18.0);
  expect(p.acx.loudness_target_lufs).toBe(-20.0);
});

test("acx_peak_below_minus_three_dbfs", () => {
  // ACX spec: true peak <= -3 dB. We carry 0.5 dB of safety headroom.
  const p = presets();
  expect(p.acx.true_peak_dbfs).toBeLessThanOrEqual(-3.0);
  expect(p.acx.true_peak_dbfs).toBe(-3.5);
});

test("acx_mp3_192_mono_44100", () => {
  // ACX retail format requirements.
  const p = presets();
  expect(p.acx.format).toBe("mp3");
  expect(p.acx.bitrate_kbps).toBe(192);
  expect(p.acx.sample_rate).toBe(44_100);
  expect(p.acx.channels).toBe(1);
});

test("acx_head_silence_within_spec", () => {
  // ACX wants 0.5-1 second of room-tone head silence.
  const s = presets().acx.head_silence_secs;
  expect(s >= 0.5 && s <= 1.0).toBe(true);
});

test("acx_tail_silence_within_spec", () => {
  // ACX wants 1-5 seconds of room-tone tail silence between sections.
  const s = presets().acx.tail_silence_secs;
  expect(s >= 1.0 && s <= 5.0).toBe(true);
});

test("podcast_louder_than_acx", () => {
  // Podcast platforms (Apple/Spotify) target -16 LUFS; audiobooks target -20.
  const p = presets();
  expect(p.podcast.loudness_target_lufs).toBeGreaterThan(p.acx.loudness_target_lufs);
});

test("youtube_loudest", () => {
  // YouTube normalizes to -14 LUFS; ours matches.
  expect(presets().youtube.loudness_target_lufs).toBe(-14.0);
});

test("master_preset_serializes", () => {
  // Round-trip — confirms cross-language API stability.
  const p = presets();
  expect(construct(MasterPresetSettings, modelDump(MasterPresetSettings, p))).toEqual(p);
});

test("user_can_override_acx_preset", () => {
  // Operator-tunable — every knob in settings.
  const custom = construct(MasterPreset, {
    loudness_target_lufs: -22.0,
    true_peak_dbfs: -3.0,
    loudness_range_lu: 7.0,
    sample_rate: 44_100,
    channels: 1,
    format: "mp3",
    bitrate_kbps: 192,
    head_silence_secs: 0.75,
    tail_silence_secs: 3.0,
  });
  expect(construct(MasterPresetSettings, { acx: custom }).acx.loudness_target_lufs).toBe(-22.0);
});
