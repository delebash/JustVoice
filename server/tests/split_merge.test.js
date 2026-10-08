// SPDX-License-Identifier: MIT
// Split and merge a line on Script, and what Script shows as "Left out" (the port of
// tests/test_split_merge.py).
//
// docs/plans/2026-09-30-script-leftovers.md — B1/B2 (Script's "✎ Edit…" with "Split at the
// cursor", and "⇲ Merge") and B4 ("Leave out dialogue tags").
//
// What these pin:
//   * a split keeps the first line's id, takes and import line id; the second is new, with the
//     same speaker, placed right after it
//   * a merge joins lines that sit next to each other onto the first one and deletes the rest —
//     their takes with them
//   * both drop the analyzed text, so a re-analyze keeps the hand cut
//   * Script marks a tag-only line "Left out" only when the project says so
//
// The tests run on the real app (create_app + seed_workspace). Analyze's model call is faked as
// Python faked it (`pipeline.runFeature`); its prompt measuring (`pipeline.measureFeature`,
// which Python left real) answers "can't measure" here, so no test can reach a language model.
// Python's parametrized test_a_split_needs_words_on_both_sides is one `test.each` over the same
// three offsets.
import { afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { Generation, Take, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import * as pipeline from "../src/extraction/pipeline.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(closeApps);

const PARA_1 = "The lamps guttered in the hall.";
const PARA_2 = "“We leave at dawn,” said Mara Vance.";

/** The `client` + `project` fixtures: the app, and a JustWrite book of one chapter imported. */
async function project() {
  const { c } = await appClient(undefined, { seed: true });
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson({ chapters: [["ch1", "One", [scene("scn1", PARA_1, PARA_2)]]] }) });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const sid = (await c.get(`/v1/projects/${pid}/scenes`)).json()[0].id;
  return { c, id: pid, sceneId: sid };
}

const blocks = async (c, sceneId) => (await c.get(`/v1/scenes/${sceneId}/blocks`)).json();

function addTake(blockId) {
  const h = session.getDb();
  h.tx(() => {
    const gen = uuid();
    h.insert(Generation, { id: gen, text: "x", engine: "stub", status: "completed" });
    h.insert(Take, { id: uuid(), block_id: blockId, generation_id: gen, is_default: true });
  });
}

const takeCount = (blockId) => session.getDb().all(`select * from ${Take} where block_id = ?`, [blockId], Take).length;

/** The model, faked: every dialogue line is `speaker`'s. */
function answer(speaker) {
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(pipeline, "runFeature").mockImplementation(async () => ({
    text: `[{"dialogue_id": 0, "speaker": "${speaker}", "confidence": 0.9}]`,
    prompt_tokens: 0,
    completion_tokens: 0,
    model: "stub",
  }));
}

const maraOf = async (c, pid) => (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers.find((s) => s.name === "Mara Vance").id;

// ── Split ────────────────────────────────────────────────────────────────

test("a_split_keeps_the_first_line_and_adds_the_second_after_it", async () => {
  const p = await project();
  const before = await blocks(p.c, p.sceneId);
  addTake(before[0].id);
  const r = await p.c.post(`/v1/blocks/${before[0].id}/split`, { json: { at: "The lamps".length } });
  expect(r.status, r.text).toBe(200);
  const [first, second] = r.json().blocks;
  expect([first.id, first.text, second.text]).toEqual([before[0].id, "The lamps", "guttered in the hall."]);

  const after = await blocks(p.c, p.sceneId);
  expect(after.map((b) => b.text)).toEqual(["The lamps", "guttered in the hall.", PARA_2]);
  expect(after.map((b) => b.position)).toEqual([0, 1, 2]);
  expect(after[1].speaker_id).toBe(after[0].speaker_id);
  expect(after[0].metadata.source_ref).toBeTruthy();
  expect("source_ref" in after[1].metadata).toBe(false);
  expect(takeCount(before[0].id)).toBe(1); // the first half keeps its takes
});

test("a_split_can_carry_the_editors_words", async () => {
  const p = await project();
  const bid = (await blocks(p.c, p.sceneId))[0].id;
  const r = await p.c.post(`/v1/blocks/${bid}/split`, { json: { at: 3, text: "One two" } });
  expect(r.json().blocks.map((b) => b.text)).toEqual(["One", "two"]);
});

test.each([0, PARA_1.length, 999])("a_split_needs_words_on_both_sides [%s]", async (at) => {
  const p = await project();
  const bid = (await blocks(p.c, p.sceneId))[0].id;
  const r = await p.c.post(`/v1/blocks/${bid}/split`, { json: { at } });
  expect(r.status, r.text).toBe(400);
  expect((await blocks(p.c, p.sceneId)).length).toBe(2);
});

// ── Merge ────────────────────────────────────────────────────────────────

test("a_merge_joins_neighbours_onto_the_first_and_deletes_their_takes", async () => {
  const p = await project();
  const [b0, b1] = await blocks(p.c, p.sceneId);
  addTake(b1.id);
  const r = await p.c.post(`/v1/scenes/${p.sceneId}/blocks/merge`, { json: { ids: [b1.id, b0.id] } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().id).toBe(b0.id);
  const after = await blocks(p.c, p.sceneId);
  expect(after.map((b) => [b.id, b.text, b.position])).toEqual([[b0.id, `${PARA_1} ${PARA_2}`, 0]]);
  expect(takeCount(b1.id)).toBe(0);
});

test("only_lines_next_to_each_other_merge", async () => {
  const p = await project();
  let [b0, b1] = await blocks(p.c, p.sceneId);
  await p.c.post(`/v1/blocks/${b1.id}/split`, { json: { at: "“We leave at dawn,”".length } });
  let b2;
  [b0, b1, b2] = await blocks(p.c, p.sceneId);
  let r = await p.c.post(`/v1/scenes/${p.sceneId}/blocks/merge`, { json: { ids: [b0.id, b2.id] } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("next to each other");
  r = await p.c.post(`/v1/scenes/${p.sceneId}/blocks/merge`, { json: { ids: [b0.id] } });
  expect(r.status).toBe(422);
  r = await p.c.post(`/v1/scenes/${p.sceneId}/blocks/merge`, { json: { ids: [b0.id, "elsewhere"] } });
  expect(r.status).toBe(400);
  expect((await blocks(p.c, p.sceneId)).length).toBe(3);
});

// ── A hand cut survives a re-analyze ──────────────────────────────────────

test("a_hand_cut_survives_a_reanalyze", async () => {
  // The book's speech is in single quotes, but the project is set to double, so Analyze reads
  // the line as narration; it is split by hand and given to Mara, and re-analyzing must not
  // undo that.
  const p = await project();
  await p.c.patch(`/v1/projects/${p.id}`, { json: { metadata: { speech_marks: "double" } } });
  answer("nobody-real");
  const text = "She turned. 'Wait,' she said.";
  expect((await p.c.post(`/v1/scenes/${p.sceneId}/analyze`, { json: { text } })).status).toBe(200);
  const all = await blocks(p.c, p.sceneId);
  expect(all.length).toBe(1);
  const [only] = all;
  expect(only.source).toBe("narration");

  await p.c.post(`/v1/blocks/${only.id}/split`, { json: { at: "She turned.".length } });
  const second = (await blocks(p.c, p.sceneId))[1];
  await p.c.post(`/v1/blocks/${second.id}/split`, { json: { at: "'Wait,'".length } });
  const cut = await blocks(p.c, p.sceneId);
  const mara = await maraOf(p.c, p.id);
  await p.c.patch(`/v1/blocks/${cut[1].id}`, { json: { speaker_id: mara, source: "corrected" } });

  const joined = cut.map((b) => b.text).join("\n\n");
  const r = await p.c.post(`/v1/scenes/${p.sceneId}/analyze`, { json: { text: joined } });
  expect(r.status, r.text).toBe(200);
  const after = await blocks(p.c, p.sceneId);
  expect(after.map((b) => b.id)).toEqual(cut.map((b) => b.id));
  expect(after.map((b) => b.text)).toEqual(["She turned.", "'Wait,'", "she said."]);
  expect(after[1].speaker_id).toBe(mara);
});

// ── Script's "Left out" ──────────────────────────────────────────────────

test("script_marks_tag_only_lines_left_out_only_when_the_project_says_so", async () => {
  const p = await project();
  answer("nobody-real");
  const text = `${PARA_1}\n\n“We leave at dawn,” said Mara Vance, “before the tide.”`;
  await p.c.post(`/v1/scenes/${p.sceneId}/analyze`, { json: { text } });

  const leftOut = async () =>
    (await p.c.get(`/v1/scenes/${p.sceneId}/script`))
      .json()
      .lines.filter((ln) => ln.left_out)
      .map((ln) => ln.text);

  expect(await leftOut()).toEqual([]);
  const meta = (await p.c.get(`/v1/projects/${p.id}`)).json().metadata;
  await p.c.patch(`/v1/projects/${p.id}`, { json: { metadata: { ...meta, leave_out_tags: true } } });
  expect(await leftOut()).toEqual(["said Mara Vance,"]);
});

test("script_counts_each_lines_takes", async () => {
  const p = await project();
  const [b0] = await blocks(p.c, p.sceneId);
  addTake(b0.id);
  addTake(b0.id);
  const lines = (await p.c.get(`/v1/scenes/${p.sceneId}/script`)).json().lines;
  expect(lines.map((ln) => ln.takes)).toEqual([2, 0]);
});

test("the_project_settings_keep_each_other", async () => {
  // Overview writes one key at a time into the project's metadata, merged on the client; the
  // server stores what it's given.
  const p = await project();
  await p.c.patch(`/v1/projects/${p.id}`, { json: { metadata: { speech_marks: "single" } } });
  const meta = (await p.c.get(`/v1/projects/${p.id}`)).json().metadata;
  await p.c.patch(`/v1/projects/${p.id}`, { json: { metadata: { ...meta, leave_out_tags: true } } });
  expect((await p.c.get(`/v1/projects/${p.id}`)).json().metadata).toEqual({ speech_marks: "single", leave_out_tags: true });
});
