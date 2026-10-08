// SPDX-License-Identifier: MIT
// The attribution routes + the Auto row (the restore 2026-08-06; the tier-debris cleanup
// 2026-08-07 — Reasoned died, Auto routes by SIZE only) — the port of
// tests/test_attribution_restore.py. The settings-model test runs here; the eight that drive
// POST /v1/scenes/{id}/analyze, /v1/extraction/analyze-text, /config and the seeded Lab sample
// wait for the API wave (the pipeline under them is exercised by chapter_pieces and
// attribution_alignment).
import { expect, test } from "vitest";
import { construct, ExtractionSettings, modelDump } from "../src/models.js";

const WAITS = "waits for api/extraction_api.js routes + app.js";

test.todo(`route_override_and_auto_source — ${WAITS}`);
test.todo(`auto_judges_each_card_by_its_own_model — ${WAITS}`);

test("stale_force_keys_are_ignored", () => {
  // The retired dial's and pills' stored keys neither error nor force: the settings model
  // drops them (production is always Auto).
  const s = construct(ExtractionSettings, { reading_style: "direct", route: "direct" });
  expect(s.direct_min_b).toBe(14.0);
  const dumped = modelDump(ExtractionSettings, s);
  expect("route" in dumped).toBe(false);
  expect("reading_style" in dumped).toBe(false);
});

test.todo(`no_computed_budget_and_explicit_cap_rides — ${WAITS}`);
test.todo(`lab_run_uses_stored_project_corrections — ${WAITS}`);
test.todo(`cellar_sample_seeds — ${WAITS}`);
test.todo(`extraction_config_has_no_force_field — ${WAITS}`);
test.todo(`lab_tunables_pass_through — ${WAITS}`);
test.todo(`auto_judges_the_model_that_would_run — ${WAITS}`);
