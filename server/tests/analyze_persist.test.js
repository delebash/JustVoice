// SPDX-License-Identifier: MIT
// Analyze saves its rows into the chapter's lines (the port of tests/test_analyze_persist.py).
//
// docs/plans/2026-08-08-script-tab-restore.md, decisions 2/3/4. Before this,
// `/v1/scenes/{id}/analyze` returned rows and persisted nothing: the renderer held them in one ref
// that a chapter change wiped, and a separate "Apply" button POSTed them back as NEW blocks on top
// of the ones the text was built from, so analyzing twice doubled the chapter.
//
// What these pin: the first analyze re-cuts an imported chapter into segments and saves them;
// narration binds to the project's Narrator instead of null; a second analyze updates in place —
// the block count never moves; rows the user corrected survive a re-analyze; a re-cut is refused
// once takes exist (Take.block_id is ON DELETE CASCADE); a speaker the model invented does not
// blow up the run on the FK.
//
// The model is `pipeline.runFeature` (Python patched `pipeline.run_feature`); the prompt measure
// (`pipeline.measureFeature`, which only sizes pieces) is stubbed to "can't say" as well, so no
// test reaches a model.
import { afterEach, expect, test, vi } from "vitest";
import { Generation, Take, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import * as pipeline from "../src/extraction/pipeline.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(closeApps);

// Two paragraphs, one of them mixing narration and dialogue — so the segmenter's split (3
// segments) differs from the import's (2 blocks).
const PARA_1 = "The lamps guttered in the hall.";
const PARA_2 = "“We leave at dawn,” said Mara.";

/** The app + a one-chapter JustWrite book (Python's `client` + `project` fixtures). */
async function setup() {
  const { c } = await appClient(undefined, { seed: true });
  const r = await c.post("/v1/projects/import?source=justwrite", {
    json: bookJson({ chapters: [["ch1", "One", [scene("scn1", PARA_1, PARA_2)]]] }),
  });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const sid = (await c.get(`/v1/projects/${pid}/scenes`)).json()[0].id;
  return { c, project: { id: pid, scene_id: sid } };
}

const _blocks = async (c, sceneId) => (await c.get(`/v1/scenes/${sceneId}/blocks`)).json();

const _analyze = (c, sceneId, text) => c.post(`/v1/scenes/${sceneId}/analyze`, { json: { text } });

async function _maraId(c, projectId) {
  const speakers = (await c.get(`/v1/projects/${projectId}/speakers`)).json().speakers;
  return speakers.find((sp) => sp.name.includes("Mara")).id;
}

/** The book's narrator, given by "+ Add Narrator" — since 2026-09-29 no book has one until you
 * choose it. */
async function _narratorId(c, projectId) {
  const r = await c.post(`/v1/projects/${projectId}/narrator`);
  expect(r.status, r.text).toBe(201);
  return r.json().speakers.find((sp) => sp.role_label === "narrator").id;
}

/** Stub the model's reply for the one [D#] segment in PARA_2. */
function _answer(speaker, confidence = 0.95) {
  return async (_action, _variables, _overrides) => ({
    text: `[{"dialogue_id": 0, "speaker": "${speaker}", "confidence": ${confidence}}]`,
    prompt_tokens: 0,
    completion_tokens: 0,
    model: "stub",
  });
}

/** `monkeypatch.setattr("justvoice.extraction.pipeline.run_feature", fn)`. */
function useModel(fn) {
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(pipeline, "runFeature").mockImplementation(fn);
}

/** A generation and a default take against `blockId` (Python opened SessionLocal()). */
function _takeOn(blockId) {
  const h = session.getDb();
  const gid = uuid();
  h.tx(() => {
    h.insert(Generation, { id: gid, text: "x", engine: "stub", status: "completed" });
    h.insert(Take, { id: uuid(), block_id: blockId, generation_id: gid, is_default: true });
  });
}

test("first_analyze_resegments_and_saves", async () => {
  const { c, project } = await setup();
  const mara = await _maraId(c, project.id);
  useModel(_answer(mara));

  const before = await _blocks(c, project.scene_id);
  expect(before.length).toBe(2); // import: one block per paragraph
  expect(before.every((b) => b.source === null)).toBe(true);

  const r = await _analyze(c, project.scene_id, `${PARA_1}\n\n${PARA_2}`);
  expect(r.status, r.text).toBe(200);
  expect(r.json().persisted.mode).toBe("resegmented");

  const after = await _blocks(c, project.scene_id);
  expect(after.length).toBe(3); // narration · dialogue · narration
  expect(after.map((b) => b.source)).toEqual(["narration", "llm", "narration"]);
  // Dialogue keeps its quote marks, or the stored chapter reads wrong AND re-segmenting it
  // would find no dialogue at all.
  expect(after[1].text).toBe("“We leave at dawn,”");
  expect(after[1].speaker_id).toBe(mara);
});

test("narration_binds_to_the_narrator", async () => {
  const { c, project } = await setup();
  const narrator = await _narratorId(c, project.id);
  useModel(_answer(await _maraId(c, project.id)));
  await _analyze(c, project.scene_id, `${PARA_1}\n\n${PARA_2}`);

  const narration = (await _blocks(c, project.scene_id)).filter((b) => b.source === "narration");
  expect(narration.length).toBeGreaterThan(0);
  expect(narration.every((b) => b.speaker_id === narrator)).toBe(true);
});

test("a_book_with_no_narrator_analyzes_and_leaves_narration_unread", async () => {
  // No book gets a narrator on its own (2026-09-29). Analyze still runs; narration keeps no
  // speaker until a narrator is chosen, which moves it.
  const { c, project } = await setup();
  useModel(_answer(await _maraId(c, project.id)));
  const r = await _analyze(c, project.scene_id, `${PARA_1}\n\n${PARA_2}`);
  expect(r.status, r.text).toBe(200);
  let narration = (await _blocks(c, project.scene_id)).filter((b) => b.source === "narration");
  expect(narration.length).toBeGreaterThan(0);
  expect(narration.every((b) => b.speaker_id === null)).toBe(true);

  const narrator = await _narratorId(c, project.id);
  narration = (await _blocks(c, project.scene_id)).filter((b) => b.source === "narration");
  expect(narration.every((b) => b.speaker_id === narrator)).toBe(true);
});

test("reanalyze_updates_in_place_and_keeps_corrections", async () => {
  const { c, project } = await setup();
  const mara = await _maraId(c, project.id);
  const narrator = await _narratorId(c, project.id);
  useModel(_answer(mara));
  await _analyze(c, project.scene_id, `${PARA_1}\n\n${PARA_2}`);

  const blocks = await _blocks(c, project.scene_id);
  // The user fixes the dialogue row — Studio's PATCH, source="corrected".
  let r = await c.patch(`/v1/blocks/${blocks[1].id}`, { json: { speaker_id: narrator, source: "corrected" } });
  expect(r.status, r.text).toBe(200);

  // The stored source text is what a re-analyze feeds back in.
  const stored = (await c.get(`/v1/projects/${project.id}/scenes`)).json()[0].metadata;
  expect(stored.source_text).toBe(`${PARA_1}\n\n${PARA_2}`);

  r = await _analyze(c, project.scene_id, stored.source_text);
  expect(r.status, r.text).toBe(200);
  expect(r.json().persisted).toEqual({ mode: "in_place", written: 2, kept_corrected: 1 });

  const after = await _blocks(c, project.scene_id);
  expect(after.map((b) => b.id)).toEqual(blocks.map((b) => b.id)); // nothing re-created
  expect(after[1].speaker_id).toBe(narrator); // the fix survived
  expect(after[1].source).toBe("corrected");
});

test("recut_is_refused_once_takes_exist", async () => {
  const { c, project } = await setup();
  useModel(_answer(await _maraId(c, project.id)));
  await _analyze(c, project.scene_id, `${PARA_1}\n\n${PARA_2}`);
  const blockId = (await _blocks(c, project.scene_id))[0].id;

  _takeOn(blockId);

  // Different text → a different split → a replace, which would cascade the take away. It must
  // refuse instead.
  const r = await _analyze(c, project.scene_id, "One sentence only.");
  expect(r.status, r.text).toBe(409);
  expect(r.json().detail).toContain("take");
  expect((await _blocks(c, project.scene_id)).length).toBe(3); // untouched
});

test("an_invented_speaker_leaves_the_line_unplaced", async () => {
  const { c, project } = await setup();
  useModel(_answer("a-speaker-that-never-existed"));
  const r = await _analyze(c, project.scene_id, `${PARA_1}\n\n${PARA_2}`);
  expect(r.status, r.text).toBe(200);
  const dialogue = (await _blocks(c, project.scene_id)).filter((b) => b.source !== "narration");
  expect(dialogue.length).toBeGreaterThan(0);
  expect(dialogue.every((b) => b.speaker_id === null)).toBe(true);
});

test("the_imports_line_ids_survive_the_recut", async () => {
  // `source_ref` is the import's stable line id and re-import merges on it
  // (`_reimport_update`'s `by_ref`). Re-cutting deletes the blocks that carry it, so without
  // carry-over the first analyze would silently break re-import — every paragraph would come
  // back as new and duplicate the chapter, which is the failure this whole change exists to end.
  const { c, project } = await setup();
  useModel(_answer(await _maraId(c, project.id)));
  const before = (await _blocks(c, project.scene_id)).map((b) => b.metadata?.source_ref ?? null);
  expect(before.length).toBe(2);
  expect(before.every(Boolean)).toBe(true);
  // A hand-written performance note on the second paragraph — authored content the re-cut must
  // not silently drop either.
  const blocks = await _blocks(c, project.scene_id);
  await c.patch(`/v1/blocks/${blocks[1].id}`, { json: { direction: "weary" } });

  await _analyze(c, project.scene_id, `${PARA_1}\n\n${PARA_2}`);

  const after = await _blocks(c, project.scene_id);
  expect(after.length).toBe(3);
  // Each segment carries the ref of the paragraph it was CUT OUT OF — positionally, so a
  // swapped mapping fails too.
  expect(after.map((b) => b.metadata?.source_ref ?? null)).toEqual([before[0], before[1], before[1]]);
  expect(after.map((b) => b.direction)).toEqual([null, "weary", "weary"]);
});

test("an_unclosed_quote_does_not_gain_a_closing_one", async () => {
  // segmentation.py:22 matches dialogue that opens and runs to the end of a line without ever
  // closing. Storing it back with a tidy closing quote would put punctuation in the manuscript
  // the author never wrote.
  const { c, project } = await setup();
  useModel(_answer(await _maraId(c, project.id)));
  const text = "He turned.\n\n“We leave at dawn";
  const r = await _analyze(c, project.scene_id, text);
  expect(r.status, r.text).toBe(200);
  const stored = (await _blocks(c, project.scene_id)).map((b) => b.text);
  expect(stored).toContain("“We leave at dawn");
  expect(stored.some((t) => t.endsWith('"') || t.endsWith("”"))).toBe(false);
});

test("a_run_with_no_rows_never_wipes_the_chapter", async () => {
  const { c, project } = await setup();
  useModel(_answer(await _maraId(c, project.id)));
  const r = await _analyze(c, project.scene_id, "   ");
  expect(r.status, r.text).toBe(409);
  expect((await _blocks(c, project.scene_id)).length).toBe(2); // the import's blocks, intact
});

test("editing_a_block_forgets_the_stored_source_text", async () => {
  const { c, project } = await setup();
  useModel(_answer(await _maraId(c, project.id)));
  await _analyze(c, project.scene_id, `${PARA_1}\n\n${PARA_2}`);

  const blockId = (await _blocks(c, project.scene_id))[0].id;
  await c.patch(`/v1/blocks/${blockId}`, { json: { text: "The lamps went out." } });

  const meta = (await c.get(`/v1/projects/${project.id}/scenes`)).json()[0].metadata;
  expect(meta).not.toHaveProperty("source_text");
});

// ── An edited chapter is re-analyzed as its lines (2026-09-30) ─────────────
//
// docs/plans/2026-09-30-script-leftovers.md, A. An edit drops the analyzed text, and the page
// then sends the lines joined up — each line a paragraph of its own, so "said Mara Vance" sat
// alone and no speech was anchored.

const TAGGED = `${PARA_1}\n\n“We leave at dawn,” said Mara Vance, “before the tide.”`;

const _meta = async (c, projectId) => (await c.get(`/v1/projects/${projectId}/scenes`)).json()[0].metadata;

/** What Script sends once the analyzed text is gone (`proseFromBlocks`). */
const _joined = async (c, sceneId) => (await _blocks(c, sceneId)).map((b) => b.text).join("\n\n");

test("an_edited_chapter_keeps_its_lines_and_its_anchors", async () => {
  const { c, project } = await setup();
  const mara = await _maraId(c, project.id);
  await _narratorId(c, project.id);
  // The model names someone who doesn't exist: only the book's words can give these lines to
  // Mara.
  useModel(_answer("nobody-real"));
  expect((await _analyze(c, project.scene_id, TAGGED)).status).toBe(200);
  const before = await _blocks(c, project.scene_id);
  expect(before.map((b) => b.source)).toEqual(["narration", "tag", "narration", "tag"]);

  await c.patch(`/v1/blocks/${before[0].id}`, { json: { text: "The lamps went out." } });
  expect(await _meta(c, project.id)).not.toHaveProperty("source_text");

  const r = await _analyze(c, project.scene_id, await _joined(c, project.scene_id));
  expect(r.status, r.text).toBe(200);
  expect(r.json().persisted.mode).toBe("in_place");
  const after = await _blocks(c, project.scene_id);
  expect(after.map((b) => b.id)).toEqual(before.map((b) => b.id));
  expect(after.map((b) => b.source)).toEqual(["narration", "tag", "narration", "tag"]);
  expect(after[1].speaker_id).toBe(mara);
  expect(after[3].speaker_id).toBe(mara);
  expect(after[1].metadata.anchor_words).toBe("said Mara Vance");
  expect(after.map((b) => b.metadata.paragraph_idx)).toEqual([0, 1, 1, 1]);
  const meta = await _meta(c, project.id);
  expect(meta).not.toHaveProperty("source_text"); // still read as its lines
  expect(meta.analyzed_at).toBeTruthy();
});

test("an_edited_chapter_with_takes_is_never_refused", async () => {
  const { c, project } = await setup();
  useModel(_answer("nobody-real"));
  await _analyze(c, project.scene_id, TAGGED);
  const blocks = await _blocks(c, project.scene_id);

  _takeOn(blocks[1].id);

  await c.patch(`/v1/blocks/${blocks[2].id}`, { json: { text: "said Mara Vance quietly," } });
  const r = await _analyze(c, project.scene_id, await _joined(c, project.scene_id));
  expect(r.status, r.text).toBe(200); // no re-cut, so no refusal
  expect((await _blocks(c, project.scene_id)).map((b) => b.id)).toEqual(blocks.map((b) => b.id));
});

test("lines_changed_during_the_run_save_nothing", async () => {
  const { c, project } = await setup();
  useModel(_answer("nobody-real"));
  await _analyze(c, project.scene_id, TAGGED);
  const blocks = await _blocks(c, project.scene_id);
  await c.patch(`/v1/blocks/${blocks[0].id}`, { json: { text: "The lamps went out." } });

  const deleteALineMidRun = async (action, variables, overrides) => {
    await c.delete(`/v1/blocks/${blocks[2].id}`);
    return _answer("nobody-real")(action, variables, overrides);
  };

  useModel(deleteALineMidRun);
  const r = await _analyze(c, project.scene_id, await _joined(c, project.scene_id));
  expect(r.status, r.text).toBe(409);
  expect(r.json().detail).toContain("changed while it was being analyzed");
});

test("a_chapter_never_edited_is_still_cut_from_its_text", async () => {
  const { c, project } = await setup();
  useModel(_answer("nobody-real"));
  await _analyze(c, project.scene_id, TAGGED);
  expect((await _meta(c, project.id)).source_text).toBe(TAGGED);
  const r = await _analyze(c, project.scene_id, TAGGED);
  expect(r.status).toBe(200);
  expect((await _meta(c, project.id)).source_text).toBe(TAGGED);
});
