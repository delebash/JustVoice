// SPDX-License-Identifier: MIT
// A project's pronunciation lexicon reaches the audio (decided 2026-09-30,
// docs/plans/2026-09-30-project-lexicon.md) — the port of tests/test_project_lexicon.py.
//
// These pin the six rules:
//   a  Overview can choose the book's lexicon, and clear it
//   b  every render door reads it — the chapter resolver and the single-line door
//   c  the book's lexicon wins over the persona's, whatever kind of entry each has
//   d  the name scan counts a name as handled only where the render handles it
//   e  the cache is keyed on what the lexicons change in a line
//   f  a line is read with its own speaker's persona lexicon, not the whole cast's
//
// Not ported here (the API wave's routes): Overview's save (api/projects_api.js), the scan
// (api/pronunciation_api.js), Generate's lexicons (api/generate_api.js), a new book lexicon
// chosen for its book (api/lexicons_api.js), and a request's own lexicons through
// POST /v1/render_chapter: test.todo. test_the_chapter_doors_render_each_line_with_its_own_lexicons
// runs the export's door (renderSceneToWav) only — Studio's (the route) waits for the API wave.
// test_the_single_line_door_reads_the_books_lexicon_first builds its book straight in the
// database and stores (Python used the routes).
import { expect, test, vi } from "vitest";
import { endState, useState } from "./engines_helpers.js";
import { personaForBlock } from "../src/api/_speaker_helpers.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import * as appState from "../src/app_state.js";
import * as session from "../src/database/session.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import * as exportVoicelines from "../src/export_voicelines.js";
import { ChapterLine, construct, Lexicon, LexiconEntry, Persona, Settings, utcNow } from "../src/models.js";
import * as renderCore from "../src/render_core.js";
import { _applyLexicons, lineLexicons, probeLineCached, RenderedLine, renderLine } from "../src/render_core.js";
import { tmpDb } from "./helpers.js";
import { FakeCache, FakeManager, fakeManifest, pcmOf, renderState, unwrap, useManager } from "./render_helpers.js";

const NOW = utcNow();
const lex = (lid, ...entries) =>
  construct(Lexicon, { id: lid, name: lid, created_at: NOW, updated_at: NOW, entries: entries.map((e) => construct(LexiconEntry, e)) });
const lexicons = (...lexes) => {
  const byId = new Map(lexes.map((lx) => [lx.id, lx]));
  return { get: (lid) => byId.get(lid) ?? null };
};

// ── c · the book's lexicon wins, in a fixed order ───────────────────────

test("line_lexicons_puts_the_book_first_and_never_repeats", () => {
  expect(lineLexicons("book", "persona")).toEqual(["book", "persona"]);
  expect(lineLexicons(null, "persona")).toEqual(["persona"]);
  expect(lineLexicons("book", null)).toEqual(["book"]);
  expect(lineLexicons("same", "same")).toEqual(["same"]);
  expect(lineLexicons(null, null)).toEqual([]);
});

test("the_first_lexicon_wins_a_word_both_respell", () => {
  const st = {
    lexicons: lexicons(lex("book", { grapheme: "Worcester", alias: "Wooster" }), lex("persona", { grapheme: "Worcester", alias: "Wusster" })),
  };
  expect(_applyLexicons("To Worcester.", ["book", "persona"], st)[0]).toBe("To Wooster.");
  expect(_applyLexicons("To Worcester.", ["persona", "book"], st)[0]).toBe("To Wusster.");
});

test("the_books_pronunciation_beats_the_personas_respelling", () => {
  // An IPA entry never touched the text, so a later lexicon's respelling of the same word
  // replaced it first and the IPA found nothing to say.
  const st = {
    lexicons: lexicons(
      lex("book", { grapheme: "Worcester", phoneme_ipa: "wˈʊstər" }),
      lex("persona", { grapheme: "worcester", alias: "Wusster" }, { grapheme: "Worcester", alias: "Wusster" }),
    ),
  };
  const [text, ipaMap] = _applyLexicons("To Worcester.", ["book", "persona"], st, { ipaCapable: true });
  expect(text).toBe("To Worcester.");
  expect(ipaMap).toEqual({ Worcester: "wˈʊstər" });
});

test("a_respelling_claims_only_its_own_spelling", () => {
  // A respelling matches its exact spelling. The book's "worcester" does nothing to
  // "Worcester", so it must not silence the persona's entry that does.
  const st = {
    lexicons: lexicons(lex("book", { grapheme: "worcester", alias: "wooster" }), lex("persona", { grapheme: "Worcester", alias: "Wooster" })),
  };
  expect(_applyLexicons("To Worcester.", ["book", "persona"], st)[0]).toBe("To Wooster.");
});

test("words_differ_the_way_the_matchers_see_them", () => {
  // Both matchers compare lowercased. casefold() folds ß to ss, so "Maße" and "Masse" — two
  // words to the engine — collided and the second lost its pronunciation.
  const st = { lexicons: lexicons(lex("book", { grapheme: "Maße", phoneme_ipa: "mˈaːsə" }, { grapheme: "Masse", phoneme_ipa: "mˈasə" })) };
  expect(_applyLexicons("Die Masse.", ["book"], st, { ipaCapable: true })[1]).toEqual({ Masse: "mˈasə" });
});

test("an_entry_the_engine_cannot_use_decides_nothing", () => {
  // IPA-only on an engine that takes no phonemes does nothing, so it claims nothing: the
  // persona's respelling is what gets said.
  const st = {
    lexicons: lexicons(lex("book", { grapheme: "Worcester", phoneme_ipa: "wˈʊstər" }), lex("persona", { grapheme: "Worcester", alias: "Wusster" })),
  };
  expect(_applyLexicons("To Worcester.", ["book", "persona"], st, { ipaCapable: false })).toEqual(["To Wusster.", {}]);
});

test("a_blank_row_claims_nothing", () => {
  // The import seeds every name as a blank row. It must not stop a later lexicon's real entry
  // for the same word.
  const st = {
    lexicons: lexicons(lex("book", { grapheme: "Worcester", alias: "" }), lex("persona", { grapheme: "Worcester", alias: "Wooster" })),
  };
  expect(_applyLexicons("To Worcester.", ["book", "persona"], st)[0]).toBe("To Wooster.");
});

// ── e · the cache follows what a lexicon changes in the line ────────────

test("the_ipa_map_holds_only_this_lines_words", () => {
  const st = {
    lexicons: lexicons(lex("book", { grapheme: "Worcester", phoneme_ipa: "wˈʊstər" }, { grapheme: "Beauchamp", phoneme_ipa: "bˈiːtʃəm" })),
  };
  const ipaFor = (text) => _applyLexicons(text, ["book"], st, { ipaCapable: true })[1];
  expect(ipaFor("To Worcester.")).toEqual({ Worcester: "wˈʊstər" });
  expect(ipaFor("to WORCESTER, then.")).toEqual({ Worcester: "wˈʊstər" });
  expect(ipaFor("Nothing to see.")).toEqual({});
  // A different word — the engine's matcher never half-matches it either.
  expect(ipaFor("Worcestershire sauce")).toEqual({});
});

test("the_host_keeps_exactly_the_words_an_ipa_splice_speaks", () => {
  // render_core decides which IPA entries a line carries; the engine-side splice decides which
  // it speaks — two matchers, one rule. These are the words the splice spoke for each text.
  const full = { Worcester: "W", "Mara Vance": "MV", Mara: "M", "Dr.": "D", "A.": "AA" };
  const st = { lexicons: lexicons(lex("book", ...Object.entries(full).map(([g, p]) => ({ grapheme: g, phoneme_ipa: p })))) };
  const spoken = {
    "To Worcester.": ["Worcester"],
    "worcester and Mara Vance": ["Mara Vance", "Worcester"],
    "Mara came. Mara Vance left.": ["Mara", "Mara Vance"],
    Worcestershire: [],
    "Nobody here.": [],
    // An entry ending in punctuation never matches the regex, but the splice still spoke it
    // when it sat alone between two matches.
    "Marathon Dr.A.": ["A.", "Dr."],
    "Worcester Dr. Worcester": ["Worcester"],
    "Dr.": [],
    "   ": [],
  };
  for (const [text, words] of Object.entries(spoken)) {
    const kept = _applyLexicons(text, ["book"], st, { ipaCapable: true })[1];
    expect(Object.keys(kept).sort(), text).toEqual(words);
  }
});

const mockMgr = () =>
  useManager(new FakeManager({ "mock-tts": fakeManifest("mock-tts", { staticVoices: [{ id: "mv_1", name: "MV" }] }) }, { pcm: pcmOf(400, 0x1000) }));
const synthBodies = (mgr) => mgr.synths.map(([, b]) => b);

const renderStateWith = (lx) => renderState({ cache: new FakeCache(), lexicons: lx });

test("a_lexicon_re_renders_only_the_lines_it_changes", async () => {
  // Choosing a lexicon on Overview used to re-render every line of the book, because the key
  // held the lexicon's id.
  const mgr = mockMgr();
  const st = renderStateWith(lexicons(lex("book", { grapheme: "Worcester", alias: "Wooster" })));
  await renderLine(st, { voice: "mv_1", text: "Hi there.", cacheScope: "s" });
  await renderLine(st, { voice: "mv_1", text: "To Worcester.", cacheScope: "s" });
  expect(mgr.synths.length).toBe(2);
  // The lexicon is chosen. The line without its word is still cached…
  expect(await probeLineCached(st, "mv_1", "Hi there.", { lexicons: ["book"], cacheScope: "s" })).toBe(true);
  await renderLine(st, { voice: "mv_1", text: "Hi there.", lexicons: ["book"], cacheScope: "s" });
  expect(mgr.synths.length).toBe(2);
  // …and the line with it is a new render, of the respelt text.
  expect(await probeLineCached(st, "mv_1", "To Worcester.", { lexicons: ["book"], cacheScope: "s" })).toBe(false);
  await renderLine(st, { voice: "mv_1", text: "To Worcester.", lexicons: ["book"], cacheScope: "s" });
  expect(mgr.synths.length).toBe(3);
  expect(synthBodies(mgr).at(-1).text).toBe("To Wooster.");
  // Taking the lexicon off again finds the first render.
  await renderLine(st, { voice: "mv_1", text: "To Worcester.", cacheScope: "s" });
  expect(mgr.synths.length).toBe(3);
});

test("an_ipa_edit_re_renders_only_the_lines_with_that_word", async () => {
  // Every IPA entry used to ride on every line, so on Kokoro any IPA edit re-rendered the whole
  // chapter.
  const mgr = mockMgr();
  vi.spyOn(renderCore, "_supportsPhonemeInput").mockReturnValue(true);
  const box = { book: lex("book", { grapheme: "Worcester", phoneme_ipa: "one" }) };
  const st = renderStateWith({ get: (lid) => box[lid] ?? null });
  const both = async () => {
    await renderLine(st, { voice: "mv_1", text: "Hi there.", lexicons: ["book"], cacheScope: "s" });
    await renderLine(st, { voice: "mv_1", text: "To Worcester.", lexicons: ["book"], cacheScope: "s" });
  };
  await both();
  expect(mgr.synths.length).toBe(2);
  expect("ipa_map" in synthBodies(mgr)[0].delivery).toBe(false);
  expect(synthBodies(mgr)[1].delivery.ipa_map).toEqual({ Worcester: "one" });
  box.book = lex("book", { grapheme: "Worcester", phoneme_ipa: "two" });
  await both();
  expect(mgr.synths.length).toBe(3); // only the line that says Worcester re-renders
  expect(synthBodies(mgr)[2].delivery.ipa_map).toEqual({ Worcester: "two" });
});

// ── f + b · the chapter resolver: each line's own lexicons ──────────────

const persona = (pid, { lexiconId = null } = {}) =>
  construct(Persona, { id: pid, name: `P ${pid}`, voice_id: `voice-${pid}`, default_delivery: {}, lexicon_id: lexiconId, created_at: NOW, updated_at: NOW });
const personas = (...ps) => {
  const byId = new Map(ps.map((p) => [p.id, p]));
  return { personas: { get: (pid) => byId.get(pid) ?? null } };
};

function seedDb(h, { bookLexicon, speakers }) {
  // tmpDb does not enforce foreign keys, so the lexicon ids need no rows.
  h.insert(Project, { id: "proj-1", name: "P", project_type: "audiobook", default_lexicon_id: bookLexicon });
  h.insert(Scene, { id: "scene-1", project_id: "proj-1", position: 0, title: "Ch 1" });
  speakers.forEach((pid, i) => {
    let sp = h.one(`select id from ${Speaker} where project_id = 'proj-1' and persona_id = ?`, [pid]);
    if (!sp) {
      sp = { id: uuid() };
      h.insert(Speaker, { id: sp.id, project_id: "proj-1", name: `Speaker ${pid}`, persona_id: pid });
    }
    h.insert(Block, { scene_id: "scene-1", position: i, text: `Line ${i}.`, speaker_id: sp.id });
  });
}

function withTmpDb(fn) {
  return async () => {
    const h = tmpDb();
    session.cfg.handle = h;
    try {
      await fn(h);
    } finally {
      session.cfg.handle = null;
      h.close();
    }
  };
}

test(
  "each_line_gets_the_books_lexicon_then_its_own_personas",
  withTmpDb(async (h) => {
    seedDb(h, { bookLexicon: "lex-book", speakers: ["crow", "narrator", "crow"] });
    const lines = await renderChapterApi._resolveSceneToLines("scene-1", personas(persona("crow", { lexiconId: "lex-crow" }), persona("narrator")));
    expect(lines.map((l) => l.lexicons)).toEqual([
      ["lex-book", "lex-crow"],
      ["lex-book"], // Old Crow's slang never reaches the narrator
      ["lex-book", "lex-crow"],
    ]);
  }),
);

test(
  "a_book_with_no_lexicon_keeps_only_the_personas",
  withTmpDb(async (h) => {
    seedDb(h, { bookLexicon: null, speakers: ["crow", "narrator"] });
    const lines = await renderChapterApi._resolveSceneToLines("scene-1", personas(persona("crow", { lexiconId: "lex-crow" }), persona("narrator")));
    expect(lines.map((l) => l.lexicons)).toEqual([["lex-crow"], null]);
  }),
);

/** Run the chapter door over `lines`; return each renderLine's lexicons. */
function captureChapterRender(lines) {
  const seen = [];
  const settings = construct(Settings, {});
  const state = { settings: { get: () => settings } };
  appState.cfg.state = state;
  vi.spyOn(renderChapterApi, "_resolveSceneToLines").mockResolvedValue(lines);
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (st, kw) => {
    seen.push(kw.lexicons);
    return {};
  });
  vi.spyOn(renderCore, "concatLines").mockResolvedValue({});
  vi.spyOn(renderChapterApi, "_masterScenePcm").mockImplementation(async (c, t) => [Buffer.from("RIFF"), t, null]);
  vi.spyOn(renderChapterApi, "_sceneMasterTarget").mockReturnValue([null, "none"]);
  return [seen, state];
}

test("the_chapter_doors_render_each_line_with_its_own_lexicons", async () => {
  const lines = [
    construct(ChapterLine, { voice: "v", text: "One.", lexicons: ["lex-book", "lex-crow"] }),
    construct(ChapterLine, { voice: "v", text: "Two.", lexicons: ["lex-book"] }),
  ];
  const [seen, state] = captureChapterRender(lines);
  try {
    // The M4B export, the ACX check and the captions. (Studio's Render — the route — waits for
    // the API wave; Python ran both doors and expected this list twice.)
    await renderChapterApi.renderSceneToWav(state, "s1", { master: false });
    expect(seen).toEqual([["lex-book", "lex-crow"], ["lex-book"]]);
  } finally {
    appState.cfg.state = null;
  }
});

test.todo("a_requests_own_lexicons_follow_the_lines — waits for api/render_chapter_api.js routes");

// ── the app-level doors: Overview's save, the single line, the scan ─────

test.todo("overview_sets_clears_and_refuses_an_unknown_lexicon — waits for api/projects_api.js");

test("the_single_line_door_reads_the_books_lexicon_first", async () => {
    // Lines ↻, a render job and the voiceline export all render a line through this one
    // function — it read the persona's lexicon only.
    const st = useState();
    try {
      const h = session.getDb();
      const pid = uuid();
      h.insert(Project, { id: pid, name: "Harbor", project_type: "audiobook" });
      const book = st.lexicons.create("Harbor names", { scope: "project", project_id: pid, entries: [construct(LexiconEntry, { grapheme: "Elara", alias: "eh-LAH-ra" })] }).id;
      st.lexicons.create("Old list", { scope: "project", project_id: pid, entries: [construct(LexiconEntry, { grapheme: "Brindlewood", alias: "BRIN-dul-wood" })] });
      const slang = st.lexicons.create("Crow's slang", { entries: [construct(LexiconEntry, { grapheme: "Harbek", alias: "AR-bek" })] }).id;
      const persona = st.personas.create("Gravel", { voice_id: "af_heart", lexicon_id: slang, language: "en-US" }).id;
      const crow = uuid();
      h.insert(Speaker, { id: crow, project_id: pid, name: "Old Crow", persona_id: persona });
      const scene = uuid();
      h.insert(Scene, { id: scene, project_id: pid, position: 0, title: "One" });
      const said = uuid();
      h.insert(Block, { id: said, scene_id: scene, position: 0, speaker_id: crow, text: "They told Harbek about Elara and Brindlewood." });
      h.insert(Block, { scene_id: scene, position: 1, text: "Much later Harbek met Elara again." });
      h.update(Project, { default_lexicon_id: book }, { id: pid });

      const seen = {};
      vi.spyOn(renderCore, "renderLine").mockImplementation(async (s, kw) => {
        Object.assign(seen, kw);
        return new RenderedLine({ pcm: pcmOf(40, 0x1000), sampleRate: 16000, channels: 1, effectiveDelivery: {} });
      });
      const block = h.get(Block, said);
      await exportVoicelines._renderBlockProduction(st, personaForBlock(h, block), block);
      expect(seen.lexicons).toEqual([book, slang]);
    } finally {
      endState();
    }
  });

test.todo("the_scan_counts_a_name_as_handled_only_where_the_render_handles_it — waits for api/pronunciation_api.js");

// ── §6 · 1 · Generate reads the lexicons the page sends ─────────────────

test.todo("generate_reads_the_lexicons_it_is_sent — waits for api/generate_api.js");
test.todo("generate_carries_the_ipa_of_the_words_it_says — waits for api/generate_api.js");

// ── §6 · 3 · a new book lexicon is chosen for a book that has none ──────

test.todo("a_new_book_lexicon_is_chosen_for_a_book_that_has_none — waits for api/lexicons_api.js");

// ── an IPA entry reaches only an engine that takes phonemes ─────────────

test("apply_lexicons_routes_ipa_and_alias_by_capability", () => {
  const lx = lex("lx1", { grapheme: "Worcester", phoneme_ipa: "wˈʊstər" }, { grapheme: "Dr.", alias: "Doctor" });
  const st = { lexicons: { get: (lid) => (lid === "lx1" ? lx : null) } };
  // IPA-capable engine: alias substitutes text, IPA goes to the map.
  let [text, ipaMap] = renderCore._applyLexicons("Dr. Smith of Worcester", ["lx1"], st, { ipaCapable: true });
  expect(text).toBe("Doctor Smith of Worcester");
  expect(ipaMap).toEqual({ Worcester: "wˈʊstər" });
  // Engine that cannot take phonemes: the IPA entry does nothing — a guessed pronunciation beats
  // reading IPA letters aloud.
  [text, ipaMap] = renderCore._applyLexicons("Dr. Smith of Worcester", ["lx1"], st, { ipaCapable: false });
  expect(text).toBe("Doctor Smith of Worcester");
  expect(unwrap(ipaMap)).toEqual({});
});

