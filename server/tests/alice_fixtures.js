// SPDX-License-Identifier: MIT
// Alice VII–VIII as the one-click plan's slice 4 measured it: the answer key, and Discover's two
// scans as gemma made them (RESEARCH §10.4, 2026-10-10) — every speaker, the people named who
// never speak (0 lines; the silent Knave 1), a heading as a name, and the Queen as "Queen of
// Hearts" in VII and "the Queen" in VIII. The line counts are the answer key's.
import { readFileSync } from "node:fs";
import path from "node:path";

export const ALICE = path.resolve(import.meta.dirname, "..", "samples", "alice-in-wonderland");
export const KEY = JSON.parse(readFileSync(path.join(ALICE, "attribution-truth.json"), "utf8"));
export const VII = "CHAPTER VII. A Mad Tea-Party";
export const VIII = "CHAPTER VIII. The Queen’s Croquet-Ground";

const cand = (name, approx_lines, extra = {}) => ({ name, role_hint: null, approx_lines, evidence: null, evidence_found: null, ...extra });

export const ALICE_SCANS = [
  {
    id: "vii",
    title: VII,
    candidates: [
      cand("Alice", 59),
      cand("Hatter", 50),
      cand("March Hare", 16),
      cand("Dormouse", 21),
      cand("Time", 0),
      cand("Elsie", 0),
      cand("Lacie", 0),
      cand("Tillie", 0),
      cand("Queen of Hearts", 0, { role_hint: "the queen the Hatter sang for", evidence: "the Queen of Hearts, and I had to sing" }),
    ],
  },
  {
    id: "viii",
    title: VIII,
    candidates: [
      cand("THE KING AND QUEEN OF HEARTS", 0),
      cand("Alice", 33),
      cand("Two", 5),
      cand("Five", 7),
      cand("Seven", 3),
      cand("the Queen", 22, { role_hint: "rules the croquet-ground", evidence: "shouted the Queen" }),
      cand("the King", 9),
      cand("the White Rabbit", 7),
      cand("the Cheshire Cat", 3),
      cand("the Duchess", 0),
      cand("the executioner", 0),
      cand("the Knave", 1),
    ],
  },
];

/** The names Discover counted no lines for — none may become a speaker. */
export const NEVER_SPEAK = ["Time", "Elsie", "Lacie", "Tillie", "THE KING AND QUEEN OF HEARTS", "the Duchess", "the executioner"];

/** What the local merge's one call answers on Alice: the Queen's two names are one person. */
export const ONE_QUEEN = { people: [{ name: "Queen of Hearts", names: ["Queen of Hearts", "the Queen"] }] };
