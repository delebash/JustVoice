// SPDX-License-Identifier: MIT
//
// Discover's mock data — Speakers found from the server's grouping of the scans' names
// (pages/mock/MockDiscoverPage.vue; decided 2026-10-16, TASKS "The one-click run's leftovers,
// rethought", item 6 and answers 3–4). Production minus the plumbing: no server, no scan, no model.
//
// The book is the one-click mock's (bookRunMock.js): Alice's Adventures in Wonderland imported with
// chapters VII and VIII only — 176 lines as imported (105 + 71), 454 once Analyze has cut them
// (273 + 181; narration 123 + 91). The scans are Discover's on gemma (RESEARCH §10.4, §10.19,
// §10.24) with the counts it gave, in the order it listed them. Each quote is the book's own words,
// checked verbatim against server/samples/alice-in-wonderland/book.epub; the scans' own quotes and
// roles weren't recorded, so the quotes are picked for the mock and no row has a role.
//
// The grouping before the AI has checked: names that sit inside one another, a leading article set
// aside, are one person (extraction/names.js `isVariantBare`), and a name counted with 0 lines joins
// nothing — it stays its own row (decided 2026-10-16: a wrong join reads two people in one voice
// unseen; two rows for one person show, and Merge found names joins them). On these scans no two
// names with lines sit inside one another, so every name is its own row: "Queen of Hearts" (VII, 0
// lines) apart from "the Queen" (VIII, 13), and the heading THE KING AND QUEEN OF HEARTS alone.
// The AI's answer (merged, stale): the local merge's one question on Alice keeps the Queen's two
// names as one person and nothing else (RESEARCH §10.24, `eval:speakers`: "merge clean") — shown as
// Queen of Hearts, its fullest form (merge_names.js `fullestName`).

import { PROJECT, UNIT, VII, VIII } from "./bookRunMock.js";

export { PROJECT, UNIT };

/** The states the page draws (?state=); merged and stale also with ?by=run. */
export const STATES = ["unchecked", "merging", "merged", "stale", "failed", "noscans"];

export const SCENES = [
  { id: "sc_vii", title: VII, position: 0 },
  { id: "sc_viii", title: VIII, position: 1 },
];

/** The model the merge asks — the built-in local model, the run's own (bookRunMock's LOCAL). */
export const MERGE_MODEL = { model: "gemma-4-26b-a4b-qat", recipe: "local" };

/** book_run.problemText's words for no language model. */
const NO_MODEL = "No language model is set up — set one in AI Settings first.";

/** The library's personas the page matches names against — one called Alice. */
export const PERSONAS = [{ id: "p_alice", name: "Alice" }];

const ELSIE = "their names were Elsie, Lacie, and Tillie; and they lived at the bottom of a well";

/** Each chapter's saved scan: the AI's names, its line counts and a quote that names them. */
const SCANS = {
  sc_vii: [
    { name: "March Hare", approx_lines: 14, evidence: "the March Hare and the Hatter were having tea at it" },
    { name: "Hatter", approx_lines: 23, evidence: "The Hatter opened his eyes very wide on hearing this" },
    { name: "Dormouse", approx_lines: 6, evidence: "a Dormouse was sitting between them, fast asleep" },
    { name: "Alice", approx_lines: 31, evidence: "said Alice indignantly, and she sat down in a large arm-chair at one end of the table" },
    { name: "Time", approx_lines: 0, evidence: "I dare say you never even spoke to Time!" },
    { name: "Queen of Hearts", approx_lines: 0, evidence: "it was at the great concert given by the Queen of Hearts" },
    { name: "Elsie", approx_lines: 0, evidence: ELSIE },
    { name: "Lacie", approx_lines: 0, evidence: ELSIE },
    { name: "Tillie", approx_lines: 0, evidence: ELSIE },
  ],
  sc_viii: [
    { name: "Five", approx_lines: 4, evidence: "said Five, in a sulky tone" },
    { name: "Seven", approx_lines: 2, evidence: "On which Seven looked up and said" },
    { name: "Two", approx_lines: 2, evidence: "Five and Seven said nothing, but looked at Two" },
    { name: "Alice", approx_lines: 12, evidence: "Alice thought this a very curious thing" },
    { name: "the Queen", approx_lines: 13, evidence: "and if the Queen was to find it out, we should all have our heads cut off, you know" },
    { name: "the White Rabbit", approx_lines: 4, evidence: "among them Alice recognised the White Rabbit" },
    { name: "the Knave of Hearts", approx_lines: 1, evidence: "Then followed the Knave of Hearts, carrying the King’s crown on a crimson velvet cushion" },
    { name: "THE KING AND QUEEN OF HEARTS", approx_lines: 0, evidence: "and, last of all this grand procession, came THE KING AND QUEEN OF HEARTS" },
    { name: "the King", approx_lines: 5, evidence: "began bowing to the King, the Queen, the royal children, and everybody else" },
    { name: "the Duchess", approx_lines: 0, evidence: "It belongs to the Duchess: you’d better ask her about it" },
    { name: "the Cheshire Cat", approx_lines: 3, evidence: "It’s the Cheshire Cat: now I shall have somebody to talk to" },
    { name: "the executioner", approx_lines: 0, evidence: "there was a dispute going on between the executioner, the King, and the Queen" },
  ],
};

/** The names the AI's answer makes one person, fullest form first (see the top). */
const ONE_PERSON = [["Queen of Hearts", "the Queen"]];

/**
 * The server's people from the scanned chapters' names → one entry per person, in book order:
 * `{key, name, names, lines, mentions, chapters, evidence, evidence_found, role_hint}`. `lines` is
 * the scans' counts summed; `evidence` the first chapter's quote. `scanned` is the ids of the
 * chapters with a saved scan; `checked`: the AI's answer is in (its pairs joined), else the
 * grouping before the check.
 */
export function mockFound(scanned, { checked = false } = {}) {
  const people = [];
  for (const scene of SCENES) {
    if (!scanned.includes(scene.id)) continue;
    for (const c of SCANS[scene.id]) {
      const group = checked ? ONE_PERSON.find((g) => g.includes(c.name)) : null;
      let p = people.find((x) => x.names.includes(c.name) || (group && x.names.some((n) => group.includes(n))));
      if (!p) {
        p = {
          key: `p:${(group ? group[0] : c.name).toLowerCase()}`, name: c.name, names: [], lines: 0, mentions: 0,
          chapters: [], evidence: "", evidence_found: null, role_hint: "",
        };
        people.push(p);
      }
      if (!p.names.includes(c.name)) p.names.push(c.name);
      p.lines += c.approx_lines;
      if (!p.chapters.includes(scene.id)) p.chapters.push(scene.id);
      if (!p.evidence) Object.assign(p, { evidence: c.evidence, evidence_found: true });
    }
  }
  for (const p of people) {
    const group = checked ? ONE_PERSON.find((g) => g.includes(p.names[0])) : null;
    if (group) p.name = group.find((n) => p.names.includes(n));
  }
  return people;
}

// The book's speakers before the run: the narrator and Alice, added on Cast and with ＋ Add —
// Alice cast with your persona Alice. Nothing is analyzed yet, so neither has a line.
const BOOK_CAST = [
  { id: "s_narrator", name: "Narrator", aliases: [], narrator: true, lines: 0, ready: false },
  { id: "s_alice", name: "Alice", aliases: [], narrator: false, lines: 0, ready: true },
];
// After Make the audiobook: everyone the merge kept, added most lines first, then the narrator;
// each cast with a voice made from the book (Alice with your persona Alice). Their lines are
// Analyze's (bookRunMock's answer key, the Knave with none).
const RUN_CAST = [
  ["s_alice", "Alice", 92], ["s_hatter", "Hatter", 55], ["s_march_hare", "March Hare", 16],
  ["s_queen", "Queen of Hearts", 22, ["the Queen"]], ["s_dormouse", "Dormouse", 21], ["s_king", "the King", 9],
  ["s_five", "Five", 7], ["s_rabbit", "the White Rabbit", 7], ["s_cat", "the Cheshire Cat", 3], ["s_seven", "Seven", 3],
  ["s_two", "Two", 5], ["s_knave", "the Knave of Hearts", 0],
].map(([id, name, lines, aliases = []]) => ({ id, name, aliases, narrator: false, lines, ready: true }))
  .concat([{ id: "s_narrator", name: "Narrator", aliases: [], narrator: true, lines: 214, ready: true }]);

/**
 * Where the page starts in each state: when each chapter was scanned, the merge's record, the book's
 * speakers and each chapter's lines. `byRun` (merged and stale only): Make the audiobook merged the
 * names — its Add step then added everyone with lines, and the run went on to the M4B.
 */
export function mockSetup(state, { byRun = false } = {}) {
  const now = Date.now();
  const minutesAgo = (m) => (m === null ? null : new Date(now - m * 60_000).toISOString());
  const run = byRun && (state === "merged" || state === "stale");
  // Minutes ago: chapter VII's scan, chapter VIII's, the merge.
  const [vii, viii, merged] = {
    noscans: [null, null, null],
    unchecked: [12, 11, null],
    merging: [12, 11, null],
    failed: [12, 11, null],
    merged: run ? [21, 21, 20] : [12, 11, 4],
    // Chapter VIII scanned again after the merge.
    stale: run ? [45, 2, 44] : [40, 2, 25],
  }[state];
  let merge = { status: "none" };
  if (state === "merging") merge = { status: "running", ...MERGE_MODEL };
  else if (state === "failed") merge = { status: "failed", error: NO_MODEL };
  else if (merged !== null) merge = { status: "done", at: minutesAgo(merged), by: run ? "run" : "button", ...MERGE_MODEL };
  return {
    run,
    scannedAt: { sc_vii: minutesAgo(vii), sc_viii: minutesAgo(viii) },
    merge,
    cast: (run ? RUN_CAST : BOOK_CAST).map((c) => ({ ...c, imported_from: null })),
    linesByScene: run ? { sc_vii: 273, sc_viii: 181 } : { sc_vii: 105, sc_viii: 71 },
  };
}
