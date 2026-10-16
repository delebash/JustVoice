// SPDX-License-Identifier: MIT
//
// Discover's mock data — Speakers found, the AI's Same person? suggestions, your links and the
// pairs kept apart (pages/mock/MockDiscoverPage.vue; decided 2026-10-16, TASKS "Discover's names:
// the AI suggests, you link"). Production minus the plumbing: no server, no scan, no model — the
// functions here stand in for the server's answers.
//
// The book is the one-click mock's (bookRunMock.js): Alice's Adventures in Wonderland imported with
// chapters VII and VIII only — 176 lines as imported (105 + 71), 454 once Analyze has cut them
// (273 + 181; narration 123 + 91). The scans are Discover's on gemma (RESEARCH §10.4, §10.19,
// §10.24) with the counts it gave, in the order it listed them. Each quote is the book's own words,
// checked verbatim against server/samples/alice-in-wonderland/book.epub; the scans' own quotes and
// roles weren't recorded, so the quotes are picked for the mock and no row has a role.
//
// Every name the scans found is its own row until you link it. Find same people asks the AI which
// names are one person; its answer on Alice — the local recipe's one question, RESEARCH §10.24,
// `eval:speakers`: "merge clean" — is that "Queen of Hearts" (VII, 0 lines) and "the Queen" (VIII,
// 13) are one person, and nothing else (THE KING AND QUEEN OF HEARTS is no one). A linked row goes
// by its fullest name (merge_names.js `fullestName`).

import { PROJECT, UNIT, VII, VIII } from "./bookRunMock.js";

export { PROJECT, UNIT };

/** The states the page draws (?state=); linked and stale also with ?by=run. */
export const STATES = ["unchecked", "finding", "suggested", "linked", "apart", "stale", "failed", "noscans"];

export const SCENES = [
  { id: "sc_vii", title: VII, position: 0 },
  { id: "sc_viii", title: VIII, position: 1 },
];

/** The model Find same people asks — the built-in local model, the run's own (bookRunMock's LOCAL). */
export const FIND_MODEL = { model: "gemma-4-26b-a4b-qat", recipe: "local" };

/** book_run.problemText's words for no language model. */
const NO_MODEL = "No language model is set up — set one in AI Settings first.";

/** The library's personas the page matches names against — one called Alice. */
export const PERSONAS = [{ id: "p_alice", name: "Alice" }];

/** The book's own first pair of names that look like one name — the line's example. */
export const EXAMPLE = ["the Queen", "Queen of Hearts"];

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

/** The AI's answer to Find same people: each group of names it says are one person. */
export const AI_SAME = [["Queen of Hearts", "the Queen"]];

const ARTICLES = new Set(["the", "a", "an"]);
/** The server's `fullestName`: the most words once a leading article is dropped, then the shorter. */
export function fullestName(names) {
  const words = (n) => {
    const w = n.toLowerCase().split(/\s+/);
    return (w.length > 1 && ARTICLES.has(w[0]) ? w.slice(1) : w).length;
  };
  return [...names].sort((a, b) => words(b) - words(a) || a.length - b.length)[0];
}

/** Each name the scanned chapters found, in book order: `{name, lines, chapters, evidence}`. */
export function mockNames(scanned) {
  const out = [];
  for (const scene of SCENES) {
    if (!scanned.includes(scene.id)) continue;
    for (const c of SCANS[scene.id]) {
      let n = out.find((x) => x.name === c.name);
      if (!n) {
        n = { name: c.name, lines: 0, chapters: [], evidence: c.evidence };
        out.push(n);
      }
      n.lines += c.approx_lines;
      if (!n.chapters.includes(scene.id)) n.chapters.push(scene.id);
    }
  }
  return out;
}

/**
 * The server's people: one row per name, or per group of names you linked →
 * `{key, name, names, lines, mentions, chapters, evidence, evidence_found, role_hint, link}`.
 * `links` is `[{names, name, by}]`; a linked row goes by the link's name, its lines summed, its
 * chapters joined, its quote the first name's.
 */
export function mockFound(scanned, links = []) {
  const people = [];
  for (const n of mockNames(scanned)) {
    const link = links.find((l) => l.names.includes(n.name)) ?? null;
    let p = link ? people.find((x) => x.link === link) : null;
    if (!p) {
      p = {
        key: `p:${(link ? link.name : n.name).toLowerCase()}`, name: link ? link.name : n.name, names: [], lines: 0,
        mentions: 0, chapters: [], evidence: n.evidence, evidence_found: true, role_hint: "", link,
      };
      people.push(p);
    }
    p.names.push(n.name);
    p.lines += n.lines;
    for (const ch of n.chapters) if (!p.chapters.includes(ch)) p.chapters.push(ch);
  }
  return people;
}

// The book's speakers before the run: the narrator and Alice, added on Cast and with ＋ Add —
// Alice cast with your persona Alice. Nothing is analyzed yet, so neither has a line.
const BOOK_CAST = [
  { id: "s_narrator", name: "Narrator", aliases: [], narrator: true, lines: 0, ready: false },
  { id: "s_alice", name: "Alice", aliases: [], narrator: false, lines: 0, ready: true },
];
// After Make the audiobook: everyone with lines, the Queen's two names linked by the run, added
// most lines first, then the narrator; each cast with a voice made from the book (Alice with your
// persona Alice). Their lines are Analyze's (bookRunMock's answer key, the Knave with none).
const RUN_CAST = [
  ["s_alice", "Alice", 92], ["s_hatter", "Hatter", 55], ["s_march_hare", "March Hare", 16],
  ["s_queen", "Queen of Hearts", 22, ["the Queen"]], ["s_dormouse", "Dormouse", 21], ["s_king", "the King", 9],
  ["s_five", "Five", 7], ["s_rabbit", "the White Rabbit", 7], ["s_cat", "the Cheshire Cat", 3], ["s_seven", "Seven", 3],
  ["s_two", "Two", 5], ["s_knave", "the Knave of Hearts", 0],
].map(([id, name, lines, aliases = []]) => ({ id, name, aliases, narrator: false, lines, ready: true }))
  .concat([{ id: "s_narrator", name: "Narrator", aliases: [], narrator: true, lines: 214, ready: true }]);

/**
 * Where the page starts in each state: when each chapter was scanned, the AI's check, your links,
 * the pairs kept apart, the book's speakers and each chapter's lines. `byRun` (linked and stale
 * only): Make the audiobook found the same people and linked them itself — its Add step then added
 * everyone with lines, and the run went on to the M4B.
 */
export function mockSetup(state, { byRun = false } = {}) {
  const now = Date.now();
  const minutesAgo = (m) => (m === null ? null : new Date(now - m * 60_000).toISOString());
  const run = byRun && (state === "linked" || state === "stale");
  // Minutes ago: chapter VII's scan, chapter VIII's, the check.
  const [vii, viii, checked] = {
    noscans: [null, null, null],
    unchecked: [12, 11, null],
    finding: [12, 11, null],
    failed: [12, 11, null],
    suggested: [12, 11, 1],
    linked: run ? [21, 21, 20] : [12, 11, 4],
    apart: [12, 11, 4],
    // Chapter VIII scanned again after the check.
    stale: run ? [45, 2, 44] : [40, 2, 25],
  }[state];
  let check = { status: "none" };
  if (state === "finding") check = { status: "running", ...FIND_MODEL };
  else if (state === "failed") check = { status: "failed", error: NO_MODEL };
  else if (checked !== null) check = { status: "done", at: minutesAgo(checked), by: run ? "run" : "button", ...FIND_MODEL };
  const queen = { names: [...AI_SAME[0]], name: fullestName(AI_SAME[0]), by: run ? "run" : "you" };
  return {
    run,
    scannedAt: { sc_vii: minutesAgo(vii), sc_viii: minutesAgo(viii) },
    check,
    links: state === "linked" || state === "stale" ? [queen] : [],
    apart: state === "apart" ? [{ names: [...AI_SAME[0]], from: "suggestion" }] : [],
    cast: (run ? RUN_CAST : BOOK_CAST).map((c) => ({ ...c, aliases: [...c.aliases], imported_from: null })),
    linesByScene: run ? { sc_vii: 273, sc_viii: 181 } : { sc_vii: 105, sc_viii: 71 },
  };
}
