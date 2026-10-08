// SPDX-License-Identifier: MIT
// Answers are matched to lines by their [D#] id (2026-09-28) — the port of
// tests/test_attribution_alignment.py.
//
// The measured failure this pins: the model returned a plain positional array, one
// merged/skipped entry early in a chapter shifted every later answer onto the next line, and
// each wrong answer still read confidence 1.00 — 15 of 35 lines wrong in one chapter of The
// Ninth Facet.
import { expect, test } from "vitest";
import { _extractFirstJsonArray as extract, alignPicks, promptHandles, resolveSpeaker } from "../src/extraction/pipeline.js";
import { DIRECT_SYSTEM, GUIDED_SYSTEM } from "../src/extraction/prompts.js";

const SEGS = [0, 1, 2, 3].map((i) => ({ dialogue_id: i }));
const PAD = { speaker: "unknown", confidence: 0.4 };

test("answers_land_on_their_own_line_even_when_one_is_missing", () => {
  const picks = [
    { id: "D0", speaker: "a" },
    { id: "D2", speaker: "c" },
    { id: "D3", speaker: "d" },
  ];
  expect(
    alignPicks(picks, SEGS).map((p) => p.speaker),
    "a gap must stay a gap, not pull D2's answer onto D1",
  ).toEqual(["a", "unknown", "c", "d"]);
});

test("ids_are_read_leniently_and_out_of_order_answers_are_fine", () => {
  const picks = [
    { id: "d3", speaker: "d" },
    { id: " D 1", speaker: "b" },
    { id: 0, speaker: "a" },
    { id: "D2", speaker: "c" },
  ];
  expect(alignPicks(picks, SEGS).map((p) => p.speaker)).toEqual(["a", "b", "c", "d"]);
});

test("a_duplicate_id_keeps_the_first_answer", () => {
  expect(
    alignPicks(
      [
        { id: "D0", speaker: "a" },
        { id: "D0", speaker: "x" },
      ],
      SEGS,
    )[0].speaker,
  ).toBe("a");
});

test("a_reply_without_ids_falls_back_to_position", () => {
  expect(alignPicks([{ speaker: "a" }, { speaker: "b" }], SEGS)).toEqual([{ speaker: "a" }, { speaker: "b" }, PAD, PAD]);
  expect(alignPicks(Array(9).fill({ speaker: "x" }), SEGS).length).toBe(4);
  expect(alignPicks([], SEGS)).toEqual([PAD, PAD, PAD, PAD]);
});

test("both_routes_ask_for_ids_and_allow_clear_turn_taking", () => {
  for (const prompt of [DIRECT_SYSTEM, GUIDED_SYSTEM]) {
    expect(prompt).toContain('"id": "D0"');
    expect(prompt).toContain("turn");
    expect(prompt).not.toContain("DO NOT guess by alternating");
  }
  expect(GUIDED_SYSTEM.startsWith(DIRECT_SYSTEM)).toBe(true);
});

test("an_answer_that_is_not_a_cast_id_is_matched_back_by_name", () => {
  // Measured 2026-09-28: the guided route copied the examples' id shape and answered
  // c_iven_sarraz for a real (UUID-like) id — the right person, a phantom id. It resolves to
  // the cast member; a stranger stays unknown.
  const cast = [
    { id: "7f3a", name: "Iven Sarraz", aliases: [] },
    { id: "9b2c", name: "Odeline Marran", aliases: ["Ode"] },
  ];
  expect(resolveSpeaker("7f3a", cast)).toBe("7f3a");
  expect(resolveSpeaker("c_iven_sarraz", cast)).toBe("7f3a");
  expect(resolveSpeaker("p_odeline_marran", cast)).toBe("9b2c");
  expect(resolveSpeaker("Ode", cast)).toBe("9b2c");
  expect(resolveSpeaker("Unknown", cast)).toBe("unknown");
  expect(resolveSpeaker("c_somebody_else", cast)).toBe("unknown");
  expect(resolveSpeaker(null, cast)).toBe("unknown");
});

test("the_model_sees_name_handles_not_real_ids_and_answers_map_back", () => {
  // Measured 2026-09-28: UUID persona ids in the prompt made the model misread a chapter it
  // gets right with readable ids. It sees name handles; answers map back.
  const real = [
    { id: "3f1c2a9e-0000-4000-8000-00000000000a", name: "Cael Ferren", aliases: [] },
    { id: "3f1c2a9e-0000-4000-8000-00000000000b", name: "Nettle", aliases: [] },
    { id: "3f1c2a9e-0000-4000-8000-00000000000c", name: "Nettle", aliases: [] },
  ];
  const [shown, toId] = promptHandles(real);
  expect(shown.map((c) => c.id)).toEqual(["cael_ferren", "nettle", "nettle_2"]);
  expect(shown.every((c) => !c.id.includes("3f1c"))).toBe(true);
  expect(toId.get(resolveSpeaker("cael_ferren", shown))).toBe(real[0].id);
  expect(toId.get(resolveSpeaker("nettle_2", shown))).toBe(real[2].id);
});

test("the_answer_array_is_found_inside_prose_and_salvaged_when_cut_off", () => {
  // Measured 2026-09-28: Qwen replies with prose around the JSON blanked whole chapters — the
  // old greedy [.*] started at a bracket in the prose.
  const prose = 'Checking [D5] against [D6]. Answer: [{"id": "D0", "speaker": "a"}, {"id": "D1", "speaker": "b"}] ok [x]';
  expect(extract(prose).map((p) => p.id)).toEqual(["D0", "D1"]);
  const cut = '[{"id": "D0", "speaker": "a"}, {"id": "D1", "speaker": "b"}, {"id": "D2", "spe';
  expect(extract(cut).map((p) => p.id)).toEqual(["D0", "D1"]);
  expect(extract("no answer at all")).toEqual([]);
});
