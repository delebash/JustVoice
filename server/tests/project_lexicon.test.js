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
// The app-level tests build their book through the real routes (Python's `_book`); the chapter
// doors run on a bare app holding the render_chapter router.
//
// The two Generate tests FAIL in Python today: their fake `_NowScheduler.submit(specs,
// interactive=False)` takes no `owner=`, which generate_api has passed since 2026-10-07. Here the
// fake scheduler takes `owner`, so they pass.
import { afterEach, expect, test, vi } from "vitest";
import { appClient, closeApps } from "./app_helpers.js";
import { personaForBlock } from "../src/api/_speaker_helpers.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import { router as renderChapterRouter } from "../src/api/render_chapter_api.js";
import * as appState from "../src/app_state.js";
import * as session from "../src/database/session.js";
import { Block, Project, Scene, Speaker, uuid } from "../src/database/models.js";
import * as manager from "../src/engines/manager.js";
import * as exportVoicelines from "../src/export_voicelines.js";
import { ChapterLine, construct, Lexicon, LexiconEntry, Persona, Settings, utcNow } from "../src/models.js";
import * as renderCore from "../src/render_core.js";
import { _applyLexicons, lineLexicons, probeLineCached, RenderedLine, renderLine } from "../src/render_core.js";
import * as synthScheduler from "../src/synth_scheduler.js";
import { tmpDb } from "./helpers.js";
import { FakeCache, FakeManager, fakeManifest, pcmOf, renderState, unwrap, useManager, viaRoutes } from "./render_helpers.js";

afterEach(closeApps);

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
  vi.spyOn(synthScheduler, "warmLines").mockResolvedValue(undefined);
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (st, kw) => {
    seen.push(kw.lexicons);
    return {};
  });
  vi.spyOn(renderCore, "concatLines").mockResolvedValue({});
  vi.spyOn(renderChapterApi, "_masterScenePcm").mockImplementation(async (c, t) => [Buffer.from("RIFF"), t, null]);
  vi.spyOn(renderChapterApi, "_sceneMasterTarget").mockReturnValue([null, "none"]);
  return [seen, state];
}

/** POST /v1/render_chapter on a bare app over a test database (the route names its queue owner
 * from the database). */
async function renderChapterRoute(body) {
  const h = tmpDb();
  session.cfg.handle = h;
  try {
    await viaRoutes([renderChapterRouter], async (app) => {
      const r = await app.inject({ method: "POST", url: "/v1/render_chapter", payload: body });
      expect(r.statusCode, r.body).toBe(200);
    });
  } finally {
    session.cfg.handle = null;
    h.close();
  }
}

test("the_chapter_doors_render_each_line_with_its_own_lexicons", async () => {
  const lines = [
    construct(ChapterLine, { voice: "v", text: "One.", lexicons: ["lex-book", "lex-crow"] }),
    construct(ChapterLine, { voice: "v", text: "Two.", lexicons: ["lex-book"] }),
  ];
  const [seen, state] = captureChapterRender(lines);
  try {
    // Studio's Render.
    await renderChapterRoute({ scene_id: "s1" });
    // The M4B export, the ACX check and the captions.
    await renderChapterApi.renderSceneToWav(state, "s1", { master: false });
    expect(seen).toEqual([["lex-book", "lex-crow"], ["lex-book"], ["lex-book", "lex-crow"], ["lex-book"]]);
  } finally {
    appState.cfg.state = null;
  }
});

test("a_requests_own_lexicons_follow_the_lines", async () => {
  const lines = [construct(ChapterLine, { voice: "v", text: "One.", lexicons: ["lex-book"] }), construct(ChapterLine, { voice: "v", text: "Two." })];
  const [seen] = captureChapterRender(lines);
  try {
    await renderChapterRoute({ scene_id: "s1", lexicons: ["lex-req", "lex-book"] });
    expect(seen).toEqual([
      ["lex-book", "lex-req"],
      ["lex-req", "lex-book"],
    ]);
  } finally {
    appState.cfg.state = null;
  }
});

// ── the app-level doors: Overview's save, the single line, the scan ─────

async function post(c, url, body) {
  const r = await c.post(url, { json: body });
  expect([200, 201], r.text).toContain(r.status);
  return r.json();
}

/** A book with a chosen lexicon, a second lexicon nobody chose, and Old Crow — played by a
 * persona with a lexicon of its own (Python's `_book`). */
async function harborBook(c) {
  const pid = (await post(c, "/v1/projects", { name: "Harbor", project_type: "audiobook" })).id;
  const book = (await post(c, "/v1/lexicons", { name: "Harbor names", scope: "project", project_id: pid, entries: [{ grapheme: "Elara", alias: "eh-LAH-ra" }] })).id;
  const spare = (await post(c, "/v1/lexicons", { name: "Old list", scope: "project", project_id: pid, entries: [{ grapheme: "Brindlewood", alias: "BRIN-dul-wood" }] })).id;
  const slang = (await post(c, "/v1/lexicons", { name: "Crow's slang", entries: [{ grapheme: "Harbek", alias: "AR-bek" }] })).id;
  const persona = (await post(c, "/v1/personas", { name: "Gravel", voice_id: "af_heart", lexicon_id: slang })).id;
  const crow = (await post(c, `/v1/projects/${pid}/speakers`, { name: "Old Crow", persona_id: persona })).id;
  const scene = (await post(c, `/v1/projects/${pid}/scenes`, { title: "One" })).id;
  const said = (await post(c, `/v1/scenes/${scene}/blocks`, { position: 0, speaker_id: crow, text: "They told Harbek about Elara and Brindlewood." })).id;
  await post(c, `/v1/scenes/${scene}/blocks`, { position: 1, text: "Much later Harbek met Elara again." });
  const r = await c.patch(`/v1/projects/${pid}`, { json: { default_lexicon_id: book } });
  expect(r.status, r.text).toBe(200);
  return { pid, book, spare, slang, said };
}

test("overview_sets_clears_and_refuses_an_unknown_lexicon", async () => {
  const { c } = await appClient();
  const b = await harborBook(c);
  expect((await c.get(`/v1/projects/${b.pid}`)).json().default_lexicon_id).toBe(b.book);
  // A save that says nothing about the lexicon leaves it.
  let r = await c.patch(`/v1/projects/${b.pid}`, { json: { name: "Harbor Lights" } });
  expect(r.json().default_lexicon_id).toBe(b.book);
  // "None" on Overview.
  r = await c.patch(`/v1/projects/${b.pid}`, { json: { default_lexicon_id: null } });
  expect(r.status).toBe(200);
  expect(r.json().default_lexicon_id).toBeNull();
  r = await c.patch(`/v1/projects/${b.pid}`, { json: { default_lexicon_id: "lex_nope" } });
  expect(r.status).toBe(404);
  expect((await c.get(`/v1/projects/${b.pid}`)).json().default_lexicon_id).toBeNull();
});

test("the_single_line_door_reads_the_books_lexicon_first", async () => {
  // Lines ↻, a render job and the voiceline export all render a line through this one function —
  // it read the persona's lexicon only.
  const { c } = await appClient();
  const b = await harborBook(c);
  const seen = {};
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (s, kw) => {
    Object.assign(seen, kw);
    return new RenderedLine({ pcm: pcmOf(40, 0x1000), sampleRate: 16000, channels: 1, effectiveDelivery: {} });
  });
  const h = session.getDb();
  const block = h.get(Block, b.said);
  await exportVoicelines._renderBlockProduction(appState.getState(), personaForBlock(h, block), block);
  expect(seen.lexicons).toEqual([b.book, b.slang]);
});

test("the_scan_counts_a_name_as_handled_only_where_the_render_handles_it", async () => {
  const { c } = await appClient();
  const b = await harborBook(c);
  const r = await c.post(`/v1/projects/${b.pid}/pronunciation-report`);
  expect(r.status, r.text).toBe(200);
  const words = Object.fromEntries(r.json().words.map((w) => [w.word, w.count]));
  // The book's chosen lexicon covers Elara on every line.
  expect("Elara" in words).toBe(false);
  // A book-scoped lexicon nobody chose is not read by the render.
  expect(words.Brindlewood).toBe(1);
  // The persona's lexicon covers Harbek on Old Crow's line only.
  expect(words.Harbek).toBe(1);
});

// ── §6 · 1 · Generate reads the lexicons the page sends ─────────────────

/** A loaded managed engine with one voice, as `_findManagedVoiceOwner` sees it. */
class GenManager extends FakeManager {
  currentId() {
    return "mock-tts";
  }
  async voices() {
    return [{ id: "mv_1", name: "MV" }];
  }
}

/** Runs the one interactive item on the spot. (Python's twin took no `owner=` and so fails
 * today — see the header.) */
const nowScheduler = {
  submit(specs, { interactive = false, owner = null } = {}) {
    void interactive;
    void owner;
    const run = specs[0][1]();
    const handle = {
      items: [{ result: null, error: null }],
      error: null,
      async waitAsync() {
        try {
          handle.items[0].result = await run;
        } catch (e) {
          handle.error = e;
        }
      },
      raiseIfFailed() {
        if (handle.error != null) throw handle.error;
      },
    };
    return handle;
  },
};

/** The app, with Generate's manager and scheduler faked (Python's `client` + `gen_mgr`). */
async function genApp() {
  const { c } = await appClient();
  const mgr = new GenManager({ "mock-tts": fakeManifest("mock-tts", { staticVoices: [{ id: "mv_1", name: "MV" }] }) }, { pcm: pcmOf(400, 0x1000) });
  vi.spyOn(manager, "getManager").mockReturnValue(mgr);
  vi.spyOn(synthScheduler, "getScheduler").mockReturnValue(nowScheduler);
  return [c, mgr];
}

test("generate_reads_the_lexicons_it_is_sent", async () => {
  // Generate sent the persona's lexicon and showed its preview, and the server read none of it —
  // a line on Generate was said one way and the same line in the chapter another.
  const [c, mgr] = await genApp();
  const lx = (await post(c, "/v1/lexicons", { name: "Harbor names", entries: [{ grapheme: "Worcester", alias: "Wooster" }] })).id;
  const r = await c.post("/v1/generate", { json: { voice: "mv_1", text: "To Worcester.", lexicons: [lx] } });
  expect(r.status, r.text).toBe(200);
  expect(synthBodies(mgr).at(-1).text).toBe("To Wooster.");
  // Sent none, read none.
  await c.post("/v1/generate", { json: { voice: "mv_1", text: "To Worcester." } });
  expect(synthBodies(mgr).at(-1).text).toBe("To Worcester.");
});

test("generate_carries_the_ipa_of_the_words_it_says", async () => {
  const [c, mgr] = await genApp();
  vi.spyOn(renderCore, "_supportsPhonemeInput").mockReturnValue(true);
  const lx = (
    await post(c, "/v1/lexicons", {
      name: "Harbor names",
      entries: [
        { grapheme: "Worcester", phoneme_ipa: "wˈʊstər" },
        { grapheme: "Beauchamp", phoneme_ipa: "bˈiːtʃəm" },
      ],
    })
  ).id;
  await c.post("/v1/generate", { json: { voice: "mv_1", text: "To Worcester.", lexicons: [lx] } });
  const body = synthBodies(mgr).at(-1);
  expect(body.text).toBe("To Worcester.");
  expect(unwrap(body.delivery.ipa_map)).toEqual({ Worcester: "wˈʊstər" });
});

// ── §6 · 3 · a new book lexicon is chosen for a book that has none ──────

test("a_new_book_lexicon_is_chosen_for_a_book_that_has_none", async () => {
  // Only an import used to choose one, so a lexicon made by hand on the Lexicons page did
  // nothing until someone found Overview's row.
  const { c } = await appClient();
  const lexiconOf = async (pid) => (await c.get(`/v1/projects/${pid}`)).json().default_lexicon_id;
  const pid = (await post(c, "/v1/projects", { name: "Harbor", project_type: "audiobook" })).id;
  const first = (await post(c, "/v1/lexicons", { name: "Harbor names", scope: "project", project_id: pid })).id;
  expect(await lexiconOf(pid)).toBe(first);
  // A second one leaves the book's choice alone…
  await post(c, "/v1/lexicons", { name: "More names", scope: "project", project_id: pid });
  expect(await lexiconOf(pid)).toBe(first);
  // …and a reusable or a persona's lexicon never chooses itself.
  const other = (await post(c, "/v1/projects", { name: "Ember", project_type: "audiobook" })).id;
  await post(c, "/v1/lexicons", { name: "Nautical" });
  expect(await lexiconOf(other)).toBeNull();
});

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

