// SPDX-License-Identifier: MIT
// Speaker identification — parser + discover/promote endpoints (the port of
// tests/test_discover_speakers.py). The parser tests run here; the twenty endpoint tests drive
// the app's routes (Discover, ＋ Add, Ignore, the ad-hoc Lab door, the usage ledger, show
// notes) and wait for the API wave.
import { expect, test } from "vitest";
import { IDENTIFY_SYSTEM, SpeakerCandidate, parseCandidates } from "../src/extraction/identify.js";

// ── parser ───────────────────────────────────────────────────────────

test("parse_plain_array", () => {
  const raw = '[{"name": "Tom Harlan", "role_hint": "neighbor", "approx_lines": 11}]';
  expect(parseCandidates(raw, ["Mara Vance"])).toEqual([new SpeakerCandidate({ name: "Tom Harlan", role_hint: "neighbor", approx_lines: 11 })]);
});

test("parse_code_fenced_with_chatter", () => {
  const raw = 'Sure! Here are the new speakers:\n```json\n[{"name": "The Stranger"}]\n```\nLet me know!';
  expect(parseCandidates(raw, []).map((c) => c.name)).toEqual(["The Stranger"]);
});

test("parse_dedupes_known_and_self_case_insensitive", () => {
  const raw = '[{"name": "MARA VANCE"}, {"name": "Tom"}, {"name": "tom"}, {"name": "narrator"}]';
  expect(parseCandidates(raw, ["Mara Vance"]).map((c) => c.name)).toEqual(["Tom"]);
});

test("parse_keeps_the_evidence_quote", () => {
  const raw = '[{"name": "Edith", "role_hint": "poured the tea", "approx_lines": 0, "evidence": "Edith’s hands"}]';
  expect(parseCandidates(raw, [])).toEqual([new SpeakerCandidate({ name: "Edith", role_hint: "poured the tea", approx_lines: 0, evidence: "Edith’s hands" })]);
});

test("the_shipped_prompt_asks_for_named_people_not_speakers_or_descriptors", () => {
  // 2026-09-27: the old default asked for speakers only and offered "the stranger" as a name —
  // the demo got "child" / "the elder" and lost Edith.
  expect(IDENTIFY_SYSTEM).toContain("whether or not they speak");
  expect(IDENTIFY_SYSTEM).toContain('"child"');
  expect(IDENTIFY_SYSTEM).toContain("are not characters");
  expect(IDENTIFY_SYSTEM).toContain('"evidence"');
  expect(IDENTIFY_SYSTEM.toLowerCase()).not.toContain("the stranger");
  expect(IDENTIFY_SYSTEM).toContain("named object"); // fix B — not "Gudgeon" the maul
  expect(IDENTIFY_SYSTEM).toContain("nickname"); // fix 2 — not "Ode" for Odeline
});

test("parse_garbage_returns_empty", () => {
  expect(parseCandidates("I could not find any JSON to give you.", [])).toEqual([]);
  expect(parseCandidates('{"name": "not a list"}', [])).toEqual([]);
});

// ── endpoints (the API wave) ─────────────────────────────────────────

const WAITS = "waits for api/extraction_api.js routes + app.js";
for (const name of [
  "discover_501_without_llm",
  "discover_with_stubbed_llm",
  "add_makes_a_speaker_and_no_persona",
  "a_scan_is_saved_on_its_chapter_and_replaces_the_last_one",
  "add_and_ignore_keep_the_saved_scan",
  "a_scan_records_the_cast_members_the_chapter_names",
  "a_cast_member_named_by_first_or_last_name_is_not_proposed",
  "add_casts_a_new_speaker_with_the_persona_of_exactly_its_name",
  "add_keeps_the_other_spellings_as_also_called",
  "the_quote_is_checked_against_the_chapter",
  "ignore_is_remembered_across_scans_and_can_be_undone",
  "analyze_gets_speaker_aliases",
  "ignore_on_a_missing_project_is_404",
  "discover_adhoc_free_text",
  "discover_adhoc_threads_column_pins",
  "analyze_text_threads_model_temp_prompt_overrides",
  "detect_local_llm_providers",
  "usage_ledger_records_chat_calls",
  "show_notes_501_without_llm_and_works_with_stub",
  "a_justwrite_characters_aliases_become_the_speakers_also_called",
]) {
  test.todo(`${name} — ${WAITS}`);
}
