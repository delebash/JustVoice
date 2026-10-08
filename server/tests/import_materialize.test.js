// SPDX-License-Identifier: MIT
// Import materialization — the book's speakers + lexicon creation (the port of
// tests/test_import_materialize.py). The four store tests run here; the eight that
// materialize an import wait for api/projects_api.js + imports/ (another slice) — and the
// demo ones for demo_projects.js's imports too.
// (`session_factory=` → the store's injectable handle.)
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "vitest";
import { LexiconStore } from "../src/storage/lexicons.js";
import { PersonaStore } from "../src/storage/personas.js";
import { tmpDb, tmpPath } from "./helpers.js";

test.todo("each_book_gets_its_own_speakers_played_by_the_named_persona — waits for api/projects_api.js + imports/");
test.todo("a_reimport_reuses_the_books_speaker — waits for api/_speaker_helpers.js + imports/");
test.todo("an_import_makes_speakers_and_no_persona — waits for api/projects_api.js + imports/");

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

test.todo("lexicon_entries_materialize_and_set_default — waits for api/projects_api.js + imports/");
test.todo("characters_alone_seed_a_blank_worklist — waits for api/projects_api.js + imports/");

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

test.todo("block_source_ref_persisted — waits for api/projects_api.js + imports/");
test.todo("demo_projects_seed_through_the_real_materializer — waits for api/projects_api.js + imports/");
test.todo("the_audiobook_demo_is_the_ninth_facet_through_the_justwrite_adapter — waits for app.js + api/projects_api.js + imports/");
