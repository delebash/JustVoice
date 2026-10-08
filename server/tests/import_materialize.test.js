// SPDX-License-Identifier: MIT
// Import materialization — the book's speakers + lexicon creation (the port of
// tests/test_import_materialize.py). The materializer (api/projects_api.js's
// `_materializeStandard` / `_materializeLexicon`, ported with the imports) and the stores run
// here; the demo-through-the-app test waits for app.js.
// (`session_factory=` → the store's injectable handle; a commit → one `h.tx`.)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { ensureSpeaker } from "../src/api/_speaker_helpers.js";
import { _materializeLexicon, _materializeStandard } from "../src/api/projects_api.js";
import { Block, Lexicon as DbLexicon, LexiconEntry as DbLexiconEntry, Persona, Project, Scene, Speaker } from "../src/database/models.js";
import { demoStandard } from "../src/demo_projects.js";
import { StandardImport } from "../src/imports/standard_schema.js";
import { construct } from "../src/models.js";
import { LexiconStore } from "../src/storage/lexicons.js";
import { PersonaStore } from "../src/storage/personas.js";
import { tmpDb, tmpPath } from "./helpers.js";

function _standard(name, { lexicon = false } = {}) {
  return construct(StandardImport, {
    source: "justwrite",
    project: { name, kind: "audiobook" },
    characters: [{ id: "mara", name: "Mara Vance" }],
    scenes: [{ id: "ch1", title: "Chapter 1", kind: "chapter", lines: [{ character_id: "mara", text: "“Hello.”" }] }],
    lexicon_entries: lexicon ? [{ grapheme: "Hecate", alias: "HEH-kuh-tee" }] : [],
  });
}

const materialize = (h, std) => h.tx(() => _materializeStandard(std, h));

test("each_book_gets_its_own_speakers_played_by_the_named_persona", () => {
  // The same character in two books is a speaker in each; a persona of exactly that name
  // plays both ("Every new speaker", 2026-09-29).
  const h = tmpDb();
  h.insert(Persona, { name: "mara vance " });
  const voice = h.one(`select * from ${Persona} where rowid = last_insert_rowid()`, [], Persona);
  const [p1, , , created1] = materialize(h, _standard("Book one"));
  const [p2, , , created2] = materialize(h, _standard("Book two"));

  expect(created1.length).toBe(1);
  expect(created2.length).toBe(1);
  expect(created1).not.toEqual(created2);
  const rows = h.all(`select * from ${Speaker} where name = ?`, ["Mara Vance"], Speaker);
  expect(new Set(rows.map((s) => s.project_id))).toEqual(new Set([p1.id, p2.id]));
  expect(new Set(rows.map((s) => s.persona_id))).toEqual(new Set([voice.id]));
});

test("a_reimport_reuses_the_books_speaker", () => {
  // A second materialize of the same character INTO the same book (the re-import path) finds
  // the speaker by its import id — never a duplicate.
  const h = tmpDb();
  const [p1] = materialize(h, _standard("Book one"));
  const [, created] = ensureSpeaker(h, p1.id, { name: "Mara Vance", importedFrom: "justwrite", importedId: "mara" });
  expect(created).toBe(false);
  expect(h.count(Speaker, { project_id: p1.id })).toBe(1);
});

test("an_import_makes_speakers_and_no_persona", () => {
  // Since 2026-09-29 a book's characters are its speakers; the library of personas (the
  // voices) is untouched by an import.
  const h = tmpDb();
  const [, , , created] = materialize(h, _standard("Book one"));
  const names = created.map((id) => h.get(Speaker, id).name);
  expect(names).toEqual(["Mara Vance"]);
  expect(new PersonaStore(tmpPath(), h).list()).toEqual([]);
});

test("legacy_persona_files_import_once", () => {
  // Pre-flip JSON files import into SQLite at store init, get renamed .migrated, and a later
  // DELETE does not resurrect them.
  const h = tmpDb();
  const tmp = tmpPath();
  const pdir = path.join(tmp, "personas");
  mkdirSync(pdir, { recursive: true });
  const legacy = {
    id: "persona_legacy1",
    name: "Old Crow",
    voice_id: "af_heart",
    language: "en",
    default_delivery: { speed: 0.97 },
    effects_chain: [],
    created_at: "2026-06-01T00:00:00+00:00",
    updated_at: "2026-06-01T00:00:00+00:00",
  };
  writeFileSync(path.join(pdir, "persona_legacy1.json"), JSON.stringify(legacy));

  const store = new PersonaStore(tmp, h);
  const p = store.get("persona_legacy1");
  expect(p).not.toBeNull();
  expect(p.name).toBe("Old Crow");
  expect(p.default_delivery.speed).toBe(0.97);
  expect(existsSync(path.join(pdir, "persona_legacy1.json"))).toBe(false);
  expect(existsSync(path.join(pdir, "persona_legacy1.json.migrated"))).toBe(true);

  // Delete, then re-construct the store — the persona must stay gone.
  expect(store.delete("persona_legacy1")).toBe(true);
  expect(new PersonaStore(tmp, h).get("persona_legacy1")).toBeNull();
});

test("store_crud_round_trip", () => {
  const h = tmpDb();
  const store = new PersonaStore(tmpPath(), h);
  const created = store.create("Mara", { voice_id: null, note: "warm, low, unhurried" });
  expect(store.get(created.id).note).toBe("warm, low, unhurried");
  const updated = store.update(created.id, { voice_instruct: "dry wit", voice_id: "af_heart" });
  expect(updated.voice_instruct).toBe("dry wit");
  expect(updated.voice_id).toBe("af_heart");
  const fetched = store.get(created.id);
  expect(fetched.voice_instruct).toBe("dry wit");
  expect(fetched.voice_id).toBe("af_heart");
  expect(store.list().map((p) => p.id)).toEqual([created.id]);
  expect(store.delete(created.id)).toBe(true);
  expect(store.list()).toEqual([]);
});

test("lexicon_entries_materialize_and_set_default", () => {
  const h = tmpDb();
  const tmp = tmpPath();
  const std = _standard("The Ninth Facet", { lexicon: true });
  const [project, lexId] = h.tx(() => {
    const [p] = _materializeStandard(std, h);
    return [p, _materializeLexicon(std, p, h)];
  });
  expect(lexId).not.toBeNull();
  expect(project.default_lexicon_id).toBe(lexId);
  expect(h.get(Project, project.id).default_lexicon_id).toBe(lexId);

  // FK target rows live in SQLite (one transaction with the project).
  expect(h.get(DbLexicon, lexId).project_id).toBe(project.id);
  const rows = h.all(`select * from ${DbLexiconEntry} where lexicon_id = ?`, [lexId], DbLexiconEntry);
  // Since 2026-08-21 the book's character names seed the lexicon as BLANK worklist rows
  // beside the explicit entries. The explicit entry keeps its pronunciation; the seeded name
  // arrives blank.
  const byWord = Object.fromEntries(rows.map((e) => [e.word, e]));
  expect(new Set(Object.keys(byWord))).toEqual(new Set(["Hecate", "Mara Vance"]));
  expect(byWord.Hecate.pronunciation).toBe("HEH-kuh-tee");
  expect(byWord["Mara Vance"].pronunciation).toBe("");

  // Post-flip: the store reads the SAME rows.
  const lex = new LexiconStore(tmp, h).get(lexId);
  expect(lex).not.toBeNull();
  expect(lex.scope).toBe("project");
  expect(lex.project_id).toBe(project.id);
  const byGrapheme = Object.fromEntries(lex.entries.map((e) => [e.grapheme, e]));
  expect(new Set(Object.keys(byGrapheme))).toEqual(new Set(["Hecate", "Mara Vance"]));
  expect(byGrapheme.Hecate.alias).toBe("HEH-kuh-tee");
  // The seeded name round-trips as a blank worklist row — inert at render until filled in.
  expect([null, ""]).toContain(byGrapheme["Mara Vance"].alias);
  expect([null, ""]).toContain(byGrapheme["Mara Vance"].phoneme_ipa);
});

test("characters_alone_seed_a_blank_worklist", () => {
  // An import with characters is NOT a no-op any more — the names seed a lexicon of blank rows
  // (the decided seed item, 2026-08-21). A true no-op needs neither entries nor characters.
  const h = tmpDb();
  const std = _standard("Plain");
  const [project, lexId] = h.tx(() => {
    const [p] = _materializeStandard(std, h);
    return [p, _materializeLexicon(std, p, h)];
  });
  expect(lexId).not.toBeNull();
  expect(project.default_lexicon_id).toBe(lexId);
  const rows = h.all(`select * from ${DbLexiconEntry} where lexicon_id = ?`, [lexId], DbLexiconEntry);
  expect(rows.map((e) => [e.word, e.pronunciation])).toEqual([["Mara Vance", ""]]);

  // And the true no-op: nothing to seed → no lexicon.
  const bare = _standard("Empty");
  bare.characters = [];
  h.tx(() => {
    const [project2] = _materializeStandard(bare, h);
    expect(_materializeLexicon(bare, project2, h)).toBeNull();
    expect(h.get(Project, project2.id).default_lexicon_id).toBeNull();
  });
});

test("lexicon_store_crud_round_trip", () => {
  const h = tmpDb();
  const store = new LexiconStore(tmpPath(), h);
  const lex = store.create("Names", { entries: [{ grapheme: "Beauchamp", alias: "bee-chum" }] });
  let got = store.get(lex.id);
  expect(got.entries.map((e) => e.grapheme)).toEqual(["Beauchamp"]);
  store.appendEntry(lex.id, { grapheme: "Hecate", phoneme_ipa: "/ˈhɛkəti/" });
  got = store.get(lex.id);
  expect(got.entries.map((e) => e.grapheme)).toEqual(["Beauchamp", "Hecate"]);
  expect(got.entries[1].phoneme_ipa).toBe("/ˈhɛkəti/");
  const replaced = store.update(lex.id, [{ grapheme: "Worcestershire", alias: "WUSS-ter-sher" }]);
  expect(replaced.entries.map((e) => e.grapheme)).toEqual(["Worcestershire"]);
  expect(store.delete(lex.id)).toBe(true);
  expect(store.list()).toEqual([]);
});

test("legacy_lexicon_files_import_once", () => {
  const h = tmpDb();
  const tmp = tmpPath();
  const ldir = path.join(tmp, "lexicons");
  mkdirSync(ldir, { recursive: true });
  const legacy = {
    id: "lex_legacy1",
    name: "Old names",
    scope: "global",
    entries: [{ grapheme: "Beauchamp", alias: "bee-chum" }],
    created_at: "2026-06-01T00:00:00+00:00",
    updated_at: "2026-06-01T00:00:00+00:00",
  };
  writeFileSync(path.join(ldir, "lex_legacy1.json"), JSON.stringify(legacy));

  const store = new LexiconStore(tmp, h);
  const lex = store.get("lex_legacy1");
  expect(lex).not.toBeNull();
  expect(lex.entries.map((e) => e.grapheme)).toEqual(["Beauchamp"]);
  expect(existsSync(path.join(ldir, "lex_legacy1.json"))).toBe(false);
  expect(existsSync(path.join(ldir, "lex_legacy1.json.migrated"))).toBe(true);

  expect(store.delete("lex_legacy1")).toBe(true);
  expect(new LexiconStore(tmp, h).get("lex_legacy1")).toBeNull();
});

test("block_source_ref_persisted", () => {
  const h = tmpDb();
  const std = _standard("Book one");
  std.scenes[0].lines[0].source_ref = "Q01_HALE_001";
  materialize(h, std);
  const block = h.one(`select * from ${Block} limit 1`, [], Block);
  expect(JSON.parse(block.metadata_json).source_ref).toBe("Q01_HALE_001");
});

test("demo_projects_seed_through_the_real_materializer", () => {
  const h = tmpDb();
  for (const kind of ["audiobook", "game_voicelines", "podcast"]) {
    const [project, sceneCount, blockCount, created] = materialize(h, demoStandard(kind));
    expect(project.project_type).toBe(kind);
    expect(sceneCount).toBeGreaterThanOrEqual(1);
    expect(blockCount).toBeGreaterThanOrEqual(3);
    expect(created.length).toBeGreaterThan(0); // speakers land in SQLite
  }
  // game demo carries stable line ids
  const game = h.one(`select * from ${Project} where project_type = 'game_voicelines' limit 1`, [], Project);
  const scene = h.one(`select * from ${Scene} where project_id = ? limit 1`, [game.id], Scene);
  const block = h.one(`select * from ${Block} where scene_id = ? limit 1`, [scene.id], Block);
  expect(JSON.parse(block.metadata_json).source_ref.startsWith("Q0")).toBe(true);
});

test.todo("the_audiobook_demo_is_the_ninth_facet_through_the_justwrite_adapter — waits for app.js (POST /v1/projects/demo)");
