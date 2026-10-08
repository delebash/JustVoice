// SPDX-License-Identifier: MIT
// Script's server half — Studio Slice 3, 3a (§8.24) (the port of tests/test_script_api.py).
//
// What these pin:
//   * an Analyze run records when it ran and the cast it could choose from, and on each line its
//     paragraph, the book's words that named the speaker, and the model's differing pick where
//     the book won
//   * a re-analyze that changes a line's speaker records who it was, and setting or confirming
//     the line clears that mark
//   * the two script endpoints: the grid row and the chapter page, flags included, on the one
//     "analyzed" rule
//   * "added since", "from the import", "not in the cast", "no dialogue found"
//   * the block PATCH: no_fix, the fix id, deleting one fix, clearing a speaker
//
// The model is stubbed at the pipeline's doors (Python patched `pipeline.run_feature`); the
// prompt measure is stubbed too (null = "run unmeasured", what a failed measure falls back to),
// so no test reaches a model.
import { pySorted } from "@delebash/llm-runner/platform/py";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { afterEach, expect, test, vi } from "vitest";
import * as pipeline from "../src/extraction/pipeline.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(closeApps);

const PARAS = [
  "“We leave at dawn,” said Mara.", // D0 — the book names Mara
  "“Not yet.”", // D1
  "“Why?”", // D2
  "“The tide.”", // D3
  "The lamps guttered in the hall.",
];
const TEXT = PARAS.join("\n\n");
const CHARACTERS = [
  { id: "mara", name: "Mara Vance", aliases: ["Mara"], main: true },
  { id: "tom", name: "Tom Hale", aliases: [], main: false },
];

/** The `client` fixture: the app on a fresh data dir, workspace seeded. */
async function makeClient() {
  return (await appClient(undefined, { seed: true })).c;
}

async function _importBook(c) {
  const r = await c.post("/v1/projects/import?source=justwrite", {
    json: bookJson({ characters: CHARACTERS, chapters: [["ch1", "One", [scene("scn1", ...PARAS)]]] }),
  });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const sid = (await c.get(`/v1/projects/${pid}/scenes`)).json()[0].id;
  return { pid, sid };
}

/** The `project` fixture. */
async function makeProject(c) {
  const { pid, sid } = await _importBook(c);
  // "+ Add Narrator" — no book has a narrator until you choose one (2026-09-29).
  expect((await c.post(`/v1/projects/${pid}/narrator`)).status).toBe(201);
  const cast = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  const ids = Object.fromEntries(cast.map((s) => [s.name, s.id]));
  const narrator = cast.find((s) => s.role_label === "narrator").id;
  return { id: pid, scene_id: sid, mara: ids["Mara Vance"], tom: ids["Tom Hale"], narrator };
}

/** Both fixtures, as most tests take them. */
async function setup() {
  const c = await makeClient();
  return { c, p: await makeProject(c) };
}

/** Stub the model: `picks` maps each [D#] to a speaker id. */
function _modelSays(picks, confidence = 0.95) {
  vi.spyOn(pipeline, "measureFeature").mockImplementation(async () => null);
  vi.spyOn(pipeline, "runFeature").mockImplementation(async () => {
    const reply = Object.entries(picks).map(([d, who]) => ({ dialogue_id: Number(d), speaker: who, confidence }));
    return { text: pyJson(reply), prompt_tokens: 0, completion_tokens: 0, model: "stub" };
  });
}

async function _analyze(c, sceneId, text = TEXT) {
  const r = await c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text } });
  expect(r.status, r.text).toBe(200);
  return r.json();
}

async function _blocks(c, sceneId) {
  return (await c.get(`/v1/scenes/${sceneId}/blocks`)).json();
}

async function _spoken(c, sceneId) {
  return (await _blocks(c, sceneId)).filter((b) => b.source !== "narration");
}

async function _sceneMeta(c, projectId) {
  return (await c.get(`/v1/projects/${projectId}/scenes`)).json()[0].metadata;
}

const _allTom = (p) => ({ 0: p.tom, 1: p.tom, 2: p.tom, 3: p.tom });

async function _row(c, projectId) {
  return (await c.get(`/v1/projects/${projectId}/script`)).json().chapters[0];
}

async function _page(c, sceneId) {
  return (await c.get(`/v1/scenes/${sceneId}/script`)).json();
}

// ── What a run records ─────────────────────────────────────────────────────

test("a_run_records_when_and_the_cast_it_chose_from", async () => {
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  const meta = await _sceneMeta(c, p.id);
  expect(meta.analyzed_at).toBeTruthy();
  expect(meta.analyzed_cast).toEqual(pySorted([p.mara, p.tom, p.narrator]));
});

test("each_line_records_its_paragraph_and_the_books_words", async () => {
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  const blocks = await _blocks(c, p.scene_id);
  expect(blocks.map((b) => b.metadata.paragraph_idx)).toEqual([0, 0, 1, 2, 3, 4]);
  const d0 = blocks[0];
  expect(d0.source).toBe("tag");
  expect(d0.speaker_id).toBe(p.mara);
  expect(d0.metadata.anchor_words).toBe("said Mara");
  // The book won; the model had said Tom — kept for "the book and the AI disagree".
  expect(d0.metadata.llm_speaker).toBe(p.tom);
  expect(blocks[2].metadata).not.toHaveProperty("llm_speaker"); // the model decided that one
  expect(d0.metadata).not.toHaveProperty("prev_speaker_id"); // a first run changes no one's mind
});

test("a_propagated_line_carries_its_tags_words", async () => {
  const { c, p } = await setup();
  const text = "“Wait.” “We leave at dawn,” said Mara.";
  _modelSays({ 0: p.mara, 1: p.mara });
  await _analyze(c, p.scene_id, text);
  const spoken = await _spoken(c, p.scene_id);
  expect(spoken.map((b) => b.source)).toEqual(["propagated", "tag"]);
  expect(spoken.map((b) => b.metadata.anchor_words)).toEqual(["said Mara", "said Mara"]);
});

test("a_reanalyze_records_who_a_changed_line_was", async () => {
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  _modelSays({ ..._allTom(p), 2: p.mara });
  await _analyze(c, p.scene_id, (await _sceneMeta(c, p.id)).source_text);

  const spoken = await _spoken(c, p.scene_id);
  const changed = spoken.filter((b) => Object.hasOwn(b.metadata, "prev_speaker_id"));
  expect(changed.map((b) => b.text)).toEqual(["“Why?”"]);
  expect(changed[0].speaker_id).toBe(p.mara);
  expect(changed[0].metadata.prev_speaker_id).toBe(p.tom);

  const page = await _page(c, p.scene_id);
  expect(page.chapter.changed).toBe(1);
  const line = page.lines.find((ln) => ln.id === changed[0].id);
  expect(line.changed).toBeTruthy();
  expect(line.prev_speaker_id).toBe(p.tom);

  // Confirming the line ("Looks right") clears the mark and saves no fix.
  const r = await c.patch(`/v1/blocks/${line.id}`, { json: { source: "corrected" } });
  expect(r.status).toBe(200);
  expect(r.json().fix_id).toBeNull();
  expect(r.json().metadata).not.toHaveProperty("prev_speaker_id");
});

// ── The two script endpoints ───────────────────────────────────────────────

test("the_chapter_page_carries_its_flags", async () => {
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  const page = await _page(c, p.scene_id);

  const spoken = page.lines.filter((ln) => ln.spoken);
  expect(spoken.length).toBe(4);
  const [d0, d1, d2, d3] = spoken.map((ln) => ln.id);
  const groups = page.flag_groups.map((g) => [g.check, g.speaker, g.lines]);
  expect(groups).toEqual([
    ["only", p.mara, [d0]], // Mara's only line
    ["disagree", p.mara, [d0]], // the book says Mara, the AI Tom
    ["run", p.tom, [d1, d2, d3]], // Tom three times, no reply
  ]);
  expect(page.flag_groups[1].other).toBe(p.tom);
  expect(page.flag_groups[2].turns).toBe(3);
  expect(spoken[0].anchor_words).toBe("said Mara");
  expect(spoken[1].flags).toEqual([2]);

  const ch = page.chapter;
  expect([ch.lines, ch.spoken, ch.anchored, ch.guessed, ch.by_you]).toEqual([6, 4, 1, 3, 0]);
  expect([ch.flagged, ch.flag_groups, ch.no_speaker, ch.to_check]).toEqual([4, 3, 0, 4]);
  expect(ch.analyzed).toBeTruthy();
  expect(ch.analyzed_at).toBeTruthy();
  expect(ch.from_import).toBeFalsy();
  // Speakers: most lines first, every speaker of the book offered.
  expect(page.speakers.map((s) => [s.speaker_id, s.lines]).slice(0, 2)).toEqual([
    [p.tom, 3],
    [p.narrator, 2],
  ]);
  expect(new Set(page.speakers.map((s) => s.speaker_id))).toEqual(new Set([p.tom, p.narrator, p.mara]));
  expect(page.narrator_id).toBe(p.narrator);
});

test("the_grid_row_and_the_one_analyzed_rule", async () => {
  const { c, p } = await setup();
  const before = await _row(c, p.id);
  // Imported prose, no speakers: never analyzed, not "from the import".
  expect(before.analyzed).toBeFalsy();
  expect(before.from_import).toBeFalsy();
  expect(before.flag_groups).toBe(0);
  expect(before.lines).toBe(5);
  // Its lines have no speaker, but it needs Analyze, not checking.
  expect(before.no_speaker).toBe(5);
  expect(before.to_check).toBe(0);

  _modelSays({ 0: p.mara, 1: p.tom, 2: p.mara, 3: p.tom });
  await _analyze(c, p.scene_id);
  const row = await _row(c, p.id);
  expect(row.analyzed).toBeTruthy();
  expect(row.title).toBe("One");
  expect([row.anchored, row.guessed, row.flagged, row.to_check]).toEqual([1, 3, 0, 0]);
});

test("speakers_from_the_import_are_not_analyzed", async () => {
  const { c, p } = await setup();
  for (const b of await _blocks(c, p.scene_id)) {
    await c.patch(`/v1/blocks/${b.id}`, { json: { speaker_id: p.narrator } });
  }
  const row = await _row(c, p.id);
  expect(row.from_import).toBeTruthy();
  expect(row.analyzed).toBeFalsy();
  expect(row.no_speaker).toBe(0);
  expect(row.flag_groups).toBe(0);
});

test("a_speaker_added_since_whose_name_is_in_the_text", async () => {
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  for (const name of ["Tide", "Harbek"]) {
    // "The tide." names one; nothing names Harbek
    const r = await c.post(`/v1/projects/${p.id}/speakers`, { json: { name } });
    expect(r.status, r.text).toBe(201);
  }
  const row = await _row(c, p.id);
  expect(row.added_since).toEqual(["Tide"]);
});

test("a_removed_speaker_leaves_their_lines_with_no_speaker", async () => {
  // Since 2026-09-29 removing a speaker deletes it from the book: its lines go back to no
  // speaker, and the page no longer lists it.
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  const r = await c.delete(`/v1/speakers/${p.tom}`);
  expect(r.status).toBe(200);
  expect(r.json().lines).toBe(3);
  const page = await _page(c, p.scene_id);
  expect(page.speakers.map((s) => s.speaker_id)).not.toContain(p.tom);
  expect(page.lines.filter((ln) => ln.speaker_id === p.tom).length).toBe(0);
  expect(page.chapter.no_speaker).toBe(3);
});

test("a_line_left_with_no_speaker_is_not_counted_as_decided", async () => {
  const { c, p } = await setup();
  _modelSays({ 0: p.tom, 1: "someone-invented", 2: p.tom, 3: p.mara });
  await _analyze(c, p.scene_id);
  const row = await _row(c, p.id);
  expect([row.anchored, row.guessed, row.by_you, row.no_speaker]).toEqual([1, 2, 0, 1]);
  expect(row.anchored + row.guessed + row.by_you + row.no_speaker).toBe(row.spoken);
});

test("no_dialogue_found", async () => {
  // Speech after a dash is the style the segmenter doesn't read (single quotes are read since
  // 2026-09-30, Speech marks).
  const { c, p } = await setup();
  _modelSays({});
  await _analyze(c, p.scene_id, "The lamps guttered.\n\n— Wait, she said.");
  const row = await _row(c, p.id);
  expect(row.analyzed).toBeTruthy();
  expect(row.spoken).toBe(0);
  expect(row.no_dialogue_found).toBeTruthy();
});

test("a_single_quoted_chapter_finds_its_speech", async () => {
  const { c, p } = await setup();
  _modelSays({});
  await _analyze(c, p.scene_id, "The lamps guttered.\n\n‘Wait,’ she said. ‘I don’t know.’");
  const { lines } = await _page(c, p.scene_id);
  expect(lines.filter((ln) => ln.spoken).map((ln) => ln.text)).toEqual(["‘Wait,’", "‘I don’t know.’"]);
});

test("unknown_scene_and_project_404", async () => {
  const c = await makeClient();
  expect((await c.get("/v1/scenes/nope/script")).status).toBe(404);
  expect((await c.get("/v1/projects/nope/script")).status).toBe(404);
});

// ── The block PATCH and one fix ────────────────────────────────────────────

async function _fixCount(c, projectId) {
  return (await c.get(`/v1/projects/${projectId}/corrections/count`)).json().count;
}

test("a_speaker_change_returns_its_fix_and_undo_removes_it", async () => {
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  const line = (await _spoken(c, p.scene_id))[2];
  const base = await _fixCount(c, p.id);

  let r = await c.patch(`/v1/blocks/${line.id}`, { json: { speaker_id: p.mara, source: "corrected" } });
  const fixId = r.json().fix_id;
  expect(fixId).toBeTruthy();
  expect(await _fixCount(c, p.id)).toBe(base + 1);

  // Undo: the old speaker back, no new fix, and the saved one deleted.
  r = await c.patch(`/v1/blocks/${line.id}`, {
    json: {
      speaker_id: p.tom,
      source: line.source,
      extraction_confidence: line.extraction_confidence,
      metadata: line.metadata,
      no_fix: true,
    },
  });
  expect(r.status).toBe(200);
  expect(r.json().fix_id).toBeNull();
  expect(r.json().source).toBe("llm");
  expect(r.json().speaker_id).toBe(p.tom);
  r = await c.delete(`/v1/projects/${p.id}/corrections/${fixId}`);
  expect(r.json()).toEqual({ deleted: 1 });
  expect(await _fixCount(c, p.id)).toBe(base);
  // Already gone is not an error.
  expect((await c.delete(`/v1/projects/${p.id}/corrections/${fixId}`)).json()).toEqual({ deleted: 0 });
});

test("a_null_speaker_clears_it_and_a_missing_one_leaves_it", async () => {
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  const line = (await _spoken(c, p.scene_id))[1];
  let r = await c.patch(`/v1/blocks/${line.id}`, { json: { direction: "quietly" } });
  expect(r.json().speaker_id).toBe(p.tom);
  r = await c.patch(`/v1/blocks/${line.id}`, { json: { speaker_id: null, no_fix: true } });
  expect(r.json().speaker_id).toBeNull();
  // Source and confidence clear the same way — a line that came with the import had neither.
  r = await c.patch(`/v1/blocks/${line.id}`, { json: { source: null, extraction_confidence: null } });
  expect(r.json().source).toBeNull();
  expect(r.json().extraction_confidence).toBeNull();
  r = await c.patch(`/v1/blocks/${line.id}`, { json: { direction: "loud" } });
  expect(r.json().direction).toBe("loud");
});

// ── A narrator who also speaks (2026-09-29) ────────────────────────────────

async function _groups(c, sceneId) {
  return (await _page(c, sceneId)).flag_groups.map((g) => [g.check, g.speaker]);
}

test("speech_on_the_narrator_counts_like_anyones", async () => {
  // No "given to the Narrator" check: the Narrator's one spoken line is an only line, as
  // anyone's would be.
  const { c, p } = await setup();
  _modelSays({ 0: p.tom, 1: p.narrator, 2: p.tom, 3: p.mara });
  await _analyze(c, p.scene_id);
  const groups = await _groups(c, p.scene_id);
  expect(groups).toContainEqual(["only", p.narrator]);
  expect(groups.filter((g) => !["run", "only", "disagree"].includes(g[0]))).toEqual([]);
});

test("a_character_who_narrates_is_counted_like_anyone", async () => {
  // Tom narrates and speaks: three of his lines in a row are a run.
  const { c, p } = await setup();
  _modelSays(_allTom(p));
  await _analyze(c, p.scene_id);
  const r = await c.put(`/v1/projects/${p.id}/narrator`, { json: { speaker_id: p.tom } });
  expect(r.status, r.text).toBe(200);
  expect(await _groups(c, p.scene_id)).toContainEqual(["run", p.tom]);
});

// ── A book with narration and no narrator (decided 2026-10-05) ─────────────

/** The `unnarrated` fixture: the same book, before anyone has added a narrator. */
async function makeUnnarrated(c) {
  const { pid, sid } = await _importBook(c);
  const cast = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  expect(cast.some((s) => s.role_label === "narrator")).toBe(false);
  const ids = Object.fromEntries(cast.map((s) => [s.name, s.id]));
  return { id: pid, scene_id: sid, mara: ids["Mara Vance"], tom: ids["Tom Hale"] };
}

test("narration_waits_for_a_narrator_instead_of_counting_as_no_speaker", async () => {
  const c = await makeClient();
  const p = await makeUnnarrated(c);
  const before = await _row(c, p.id);
  // Four spoken paragraphs with no speaker yet; the narration waits for a narrator.
  expect([before.no_speaker, before.narration_waiting, before.to_check]).toEqual([4, 1, 0]);

  _modelSays({ 0: p.mara, 1: p.tom, 2: p.mara, 3: p.tom });
  await _analyze(c, p.scene_id);
  const page = await _page(c, p.scene_id);
  const ch = page.chapter;
  // Analyze's narration — "said Mara." cut from D0, and the closing line — waits; every spoken
  // line has its speaker, so nothing is "No speaker" and nothing to check.
  const narration = (await _blocks(c, p.scene_id)).filter((b) => b.source === "narration").map((b) => b.text);
  expect(narration.length).toBe(2);
  expect(narration).toContain("The lamps guttered in the hall.");
  expect([ch.no_speaker, ch.narration_waiting, ch.to_check]).toEqual([0, 2, 0]);
  const waiting = page.lines.filter((ln) => ln.waits_for_narrator).map((ln) => ln.text);
  expect(pySorted(waiting)).toEqual(pySorted(narration));
  expect(page.narrator_id).toBeNull();

  // ＋ Add Narrator gives it the narration at once — nothing waits, nothing to check.
  const r = await c.post(`/v1/projects/${p.id}/narrator`);
  expect(r.status).toBe(201);
  expect(r.json().moved_lines).toBe(2);
  const after = await _page(c, p.scene_id);
  expect([after.chapter.no_speaker, after.chapter.narration_waiting]).toEqual([0, 0]);
  expect(after.lines.some((ln) => ln.waits_for_narrator)).toBe(false);
});

test("with_a_narrator_a_line_with_no_speaker_is_counted_as_before", async () => {
  const { c, p } = await setup();
  _modelSays({ 0: p.mara, 1: p.tom, 2: p.mara, 3: p.tom });
  await _analyze(c, p.scene_id);
  const narration = (await _blocks(c, p.scene_id)).find((b) => b.source === "narration");
  await c.patch(`/v1/blocks/${narration.id}`, { json: { speaker_id: null } });
  const ch = (await _page(c, p.scene_id)).chapter;
  expect([ch.no_speaker, ch.narration_waiting]).toEqual([1, 0]);
});
