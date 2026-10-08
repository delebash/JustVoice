// SPDX-License-Identifier: MIT
// A chapter's text, edited from Script's grid — "✎ Edit text" (2026-10-05) — GET/PUT
// /v1/scenes/{id}/text (the port of tests/test_chapter_text.py).
//
// TASKS "A chapter's text can be edited from its row, and a chapter opens before Analyze". What
// these pin:
//   * the text is the chapter's lines, a paragraph each
//   * a line whose words are unchanged keeps its id, speaker and takes; spacing is not a change
//   * a changed or new paragraph is a new line with no speaker (source "manual"), and Script
//     counts it "changed since" on an analyzed chapter
//   * a removed or changed line takes its takes with it, and a dry run says how many lines with
//     takes would go, changing nothing
//
// The route tests run on the real app (create_app + seed_workspace). Analyze's model call is
// faked as Python faked it (`pipeline.runFeature`); its prompt measuring (`pipeline.
// measureFeature`, which Python left real) answers "can't measure" here, so no test can reach a
// language model.
import { afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { textEditPlan } from "../src/api/projects_api.js";
import { Generation, Take, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import * as pipeline from "../src/extraction/pipeline.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(closeApps);

const P1 = "The lamps guttered in the hall.";
const P2 = "“We leave at dawn,” said Mara Vance.";
const P3 = "Nobody answered her.";

/** The `client` + `project` fixtures: the app, and a JustWrite book of one chapter imported. */
async function project() {
  const { c } = await appClient(undefined, { seed: true });
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson({ chapters: [["ch1", "One", [scene("scn1", P1, P2, P3)]]] }) });
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

const put = (c, sceneId, text, dryRun = false) => c.put(`/v1/scenes/${sceneId}/text`, { json: { text, dry_run: dryRun } });

// ── The match ────────────────────────────────────────────────────────────

test("the_plan_keeps_unchanged_lines_and_counts_the_rest", () => {
  const [steps, counts] = textEditPlan(["a", "b", "c", "d"], ["a", "B!", "c", "e", "f"]);
  expect(counts).toEqual({ kept: 2, changed: 2, added: 1, removed: 0 });
  expect(steps.filter((s) => s[0] !== "drop")).toEqual([
    ["keep", 0],
    ["new", 1],
    ["keep", 2],
    ["new", 3],
    ["new", 4],
  ]);
  expect(
    steps
      .filter(([kind]) => kind === "drop")
      .map(([, i]) => i)
      .sort((a, b) => a - b),
  ).toEqual([1, 3]);
});

test("spacing_is_not_a_change", () => {
  const [, counts] = textEditPlan(["one  two\nthree"], ["one two three"]);
  expect(counts).toEqual({ kept: 1, changed: 0, added: 0, removed: 0 });
});

// ── The routes ───────────────────────────────────────────────────────────

test("the_text_is_the_chapters_lines_a_paragraph_each", async () => {
  const p = await project();
  const text = (await p.c.get(`/v1/scenes/${p.sceneId}/text`)).json().text;
  expect(text).toBe((await blocks(p.c, p.sceneId)).map((b) => b.text).join("\n\n"));
});

test("an_unchanged_text_changes_nothing", async () => {
  const p = await project();
  const before = await blocks(p.c, p.sceneId);
  const text = (await p.c.get(`/v1/scenes/${p.sceneId}/text`)).json().text;
  const r = await put(p.c, p.sceneId, `${text}\n\n\n`);
  expect(r.status, r.text).toBe(200);
  expect([r.json().changed, r.json().added, r.json().removed]).toEqual([0, 0, 0]);
  expect(await blocks(p.c, p.sceneId)).toEqual(before);
});

test("a_changed_paragraph_is_a_new_line_and_the_rest_keep_everything", async () => {
  const p = await project();
  const before = await blocks(p.c, p.sceneId);
  const mara = (await p.c.get(`/v1/projects/${p.id}/speakers`)).json().speakers.find((s) => s.name === "Mara Vance").id;
  await p.c.patch(`/v1/blocks/${before[0].id}`, { json: { speaker_id: mara, source: "corrected" } });
  const paras = before.map((b) => b.text);
  paras[paras.length - 1] = "Nobody answered him.";
  paras.push("The door shut.");

  const r = await put(p.c, p.sceneId, paras.join("\n\n"));
  expect(r.status, r.text).toBe(200);
  expect(r.json()).toEqual({ kept: before.length - 1, changed: 1, added: 1, removed: 0, takes_lost: 0 });

  const after = await blocks(p.c, p.sceneId);
  expect(after.map((b) => b.text)).toEqual(paras);
  expect(after.slice(0, -2).map((b) => b.id)).toEqual(before.slice(0, -1).map((b) => b.id));
  expect(after[0].speaker_id).toBe(mara);
  expect(after[0].source).toBe("corrected");
  expect(after.slice(-2).every((b) => b.speaker_id === null && b.source === "manual")).toBe(true);
  expect(after.map((b) => b.position)).toEqual(after.map((_, i) => i));
});

test("a_dry_run_says_which_takes_would_go_and_changes_nothing", async () => {
  const p = await project();
  const before = await blocks(p.c, p.sceneId);
  addTake(before[0].id);
  addTake(before[1].id);
  const text = ["Changed.", ...before.slice(2).map((b) => b.text)].join("\n\n");

  const r = await put(p.c, p.sceneId, text, true);
  expect(r.json().takes_lost).toBe(2);
  expect(await blocks(p.c, p.sceneId)).toEqual(before);

  expect((await put(p.c, p.sceneId, text)).status).toBe(200);
  const left = session.getDb().all(`select * from ${Take} where block_id in (?, ?)`, [before[0].id, before[1].id], Take);
  expect(left.length).toBe(0);
});

test("an_empty_text_is_refused", async () => {
  const p = await project();
  const r = await put(p.c, p.sceneId, " \n\n ");
  expect(r.status).toBe(400);
  expect(r.text).toContain("Delete");
});

test("script_counts_lines_changed_since_the_last_analyze", async () => {
  const p = await project();
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(pipeline, "runFeature").mockImplementation(async () => ({ text: "[]", prompt_tokens: 0, completion_tokens: 0, model: "stub" }));
  const text = (await p.c.get(`/v1/scenes/${p.sceneId}/text`)).json().text;
  expect((await p.c.post(`/v1/scenes/${p.sceneId}/analyze`, { json: { text } })).status).toBe(200);

  const edited = async () => (await p.c.get(`/v1/projects/${p.id}/script`)).json().chapters[0].edited_since;

  expect(await edited()).toBe(0);
  const lines = await blocks(p.c, p.sceneId);
  await put(p.c, p.sceneId, [...lines.map((b) => b.text), "The door shut."].join("\n\n"));
  expect(await edited()).toBe(1);
});
