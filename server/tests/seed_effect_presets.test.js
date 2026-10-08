// SPDX-License-Identifier: MIT
// Built-in effect presets must exist after boot (parity-audit fix) and every type they use
// must be one the effects chain knows — since 2026-10-07 the chain runs in audiocpp_dsp,
// which passes an unknown effect through (the port of tests/test_seed_effect_presets.py).
//
// Python booted create_app + seed_workspace; the boot's part this test reads is the
// database plus the effect-preset seed, which run here directly (app.js is a later wave's).
import { afterAll, afterEach, expect, test } from "vitest";
import "./engines_helpers.js";
import * as dspClient from "../src/audio/dsp_client.js";
import { applyEffectsChain } from "../src/audio/effects.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as session from "../src/database/session.js";
import { seedBuiltinEffectPresets } from "../src/database/seed.js";
import { pyJsonParse } from "../src/models.js";
import { closeModuleDb, initDbAt, tmpPath } from "./helpers.js";

afterAll(() => dspClient.stop());
afterEach(() => closeModuleDb());

function toneWav() {
  const sr = 24000;
  const n = Math.floor(sr / 2);
  const b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.trunc(0.3 * 32767 * Math.sin((2 * Math.PI * 220 * i) / sr)), i * 2);
  return writeWavContainer(b, sr, 1);
}

test("builtins_seeded_and_buildable", async () => {
  initDbAt(tmpPath());
  seedBuiltinEffectPresets();
  const rows = session.getDb().all("select * from effect_presets where is_builtin");
  const names = new Set(rows.map((r) => r.name));
  for (const n of ["Robotic", "Radio", "Echo Chamber", "Deep Voice"]) expect(names.has(n)).toBe(true);
  // Every enabled effect in every preset must be one the chain knows — catches the
  // missing-chorus case (Robotic silently became a no-op): an unknown effect gives the audio
  // back untouched.
  const wav = toneWav();
  for (const r of rows) {
    for (const entry of pyJsonParse(r.chain_json)) {
      if (entry.enabled ?? true) {
        const out = await applyEffectsChain(wav, [entry]);
        expect(Buffer.from(out).equals(wav), `${r.name}: ${entry.type} did nothing`).toBe(false);
      }
    }
  }
});

test("disabled_effects_are_skipped", async () => {
  const wav = toneWav();
  const chain = pyJsonParse(`[
    {"type": "gain", "enabled": false, "params": {"gain_db": 6.0}},
    {"type": "gain", "enabled": true, "params": {"gain_db": 3.0}},
    {"type": "gain", "params": {"gain_db": 1.0}}
  ]`);
  const all = await applyEffectsChain(wav, chain);
  const rest = await applyEffectsChain(wav, chain.slice(1));
  expect(Buffer.from(all).equals(Buffer.from(rest))).toBe(true);
  expect(Buffer.from(await applyEffectsChain(wav, chain.slice(0, 1))).equals(wav)).toBe(true);
});
