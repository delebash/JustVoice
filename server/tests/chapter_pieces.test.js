// SPDX-License-Identifier: MIT
// Chapter splitting (2026-09-28, docs/plans/2026-09-28-chapter-splitting.md) — the port of
// tests/test_chapter_pieces.py.
//
// A chapter too long for the model is read in pieces of whole paragraphs, each with a lead-in
// from the piece before whose answers are thrown away. Backstops halve a piece the provider
// refuses as too big, or whose reply comes back cut off (finish_reason "length" — llama.cpp's
// only signal when the context fills).
import { RuntimeError } from "@delebash/llm-runner/platform/py";
import { expect, test, vi } from "vitest";
import * as run from "../src/engines/llm/run.js";
import { identifySpeakers } from "../src/extraction/identify.js";
import { ParagraphTooBig, Piece, isBreak, planPieces } from "../src/extraction/pieces.js";
import * as pipeline from "../src/extraction/pipeline.js";
import { AttributionModelError, analyzeScene } from "../src/extraction/pipeline.js";
import { construct, Settings } from "../src/models.js";

// ── the planner ────────────────────────────────────────────────────────────

const P = (lead, start, end) => new Piece(lead, start, end);

test("a_chapter_that_fits_is_one_piece", () => {
  expect(planPieces([10, 10, 10], 30, 2)).toEqual([P(0, 0, 3)]);
});

test("pieces_are_whole_paragraphs_with_a_lead_in", () => {
  const got = planPieces(Array(10).fill(10), 40, 1);
  expect(got[0]).toEqual(P(0, 0, 4));
  expect(got[1], "one lead-in paragraph + three it owns = 40").toEqual(P(3, 4, 7));
  expect(got.map((p) => p.start)).toEqual([0, 4, 7]);
  expect(got[got.length - 1]).toEqual(P(6, 7, 10));
  const owned = got.flatMap((p) => Array.from({ length: p.end - p.start }, (_, k) => p.start + k));
  expect(owned, "every paragraph owned exactly once").toEqual([...Array(10).keys()]);
});

test("a_scene_break_near_the_end_moves_the_cut", () => {
  const got = planPieces(Array(10).fill(10), 80, 0, new Set([6]));
  expect(got[0], "cut just after the *** at paragraph 6, not at 8").toEqual(P(0, 0, 7));
});

test("a_break_early_in_the_piece_is_ignored", () => {
  expect(planPieces(Array(10).fill(10), 80, 0, new Set([1]))[0]).toEqual(P(0, 0, 8));
});

test("the_lead_in_gives_way_to_a_big_paragraph", () => {
  const got = planPieces([10, 10, 35], 40, 2);
  expect(got[got.length - 1], "no room for the lead-in beside it — dropped, not the paragraph").toEqual(P(2, 2, 3));
});

test("a_paragraph_bigger_than_the_room_is_refused", () => {
  let err;
  try {
    planPieces([10, 50, 10], 40, 0);
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(ParagraphTooBig);
  expect(err.index).toBe(1);
});

test("scene_break_marks", () => {
  for (const t of ["***", "* * *", "---", "#", "~", "—"]) expect(isBreak(t), t).toBe(true);
  for (const t of ["", "Mara.", "“—”"]) expect(isBreak(t), t).toBe(false);
});

// ── the runner ─────────────────────────────────────────────────────────────

const CAST = [
  { id: "p_mara", name: "Mara" },
  { id: "p_hale", name: "Hale" },
];
const _D = /\[D(\d+)\]/g;

// Untagged lines, so every answer comes from the model (no anchors).
const _chapter = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i} has words in it. “Line ${i}.”`).join("\n\n");

function _settings({ leadIn = 1, perLine = 10 } = {}) {
  const s = construct(Settings, {});
  s.extraction.split_lead_in_paragraphs = leadIn;
  s.extraction.answer_tokens_per_line = perLine;
  return s;
}

/** measure: 1 token per char of the rendered paragraphs + 100 overhead. run: answers every [D#]
 * in the prompt, via `answer(did)`. */
function _stub({ context, answer = () => "mara", finish = () => "stop", refuse = null }) {
  const calls = [];
  vi.spyOn(pipeline, "measureFeature").mockImplementation(async (_action, variables) => ({
    prompt_tokens: 100 + variables.paragraphs.length,
    context,
    model: "m",
  }));
  vi.spyOn(pipeline, "runFeature").mockImplementation(async (_action, variables) => {
    const ids = [...variables.paragraphs.matchAll(_D)].map((m) => Number(m[1]));
    calls.push(ids);
    if (refuse?.(ids)) {
      throw new RuntimeError('local-llamacpp 400: {"error":{"type":"exceed_context_size_error","n_prompt_tokens":40000,"n_ctx":32768}}');
    }
    const text = `[${ids.map((i) => `{"id":"D${i}","speaker":"${answer(i, calls)}","confidence":0.9}`).join(",")}]`;
    return { text, finish_reason: finish(ids), prompt_tokens: 1, completion_tokens: 1, model: "m" };
  });
  return calls;
}

const _speakers = (rows) => rows.filter((r) => r.kind === "dialogue").map((r) => r.speaker);
const req = (o) => ({ route: "direct", characters: CAST, ...o });

test("a_chapter_that_fits_is_one_call", async () => {
  const calls = _stub({ context: 100_000 });
  const raw = {};
  const rows = await analyzeScene({ settings: _settings(), request: req({ text: _chapter(8) }), rawOut: raw });
  expect(calls.length).toBe(1);
  expect(raw.usage.pieces).toBe(1);
  expect(_speakers(rows)).toEqual(Array(8).fill("p_mara"));
});

test("a_long_chapter_is_read_in_pieces_and_the_lead_in_answers_are_dropped", async () => {
  // Pieces answer their lead-in lines "hale"; the owning piece says "mara". If a lead-in
  // answer leaked, some line would come back as Hale.
  const firstCallOf = new Map();
  const answer = (did, calls) => {
    const n = calls.length;
    if (!firstCallOf.has(did)) firstCallOf.set(did, n);
    return firstCallOf.get(did) === n ? "mara" : "hale";
  };
  const calls = _stub({ context: 400, answer });
  const raw = {};
  const rows = await analyzeScene({ settings: _settings({ leadIn: 1 }), request: req({ text: _chapter(12) }), rawOut: raw });
  expect(calls.length).toBeGreaterThan(1);
  expect(raw.usage.pieces).toBe(calls.length);
  expect(
    calls.some((c, i) => i && calls[i - 1].includes(c[0])),
    "later pieces carry a lead-in",
  ).toBe(true);
  expect(_speakers(rows)).toEqual(Array(12).fill("p_mara"));
});

test("max_context_forces_splitting_on_a_short_chapter", async () => {
  const calls = _stub({ context: 100_000 });
  await analyzeScene({ settings: _settings(), request: req({ text: _chapter(12), max_context: 400 }) });
  expect(calls.length).toBeGreaterThan(1);
});

test("a_reply_cut_off_at_the_context_halves_the_piece", async () => {
  // Measuring says one piece fits; the model runs out of room on anything over 4 lines.
  const calls = _stub({ context: 100_000, finish: (ids) => (ids.length > 4 ? "length" : "stop") });
  const raw = {};
  const rows = await analyzeScene({ settings: _settings({ leadIn: 0 }), request: req({ text: _chapter(12) }), rawOut: raw });
  expect(_speakers(rows), "nothing left as unknown").toEqual(Array(12).fill("p_mara"));
  expect(raw.usage.pieces, "only the calls that fit count").toBe(calls.filter((c) => c.length <= 4).length);
});

test("a_refusal_as_too_big_halves_the_piece_unmeasured", async () => {
  // Another provider: nothing to measure; it refuses anything over 3 lines.
  const calls = _stub({ context: 100_000, refuse: (ids) => ids.length > 3 });
  vi.spyOn(pipeline, "measureFeature").mockImplementation(async () => null);
  const rows = await analyzeScene({ settings: _settings({ leadIn: 0 }), request: req({ text: _chapter(10) }) });
  expect(_speakers(rows)).toEqual(Array(10).fill("p_mara"));
  expect(calls.length).toBeGreaterThan(3);
});

test("one_paragraph_that_never_fits_says_so", async () => {
  _stub({ context: 100_000, refuse: () => true });
  vi.spyOn(pipeline, "measureFeature").mockImplementation(async () => null);
  let err;
  try {
    await analyzeScene({ settings: _settings(), request: req({ text: _chapter(3) }) });
  } catch (e) {
    err = e;
  }
  expect(err).toBeInstanceOf(AttributionModelError);
  expect(err.message.startsWith("A paragraph of this chapter is too long for the model to read")).toBe(true);
  expect(err.message).toContain("40,000 tokens");
  expect(err.message).toContain("32,768");
});

// ── Discover reads a long chapter in pieces too (Slice 4) ─────────────────────

function _identifyStub({ context, refuse = null }) {
  const calls = [];
  vi.spyOn(run, "measureFeature").mockImplementation(async (_action, variables) => ({
    prompt_tokens: 100 + variables.manuscript.length,
    context,
    model: "m",
  }));
  vi.spyOn(run, "runFeature").mockImplementation(async (_action, variables) => {
    const m = variables.manuscript;
    calls.push(m);
    if (refuse?.(m)) throw new RuntimeError("local-llamacpp 400: exceed_context_size_error");
    const names = [...new Set([...m.matchAll(/\b(Tom|Edith)\b/g)].map((x) => x[1]))].sort();
    const text = `[${names.map((n) => `{"name":"${n}","approx_lines":1,"evidence":"${n}"}`).join(",")}]`;
    return { text, finish_reason: "stop", prompt_tokens: 1, completion_tokens: 1, model: "m" };
  });
  return calls;
}

const _book = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i}: ${i % 2 ? "Tom" : "Edith"} waited by the gate.`).join("\n\n");
const count = (s, sub) => s.split(sub).length - 1;

test("discover_reads_a_long_chapter_in_pieces_and_merges_names", async () => {
  const calls = _identifyStub({ context: 400 });
  const raw = {};
  const got = await identifySpeakers(_book(20), [], { settings: _settings({ perLine: 10 }), rawOut: raw });
  expect(calls.length).toBeGreaterThan(1);
  expect(raw.usage.pieces).toBe(calls.length);
  expect(calls.join("\n\n"), "every paragraph read exactly once, in order").toBe(_book(20));
  const by = Object.fromEntries(got.map((c) => [c.name, c.approx_lines]));
  expect(new Set(Object.keys(by))).toEqual(new Set(["Tom", "Edith"]));
  expect(by.Tom, "one row per name, lines summed").toBe(calls.filter((c) => c.includes("Tom")).length);
});

test("discover_halves_a_piece_the_provider_refuses", async () => {
  const calls = _identifyStub({ context: 100_000, refuse: (m) => count(m, "Paragraph") > 3 });
  const got = await identifySpeakers(_book(10), [], { settings: _settings() });
  expect(new Set(got.map((c) => c.name))).toEqual(new Set(["Tom", "Edith"]));
  expect(calls.filter((c) => count(c, "Paragraph") <= 3).length).toBeGreaterThanOrEqual(4);
});

test("a_piece_answered_without_line_numbers_is_placed_by_order", async () => {
  // Measured: a piece's reply put the speaker in the id field. One answer per line of the
  // piece -> placed in order; nothing lost.
  const calls = _stub({ context: 400 });
  const real = vi.mocked(pipeline.runFeature).getMockImplementation();
  vi.spyOn(pipeline, "runFeature").mockImplementation(async (action, variables, kw) => {
    const resp = await real(action, variables, kw);
    return { ...resp, text: resp.text.replace(/"id":"D\d+"/g, '"id":"nettle_2"') };
  });
  const rows = await analyzeScene({ settings: _settings({ leadIn: 1 }), request: req({ text: _chapter(12) }) });
  expect(calls.length).toBeGreaterThan(1);
  expect(_speakers(rows)).toEqual(Array(12).fill("p_mara"));
});
