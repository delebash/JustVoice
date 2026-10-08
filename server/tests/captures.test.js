// SPDX-License-Identifier: MIT
// Captures — dictation recordings and their refinement (the port of tests/test_captures.py).
//
// Not ported here: the two capture endpoint tests (api/captures_api.js), and
// test_compose_refinement_system_toggles — it needs the seeded `refine.*` prompt rows, which
// seed_feature_prompts.js writes once the extraction wave's modules it imports exist
// (extraction/identify.js, prompts.js, second_look.js): test.todo. The repetition collapse is
// refinement's own pure pass.
import { expect, test } from "vitest";
import { collapseRepetitiveArtifacts as collapse } from "../src/refinement.js";

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

test.todo("compose_refinement_system_toggles — waits for extraction/* (seed_feature_prompts.js imports them)");
