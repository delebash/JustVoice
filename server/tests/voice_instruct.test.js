// SPDX-License-Identifier: MIT
// The 2026-08-15 split: `voice_instruct` is audio, `personality` is prose (the port of
// tests/test_voice_instruct.py).
//
// One persona field used to feed both the synth (as `delivery.instruct`) and the LLM prompts
// (Compose / Rewrite / casting), so editing a character's description silently changed how
// they SOUNDED. The field split in two, and these tests hold the line between them:
//   * `voice_instruct` reaches `delivery.instruct` and nothing else;
//   * `personality` (the character sheet) reaches the prompts and NEVER the delivery;
//   * an importer fills the sheet only — a casting hint is not a delivery instruction.
// The Smart-assign test waits for api/smart_assign_api.js (the API wave).
import { afterEach, beforeEach, expect, test } from "vitest";
import "./engines_helpers.js";
import { _materializeStandard } from "../src/api/projects_api.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import * as appState from "../src/app_state.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import { StandardImport } from "../src/imports/standard_schema.js";
import { construct, Delivery, modelDump, Persona, utcNow } from "../src/models.js";
import { PersonaStore } from "../src/storage/personas.js";
import { tmpDb, tmpPath } from "./helpers.js";

const SHEET = "Lead detective. Dry wit, hates the fog, protective of Sarah.";
const INSTRUCT = "Clipped, world-weary noir delivery. Never overshares.";

function _persona({ voiceInstruct = null, personality = null } = {}) {
  const now = utcNow();
  return construct(Persona, {
    id: "persona-mara",
    name: "Mara",
    voice_id: "voice-mara",
    voice_instruct: voiceInstruct,
    personality,
    created_at: now,
    updated_at: now,
  });
}

const _state = (persona) => ({ personas: { get: (pid) => (pid === persona.id ? persona : null) } });

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

/** speaker_fixtures.speaker_played_by: this book's speaker played by `personaId`. */
function speakerPlayedBy(sceneId, personaId) {
  const projectId = h.get(Scene, sceneId).project_id;
  const id = uuid();
  h.insert(Speaker, { id, project_id: projectId, name: `Speaker ${personaId}`, persona_id: personaId });
  return id;
}

function _sceneWithOneBlock() {
  h.insert(Project, { id: "proj-1", name: "Book", project_type: "audiobook" });
  h.insert(Scene, { id: "scene-1", project_id: "proj-1", position: 0, title: "Chapter 1" });
  h.insert(Block, { scene_id: "scene-1", position: 0, text: "The fog came in.", speaker_id: speakerPlayedBy("scene-1", "persona-mara") });
}

async function _resolve(persona) {
  const lines = await renderChapterApi._resolveSceneToLines("scene-1", _state(persona));
  return lines[0].delivery ? JSON.parse(JSON.stringify(modelDump(Delivery, lines[0].delivery, { excludeNone: true }))) : {};
}

// ─── 1. The instruct is the audio field ─────────────────────────────────

test("voice_instruct_reaches_delivery_and_the_sheet_does_not", async () => {
  // A persona carrying BOTH fields renders with the instruct only.
  _sceneWithOneBlock();
  const delivery = await _resolve(_persona({ voiceInstruct: INSTRUCT, personality: SHEET }));
  expect(delivery.instruct).toBe(INSTRUCT);
  expect(JSON.stringify(delivery)).not.toContain(SHEET);
});

// ─── 2. The sheet never becomes a fallback instruct ─────────────────────

test("sheet_alone_leaves_the_instruct_unset", async () => {
  // The bug this split fixes: describing a character used to direct them.
  _sceneWithOneBlock();
  const delivery = await _resolve(_persona({ voiceInstruct: null, personality: SHEET }));
  expect("instruct" in delivery).toBe(false);
});

// ─── 4. An import fills the sheet, never the instruct ───────────────────

test("import_fills_the_sheet_and_leaves_the_instruct_empty", () => {
  // JustWrite hands over a one-liner + a casting hint. Both are "Who they are" material on
  // the SPEAKER (2026-09-29); no persona — so no spoken-delivery box — is made by an import.
  const standard = construct(StandardImport, {
    source: "justwrite",
    project: { name: "The Ninth Facet", kind: "audiobook" },
    characters: [{ id: "mara", name: "Mara Vance", voice_hint: "female, age 34, protagonist", notes: "The archivist who reads the tide tables." }],
    scenes: [{ id: "ch1", title: "Chapter 1", kind: "chapter", lines: [{ character_id: "mara", text: "“Hello.”" }] }],
  });
  h.tx(() => _materializeStandard(standard, h));

  const rows = h.all(`select * from ${Speaker} where name = ?`, ["Mara Vance"], Speaker);
  expect(rows.length).toBe(1);
  const [mara] = rows;
  expect(mara.description).toContain("The archivist who reads the tide tables.");
  expect(mara.description).toContain("Voice hint:");
  expect(mara.description).toContain("female, age 34, protagonist");
  expect(mara.persona_id).toBeNull();
  expect(new PersonaStore(tmpPath(), h).list()).toEqual([]);
});

// ─── 5. Casting reads the sheet ─────────────────────────────────────────

test.todo("smart_assign_description_comes_from_the_sheet — waits for api/smart_assign_api.js");
