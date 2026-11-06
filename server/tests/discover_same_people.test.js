// SPDX-License-Identifier: MIT
// Discover's names: the AI suggests, you link (decided 2026-10-16, TASKS "Discover's names: the AI
// suggests, you link — Find same people, Link, Unlink, Kept apart"). Find same people writes
// suggestions only; Link, Unlink, Not the same and Undo are yours; Make the audiobook links on its
// own, never a pair you kept apart. The state lives on the project (`discover_people`).
//
// The names are gemma's scans of Alice VII–VIII (alice_fixtures.js); every model call is stubbed:
// `merge_names.runFeature` (Find's own call), `identify.identifySpeakers` (Discover's scan), and
// `run.featureRoute` (the model Find would ask).
import { afterEach, expect, test, vi } from "vitest";
import * as extraction from "../src/api/extraction_api.js";
import * as session from "../src/database/session.js";
import * as run from "../src/engines/llm/run.js";
import * as identify from "../src/extraction/identify.js";
import { SpeakerCandidate } from "../src/extraction/identify.js";
import * as mergeNames from "../src/extraction/merge_names.js";
import { ALICE_SCANS, ONE_QUEEN } from "./alice_fixtures.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApps();
});

const QUEEN = ["Queen of Hearts", "the Queen"];

/** A two-chapter book, each chapter scanned with Alice's names; Find's model ready, answering
 * that the Queen's two names are one person. → {c, pid, calls} */
async function scannedBook() {
  const { c } = await appClient(undefined, { seed: true });
  const chapters = [
    ["ch1", "One", [scene("scn1", "Hello.")]],
    ["ch2", "Two", [scene("scn2", "Hi.")]],
  ];
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson({ chapters }) });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const scenes = (await c.get(`/v1/projects/${pid}/scenes`)).json();
  for (const [i, scan] of ALICE_SCANS.entries()) {
    vi.spyOn(identify, "identifySpeakers").mockResolvedValueOnce(scan.candidates.map((x) => new SpeakerCandidate(x)));
    expect((await c.post(`/v1/scenes/${scenes[i].id}/discover-speakers`, { json: { text: "Some text." } })).status).toBe(200);
  }
  vi.spyOn(run, "featureRoute").mockReturnValue({ configured: true, model: "gemma-test", provider: "Built-in engine", provider_id: "builtin", cloud: false, detail: null });
  const calls = [];
  vi.spyOn(mergeNames, "runFeature").mockImplementation(async (action, variables) => {
    calls.push([action, variables]);
    return { text: JSON.stringify(ONE_QUEEN), prompt_tokens: 120, completion_tokens: 30, model: "gemma" };
  });
  return { c, pid, calls };
}

const people = async (c, pid) => (await c.get(`/v1/projects/${pid}`)).json().discover_people;
const speakers = async (c, pid) => (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
const post = (c, url, json) => (json === undefined ? c.post(url) : c.post(url, { json }));

test("Find same people suggests, and nothing else changes; asked again, the list stays one", async () => {
  const { c, pid, calls } = await scannedBook();
  const before = await speakers(c, pid);
  expect((await people(c, pid)).check.status).toBe("none");

  const r = await post(c, `/v1/projects/${pid}/discover/find`);
  expect(r.status, r.text).toBe(200);
  expect(calls.map((x) => x[0])).toEqual(["speaker_merge.local"]);
  const got = r.json();
  expect(got.added).toBe(1);
  expect(got.usage).toMatchObject({ prompt_tokens: 120, completion_tokens: 30 });
  expect(got.discover_people.suggestions).toEqual([{ names: QUEEN, name: "Queen of Hearts" }]);
  expect(got.discover_people.links).toEqual([]);
  expect(got.discover_people.apart).toEqual([]);
  expect(got.discover_people.check).toMatchObject({ status: "done", by: "button", model: "gemma", recipe: "local", error: null });
  expect(got.discover_people.check.at).toBeTruthy();
  // Nothing linked, no speaker added, no Also called written.
  expect(await speakers(c, pid)).toEqual(before);
  // The project carries it — and keeps it out of `metadata`, which a client sends back.
  const project = (await c.get(`/v1/projects/${pid}`)).json();
  expect(project.discover_people).toEqual(got.discover_people);
  expect(project.metadata).not.toHaveProperty("discover_people");

  const again = (await post(c, `/v1/projects/${pid}/discover/find`)).json();
  expect(again.added).toBe(0);
  expect(again.discover_people.suggestions.length).toBe(1);
});

test("the GET says what Find would ask; with no language model Find is 501, kept as a failed check", async () => {
  const { c, pid } = await scannedBook();
  expect((await c.get(`/v1/projects/${pid}/discover/find`)).json()).toEqual({ configured: true, model: "gemma-test", recipe: "local", detail: null });
  vi.mocked(run.featureRoute).mockReturnValue({ configured: false, model: null, provider: null, provider_id: null, cloud: false, detail: "No LLM provider registered." });
  const r = await post(c, `/v1/projects/${pid}/discover/find`);
  expect(r.status).toBe(501);
  expect(r.text).toContain(extraction.NO_MODEL);
  expect((await people(c, pid)).check).toMatchObject({ status: "failed", by: "button", error: extraction.NO_MODEL });
  expect((await c.get("/v1/projects/nope/discover/find")).status).toBe(404);
});

test("Link, then Unlink: the pair is kept apart, Find won't suggest it again, Undo links it back", async () => {
  const { c, pid } = await scannedBook();
  await post(c, `/v1/projects/${pid}/discover/find`);

  let r = await post(c, `/v1/projects/${pid}/discover/link`, { names: ["the Queen", "Queen of Hearts"] });
  expect(r.status, r.text).toBe(200);
  // One person, going by the fullest name; no speaker among them, so no Also called written.
  expect(r.json()).toEqual({
    discover_people: expect.objectContaining({ links: [{ names: ["the Queen", "Queen of Hearts"], name: "Queen of Hearts", by: "you" }], apart: [] }),
    speaker_id: null,
  });

  r = await post(c, `/v1/projects/${pid}/discover/unlink`, { name: "the queen" });
  expect(r.status, r.text).toBe(200);
  let state = r.json().discover_people;
  expect(state.links).toEqual([]);
  expect(state.apart).toEqual([{ names: QUEEN, from: "unlink", link: { name: "Queen of Hearts", by: "you" } }]);
  // Find again: the model still says they are one person, and it isn't suggested.
  const found = (await post(c, `/v1/projects/${pid}/discover/find`)).json();
  expect(found.added).toBe(0);
  // The stored suggestion stays; it is the page that leaves out what you answered.
  expect(found.discover_people.suggestions).toEqual([{ names: QUEEN, name: "Queen of Hearts" }]);

  r = await post(c, `/v1/projects/${pid}/discover/undo-apart`, { names: ["the Queen", "Queen of Hearts"] });
  expect(r.status, r.text).toBe(200);
  state = r.json().discover_people;
  expect(state.apart).toEqual([]);
  expect(state.links).toEqual([{ names: QUEEN, name: "Queen of Hearts", by: "you" }]);

  // Unlinking a name linked to no one, or undoing a pair that isn't kept apart: 404.
  expect((await post(c, `/v1/projects/${pid}/discover/unlink`, { name: "Hatter" })).status).toBe(404);
  expect((await post(c, `/v1/projects/${pid}/discover/undo-apart`, { names: ["Hatter", "Alice"] })).status).toBe(404);
  expect((await post(c, `/v1/projects/${pid}/discover/link`, { names: ["Hatter"] })).status).toBe(400);
});

test("Not the same keeps a suggestion's names apart; Undo puts the suggestion back", async () => {
  const { c, pid } = await scannedBook();
  await post(c, `/v1/projects/${pid}/discover/find`);
  let r = await post(c, `/v1/projects/${pid}/discover/keep-apart`, { names: QUEEN });
  expect(r.status, r.text).toBe(200);
  expect(r.json().discover_people.apart).toEqual([{ names: QUEEN, from: "suggestion", link: null }]);
  // Twice is once.
  r = await post(c, `/v1/projects/${pid}/discover/keep-apart`, { names: [...QUEEN].reverse() });
  expect(r.json().discover_people.apart.length).toBe(1);
  r = await post(c, `/v1/projects/${pid}/discover/undo-apart`, { names: QUEEN });
  expect(r.json().discover_people).toMatchObject({ apart: [], links: [], suggestions: [{ names: QUEEN }] });
});

test("a speaker among the names keeps their name and takes the others as Also called; Unlink takes it out; two speakers can't be linked", async () => {
  const { c, pid } = await scannedBook();
  const queen = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Queen of Hearts" } })).json();
  const king = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "the King" } })).json();

  let r = await post(c, `/v1/projects/${pid}/discover/link`, { names: ["the Queen", "Queen of Hearts"] });
  expect(r.status, r.text).toBe(200);
  expect(r.json().speaker_id).toBe(queen.id);
  expect(r.json().discover_people.links).toEqual([{ names: ["Queen of Hearts", "the Queen"], name: "Queen of Hearts", by: "you" }]);
  expect((await speakers(c, pid)).find((s) => s.id === queen.id).aliases).toEqual(["the Queen"]);

  // Two speakers: joining them would move lines — not this.
  r = await post(c, `/v1/projects/${pid}/discover/link`, { names: ["Queen of Hearts", "the King"] });
  expect(r.status).toBe(409);
  expect(r.text).toContain("joining speakers isn't done here");
  expect((await speakers(c, pid)).find((s) => s.id === king.id).aliases).toEqual([]);

  // A speaker's own name can't be unlinked.
  expect((await post(c, `/v1/projects/${pid}/discover/unlink`, { name: "Queen of Hearts" })).status).toBe(400);
  r = await post(c, `/v1/projects/${pid}/discover/unlink`, { name: "the Queen" });
  expect(r.status, r.text).toBe(200);
  expect(r.json().speaker_id).toBe(queen.id);
  expect((await speakers(c, pid)).find((s) => s.id === queen.id).aliases).toEqual([]);
  expect(r.json().discover_people.apart).toEqual([{ names: ["Queen of Hearts", "the Queen"], from: "unlink", link: { name: "Queen of Hearts", by: "you" } }]);

  // An Also called that no link made (Cast's, or the import's) unlinks too.
  expect((await c.patch(`/v1/speakers/${king.id}`, { json: { aliases: ["his Majesty"] } })).status).toBe(200);
  r = await post(c, `/v1/projects/${pid}/discover/unlink`, { name: "his Majesty" });
  expect(r.status, r.text).toBe(200);
  expect((await speakers(c, pid)).find((s) => s.id === king.id).aliases).toEqual([]);
  // Undo gives it back.
  r = await post(c, `/v1/projects/${pid}/discover/undo-apart`, { names: ["his Majesty", "the King"] });
  expect(r.status, r.text).toBe(200);
  expect((await speakers(c, pid)).find((s) => s.id === king.id).aliases).toEqual(["his Majesty"]);
});

test("Find never suggests a name that is already that speaker's, nor two speakers", async () => {
  const { c, pid } = await scannedBook();
  // The Queen added with her other name: the model's group is one speaker already.
  const add = await c.post(`/v1/projects/${pid}/speakers/promote`, { json: { candidates: [{ name: "Queen of Hearts", aliases: ["the Queen"] }] } });
  expect(add.status, add.text).toBe(200);
  let found = (await post(c, `/v1/projects/${pid}/discover/find`)).json();
  expect(found.discover_people.suggestions).toEqual([]);
  // The Queen and the King both speakers, the model saying they are one: not suggested.
  await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "the King" } });
  vi.mocked(mergeNames.runFeature).mockResolvedValue({ text: JSON.stringify({ people: [{ name: "the King", names: ["the King", "the Queen"] }] }), prompt_tokens: 1, completion_tokens: 1, model: "gemma" });
  found = (await post(c, `/v1/projects/${pid}/discover/find`)).json();
  expect(found.discover_people.suggestions).toEqual([]);
});

test("Make the audiobook links on its own, says so, and never links a pair you kept apart", async () => {
  const { c, pid } = await scannedBook();
  const h = session.getDb();
  // You said the Queen's names are different people: the run's merge leaves them apart.
  await post(c, `/v1/projects/${pid}/discover/keep-apart`, { names: QUEEN });
  let out = await extraction.mergeFoundNames(h, pid);
  expect(out.groups).toEqual([]);
  expect(out.people.map((p) => p.name)).toContain("the Queen");
  extraction.linkFoundPeople(h, pid, out.groups, { at: "2026-11-05T10:00:00+00:00", model: "gemma", recipe: "local" });
  let state = await people(c, pid);
  expect(state.links).toEqual([]);
  expect(state.check).toMatchObject({ status: "done", by: "run", model: "gemma", recipe: "local" });

  // Undo, and run again: linked by the run, and the run's Add takes the other name as Also called.
  await post(c, `/v1/projects/${pid}/discover/undo-apart`, { names: QUEEN });
  out = await extraction.mergeFoundNames(h, pid);
  expect(out.groups).toEqual([{ name: "Queen of Hearts", names: QUEEN }]);
  expect(extraction.linkFoundPeople(h, pid, out.groups, { at: "2026-11-05T10:00:00+00:00", model: "gemma", recipe: "local" })).toBe(1);
  state = await people(c, pid);
  expect(state.links).toEqual([{ names: QUEEN, name: "Queen of Hearts", by: "run" }]);
  const queen = out.people.find((p) => p.name === "Queen of Hearts");
  expect(queen.aliases).toEqual(["the Queen"]);
  expect((await c.post(`/v1/projects/${pid}/speakers/promote`, { json: { candidates: [{ name: queen.name, aliases: queen.aliases }] } })).status).toBe(200);

  // Unlink after the run: out of her Also called, kept apart — and a run after that adds "the
  // Queen" as someone else, as Discover then shows her.
  const sp = (await speakers(c, pid)).find((s) => s.name === "Queen of Hearts");
  const r = await post(c, `/v1/projects/${pid}/discover/unlink`, { name: "the Queen" });
  expect(r.json().speaker_id).toBe(sp.id);
  expect(r.json().discover_people.apart).toEqual([{ names: QUEEN, from: "unlink", link: { name: "Queen of Hearts", by: "run" } }]);
  out = await extraction.mergeFoundNames(h, pid);
  expect(out.people.map((p) => p.name)).toContain("the Queen");
  expect(out.in_book).toContainEqual({ name: "Queen of Hearts", speaker_id: sp.id });
});

test("a client's metadata never replaces the same people (the Overview's PATCH)", async () => {
  const { c, pid } = await scannedBook();
  await post(c, `/v1/projects/${pid}/discover/link`, { names: QUEEN });
  const meta = (await c.get(`/v1/projects/${pid}`)).json().metadata;
  const r = await c.patch(`/v1/projects/${pid}`, { json: { metadata: { ...meta, author: "Lewis Carroll", discover_people: { links: [] } } } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().metadata.author).toBe("Lewis Carroll");
  expect(r.json().discover_people.links).toEqual([{ names: QUEEN, name: "Queen of Hearts", by: "you" }]);
  // The language PATCH reads the same metadata.
  const lang = await c.patch(`/v1/projects/${pid}`, { json: { language: "en" } });
  expect(lang.json().discover_people.links.length).toBe(1);
});
