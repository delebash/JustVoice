// SPDX-License-Identifier: MIT
// Discover + merge names across chapters — the one-click plan's slice 4 (step 2, §3's two
// recipes). Accepted: "Alice VII–VIII give one Queen, no one with 0 lines becomes a speaker".
//
// The names are what gemma's Discover listed on Alice VII–VIII (alice_fixtures.js, RESEARCH
// §10.4). Every model call is stubbed: `merge_names.runFeature` (the merge's
// own call) and `identify.identifySpeakers` (Discover's, on the route).
import * as llmStores from "@delebash/core/llm/stores";
import { resolveFeaturePreset } from "@delebash/core/llm";
import { afterEach, describe, expect, test, vi } from "vitest";
import * as identify from "../src/extraction/identify.js";
import { SpeakerCandidate } from "../src/extraction/identify.js";
import * as mergeNames from "../src/extraction/merge_names.js";
import { applyPeople, collectFound, containmentGroups, fullestName, mergeBook, parsePeople } from "../src/extraction/merge_names.js";
import { bare, isVariantBare } from "../src/extraction/names.js";
import { ALICE_SCANS, ONE_QUEEN } from "./alice_fixtures.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApps();
});

const cand = (name, approx_lines, extra = {}) => ({ name, role_hint: null, approx_lines, evidence: null, evidence_found: null, ...extra });

/** A stand-in for the merge's model call: records each call, answers `answer`. */
function stubMerge(answer, calls = []) {
  return vi.spyOn(mergeNames, "runFeature").mockImplementation(async (action, variables) => {
    calls.push([action, variables]);
    return { text: typeof answer === "string" ? answer : JSON.stringify(answer), prompt_tokens: 120, completion_tokens: 30, model: "gemma" };
  });
}

const names = (people) => people.map((p) => p.name);

describe("names that contain one another", () => {
  test("a leading article aside, whole words only", () => {
    expect(bare("the Queen")).toBe("queen");
    expect(bare("The")).toBe("the"); // a name that is only an article stays
    expect(bare("l'Abbé")).toBe("abbé");
    expect(isVariantBare("the Queen", "Queen of Hearts")).toBe(true);
    expect(isVariantBare("Hare", "the March Hare")).toBe(true);
    expect(isVariantBare("the Queen", "Queen")).toBe(true);
    expect(isVariantBare("the King", "the Queen")).toBe(false);
    expect(isVariantBare("Ann", "Annabel")).toBe(false);
  });

  test("the scans' names, once each: counts summed, the first quote kept", () => {
    const found = collectFound(ALICE_SCANS);
    const alice = found.find((f) => f.name === "Alice");
    expect(alice.lines).toBe(92);
    expect(alice.chapters.map((c) => c.id)).toEqual(["vii", "viii"]);
    expect(found.filter((f) => f.key === "alice").length).toBe(1);
    expect(found.find((f) => f.name === "Queen of Hearts").evidence).toBe("the Queen of Hearts, and I had to sing");
    // No number from the scan: not counted, which is not 0.
    expect(collectFound([{ id: "a", title: "A", candidates: [cand("Edith", null)] }])[0].lines).toBeNull();
  });

  test("Alice's one group: the Queen's two names, the King, and the heading that holds both", () => {
    const found = collectFound(ALICE_SCANS);
    const groups = containmentGroups(found).map((g) => g.map((i) => found[i].name));
    expect(groups).toEqual([["Queen of Hearts", "THE KING AND QUEEN OF HEARTS", "the Queen", "the King"]]);
  });

  test("the fullest name: most words once the article goes, then without the article", () => {
    expect(fullestName(["the Queen", "Queen of Hearts"])).toBe("Queen of Hearts");
    expect(fullestName(["the March Hare", "March Hare"])).toBe("March Hare");
    expect(fullestName(["Hatter"])).toBe("Hatter");
  });
});

describe("the local recipe", () => {
  test("Alice VII–VIII give one Queen, and no one with 0 lines is kept", async () => {
    const calls = [];
    stubMerge(ONE_QUEEN, calls);
    const rawOut = {};
    const { people, left_out } = await mergeBook(collectFound(ALICE_SCANS), { recipe: "local", rawOut });
    // One short call, about the one group.
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe("speaker_merge.local");
    expect(calls[0][1].groups).toContain('"THE KING AND QUEEN OF HEARTS"');
    expect(calls[0][1].groups).not.toContain('"Hatter"');
    expect(rawOut.usage).toMatchObject({ prompt_tokens: 120, completion_tokens: 30, model: "gemma", pieces: 1 });

    const queens = people.filter((p) => /queen/i.test([p.name, ...p.aliases].join(" ")));
    expect(queens.length).toBe(1);
    expect(queens[0]).toMatchObject({ name: "Queen of Hearts", aliases: ["the Queen"], lines: 22, chapters: ["vii", "viii"] });
    expect(queens[0].description).toBe("the queen the Hatter sang for");
    expect(people.every((p) => p.lines > 0)).toBe(true);
    expect(names(left_out)).toEqual(["Time", "Elsie", "Lacie", "Tillie", "THE KING AND QUEEN OF HEARTS", "the Duchess", "the executioner"]);
    // Most lines first. The silent Knave stays: Discover counted 1 line for him.
    expect(names(people)).toEqual([
      "Alice",
      "Hatter",
      "Queen of Hearts",
      "Dormouse",
      "March Hare",
      "the King",
      "Five",
      "the White Rabbit",
      "Two",
      "Seven",
      "the Cheshire Cat",
      "the Knave",
    ]);
  });

  test("no names that share words, no call", async () => {
    const spy = stubMerge(ONE_QUEEN);
    const rawOut = {};
    const { people } = await mergeBook(collectFound([ALICE_SCANS[0]]), { recipe: "local", rawOut });
    expect(spy).not.toHaveBeenCalled();
    expect(rawOut.usage).toBeUndefined();
    expect(names(people)).toEqual(["Alice", "Hatter", "Dormouse", "March Hare"]);
  });

  test("the answer can't lose, invent or cross-join a name", async () => {
    const scans = [
      { id: "a", title: "A", candidates: [cand("the Queen", 4), cand("Queen of Hearts", 1), cand("Old Sedge", 2), cand("Sedge", 1)] },
    ];
    stubMerge({
      people: [
        // the two groups joined, a made-up name, a name placed twice
        { name: "Queen of Hearts", names: ["Queen of Hearts", "the Queen", "Sedge", "Nobody"] },
        { name: "Sedge", names: ["Sedge", "the Queen", "Old Sedge"] },
      ],
    });
    const { people } = await mergeBook(collectFound(scans), { recipe: "local" });
    expect(people.map((p) => [p.name, p.aliases])).toEqual([
      ["Queen of Hearts", ["the Queen"]],
      ["Sedge", ["Old Sedge"]],
    ]);
  });

  test("an unreadable answer keeps every name on its own", async () => {
    stubMerge("I think the Queen is the Queen of Hearts.");
    const { people } = await mergeBook(collectFound(ALICE_SCANS), { recipe: "local" });
    expect(people.filter((p) => /queen/i.test(p.name)).map((p) => p.name)).toEqual(["the Queen"]);
    expect(parsePeople("no json")).toBeNull();
    expect(parsePeople('{"people": [{"name": "A", "names": "not a list"}]}')).toEqual([]);
  });

  test("a name with no count is kept; one counted 0 everywhere is not", () => {
    const found = collectFound([
      { id: "a", title: "A", candidates: [cand("Edith", null), cand("Tom", 0)] },
      { id: "b", title: "B", candidates: [cand("Edith", 0), cand("Tom", 0)] },
    ]);
    const persons = applyPeople(found, []);
    expect(persons.map((p) => mergeNames.personOf(found, p).lines)).toEqual([null, 0]);
  });
});

describe("the frontier recipe", () => {
  test("every name in one call; its answer merges, and its chosen name is used", async () => {
    const calls = [];
    stubMerge({ people: [{ name: "the Queen", names: ["Queen of Hearts", "the Queen"] }] }, calls);
    const { people, left_out } = await mergeBook(collectFound(ALICE_SCANS), { recipe: "frontier" });
    expect(calls.map((c) => c[0])).toEqual(["speaker_merge.frontier"]);
    // The whole book's names, with each chapter's count and the quotes.
    expect(calls[0][1].names).toContain('- "Hatter" — CHAPTER VII. A Mad Tea-Party: 50 lines');
    expect(calls[0][1].names).toContain('- "Alice" — CHAPTER VII. A Mad Tea-Party: 59 lines; CHAPTER VIII. The Queen’s Croquet-Ground: 33 lines');
    expect(calls[0][1].names).toContain('"shouted the Queen"');
    expect(people.find((p) => p.name === "the Queen")).toMatchObject({ aliases: ["Queen of Hearts"], lines: 22 });
    expect(people.filter((p) => /queen/i.test(p.name)).length).toBe(1);
    expect(left_out.every((p) => p.lines === 0)).toBe(true);
  });
});

// ── Through the app ────────────────────────────────────────────────────────

async function importBook(c) {
  const chapters = [
    ["ch1", "One", [scene("scn1", "Hello.")]],
    ["ch2", "Two", [scene("scn2", "Hi.")]],
  ];
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson({ chapters }) });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  return [pid, (await c.get(`/v1/projects/${pid}/scenes`)).json()];
}

test("the recipe follows the Frontier card's preset", async () => {
  await appClient(undefined, { seed: true });
  expect(mergeNames.mergeRecipe()).toBe("local"); // the seeded built-in engine
  const preset = resolveFeaturePreset("speaker_merge.frontier", "speaker_merge");
  llmStores.getEnginePresetStore().save({ ...preset, recipe: "frontier" });
  expect(mergeNames.mergeRecipe()).toBe("frontier");
});

test("merge reads every chapter's scan; promote adds the people with their other names", async () => {
  const { c } = await appClient(undefined, { seed: true });
  const [pid, scenes] = await importBook(c);
  expect(scenes.length).toBe(2);
  // Discover, chapter by chapter — the model stands in with Alice's names.
  for (const [i, scan] of ALICE_SCANS.entries()) {
    vi.spyOn(identify, "identifySpeakers").mockResolvedValueOnce(scan.candidates.map((x) => new SpeakerCandidate(x)));
    const r = await c.post(`/v1/scenes/${scenes[i].id}/discover-speakers`, { json: { text: "Some text." } });
    expect(r.status, r.text).toBe(200);
  }
  // A name you ignored stays out; one that became a speaker since the scan shows as in the book.
  expect((await c.post(`/v1/projects/${pid}/discover/ignore`, { json: { names: ["Two"] } })).status).toBe(200);
  const someone = "Dormouse";
  const made = await c.post(`/v1/projects/${pid}/speakers`, { json: { name: someone } });
  expect(made.status, made.text).toBe(201);
  const book = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;

  const calls = [];
  stubMerge(ONE_QUEEN, calls);
  const r = await c.post(`/v1/projects/${pid}/speakers/merge`);
  expect(r.status, r.text).toBe(200);
  const got = r.json();
  expect(got).toMatchObject({ project_id: pid, recipe: "local", scanned: 2 });
  expect(got.usage).toMatchObject({ prompt_tokens: 120, completion_tokens: 30 });
  expect(names(got.people)).not.toContain("Two");
  expect(names(got.people)).not.toContain(someone);
  expect(got.in_book).toEqual([{ name: someone, speaker_id: made.json().id }]);
  expect(got.people.filter((p) => /queen/i.test(p.name)).length).toBe(1);
  expect(got.left_out.length).toBe(7);
  // Nothing written yet.
  expect((await c.get(`/v1/projects/${pid}/speakers`)).json().speakers.length).toBe(book.length);

  const add = await c.post(`/v1/projects/${pid}/speakers/promote`, {
    json: { candidates: got.people.map((p) => ({ name: p.name, description: p.description, aliases: p.aliases })) },
  });
  expect(add.status, add.text).toBe(200);
  expect(add.json().created.length).toBe(got.people.length);
  const queen = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers.find((s) => s.name === "Queen of Hearts");
  expect(queen.aliases).toEqual(["the Queen"]);
  expect(queen.description).toBe("the queen the Hatter sang for");
});

test("merge on a book with no scans asks nothing; a failed call is the provider's words", async () => {
  const { c } = await appClient(undefined, { seed: true });
  const [pid, scenes] = await importBook(c);
  const spy = stubMerge(ONE_QUEEN);
  let r = await c.post(`/v1/projects/${pid}/speakers/merge`);
  expect(r.status, r.text).toBe(200);
  expect(r.json()).toMatchObject({ scanned: 0, people: [], left_out: [], usage: null });
  expect(spy).not.toHaveBeenCalled();

  vi.spyOn(identify, "identifySpeakers").mockResolvedValueOnce(ALICE_SCANS[1].candidates.map((x) => new SpeakerCandidate(x)));
  expect((await c.post(`/v1/scenes/${scenes[0].id}/discover-speakers`, { json: { text: "Some text." } })).status).toBe(200);
  vi.spyOn(mergeNames, "runFeature").mockRejectedValue(new Error("connection refused"));
  r = await c.post(`/v1/projects/${pid}/speakers/merge`);
  expect(r.status).toBe(502);
  expect(r.text).toContain("merging names failed: connection refused");
  expect((await c.post("/v1/projects/nope/speakers/merge")).status).toBe(404);
});
