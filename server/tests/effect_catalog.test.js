// SPDX-License-Identifier: MIT
// The effects catalog (GET /v1/effects/catalog) — the effects and knobs the chain editor offers.
// Chorus joined it 2026-10-15 (the build's question 10, "your rec"): audiocpp_dsp ran it for the
// built-in Robotic, but the editor could not offer it and the Effects page showed its key.
import { afterAll, expect, test } from "vitest";
import "./engines_helpers.js";
import { pyFloatValue as F } from "@delebash/llm-runner/platform/pyjson";
import * as dspClient from "../src/audio/dsp_client.js";
import { EFFECT_CATALOG } from "../src/audio/effect_catalog.js";
import { applyEffectsChain } from "../src/audio/effects.js";
import { BUILTIN_EFFECT_PRESETS } from "../src/database/seed.js";
import { sineWav } from "./audio_fixtures.js";

afterAll(() => dspClient.stop());

const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const chorus = () => EFFECT_CATALOG.find((e) => e.type === "chorus");

test("chorus_is_offered_with_its_five_knobs", () => {
  // Labels from what each parameter does in dsp/src/effects.cpp; defaults are the DSP's own
  // (what it uses when a chain leaves the knob out); a range only where the DSP clamps.
  expect(chorus().label).toBe("Chorus");
  expect(chorus().params.map((p) => [p.key, p.label, p.default, p.min, p.max])).toEqual([
    ["rate_hz", "Rate (Hz)", 1.0, null, null],
    ["depth", "Depth", 0.25, 0.0, 1.0],
    ["centre_delay_ms", "Centre delay (ms)", 7.0, 0.0, null],
    ["feedback", "Feedback", 0.0, 0.0, 0.95],
    ["mix", "Mix", 0.5, 0.0, 1.0],
  ]);
});

test("every_builtin_preset_uses_only_effects_and_knobs_the_catalog_offers", () => {
  // The Effects page names a preset's steps from the catalog, and the editor draws a step's knobs
  // from it: a type or a knob missing here showed as its key, or not at all.
  for (const preset of BUILTIN_EFFECT_PRESETS) {
    for (const step of preset.chain) {
      const spec = EFFECT_CATALOG.find((e) => e.type === step.type);
      expect(spec, `${preset.name}: ${step.type}`).toBeTruthy();
      for (const key of Object.keys(step.params)) expect(spec.params.map((p) => p.key), `${preset.name}: ${key}`).toContain(key);
    }
  }
});

test("the_catalogs_chorus_knobs_are_the_ones_the_dsp_takes", async () => {
  // A knob the DSP doesn't take makes it skip the whole effect (effects_chain.test.js
  // bad_parameter_name_is_skipped), so the audio would come back as it went in.
  const w = sineWav();
  const params = Object.fromEntries(chorus().params.map((p) => [p.key, F(p.default)]));
  expect(same(await applyEffectsChain(w, [{ type: "chorus", params }]), w)).toBe(false);
});
