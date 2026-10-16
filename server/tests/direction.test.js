// SPDX-License-Identifier: MIT
// Direction — the one-click plan's step 6 (slice 2, 2026-10-16; docs/plans/2026-10-11-one-click-
// audiobook.md §2 step 6, §3, §5).
//
// Pins: the reply is read wherever its JSON sits and only the nine emotions pass; the carry gives
// a speaker's answer to their other lines in the same paragraph, forward then back, and never
// across speakers or paragraphs; an answer is shaped to the line's model (words + emotion on a
// written-direction model, the tag on a tag model, nothing on sliders or with no voice); the
// Frontier card's preset picks the recipe; a long chapter is read in pieces, each line answered
// once; the scene route writes many lines in one go, records who wrote them, never overwrites a
// line you set, and a re-run replaces only the model's own; the text route writes nothing.
//
// The model is `direction.runFeature` and its prompt measure `direction.measureFeature` (as
// pipeline's in analyze_persist); a voice's model is `voice_model.voiceModel`, so no test reaches
// a model or a speech engine.
import * as llmStores from "@delebash/llm-runner/llm/stores";
import { resolveFeaturePreset, stores } from "@delebash/llm-runner/llm";
import { afterEach, expect, test, vi } from "vitest";
import { getState } from "../src/app_state.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import * as direction from "../src/extraction/direction.js";
import { carry, formatLines, isMarked, modelOwns, parseAnswers, shapeFor } from "../src/extraction/direction.js";
import { blockMeta } from "../src/line_takes.js";
import { DEFAULT_FEATURE_PROMPTS } from "../src/seed_feature_prompts.js";
import { DEFAULT_FEATURE_PRESETS } from "../src/seed_presets.js";
import * as vmod from "../src/voice_model.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApps();
});

// ── Reading the reply ──────────────────────────────────────────────────────

test("the_reply_is_read_wherever_its_json_sits", () => {
  const reply =
    'Here you go. <think>{"lines": [{"id": "D9", "emotion": "sad"}]}</think> ' +
    '{"lines": [{"id": "D3", "emotion": "Angry", "direction": "  said   indignantly "}, ' +
    '{"id": "D4", "emotion": "neutral", "direction": ""}, {"id": "[D5]", "emotion": "joyful", "direction": "laughing"}]} done';
  expect([...parseAnswers(reply)]).toEqual([
    [3, { emotion: "angry", direction: "said indignantly" }],
    // An emotion outside the nine is dropped, the words kept.
    [5, { emotion: "", direction: "laughing" }],
  ]); // "neutral" alone marks nothing; the thinking is never read
  // An object keyed by line, and a bare array, read the same.
  expect([...parseAnswers('{"D7": {"emotion": "sad", "direction": "sighing"}}')]).toEqual([[7, { emotion: "sad", direction: "sighing" }]]);
  expect([...parseAnswers('[{"id": 2, "emotion": "whispered"}]')]).toEqual([[2, { emotion: "whispered", direction: "" }]]);
  expect(parseAnswers('{"lines": []}').size).toBe(0);
  expect(parseAnswers("no json at all").size).toBe(0);
});

test("marked_means_an_emotion_that_says_something_or_words", () => {
  expect(isMarked({ emotion: "neutral", direction: "" })).toBe(false);
  expect(isMarked({ emotion: "neutral", direction: "calmly" })).toBe(true);
  expect(isMarked({ emotion: "sad", direction: "" })).toBe(true);
  expect(isMarked(null)).toBe(false);
});

test("the_chapter_reads_with_each_spoken_line_marked_and_its_speaker", () => {
  const text = formatLines([
    { kind: "narration", text: "He sighed.", paragraph_idx: 0 },
    { kind: "dialogue", text: "Oh dear,", paragraph_idx: 0, dialogue_id: 0, speaker_name: "Hatter" },
    { kind: "dialogue", text: "Hm.", paragraph_idx: 1, dialogue_id: 1, speaker_name: null },
  ]);
  expect(text).toBe('He sighed. [D0 · Hatter] "Oh dear,"\n\n[D1 · unknown] "Hm."');
});

// ── The carry ──────────────────────────────────────────────────────────────

test("the_carry_goes_to_the_speakers_other_lines_in_the_paragraph_forward_then_back", () => {
  const lines = [
    { did: 0, paragraph: 0, speaker: "a" }, // before a's cue — the back sweep
    { did: 1, paragraph: 0, speaker: "b" }, // another speaker — never
    { did: 2, paragraph: 0, speaker: "a" }, // the cue
    { did: 3, paragraph: 0, speaker: "a" }, // after it — the forward sweep
    { did: 4, paragraph: 1, speaker: "a" }, // another paragraph — never
    { did: 5, paragraph: 2, speaker: null }, // no speaker takes nothing…
    { did: 6, paragraph: 2, speaker: null }, // …and gives nothing
  ];
  const own = new Map([
    [2, { emotion: "sad", direction: "sighing" }],
    [6, { emotion: "angry", direction: "x" }],
  ]);
  const got = carry(lines, own);
  expect(got.get(0)).toEqual({ emotion: "sad", direction: "sighing", carried_from: "D2" });
  expect(got.get(3)).toEqual({ emotion: "sad", direction: "sighing", carried_from: "D2" });
  expect(got.has(1)).toBe(false);
  expect(got.has(4)).toBe(false);
  expect(got.has(5)).toBe(false);
  expect(got.get(2)).toEqual(own.get(2)); // the model's own stays as it was
  expect(own.size).toBe(2); // the model's answers are not changed
});

test("a_nearer_cue_wins_and_a_carried_answer_is_never_carried_again", () => {
  const lines = [0, 1, 2, 3].map((did) => ({ did, paragraph: 0, speaker: "a" }));
  const got = carry(
    lines,
    new Map([
      [1, { emotion: "sad", direction: "first" }],
      [3, { emotion: "angry", direction: "second" }],
    ]),
  );
  expect(got.get(0).carried_from).toBe("D1"); // back from the nearest after
  expect(got.get(2).carried_from).toBe("D1"); // forward from the nearest before
});

// ── Shaped to the line's model ─────────────────────────────────────────────

test("an_answer_is_shaped_to_the_lines_model", () => {
  const scared = { emotion: "fearful", direction: "in a frightened tone" };
  // Written direction: the words and the emotion.
  expect(shapeFor(scared, "voxcpm2")).toEqual({ direction: "in a frightened tone", emotion: "fearful" });
  // A tag model: its own tag for the emotion (Turbo's value_map), no words.
  expect(shapeFor(scared, "chatterbox-turbo")).toEqual({ direction: null, emotion: "fear" });
  // …and nothing where it has no tag for it.
  expect(shapeFor({ emotion: "sad", direction: "sighing" }, "chatterbox-turbo")).toEqual({ direction: null, emotion: null });
  // A written-direction model whose file maps only some emotions keeps the words.
  expect(shapeFor({ emotion: "contemptuous", direction: "scornfully" }, "cosyvoice3")).toEqual({ direction: "scornfully", emotion: null });
  // Sliders only, or no voice yet: nothing.
  expect(shapeFor(scared, "kokoro")).toEqual({ direction: null, emotion: null });
  expect(shapeFor(scared, null)).toEqual({ direction: null, emotion: null });
  // "neutral" is never written.
  expect(shapeFor({ emotion: "neutral", direction: "calmly" }, "voxcpm2")).toEqual({ direction: "calmly", emotion: null });
});

test("a_line_is_the_models_only_while_it_holds_what_the_model_wrote", () => {
  expect(modelOwns("", {})).toBe(true); // nothing set — free
  expect(modelOwns(null, {})).toBe(true);
  expect(modelOwns("softly", {})).toBe(false); // yours, or the import's
  expect(modelOwns("", { line_models: { voxcpm2: { emotion: "sad" } } })).toBe(false); // your emotion
  expect(modelOwns("", { line_models: { voxcpm2: { emotion: "" } } })).toBe(false); // "none on this line" is yours too
  expect(modelOwns("", { line_models: { voxcpm2: { knobs: { cfg_value: 2 } } } })).toBe(true); // a knob isn't direction
  const by = { direction_by: { direction: "sighing", emotion: { voxcpm2: "sad" } } };
  expect(modelOwns("sighing", { ...by, line_models: { voxcpm2: { emotion: "sad" } } })).toBe(true);
  expect(modelOwns("sighing, then laughing", { ...by, line_models: { voxcpm2: { emotion: "sad" } } })).toBe(false);
  expect(modelOwns("sighing", { ...by, line_models: { voxcpm2: { emotion: "happy" } } })).toBe(false);
  expect(modelOwns("sighing", by)).toBe(false); // you took its emotion off
});

// ── The seeds ──────────────────────────────────────────────────────────────

test("both_recipes_are_seeded_as_routed_cards", () => {
  const local = DEFAULT_FEATURE_PROMPTS["direction.local"];
  const frontier = DEFAULT_FEATURE_PROMPTS["direction.frontier"];
  expect([local.feature, frontier.feature]).toEqual(["direction", "direction"]);
  expect([local.label, frontier.label]).toEqual(["Local", "Frontier"]);
  expect(local.json_mode).toBe(true); // an object answer, JSON mode — thinking off
  expect(frontier.json_mode ?? false).toBe(false); // so the preset's thinking runs
  expect(local.user_template).toContain("{{paragraphs}}");
  for (const v of ["{{speakers}}", "{{earlier}}", "{{paragraphs}}"]) expect(frontier.user_template).toContain(v);
  expect(DEFAULT_FEATURE_PRESETS["direction.local"]).toBe("p_extract_reasoned");
  expect(DEFAULT_FEATURE_PRESETS["direction.frontier"]).toBe("p_extract_reasoned");
});

// ── Asking the model ───────────────────────────────────────────────────────

/** A model stub: records each call, answers every [D#] it is shown with `answer(did)`. */
function stubModel(answer, calls = []) {
  vi.spyOn(direction, "runFeature").mockImplementation(async (action, variables, overrides) => {
    calls.push({ action, variables, overrides });
    const ids = [...variables.paragraphs.matchAll(/\[D(\d+) ·/g)].map((m) => Number(m[1]));
    const lines = ids.map((d) => answer(d)).filter(Boolean);
    return { text: JSON.stringify({ lines }), prompt_tokens: 10, completion_tokens: 5, model: "stub-model", finish_reason: "stop" };
  });
  return calls;
}

/** n paragraphs, each one narration and one spoken line. */
function chapterSegments(n) {
  const segs = [];
  for (let i = 0; i < n; i++) {
    segs.push({ kind: "narration", text: `Narration ${i} goes on a while here.`, paragraph_idx: i });
    segs.push({ kind: "dialogue", text: `Line ${i}.`, paragraph_idx: i, dialogue_id: i, speaker_name: "Mara" });
  }
  return segs;
}

test("a_chapter_that_fits_is_one_call_on_the_local_card", async () => {
  vi.spyOn(direction, "measureFeature").mockResolvedValue(null);
  vi.spyOn(direction, "directionRecipe").mockReturnValue("local");
  const calls = stubModel((d) => (d === 1 ? { id: `D${d}`, emotion: "sad", direction: "sighing" } : null));
  const r = await direction.directChapter({ segments: chapterSegments(3), cast: [{ name: "Mara" }], earlier: [["One", "Before."]] });
  expect(calls.length).toBe(1);
  expect(calls[0].action).toBe("direction.local");
  // The local recipe reads the chapter alone.
  expect(Object.keys(calls[0].variables)).toEqual(["paragraphs"]);
  expect(r.recipe).toBe("local");
  expect([...r.answers]).toEqual([[1, { emotion: "sad", direction: "sighing" }]]);
  expect(r.usage).toMatchObject({ prompt_tokens: 10, completion_tokens: 5, model: "stub-model", pieces: 1 });
});

test("the_frontier_recipe_reads_the_cast_and_the_chapters_before", async () => {
  vi.spyOn(direction, "measureFeature").mockResolvedValue(null);
  const calls = stubModel(() => null);
  const r = await direction.directChapter({
    segments: chapterSegments(1),
    cast: [{ name: "Mara", aliases: ["Mar"], description: "a dry archivist" }],
    earlier: [["One", "It began."]],
    recipe: "frontier",
  });
  expect(r.action).toBe("direction.frontier");
  expect(calls[0].variables.speakers).toBe("- Mara — also called Mar — a dry archivist");
  expect(calls[0].variables.earlier).toBe("One\n\nIt began.");
  // No earlier chapters says so rather than sending nothing.
  await direction.directChapter({ segments: chapterSegments(1), recipe: "frontier" });
  expect(calls[1].variables.earlier).toBe("(none — this is the first chapter)");
});

test("a_long_chapter_is_read_in_pieces_each_line_answered_once", async () => {
  // Measured: 10 paragraphs cost far more than the room one call has.
  vi.spyOn(direction, "measureFeature").mockImplementation(async (_a, variables) =>
    variables.paragraphs ? { prompt_tokens: 2100, context: 600, model: "m" } : { prompt_tokens: 100, context: 600, model: "m" },
  );
  const calls = stubModel((d) => ({ id: `D${d}`, emotion: "happy", direction: `cue ${d}` }));
  const r = await direction.directChapter({ segments: chapterSegments(10), recipe: "local", settings: { extraction: { split_lead_in_paragraphs: 1, answer_tokens_per_line: 65 } } });
  expect(calls.length).toBeGreaterThan(1);
  expect(r.usage.pieces).toBe(calls.length);
  // Every line answered, each by the piece that owns it.
  expect([...r.answers.keys()].sort((a, b) => a - b)).toEqual([...Array(10).keys()]);
});

test("the_frontier_cards_preset_picks_the_recipe", async () => {
  await appClient(undefined, { seed: true });
  expect(direction.directionRecipe()).toBe("local"); // the seeded built-in engine
  const preset = resolveFeaturePreset("direction.frontier", "direction");
  llmStores.getEnginePresetStore().save({ ...preset, recipe: "frontier" });
  expect(direction.directionRecipe()).toBe("frontier");
  llmStores.getEnginePresetStore().save({ ...preset, recipe: "local" });
  expect(direction.directionRecipe()).toBe("local");
  // The seeded rows are in the shared store.
  const rows = Object.fromEntries(stores.getPromptStore().list().map((x) => [x.key, x]));
  expect(rows["direction.local"].json_mode).toBe(true);
  expect(rows["direction.frontier"].json_mode).toBe(false);
});

// ── The routes ─────────────────────────────────────────────────────────────

const h = () => session.getDb();

/**
 * A book of two chapters, the second analyzed: Mara on a written-direction voice (voxcpm2) and
 * Sarah on a tag voice (chatterbox-turbo).
 *
 *   ¶0  Mara turned. “Leave it,” she said coldly. “Now.”       D0 Mara · D1 Mara
 *   ¶1  “Why?” Sarah whispered.                                D2 Sarah
 *   ¶2  “Because.”                                             D3 Mara
 */
async function book() {
  const { c } = await appClient(undefined, { seed: true });
  const st = getState();
  const pid = uuid();
  h().insert(Project, { id: pid, name: "Cellar", project_type: "audiobook" });
  const first = uuid();
  const sid = uuid();
  h().insert(Scene, { id: first, project_id: pid, position: 0, title: "One" });
  h().insert(Block, { id: uuid(), scene_id: first, position: 0, text: "It began in the cellar." });
  h().insert(Scene, { id: sid, project_id: pid, position: 1, title: "Two", metadata_json: JSON.stringify({ analyzed_at: "2026-10-16T00:00:00" }) });
  const maraP = st.personas.create("Mara P", { voice_id: "v_vox" }).id;
  const sarahP = st.personas.create("Sarah P", { voice_id: "v_turbo" }).id;
  const mara = uuid();
  const sarah = uuid();
  h().insert(Speaker, { id: mara, project_id: pid, name: "Mara", persona_id: maraP });
  h().insert(Speaker, { id: sarah, project_id: pid, name: "Sarah", persona_id: sarahP });
  const rows = [
    ["Mara turned.", null, "narration", 0],
    ["“Leave it,”", mara, "tag", 0],
    ["she said coldly.", null, "narration", 0],
    ["“Now.”", mara, "propagated", 0],
    ["“Why?”", sarah, "llm", 1],
    ["Sarah whispered.", null, "narration", 1],
    ["“Because.”", mara, "llm", 2],
  ];
  const ids = rows.map(([text, speaker, source, para], i) => {
    const id = uuid();
    h().insert(Block, { id, scene_id: sid, position: i, text, speaker_id: speaker, source, metadata_json: JSON.stringify({ paragraph_idx: para }) });
    return id;
  });
  vi.spyOn(vmod, "voiceModel").mockImplementation(async (_st, vid) => ({ model: vid === "v_vox" ? "voxcpm2" : "chatterbox-turbo" }));
  vi.spyOn(direction, "measureFeature").mockResolvedValue(null);
  // Spoken lines D0..D3 are blocks 1, 3, 4, 6.
  return { c, pid, first, sid, mara, sarah, line: { D0: ids[1], D1: ids[3], D2: ids[4], D3: ids[6] } };
}

const blockOf = (id) => h().one(`select * from ${Block} where id = ?`, [id], Block);
const plain = (v) => JSON.parse(JSON.stringify(v));

test("the_scene_route_writes_many_lines_shaped_and_records_who_wrote_them", async () => {
  const { c, sid, line } = await book();
  const calls = stubModel((d) =>
    d === 0 ? { id: "D0", emotion: "angry", direction: "coldly" } : d === 2 ? { id: "D2", emotion: "fearful", direction: "in a frightened whisper" } : null,
  );
  const r = await c.post(`/v1/scenes/${sid}/direction`, { json: {} });
  expect(r.status, r.text).toBe(200);
  const body = r.json();
  expect(body.recipe).toBe("local");
  expect(body.action).toBe("direction.local");
  // The model read each line with who speaks it.
  expect(calls[0].variables.paragraphs).toContain('[D0 · Mara] "Leave it,"');
  expect(calls[0].variables.paragraphs).toContain('[D2 · Sarah] "Why?"');
  expect(body.lines.map((l) => [l.id, l.carried_from])).toEqual([
    ["D0", null],
    ["D1", "D0"], // the carry: Mara's other line in the paragraph
    ["D2", null],
  ]);
  expect(body.persisted).toMatchObject({ written: 3, kept_yours: 0, cleared: 0 });

  // Mara (written direction): the words and the emotion; who wrote it, recorded.
  const d0 = blockOf(line.D0);
  expect(d0.direction).toBe("coldly");
  const m0 = plain(blockMeta(d0));
  expect(m0.line_models).toEqual({ voxcpm2: { emotion: "angry" } });
  expect(m0.direction_by).toEqual({ model: "stub-model", recipe: "local", direction: "coldly", emotion: { voxcpm2: "angry" } });
  expect(m0.paragraph_idx).toBe(0); // the line's own metadata kept
  expect(plain(blockMeta(blockOf(line.D1))).direction_by.carried_from).toBe("D0");
  expect(blockOf(line.D1).direction).toBe("coldly");
  // Sarah (a tag model): Turbo's own tag, no words.
  const d2 = blockOf(line.D2);
  expect(d2.direction ?? "").toBe("");
  expect(plain(blockMeta(d2)).line_models).toEqual({ "chatterbox-turbo": { emotion: "fear" } });
  // An unmarked line is untouched.
  expect(blockOf(line.D3).direction).toBe(null);
  expect(plain(blockMeta(blockOf(line.D3)))).toEqual({ paragraph_idx: 2 });
  // The chapter records the run.
  const sm = JSON.parse(h().one(`select metadata_json from ${Scene} where id = ?`, [sid]).metadata_json);
  expect(sm.direction).toMatchObject({ model: "stub-model", recipe: "local" });
  expect(sm.analyzed_at).toBe("2026-10-16T00:00:00");
});

test("a_line_you_set_is_never_overwritten_and_a_rerun_replaces_only_the_models", async () => {
  const { c, sid, line } = await book();
  stubModel((d) =>
    d === 0 ? { id: "D0", emotion: "angry", direction: "coldly" } : d === 2 ? { id: "D2", emotion: "fearful", direction: "in a frightened whisper" } : null,
  );
  expect((await c.post(`/v1/scenes/${sid}/direction`, { json: {} })).status).toBe(200);
  // You change one carried line on Render ("This line only"), and give D3 an emotion of your own.
  expect((await c.patch(`/v1/blocks/${line.D1}`, { json: { direction: "softly" } })).status).toBe(200);
  expect((await c.patch(`/v1/blocks/${line.D3}`, { json: { line_override: { models: { voxcpm2: { emotion: "happy" } } } } })).status).toBe(200);

  vi.mocked(direction.runFeature).mockRestore();
  stubModel((d) => (d === 0 || d === 3 ? { id: `D${d}`, emotion: "sad", direction: "sighing" } : null));
  const r = await c.post(`/v1/scenes/${sid}/direction`, { json: {} });
  expect(r.status, r.text).toBe(200);
  // D0 the model's again; D1 (carried onto) and D3 yours, kept; D2 the model's from before, cleared.
  expect(r.json().persisted).toMatchObject({ written: 1, kept_yours: 2, cleared: 1 });
  expect(blockOf(line.D0).direction).toBe("sighing");
  expect(plain(blockMeta(blockOf(line.D0))).line_models).toEqual({ voxcpm2: { emotion: "sad" } });
  expect(blockOf(line.D1).direction).toBe("softly");
  expect(plain(blockMeta(blockOf(line.D3))).line_models).toEqual({ voxcpm2: { emotion: "happy" } });
  const d2 = plain(blockMeta(blockOf(line.D2)));
  expect(d2.line_models).toBeUndefined();
  expect(d2.direction_by).toBeUndefined();
});

test("the_carry_can_be_left_off", async () => {
  const { c, sid, line } = await book();
  stubModel((d) => (d === 0 ? { id: "D0", emotion: "angry", direction: "coldly" } : null));
  const r = await c.post(`/v1/scenes/${sid}/direction`, { json: { carry: false } });
  expect(r.json().lines.map((l) => l.id)).toEqual(["D0"]);
  expect(blockOf(line.D1).direction).toBe(null);
});

test("a_line_with_no_voice_or_a_sliders_model_gets_nothing", async () => {
  const { c, sid, line } = await book();
  vi.mocked(vmod.voiceModel).mockResolvedValue({ model: "kokoro" });
  stubModel((d) => (d === 0 ? { id: "D0", emotion: "angry", direction: "coldly" } : null));
  let r = await c.post(`/v1/scenes/${sid}/direction`, { json: { carry: false } });
  expect(r.json().persisted).toMatchObject({ written: 0, takes_none: 1 });
  vi.mocked(vmod.voiceModel).mockResolvedValue(null);
  r = await c.post(`/v1/scenes/${sid}/direction`, { json: { carry: false } });
  expect(r.json().persisted).toMatchObject({ written: 0, no_voice: 1 });
  expect(blockOf(line.D0).direction).toBe(null);
});

test("the_frontier_recipe_runs_its_own_card_with_the_book_so_far", async () => {
  const { c, sid } = await book();
  const calls = stubModel(() => null);
  const r = await c.post(`/v1/scenes/${sid}/direction`, { json: { recipe: "frontier" } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().action).toBe("direction.frontier");
  expect(calls[0].variables.earlier).toBe("One\n\nIt began in the cellar.");
  expect(calls[0].variables.speakers).toContain("- Mara");
});

test("a_chapter_never_analyzed_is_refused", async () => {
  const { c, first } = await book();
  stubModel(() => null);
  const r = await c.post(`/v1/scenes/${first}/direction`, { json: {} });
  expect(r.status).toBe(409);
  expect(r.text).toContain("Analyze this chapter first");
});

test("the_text_route_runs_the_same_step_and_writes_nothing", async () => {
  const { c } = await appClient(undefined, { seed: true });
  vi.spyOn(direction, "measureFeature").mockResolvedValue(null);
  stubModel((d) => (d === 0 ? { id: "D0", emotion: "sad", direction: "sighing" } : null));
  const text = "“Oh dear,” sighed the Hatter. “It's always six o'clock.”\n\n“Is it?” said Alice.";
  const r = await c.post("/v1/extraction/direction-text", { json: { text, speakers: { 0: "Hatter", 1: "Hatter", 2: "Alice" } } });
  expect(r.status, r.text).toBe(200);
  const body = r.json();
  expect(body.scene_id).toBe("(adhoc)");
  expect(body.persisted).toBe(null);
  expect(body.lines.map((l) => [l.id, l.speaker, l.emotion, l.carried_from])).toEqual([
    ["D0", "Hatter", "sad", null],
    ["D1", "Hatter", "sad", "D0"],
  ]);
  // Without the carry: the model's own answers only.
  const bare = (await c.post("/v1/extraction/direction-text", { json: { text, speakers: { 0: "Hatter", 1: "Hatter" }, carry: false } })).json();
  expect(bare.lines.map((l) => l.id)).toEqual(["D0"]);
});
