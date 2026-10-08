// SPDX-License-Identifier: MIT
// A JustWrite book — built the way JustWrite really exports one (the port of
// tests/jw_fixtures.py).
//
// Every JustVoice test that imports "from JustWrite" builds its payload here, so the JW→JV
// contract has ONE definition on this side. The shape mirrors justwrite-app's
// `book_io.assemble()`: `parts[].chapters[]` for order, a `scenes` map keyed by chapter id, and
// scene bodies of rich-editor HTML.
import { ZipWriter } from "@delebash/llm-runner/platform/zip";
import { pyJson } from "@delebash/llm-runner/platform/pyjson";

/** One JustWrite scene row. Its body is editor HTML — one `<p>` per paragraph, which is what
 * the TipTap editor stores. */
export function scene(sceneId, ...paragraphs) {
  return { id: sceneId, title: "", body: paragraphs.map((p) => `<p>${p}</p>`).join("") };
}

/** A `book.json` snapshot. `chapters` is `[[id, title, [scene, ...]], ...]`. */
export function bookJson({ title = "The Ninth Facet", author = "Tamsin Vale", premise = "", characters = null, chapters = null } = {}) {
  const chs = chapters ?? [["ch1", "One", [scene("scn1", "Hello.")]]];
  const cast = characters ?? [
    { id: "mara", name: "Mara Vance", main: true, age: 34, gender: "female", pronouns: "she/her", aliases: [], lifeStatus: "alive", oneLiner: "", role: "", tags: [] },
  ];
  return {
    project: {
      title,
      author,
      subtitle: "",
      genre: "",
      wordsGoal: 0,
      dailyTarget: 0,
      wordsWritten: 0,
      startedOn: "",
      deadline: "",
      premise,
      coverImage: null,
    },
    parts: [
      {
        id: "part1",
        title: "Part One",
        chapters: chs.map(([chapterId, chapterTitle], i) => ({ id: chapterId, num: i + 1, title: chapterTitle, words: 0, status: "done", strands: [] })),
      },
    ],
    scenes: Object.fromEntries(chs.map(([chapterId, , scenes]) => [chapterId, scenes])),
    characters: cast,
    // The planning data JustVoice ignores, present so tests can prove it is ignored rather than
    // assuming a minimal payload.
    characterExtras: {},
    locations: [],
    objects: [],
    groups: [],
    notes: [],
    strands: [],
    architecture: {},
    worldbuilding: [],
    worldbuildingCategories: [],
    tagVocabularies: {},
    images: {},
    events: {},
    statuses: [],
    trash: {},
    voiceCanonChapterIds: [],
    worldRules: "",
    savedAt: "2026-08-08T00:00:00Z",
  };
}

/** The bytes JustWrite's export writes: `<folder>/book.json` next to a `<folder>/images/`
 * folder. */
export function bookZip(snapshot = null, { folder = "The Ninth Facet", images = {} } = {}) {
  const snap = snapshot ?? bookJson();
  const zf = new ZipWriter();
  zf.writestr(`${folder}/book.json`, pyJson(snap, { ensureAscii: false, indent: 2 }));
  for (const [name, raw] of Object.entries(images)) zf.writestr(`${folder}/images/${name}`, raw);
  return zf.toBuffer();
}
