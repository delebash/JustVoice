// SPDX-License-Identifier: MIT
// Captures — dictation recordings and their refinement (the port of tests/test_captures.py).
//
// Not ported here: the two capture endpoint tests (api/captures_api.js). The repetition
// collapse is refinement's own pure pass; the system composition reads the seeded `refine.*`
// prompt rows, so its test boots the LLM half of create_app headless (llm_boot.js).
import { afterEach, expect, test } from "vitest";
import { cfg as appCfg } from "../src/app_state.js";
import { collapseRepetitiveArtifacts as collapse, composeRefinementSystem, RefinementFlags } from "../src/refinement.js";
import { closeModuleDb, tmpPath } from "./helpers.js";
import { llmBoot } from "./llm_boot.js";

afterEach(() => {
  closeModuleDb();
  appCfg.state = null;
});

test.todo("transcribe_stateless — waits for api/captures_api.js");
test.todo("capture_crud_and_refine_degrades — waits for api/captures_api.js");

test("collapse_repetitive_artifacts", () => {
  // 6+ token loop dropped; rhetorical 5x kept.
  expect(collapse("ok URL URL URL URL URL URL done")).toBe("ok done");
  expect(collapse("I said no, no, no, no, no to that")).toContain("no, no, no, no, no");
  // character-level CJK loop
  expect(collapse("end 谢谢观看谢谢观看谢谢观看谢谢观看谢谢观看谢谢观看 fin")).toBe("end fin");
  // emphasized single letters survive (2-char lower bound)
  expect(collapse("wooooooow")).toBe("wooooooow");
});

test("compose_refinement_system_toggles", async () => {
  // F1 Phase 2: the system assembles from the TEMPLATE ROWS (refine.base + enabled section
  // rows); the no-sections identity line lives in the base row itself, so flags-all-off still
  // states it.
  await llmBoot(tmpPath());
  const allOn = composeRefinementSystem(new RefinementFlags());
  expect(allOn.toLowerCase()).toContain("self");
  expect(allOn.toLowerCase()).toContain("technical");
  const noneOn = composeRefinementSystem(new RefinementFlags({ smartCleanup: false, selfCorrection: false, preserveTechnical: false }));
  expect(noneOn.toLowerCase()).toContain("return the transcript unchanged");
  expect(noneOn.toLowerCase()).not.toContain("technical");
});
