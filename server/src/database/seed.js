// SPDX-License-Identifier: MIT
//
// Preset data adapted from voicebox (MIT) — backend/utils/effects.py BUILTIN_PRESETS at the
// commit pinned in voicebox-pin.txt. Original copyright (c) the voicebox authors.
//
// Idempotent boot-time seeding — built-in effect presets, and the serve-time workspace seed
// (the port of justvoice/database/seed.py).
//
// The EffectPreset model + API carried `is_builtin` guards from day one, but nothing ever
// inserted the built-ins (parity-audit finding F5). Runs on every boot; existing rows by
// name are left untouched so user edits to sort order survive.

import { getLogger } from "@delebash/llm-runner/platform/log";
import { pyFloatValue, pyJson } from "@delebash/llm-runner/platform/pyjson";
import * as session from "./session.js";

const log = getLogger("justvoice.database.seed");

// Every effect parameter below is a float in the Python literal (`1.0`, `300.0`), so it is
// stored as one: `"depth": 1.0` — the text a JavaScript writer must match (RESEARCH §6).
const floats = (params) => Object.fromEntries(Object.entries(params).map(([k, v]) => [k, pyFloatValue(v)]));

export const BUILTIN_EFFECT_PRESETS = [
  {
    name: "Robotic",
    sort_order: 0,
    description: "Metallic robotic voice (flanger with slow LFO and high feedback)",
    chain: [
      {
        type: "chorus",
        enabled: true,
        params: floats({ rate_hz: 0.2, depth: 1.0, feedback: 0.35, centre_delay_ms: 7.0, mix: 0.5 }),
      },
    ],
  },
  {
    name: "Radio",
    sort_order: 1,
    description: "Thin AM-radio voice with band-pass filtering and light compression",
    chain: [
      { type: "highpass", enabled: true, params: floats({ cutoff_frequency_hz: 300.0 }) },
      { type: "lowpass", enabled: true, params: floats({ cutoff_frequency_hz: 3500.0 }) },
      {
        type: "compressor",
        enabled: true,
        params: floats({ threshold_db: -15.0, ratio: 6.0, attack_ms: 5.0, release_ms: 50.0 }),
      },
      { type: "gain", enabled: true, params: floats({ gain_db: 6.0 }) },
    ],
  },
  {
    name: "Echo Chamber",
    sort_order: 2,
    description: "Spacious reverb with trailing echo",
    chain: [
      {
        type: "reverb",
        enabled: true,
        params: floats({ room_size: 0.85, damping: 0.3, wet_level: 0.45, dry_level: 0.55, width: 1.0 }),
      },
      { type: "delay", enabled: true, params: floats({ delay_seconds: 0.25, feedback: 0.3, mix: 0.2 }) },
    ],
  },
  {
    name: "Deep Voice",
    sort_order: 99,
    description: "Lower pitch with added warmth",
    chain: [
      { type: "pitch_shift", enabled: true, params: floats({ semitones: -3.0 }) },
      { type: "lowpass", enabled: true, params: floats({ cutoff_frequency_hz: 6000.0 }) },
      {
        type: "compressor",
        enabled: true,
        params: floats({ threshold_db: -18.0, ratio: 3.0, attack_ms: 10.0, release_ms: 150.0 }),
      },
    ],
  },
];

/** Insert any missing built-in presets. Safe to call on every boot. */
export function seedBuiltinEffectPresets() {
  const h = session.cfg.handle;
  if (h === null) return;
  try {
    h.tx(() => {
      for (const preset of BUILTIN_EFFECT_PRESETS) {
        if (h.one("select id from effect_presets where name = ? limit 1", [preset.name])) continue;
        h.insert("effect_presets", {
          name: preset.name,
          description: preset.description,
          chain_json: pyJson(preset.chain),
          is_builtin: true,
          sort_order: preset.sort_order,
        });
      }
    });
  } catch (e) {
    log.warning(`builtin effect-preset seed failed: ${e?.message ?? e}`);
  }
}

/**
 * Serve-time workspace seeding — the family call-site (target-tree P6). It moved out of the
 * app factory so a test's fresh app starts from an EMPTY database; the server calls it after
 * creating the app, and tests that assert seeded content call it explicitly. The factory
 * reset stays on its own bundle (data_admin → llm_bootstrap.reseedSharedLlm).
 *
 * ORDER IS THE CONTRACT: effect presets (an independent domain seed) first; the
 * legacy-prompt migration BEFORE seedLlm (user edits win over seed defaults); the
 * settings→DB provider migration, the shared seed, then the registry boots FROM THE DB —
 * JustWrite's exact order, so `registered` flags are live from boot; the tunable lift and
 * the catalog-row retirement after the presets exist.
 *
 * Async because its collaborators are loaded lazily, as Python imported them inside the
 * function (engines/llm is another slice's module).
 */
export async function seedWorkspace() {
  const { loadFromConfigs, stores } = await import("@delebash/llm-runner/llm");
  const { seedLlm } = await import("@delebash/llm-runner/llm/seed");
  const { getState } = await import("../app_state.js");
  const migratePrompts = await import("../engines/llm/migrate_prompts.js");
  const { migrateSettingsProvidersToDb } = await import("../engines/llm/migrate_providers.js");
  const { retireDefaultCatalogRows } = await import("../llm_bootstrap.js");

  seedBuiltinEffectPresets();
  // JV's warm-OFF override retired 2026-08-13 with the VRAM wiring — the shared seed's
  // family default (warm ON) reaches fresh DBs directly.
  await migratePrompts.migrateJvPromptsToShared();
  await migrateSettingsProvidersToDb(getState().settings.get());
  seedLlm();
  await migratePrompts.liftEditedTunablesIntoPresets();
  retireDefaultCatalogRows();
  loadFromConfigs(stores.getProviderStore().list());
}
