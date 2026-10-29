// SPDX-License-Identifier: MIT
// Boot-time seeding, run after the app is built (serve.js) — never inside the app factory, so a
// test's fresh app starts from an empty database.
//
// Two parts:
//   - the built-in effect presets (Robotic, Radio, Echo Chamber, Deep Voice) — the starting points
//     the effects-chain editor offers. A preset is matched by NAME and only ever inserted: a
//     database that already has a preset of that name keeps it as it is, built-in or the user's.
//   - the workspace seed — the shared LLM stack's migrations and seed in JustWrite's order, then
//     the settings that moved into the kit carried there (the kit's retireSettings), then the
//     provider registry booted from the database.

import { stores } from "@delebash/core/llm";
import { retireSettings } from "@delebash/core/platform";
import { getLogger } from "@delebash/core/platform/log";
import { pyFloatValue as F, pyJson } from "@delebash/core/platform/pyjson";
import { settingKey } from "@delebash/core/runner/runtimes";
import { deleteStoredSetting, storedSetting } from "../storage/settings_store.js";
import { EffectPreset } from "./models.js";
import * as session from "./session.js";

const log = getLogger("justvoice.database.seed");

// The speech runtime's settings (`engines.speech_runtime`), now the kit's audio.cpp runtime's own —
// its runner settings `<name>:audiocpp`, the same names and defaults (runner/config.js
// DEFAULT_AUDIOCPP_SETTINGS; round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 1).
export const SPEECH_RUNTIME_SETTINGS = [
  "backend", "gpu", "cpu_threads", "cpu_min_realtime", "spill_mb", "runaway_s_per_char", "runaway_min_s",
  "card_margin_mb", "gpu_threads", "start_timeout_s", "request_timeout_s",
];

/** Each speech runtime setting still in the stored settings row carried into the kit's runner
 * setting, and out of the row (the kit's retireSettings — read from the row as stored). Run at
 * every seed, after the kit's rows: a restored older backup's values carry over too. */
export function retireSpeechRuntimeSettings() {
  const h = session.cfg.handle;
  const moves = Object.fromEntries(
    SPEECH_RUNTIME_SETTINGS.map((name) => [
      `engines.speech_runtime.${name}`,
      (value) => stores.getRunnerConfigStore().setSetting(settingKey("audiocpp", name), value),
    ]),
  );
  const out = retireSettings(h, moves, { getSetting: storedSetting, deleteSetting: deleteStoredSetting });
  if (out.moved.length) log.info(`the speech runtime's settings are the AI stack's now, carried over: ${out.moved.join(", ")}`);
  for (const k of out.kept) log.warning(`the setting ${k.key} couldn't move into the AI stack yet: ${k.error?.message ?? k.error}`);
  return out;
}

const on = (type, params) => ({ type, enabled: true, params });

// Every parameter is a float on disk (`1.0`, not `1` — the chain's stored form), so each value
// goes through `F`. Each effect alone audibly changes a voice, and no chain changes the length.
export const BUILTIN_EFFECT_PRESETS = [
  {
    name: "Robotic",
    sort_order: 10,
    description: "A machine voice: a slow flanging sweep with a metallic ring and a little grit.",
    chain: [
      on("chorus", { rate_hz: F(0.35), depth: F(0.4), centre_delay_ms: F(3.0), feedback: F(0.65), mix: F(0.55) }),
      on("eq_mid", { cutoff_frequency_hz: F(1100.0), gain_db: F(5.0), q: F(1.6) }),
      on("distortion", { drive_db: F(8.0) }),
    ],
  },
  {
    name: "Radio",
    sort_order: 20,
    description: "An old AM set: only the middle of the voice gets through, squeezed flat and driven hot.",
    chain: [
      on("highpass", { cutoff_frequency_hz: F(450.0) }),
      on("lowpass", { cutoff_frequency_hz: F(3200.0) }),
      on("compressor", { threshold_db: F(-24.0), ratio: F(6.0), attack_ms: F(2.0), release_ms: F(150.0) }),
      on("distortion", { drive_db: F(12.0) }),
    ],
  },
  {
    name: "Echo Chamber",
    sort_order: 30,
    description: "A large, hard-walled room: a wide reverb tail with a repeating echo behind the voice.",
    chain: [
      on("reverb", { room_size: F(0.92), damping: F(0.18), wet_level: F(0.38), dry_level: F(0.72), width: F(0.9) }),
      on("delay", { delay_seconds: F(0.24), feedback: F(0.4), mix: F(0.3) }),
    ],
  },
  {
    name: "Deep Voice",
    sort_order: 40,
    description: "Three semitones lower, with more weight in the low end and an evened-out level.",
    chain: [
      on("pitch_shift", { semitones: F(-3.0) }),
      on("eq_low", { cutoff_frequency_hz: F(220.0), gain_db: F(4.0), q: F(0.7) }),
      on("compressor", { threshold_db: F(-20.0), ratio: F(2.5), attack_ms: F(8.0), release_ms: F(200.0) }),
    ],
  },
];

/** Insert every built-in preset the database has no preset of that name for. Never throws: a
 * failed seed is logged and the app carries on without the missing presets. */
export function seedBuiltinEffectPresets() {
  const h = session.cfg.handle;
  if (h === null) return;
  try {
    h.tx(() => {
      for (const preset of BUILTIN_EFFECT_PRESETS) {
        if (h.one(`select id from ${EffectPreset} where name = ? limit 1`, [preset.name]) !== null) continue;
        h.insert(EffectPreset, {
          name: preset.name,
          description: preset.description,
          chain_json: pyJson(preset.chain),
          is_builtin: true,
          sort_order: preset.sort_order,
        });
      }
    });
  } catch (e) {
    log.warning(`seeding the built-in effect presets failed: ${e?.message ?? e}`);
  }
}

/**
 * The workspace seed. The ORDER is the contract (JustWrite's):
 *   1. the built-in effect presets (independent of the rest);
 *   2. JustVoice's legacy prompt rows into the shared table — before the shared seed, so a prompt
 *      the user edited wins over the seed's default;
 *   3. providers kept in settings into the database;
 *   4. the shared seed;
 *   5. tunables edited on legacy rows onto the presets — once the presets exist;
 *   6. retired default catalog rows out;
 *   7. the speech runtime's settings into the kit's audio.cpp runtime — once its rows exist;
 *   8. the provider registry booted from the database, so `registered` is live from boot.
 * The collaborators load at call time (they sit in import cycles with the app). Errors from
 * steps 2–8 propagate.
 */
export async function seedWorkspace() {
  seedBuiltinEffectPresets();

  const { loadFromConfigs } = await import("@delebash/core/llm");
  const { seedLlm } = await import("@delebash/core/llm/seed");
  const { getState } = await import("../app_state.js");
  const { liftEditedTunablesIntoPresets, migrateJvPromptsToShared } = await import("../engines/llm/migrate_prompts.js");
  const { migrateSettingsProvidersToDb } = await import("../engines/llm/migrate_providers.js");
  const { retireDefaultCatalogRows } = await import("../llm_bootstrap.js");

  await migrateJvPromptsToShared();
  await migrateSettingsProvidersToDb(getState().settings.get());
  seedLlm();
  await liftEditedTunablesIntoPresets();
  retireDefaultCatalogRows();
  retireSpeechRuntimeSettings();
  loadFromConfigs(stores.getProviderStore().list());
}
