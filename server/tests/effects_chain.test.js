// SPDX-License-Identifier: MIT
// Tests for the effects chain — the WAV-in/WAV-out layer over audiocpp_dsp (the port of
// tests/test_effects_chain.py).
//
// The chain's job is to be unbreakable: it is fed specs that come out of a database and a
// user-facing editor, so it has to survive misspellings, stale effect names, wrong parameter
// types and effects that throw, without ever failing a render.
import { afterAll, expect, test } from "vitest";
import "./engines_helpers.js";
import * as dspClient from "../src/audio/dsp_client.js";
import * as effects from "../src/audio/effects.js";
import { applyEffectsChain, chainEntries, effectsChainHash } from "../src/audio/effects.js";
import { parseWavHeader } from "../src/audio/wav.js";
import { BUILTIN_EFFECT_PRESETS } from "../src/database/seed.js";
import { sineWav } from "./audio_fixtures.js";
import { pyJsonParse } from "@delebash/llm-runner/platform/pyjson";

afterAll(() => dspClient.stop());

const frames = (w) => parseWavHeader(w)[0].sampleCount;
const rate = (w) => parseWavHeader(w)[0].sampleRate;
const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));

// ── the chain must never break a render ──────────────────────────────────

test("empty_chain_returns_the_input_untouched", async () => {
  const w = sineWav();
  expect(await applyEffectsChain(w, [])).toBe(w);
});

test("unknown_effect_type_is_skipped_not_raised", async () => {
  const w = sineWav();
  const out = await applyEffectsChain(w, [{ type: "flux_capacitor", params: {} }]);
  expect(same(out, w)).toBe(true); // nothing applied, nothing lost
});

test("bad_parameter_name_is_skipped", async () => {
  // `loudness_db` is not a gain parameter.
  const w = sineWav();
  expect(same(await applyEffectsChain(w, pyJsonParse('[{"type": "gain", "params": {"loudness_db": 6.0}}]')), w)).toBe(true);
});

test("params_of_the_wrong_type_is_skipped", async () => {
  const w = sineWav();
  expect(same(await applyEffectsChain(w, [{ type: "gain", params: ["6db"] }]), w)).toBe(true);
});

test("disabled_entries_do_not_apply", async () => {
  const w = sineWav();
  const chain = pyJsonParse('[{"type": "gain", "params": {"gain_db": 12.0}, "enabled": false}]');
  expect(same(await applyEffectsChain(w, chain), w)).toBe(true);
});

test("a_failing_effect_does_not_lose_the_render", async () => {
  // If an effect fails mid-chain we keep the audio. (A value that isn't a number makes the
  // effect fail when it runs, in audiocpp_dsp as in the numpy effects it replaced.)
  const w = sineWav();
  const chain = pyJsonParse('[{"type": "gain", "params": {"gain_db": "loud"}}, {"type": "lowpass", "params": {"cutoff_frequency_hz": 2000.0}}]');
  const out = await applyEffectsChain(w, chain);
  expect(frames(out)).toBe(frames(w));
  expect(same(out, w)).toBe(false); // the chain went on past the one that failed
});

test("undecodable_wav_is_returned_unchanged", async () => {
  const junk = Buffer.from("this is not a wav file");
  expect(same(await applyEffectsChain(junk, pyJsonParse('[{"type": "gain", "params": {"gain_db": 3.0}}]')), junk)).toBe(true);
});

// ── the contracts that downstream code depends on ────────────────────────

test("chain_preserves_frame_count_and_sample_rate", async () => {
  // Export manifests, M4B chapter marks and block offsets are all derived from render length.
  const w = sineWav();
  const chain = [
    { type: "reverb", params: { room_size: 0.8, wet_level: 0.6 } },
    { type: "delay", params: { delay_seconds: 0.25, feedback: 0.4, mix: 0.5 } },
  ];
  const out = await applyEffectsChain(w, chain);
  expect(frames(out)).toBe(frames(w));
  expect(rate(out)).toBe(rate(w));
});

test("a_real_chain_actually_changes_the_audio", async () => {
  const w = sineWav();
  expect(same(await applyEffectsChain(w, pyJsonParse('[{"type": "gain", "params": {"gain_db": -12.0}}]')), w)).toBe(false);
});

test("every_shipped_builtin_preset_runs_end_to_end", async () => {
  // The four seeded presets, taken from the seed data itself rather than retyped.
  const w = sineWav();
  expect(BUILTIN_EFFECT_PRESETS.length).toBeGreaterThan(0);
  for (const preset of BUILTIN_EFFECT_PRESETS) {
    const out = await applyEffectsChain(w, preset.chain);
    expect(frames(out), `${preset.name} changed length`).toBe(frames(w));
    expect(same(out, w), `${preset.name} did nothing`).toBe(false);
  }
});

// ── the cache key ────────────────────────────────────────────────────────

test("chain_hash_is_stable_and_order_sensitive", () => {
  const a = pyJsonParse('[{"type": "gain", "params": {"gain_db": 3.0}}]');
  const b = pyJsonParse('[{"type": "gain", "params": {"gain_db": 3.0}}]');
  const c = pyJsonParse('[{"type": "gain", "params": {"gain_db": 4.0}}]');
  expect(effectsChainHash(a)).toBe(effectsChainHash(b));
  expect(effectsChainHash(a)).not.toBe(effectsChainHash(c));
  expect(effectsChainHash([])).toBe("noeffects");
});

test("chain_hash_changes_when_the_dsp_version_does", () => {
  // The cache promises "same key -> same audio" — a claim about the CODE, not just the chain.
  const chain = [{ type: "reverb", params: { room_size: 0.5 } }];
  const before = effectsChainHash(chain);
  const original = effects.cfg.DSP_VERSION;
  try {
    effects.cfg.DSP_VERSION = "dsp-something-else";
    expect(effectsChainHash(chain)).not.toBe(before);
  } finally {
    effects.cfg.DSP_VERSION = original;
  }
});

// ── chain resolution (unchanged behaviour, guarded) ──────────────────────

test("a_stored_chain_keeps_only_its_entries", () => {
  // A persona's chain runs alone since render presets were removed (2026-10-03); anything in
  // it that isn't an entry is skipped.
  const persona = [{ type: "gain", params: { gain_db: 1.0 } }, "junk", null];
  expect(chainEntries(persona)).toEqual([{ type: "gain", params: { gain_db: 1.0 } }]);
  expect(chainEntries(null)).toEqual([]);
});
