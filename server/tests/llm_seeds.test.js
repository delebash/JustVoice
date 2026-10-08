// SPDX-License-Identifier: MIT
// F1 Phase 2 — every JV action is a template row in the SHARED prompt system, the preset
// library is the one source of tunables, and the legacy `jv_feature_prompts` system migrates
// preserving user edits (the port of tests/test_llm_seeds.py).
//
// The shared-rows test boots the LLM half of create_app headless (llm_boot.js) and reads the
// store; the others boot the real app (app_helpers.js).
import { stores } from "@delebash/llm-runner/llm";
import * as llmDb from "@delebash/llm-runner/llm/db";
import * as llmSeed from "@delebash/llm-runner/llm/seed";
import { afterEach, expect, test, vi } from "vitest";
import { cfg as appCfg } from "../src/app_state.js";
import { seedWorkspace } from "../src/database/seed.js";
import * as lb from "../src/llm_bootstrap.js";
import * as session from "../src/database/session.js";
import { DEFAULT_FEATURE_PROMPTS } from "../src/seed_feature_prompts.js";
import { DEFAULT_ENGINE_PRESETS, DEFAULT_FEATURE_PRESETS } from "../src/seed_presets.js";
import { appClient, closeApps } from "./app_helpers.js";
import { closeModuleDb, tmpPath } from "./helpers.js";
import { llmBoot } from "./llm_boot.js";

afterEach(async () => {
  await closeApps();
  closeModuleDb();
  appCfg.state = null;
});

test("all_actions_seed_as_shared_rows", async () => {
  // create_app + seed_workspace twice, headless (llm_boot.js): every action is a shared row.
  const dir = tmpPath();
  await llmBoot(dir);
  await seedWorkspace();
  const rows = Object.fromEntries(stores.getPromptStore().list().map((r) => [r.key, r]));
  for (const key of Object.keys(DEFAULT_FEATURE_PROMPTS)) expect(rows, `missing shared row ${key}`).toHaveProperty([key]);
  // 13 actions over 10 features (the refine x4 composition + attribution's two routes + discovery
  // as its own speaker_discovery feature + Analyze's second look; Reasoned died 2026-08-07).
  expect(Object.keys(DEFAULT_FEATURE_PROMPTS).length).toBe(13);
  expect(rows.speaker_second_look.json_mode).toBe(true);
  expect(rows["refine.base"].user_template).toBe("{{transcript}}");
  expect(rows["speaker_attribution.guided"].user_template).toContain("{{speakers}}");
  expect(rows.smart_assign.json_mode).toBe(true);
  expect(rows["speaker_attribution.guided"].json_mode).toBe(false); // array output
});
/** createApp + seedWorkspace twice (Python's _client). */
async function client(dir) {
  const { c } = await appClient(dir, { seed: true });
  await seedWorkspace();
  return c;
}

const sharedRows = () => Object.fromEntries(stores.getPromptStore().list().map((r) => [r.key, r]));

test("presets_and_refs_seed", async () => {
  const c = await client(tmpPath());
  const body = (await c.get("/v1/ai/engine-presets")).json();
  const presets = Object.fromEntries(body.presets.map((x) => [x.id, x]));
  for (const x of DEFAULT_ENGINE_PRESETS) expect(presets).toHaveProperty([x.id]);
  // compose runs at its preset's 0.9 (the hardcoded personas_api temperature moved onto the
  // preset — ruling 9).
  expect(presets.p_compose.temperature).toBe(0.9);
  // Every preset ships think-off EXCEPT the one where thinking was measured to earn its time:
  // speaker attribution's Reasoned extraction (2026-09-28).
  const thinking = Object.entries(presets)
    .filter(([, x]) => x.think)
    .map(([pid]) => pid)
    .sort();
  expect(thinking).toEqual(["p_extract_reasoned"]);
  // The two routes each carry their OWN ref, and both run on it; Discover and Smart-assign keep
  // the faster p_extract.
  expect(DEFAULT_FEATURE_PRESETS["speaker_attribution.direct"]).toBe("p_extract_reasoned");
  expect(DEFAULT_FEATURE_PRESETS["speaker_attribution.guided"]).toBe("p_extract_reasoned");
  expect(DEFAULT_FEATURE_PRESETS["speaker_attribution.identify"]).toBe("p_extract");
  // Every seeded row RESOLVES through the cascade: its own ref, or its FEATURE's ref. And every
  // ref names a seeded row or a seeded feature.
  const featuresOf = Object.fromEntries(Object.entries(DEFAULT_FEATURE_PROMPTS).map(([k, v]) => [k, v.feature || k]));
  for (const [key, feat] of Object.entries(featuresOf)) {
    expect(Object.hasOwn(DEFAULT_FEATURE_PRESETS, key) || Object.hasOwn(DEFAULT_FEATURE_PRESETS, feat), key).toBe(true);
  }
  const known = new Set([...Object.keys(DEFAULT_FEATURE_PROMPTS), ...Object.values(featuresOf)]);
  for (const refKey of Object.keys(DEFAULT_FEATURE_PRESETS)) expect(known.has(refKey), refKey).toBe(true);
});

/** The pre-F1 state: a jv_feature_prompts table (raw SQL, like the migration's own reads)
 * holding one user-edited row. Boots migrate it, then drop the table. */
function plantLegacyRow(key, system, temperature) {
  const h = session.getDb();
  h.exec(
    "CREATE TABLE IF NOT EXISTS jv_feature_prompts (" +
      "key TEXT PRIMARY KEY, feature TEXT NOT NULL DEFAULT '', " +
      "system TEXT NOT NULL DEFAULT '', user_template TEXT NOT NULL DEFAULT '', " +
      "temperature FLOAT NOT NULL DEFAULT 0.7, think BOOLEAN NOT NULL DEFAULT 0, " +
      "built_in BOOLEAN NOT NULL DEFAULT 1, created_at DATETIME)",
  );
  h.run("INSERT INTO jv_feature_prompts (key, feature, system, user_template, temperature, think) VALUES (?, ?, ?, '', ?, 0)", [
    key,
    "x",
    system,
    temperature,
  ]);
}

function clearShared(key, { clearLiftMarker = false } = {}) {
  const h = llmDb.session();
  h.delete("feature_prompts", { key });
  if (clearLiftMarker) h.delete("runner_setting", { key: "jv_prompt_tunables_lifted" });
}

test("edited_legacy_row_migrates_wins_and_table_drops", async () => {
  // Boot once (fresh shared seed), then simulate the 2026-08-01..05 state: a user-edited legacy
  // row + no shared row yet.
  const dir = tmpPath();
  await client(dir);
  plantLegacyRow("smart_assign", "MY EDITED CASTING PROMPT", 0.55);
  clearShared("smart_assign", { clearLiftMarker: true });

  await client(dir);
  const row = sharedRows().smart_assign;
  // The edit won over the seed default…
  expect(row.system).toBe("MY EDITED CASTING PROMPT");
  // …while the untouched (legacy-empty) user template took the NEW seed's.
  expect(row.user_template).toContain("{{personas}}");
  // The hand-changed temperature lifted onto the assigned preset.
  expect(llmDb.session().get("engine_presets", "p_extract").temperature).toBe(0.55);
  // Both halves succeeded → the legacy table dropped.
  expect(session.getDb().tableNames()).not.toContain("jv_feature_prompts");
});

test("legacy_identify_key_renames", async () => {
  const dir = tmpPath();
  await client(dir);
  plantLegacyRow("identify", "EDITED DISCOVERY PROMPT", 0.2);
  clearShared("speaker_attribution.identify", { clearLiftMarker: true });

  await client(dir);
  const row = sharedRows()["speaker_attribution.identify"];
  expect(row.system).toBe("EDITED DISCOVERY PROMPT");
  expect(row.user_template).toContain("{{manuscript}}");
});

test("catalog_is_the_three_family_rungs", async () => {
  // 2026-08-05: the measured daily driver only; AMENDED 2026-08-06: the 12B and E4B rungs
  // return — three rows, the flagship ranked best (QuickSetup's best-that-fits order).
  const c = await client(tmpPath());
  const rows = (await c.get("/v1/ai/model-catalog")).json().rows;
  expect(new Set(rows.map((r) => r.id))).toEqual(new Set(["gemma-4-26b-a4b-qat", "gemma-4-12b-qat", "gemma-4-e4b-qat"]));
  const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
  const flagship = byId["gemma-4-26b-a4b-qat"];
  expect(flagship.quant).toBe("UD-Q4_K_XL");
  expect(flagship.tier).toBe("low-vram-moe");
  expect(flagship.qualityRank).toBeLessThan(byId["gemma-4-12b-qat"].qualityRank);
  expect(byId["gemma-4-12b-qat"].qualityRank).toBeLessThan(byId["gemma-4-e4b-qat"].qualityRank);
});

test("retired_default_rows_are_removed_once_from_existing_dbs", async () => {
  // The pre-suppression state: a DB that already carries one of the retired shared-default rows
  // + no marker. (The 12B/E4B ids left the retirement list on the 2026-08-06 re-add — they must
  // SURVIVE.)
  const dir = tmpPath();
  await client(dir);
  const h = llmDb.session();
  h.insert("model_catalog", { id: "gryphe-styletune-v2", name: "StyleTune" });
  // A USER-added row must survive the cleanup untouched.
  h.insert("model_catalog", { id: "my-own-model", name: "Mine" });
  h.delete("runner_setting", { key: "jv_default_catalog_retired" });

  const c = await client(dir);
  const ids = new Set((await c.get("/v1/ai/model-catalog")).json().rows.map((r) => r.id));
  expect(ids).toEqual(new Set(["gemma-4-26b-a4b-qat", "gemma-4-12b-qat", "gemma-4-e4b-qat", "my-own-model"]));
});

test("factory_reset_runs_in_ship_order", () => {
  // Part 7 rider (2026-08-06): the factory-reset shared half pins its order — storage
  // re-point, table create, SEED, then the catalog retirement.
  const calls = [];
  vi.spyOn(llmDb, "configureStorage").mockImplementation(() => calls.push("storage"));
  vi.spyOn(llmDb, "createAll").mockImplementation(() => calls.push("tables"));
  vi.spyOn(llmSeed, "seedLlm").mockImplementation(() => calls.push("seed"));
  vi.spyOn(lb, "retireDefaultCatalogRows").mockImplementation(() => calls.push("retire"));

  lb.reseedSharedLlm(null);

  expect(calls).toEqual(["storage", "tables", "seed", "retire"]);
});
