// SPDX-License-Identifier: MIT
// F1 Phase 2 — every JV action is a template row in the SHARED prompt system, the preset
// library is the one source of tunables, and the legacy `jv_feature_prompts` system migrates
// preserving user edits (the port of tests/test_llm_seeds.py).
//
// The shared-rows test boots the LLM half of create_app headless (llm_boot.js) and reads the
// store; five more read the app's routes or run its legacy migrations and wait for app.js. The
// reset-order test runs.
import { stores } from "@delebash/llm-runner/llm";
import * as llmDb from "@delebash/llm-runner/llm/db";
import * as llmSeed from "@delebash/llm-runner/llm/seed";
import { afterEach, expect, test, vi } from "vitest";
import { cfg as appCfg } from "../src/app_state.js";
import { seedWorkspace } from "../src/database/seed.js";
import * as lb from "../src/llm_bootstrap.js";
import { DEFAULT_FEATURE_PROMPTS } from "../src/seed_feature_prompts.js";
import { closeModuleDb, tmpPath } from "./helpers.js";
import { llmBoot } from "./llm_boot.js";

afterEach(() => {
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
test.todo("presets_and_refs_seed — waits for app.js (it reads GET /v1/ai/engine-presets)");
test.todo("edited_legacy_row_migrates_wins_and_table_drops — waits for app.js + engines/llm/migrate_prompts.js");
test.todo("legacy_identify_key_renames — waits for app.js + engines/llm/migrate_prompts.js");
test.todo("catalog_is_the_three_family_rungs — waits for app.js + engines/llm/*");
test.todo("retired_default_rows_are_removed_once_from_existing_dbs — waits for app.js + engines/llm/*");

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
