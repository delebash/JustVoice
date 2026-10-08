// SPDX-License-Identifier: MIT
// F1 Phase 2 — every JV action is a template row in the SHARED prompt system, the preset
// library is the one source of tunables, and the legacy `jv_feature_prompts` system migrates
// preserving user edits (the port of tests/test_llm_seeds.py).
//
// Six tests boot the app (create_app + seed_workspace) and wait for app.js, the
// engines/llm migrations and the extraction/refinement modules seed_feature_prompts reads.
// The reset-order test runs.
import { expect, test, vi } from "vitest";
import * as llmDb from "@delebash/llm-runner/llm/db";
import * as llmSeed from "@delebash/llm-runner/llm/seed";
import * as lb from "../src/llm_bootstrap.js";

test.todo("all_actions_seed_as_shared_rows — waits for app.js + engines/llm/* + extraction/* + refinement.js");
test.todo("presets_and_refs_seed — waits for app.js + engines/llm/* + extraction/* + refinement.js");
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
