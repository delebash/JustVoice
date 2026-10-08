// SPDX-License-Identifier: MIT
// /v1/render_chapter scene_id mode (the port of tests/test_render_chapter_scene_mode.py).
//
// Covers the behaviours documented in the Affordance Table for scene mode (added 2026-06-10).
// Each test points the module database at a fresh SQLite (Python patched SessionLocal) and
// writes the minimum scene/block/speaker graph the resolver needs; personas live in a fake
// store. `_resolveSceneToLines` is called directly — the load-bearing internal function.
import { pyJson } from "@delebash/llm-runner/platform/pyjson";
import { afterEach, beforeEach, expect, test } from "vitest";
import "./engines_helpers.js";
import { _resolveSceneToLines } from "../src/api/render_chapter_api.js";
import * as appState from "../src/app_state.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { construct, Delivery, modelDump, Persona, utcNow } from "../src/models.js";
import { tmpDb } from "./helpers.js";
import { unwrap } from "./render_helpers.js";

let h;
beforeEach(() => {
  h = tmpDb();
  session.cfg.handle = h;
});
afterEach(() => {
  session.cfg.handle = null;
  h.close();
  appState.cfg.state = null;
});

/** A state whose persona store is a dict — `_resolveSceneToLines` touches only
 * `st.personas.get(id)`. */
const fakeState = (personasById) => ({ personas: { get: (pid) => personasById[pid] ?? null } });

function makePersona(pid, { voiceId = "voice-1", voiceInstruct = null, defaultDelivery = null, lexiconId = null } = {}) {
  const now = utcNow();
  return construct(Persona, {
    id: pid,
    name: `Persona ${pid}`,
    voice_id: voiceId || "",
    voice_instruct: voiceInstruct,
    default_delivery: defaultDelivery || {},
    lexicon_id: lexiconId,
    created_at: now,
    updated_at: now,
  });
}

function makeProjectWithScene(sceneId = "scene-1") {
  h.insert(Project, { id: "proj-1", name: "Test Project", project_type: "audiobook" });
  h.insert(Scene, { id: sceneId, project_id: "proj-1", position: 0, title: "Scene 1" });
  return { id: sceneId, project_id: "proj-1" };
}

/** speaker_fixtures.speaker_played_by: this book's speaker played by `personaId`, made on first
 * use; null for null (a line with no speaker). */
function speakerPlayedBy(sceneId, personaId) {
  if (personaId === null) return null;
  const projectId = h.get(Scene, sceneId).project_id;
  const found = h.one(`select id from ${Speaker} where project_id = ? and persona_id = ? limit 1`, [projectId, personaId]);
  if (found) return found.id;
  const id = uuid();
  h.insert(Speaker, { id, project_id: projectId, name: `Speaker ${personaId}`, persona_id: personaId });
  return id;
}

/** A line said by a speaker that `personaId` plays (null = no speaker). */
function addBlock(sceneId, position, text, personaId, extra = {}) {
  const id = uuid();
  h.insert(Block, { id, scene_id: sceneId, position, text, speaker_id: speakerPlayedBy(sceneId, personaId), ...extra });
  return id;
}

/** The ApiError a call throws. */
async function refusal(promise) {
  try {
    await promise;
  } catch (e) {
    return e;
  }
  throw new Error("expected a refusal");
}

const deliveryOf = (line) => (line.delivery ? unwrap(modelDump(Delivery, line.delivery, { excludeNone: true })) : {});

// ─── #10 Scene not found raises not_found ──────────────────────────────

test("unknown_scene_raises_not_found", async () => {
  const e = await refusal(_resolveSceneToLines("nonexistent", fakeState({})));
  expect(e.statusCode).toBe(404);
});

// ─── #8 Scene with no blocks raises bad_request ────────────────────────

test("scene_with_no_blocks_raises_bad_request", async () => {
  makeProjectWithScene();
  const e = await refusal(_resolveSceneToLines("scene-1", fakeState({})));
  expect(e.statusCode).toBe(400);
  expect(String(e.detail).toLowerCase()).toContain("no blocks");
});

// ─── #2 Scene mode resolves blocks → personas → ChapterLines ──────────

test("resolves_blocks_to_chapter_lines", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Hello world.", "persona-mara");
  addBlock(scene.id, 1, "Reply text.", "persona-jane");
  const personas = {
    "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }),
    "persona-jane": makePersona("persona-jane", { voiceId: "voice-jane" }),
  };
  const lines = await _resolveSceneToLines("scene-1", fakeState(personas));
  expect(lines.length).toBe(2);
  expect(lines[0].voice).toBe("voice-mara");
  expect(lines[0].text).toBe("Hello world.");
  expect(lines[1].voice).toBe("voice-jane");
  expect(lines[1].text).toBe("Reply text.");
  expect(lines.map((line) => line.lexicons)).toEqual([null, null]);
});

// ─── #3 Persona.default_delivery merges via merge_delivery ────────────

test("persona_default_delivery_flows_into_chapter_line", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Test.", "persona-mara");
  const personas = {
    "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara", defaultDelivery: { speed: 1.2, gain_db: -3.0 } }),
  };
  const lines = await _resolveSceneToLines("scene-1", fakeState(personas));
  expect(lines.length).toBe(1);
  const d = deliveryOf(lines[0]);
  expect(d.speed).toBe(1.2);
  expect(d.gain_db).toBe(-3.0);
});

// ─── #4 Persona.voice_instruct → delivery.instruct (no explicit instruct) ─

test("persona_voice_instruct_becomes_delivery_instruct", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Test.", "persona-mara");
  const personas = {
    "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara", voiceInstruct: "Clipped, world-weary noir delivery." }),
  };
  const lines = await _resolveSceneToLines("scene-1", fakeState(personas));
  expect(deliveryOf(lines[0]).instruct).toBe("Clipped, world-weary noir delivery.");
});

// ─── #5 Persona.lexicon_id rides on that persona's own lines ────────────
// (the book's lexicon and the order are pinned in project_lexicon.test.js)

test("a_persona_lexicon_reaches_only_its_own_lines", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Hello.", "persona-a");
  addBlock(scene.id, 1, "Reply.", "persona-b");
  addBlock(scene.id, 2, "Hello again.", "persona-a"); // same lex as 0
  const personas = {
    "persona-a": makePersona("persona-a", { voiceId: "voice-a", lexiconId: "lex-narrator" }),
    "persona-b": makePersona("persona-b", { voiceId: "voice-b", lexiconId: "lex-character" }),
  };
  const lines = await _resolveSceneToLines("scene-1", fakeState(personas));
  // Until 2026-09-30 both lexicons were applied to all three lines.
  expect(lines.map((line) => line.lexicons)).toEqual([["lex-narrator"], ["lex-character"], ["lex-narrator"]]);
});

// ─── #6 Block with no persona is skipped ────────────────────────────────

test("block_with_no_persona_is_skipped", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Narrator.", null);
  addBlock(scene.id, 1, "Voiced.", "persona-mara");
  const lines = await _resolveSceneToLines("scene-1", fakeState({ "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }) }));
  expect(lines.length).toBe(1);
  expect(lines[0].text).toBe("Voiced.");
});

// ─── #7 Block with persona but no voice is skipped ──────────────────────

test("block_with_persona_but_no_voice_is_skipped", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Skipped — voiceless persona.", "persona-noisy");
  addBlock(scene.id, 1, "Voiced.", "persona-mara");
  const personas = {
    "persona-noisy": makePersona("persona-noisy", { voiceId: "" }), // empty voice
    "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }),
  };
  const lines = await _resolveSceneToLines("scene-1", fakeState(personas));
  expect(lines.length).toBe(1);
  expect(lines[0].voice).toBe("voice-mara");
});

// ─── #9 Empty resolved-lines raises bad_request ─────────────────────────

test("all_blocks_skipped_raises_bad_request", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Has text but no persona.", null);
  const e = await refusal(_resolveSceneToLines("scene-1", fakeState({})));
  expect(e.statusCode).toBe(400);
  expect(String(e.detail).toLowerCase()).toContain("no speaker, persona or voice");
});

// ─── Edge: empty-text blocks are skipped ────────────────────────────────

test("empty_text_blocks_skipped", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "   ", "persona-mara"); // whitespace only
  addBlock(scene.id, 1, "Real text.", "persona-mara");
  const lines = await _resolveSceneToLines("scene-1", fakeState({ "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }) }));
  expect(lines.length).toBe(1);
  expect(lines[0].text).toBe("Real text.");
});

// ─── strict — a real render refuses instead of dropping lines ───────────
//
// The skips above are the READ-ONLY probe's behaviour (cache-stats runs on every Home/Studio
// visit and only asks how much is cached). A render passes strict: a line the attribution
// pipeline couldn't place used to vanish from the audiobook in silence (Script-tab restore
// 2026-08-08, decision 5).

test("strict_refuses_and_names_the_unplaced_lines", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Nobody speaks this.", null);
  addBlock(scene.id, 1, "Voiced.", "persona-mara");
  const personas = { "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }) };
  const e = await refusal(_resolveSceneToLines("scene-1", fakeState(personas), { strict: true }));
  expect(e.statusCode).toBe(400);
  const detail = String(e.detail);
  expect(detail).toContain("line 1"); // 1-based position, not an index
  expect(detail).toContain("Nobody speaks this.");
});

test("strict_names_a_persona_cast_without_a_voice", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "Said by a voiceless persona.", "persona-noisy");
  addBlock(scene.id, 1, "Voiced.", "persona-mara");
  const personas = {
    "persona-noisy": makePersona("persona-noisy", { voiceId: "" }),
    "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }),
  };
  const e = await refusal(_resolveSceneToLines("scene-1", fakeState(personas), { strict: true }));
  expect(String(e.detail)).toContain("The persona Persona persona-noisy has no voice");
});

test("strict_names_a_speaker_no_persona_plays", async () => {
  // Since 2026-09-29: a line's speaker is there, but no persona plays them.
  const scene = makeProjectWithScene();
  const harbek = uuid();
  h.insert(Speaker, { id: harbek, project_id: scene.project_id, name: "Harbek" });
  h.insert(Block, { scene_id: scene.id, position: 0, text: "Halt.", speaker_id: harbek });
  addBlock(scene.id, 1, "Voiced.", "persona-mara");
  const personas = { "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }) };
  const e = await refusal(_resolveSceneToLines("scene-1", fakeState(personas), { strict: true }));
  expect(String(e.detail)).toContain("Harbek has no persona yet");
});

test("strict_ignores_markers", async () => {
  // Podcast music/ad direction lines are speaker-less BY DESIGN (projects_api's materializer).
  // Counting them as unplaced would refuse every marked episode forever.
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "— Mid-roll —", null, { metadata_json: '{"marker": true}' });
  addBlock(scene.id, 1, "Voiced.", "persona-mara");
  const personas = { "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }) };
  const lines = await _resolveSceneToLines("scene-1", fakeState(personas), { strict: true });
  expect(lines.length).toBe(1);
  expect(lines[0].text).toBe("Voiced.");
});

test("strict_passes_when_every_line_has_a_voice", async () => {
  const scene = makeProjectWithScene();
  addBlock(scene.id, 0, "One.", "persona-mara");
  addBlock(scene.id, 1, "Two.", "persona-mara");
  const personas = { "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }) };
  const lines = await _resolveSceneToLines("scene-1", fakeState(personas), { strict: true });
  expect(lines.length).toBe(2);
});

// ─── Leave out dialogue tags (2026-09-30, extraction/tags.js) ─────────────

/** “Come here,” said Mara, “now.” — then a paragraph of narration. */
function taggedChapter({ leaveOut, narrator = "persona-narr" }) {
  const scene = makeProjectWithScene();
  if (leaveOut) h.update(Project, { metadata_json: pyJson({ leave_out_tags: true }) }, { id: scene.project_id });
  const rows = [
    ["“Come here,”", "persona-mara", "tag", 0],
    ["said Mara,", narrator, "narration", 0],
    ["“now.”", "persona-mara", "tag", 0],
    ["She sat down.", narrator, "narration", 1],
  ];
  rows.forEach(([text, persona, source, para], pos) => {
    addBlock(scene.id, pos, text, persona, { source, metadata_json: pyJson({ paragraph_idx: para }) });
  });
}

const VOICED = () => ({
  "persona-mara": makePersona("persona-mara", { voiceId: "voice-mara" }),
  "persona-narr": makePersona("persona-narr", { voiceId: "voice-narr" }),
});

test("a_tag_only_line_is_left_out_when_the_project_says_so", async () => {
  taggedChapter({ leaveOut: true });
  const lines = await _resolveSceneToLines("scene-1", fakeState(VOICED()), { strict: true });
  expect(lines.map((ln) => ln.text)).toEqual(["“Come here,”", "“now.”", "She sat down."]);
});

test("tags_are_read_when_the_switch_is_off", async () => {
  taggedChapter({ leaveOut: false });
  const lines = await _resolveSceneToLines("scene-1", fakeState(VOICED()), { strict: true });
  expect(lines.map((ln) => ln.text)).toEqual(["“Come here,”", "said Mara,", "“now.”", "She sat down."]);
});

test("a_left_out_tag_never_blocks_the_render", async () => {
  // A tag with no speaker would refuse the chapter — but it isn't read.
  taggedChapter({ leaveOut: true });
  h.update(Block, { speaker_id: null }, { text: "said Mara," });
  const lines = await _resolveSceneToLines("scene-1", fakeState(VOICED()), { strict: true });
  expect(lines.map((ln) => ln.text)).not.toContain("said Mara,");
});
