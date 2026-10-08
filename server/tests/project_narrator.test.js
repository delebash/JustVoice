// SPDX-License-Identifier: MIT
// A book's narrator — a speaker holding the narrator role, never made on its own; and the
// speakers routes around it: cast, un-cast, clear cast, rewrite in character (the port of
// tests/test_project_narrator.py).
//
// Since 2026-09-29 the people in a book are its speakers, and each speaker is played by a
// persona (the finished voice). The narrator is the speaker holding the "narrator" role — the
// role, not the name, says so. No book gets one on its own: Cast's tick makes any speaker the
// narrator, and "+ Add Narrator" (POST /narrator) makes a speaker called Narrator — cast with the
// persona of exactly that name when the library has one.
//
// Python's parametrized `test_a_new_project_gets_no_narrator` is a `describe` of the same name
// with one test per project kind. Its `run_feature` monkeypatch is a spy on `run.runFeature`.
import { afterEach, describe, expect, test, vi } from "vitest";
import * as run from "../src/engines/llm/run.js";
import { appClient, closeApps } from "./app_helpers.js";
import { tmpPath } from "./helpers.js";

afterEach(closeApps);

async function createProject(c, name, kind) {
  const r = await c.post("/v1/projects", { json: { name, project_type: kind } });
  expect(r.status, r.text).toBe(201);
  return r.json().id;
}

async function speakers(c, projectId) {
  const r = await c.get(`/v1/projects/${projectId}/speakers`);
  expect(r.status, r.text).toBe(200);
  return r.json().speakers;
}

async function narrator(c, projectId) {
  return (await speakers(c, projectId)).find((s) => s.role_label === "narrator") ?? null;
}

/** A new book given a narrator by "+ Add Narrator" → [project id, narrator speaker id]. */
async function book(c, name = "Book", kind = "audiobook") {
  const pid = await createProject(c, name, kind);
  const r = await c.post(`/v1/projects/${pid}/narrator`);
  expect(r.status, r.text).toBe(201);
  return [pid, (await narrator(c, pid)).id];
}

async function speakerOf(c, sid, blockId) {
  return (await c.get(`/v1/scenes/${sid}/blocks`)).json().find((b) => b.id === blockId).speaker_id;
}

const personaIds = async (c) => (await c.get("/v1/personas")).json().personas.map((p) => p.id);

describe("a_new_project_gets_no_narrator", () => {
  test.each(["audiobook", "podcast", "game_voicelines", "custom"])("%s", async (kind) => {
    const { c } = await appClient();
    const pid = await createProject(c, "The Ninth Facet", kind);
    expect(await speakers(c, pid)).toEqual([]);
    expect((await c.get("/v1/personas")).json().personas).toEqual([]);
  });
});

test("add_narrator_makes_a_speaker_and_no_persona", async () => {
  const { c } = await appClient();
  const [pid] = await book(c);
  const n = await narrator(c, pid);
  expect(n.name).toBe("Narrator");
  expect(n.persona_id).toBeNull();
  expect((await c.get("/v1/personas")).json().personas).toEqual([]);
});

test("add_narrator_is_cast_with_a_persona_of_exactly_that_name", async () => {
  // Every new speaker: a persona called "narrator " (case and spaces aside) plays it at once.
  const { c } = await appClient();
  const voice = (await c.post("/v1/personas", { json: { name: "narrator " } })).json().id;
  const [pid] = await book(c);
  expect((await narrator(c, pid)).persona_id).toBe(voice);
});

test("ensure_narrator_endpoint_is_idempotent", async () => {
  const { c } = await appClient();
  const pid = await createProject(c, "Book", "audiobook");
  const r1 = await c.post(`/v1/projects/${pid}/narrator`);
  expect(r1.status, r1.text).toBe(201);
  const first = r1
    .json()
    .speakers.filter((s) => s.role_label === "narrator")
    .map((s) => s.id);
  const r2 = await c.post(`/v1/projects/${pid}/narrator`);
  expect(r2.status, r2.text).toBe(201);
  expect(
    r2
      .json()
      .speakers.filter((s) => s.role_label === "narrator")
      .map((s) => s.id),
  ).toEqual(first);
  expect((await speakers(c, pid)).length).toBe(1);
});

test("a_removed_narrator_takes_its_speaker_off_the_narration", async () => {
  // Removing the narrator's speaker leaves its lines with no speaker; "+ Add Narrator" makes a
  // new one and gives them back.
  const { c } = await appClient();
  const [pid, narratorId] = await book(c);
  const sid = (await c.post(`/v1/projects/${pid}/scenes`, { json: { title: "One" } })).json().id;
  const line = (
    await c.post(`/v1/scenes/${sid}/blocks`, {
      json: { position: 0, text: "It was early April.", speaker_id: narratorId, source: "narration" },
    })
  ).json().id;
  let r = await c.delete(`/v1/speakers/${narratorId}`);
  expect(r.status).toBe(200);
  expect(r.json()).toEqual({ deleted: true, lines: 1 });
  expect(await narrator(c, pid)).toBeNull();
  expect(await speakerOf(c, sid, line)).toBeNull();

  r = await c.post(`/v1/projects/${pid}/narrator`);
  expect(r.status).toBe(201);
  expect(r.json().moved_lines).toBe(1);
  const now = (await narrator(c, pid)).id;
  expect(await speakerOf(c, sid, line)).toBe(now);
  expect(now).not.toBe(narratorId);
});

test("add_narrator_takes_the_narration_nobody_reads", async () => {
  // Analyze on a book with no narrator leaves narration with no speaker; "+ Add Narrator" moves
  // those lines to it, as ticking a narrator does.
  const { c } = await appClient();
  const pid = await createProject(c, "Book", "audiobook");
  const sid = (await c.post(`/v1/projects/${pid}/scenes`, { json: { title: "One" } })).json().id;
  const line = (
    await c.post(`/v1/scenes/${sid}/blocks`, {
      json: { position: 0, text: "It was early April.", speaker_id: null, source: "narration" },
    })
  ).json().id;
  const r = await c.post(`/v1/projects/${pid}/narrator`);
  expect(r.status).toBe(201);
  expect(r.json().moved_lines).toBe(1);
  expect(await speakerOf(c, sid, line)).toBe((await narrator(c, pid)).id);
});

test("the_narrator_renames_like_any_speaker", async () => {
  // Renamed, it is still the book's narrator — the role, not the name.
  const { c } = await appClient();
  const [pid, narratorId] = await book(c);
  const r = await c.patch(`/v1/speakers/${narratorId}`, { json: { name: "Main Narrator" } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().name).toBe("Main Narrator");
  expect((await narrator(c, pid)).id).toBe(narratorId);
});

test("a_removed_narrator_stays_removed_across_a_restart", async () => {
  // There is no startup fill-in: "Add Narrator" is the one way back.
  const dir = tmpPath();
  const { c } = await appClient(dir);
  const [pid, narratorId] = await book(c);
  expect((await c.delete(`/v1/speakers/${narratorId}`)).status).toBe(200);
  const { c: again } = await appClient(dir);
  expect(await narrator(again, pid)).toBeNull();
});

test("a_deleted_book_takes_its_speakers_with_it", async () => {
  // Speakers can't outlive their book — so no leftover Narrators pile up; the persona that
  // played them stays in the library.
  const { c } = await appClient();
  const voice = (await c.post("/v1/personas", { json: { name: "Narrator" } })).json().id;
  const [pid, narratorId] = await book(c);
  expect((await c.delete(`/v1/projects/${pid}`)).status).toBe(200);
  expect((await c.patch(`/v1/speakers/${narratorId}`, { json: { name: "x" } })).status).toBe(404);
  expect(await personaIds(c)).toEqual([voice]);
});

// ── Any speaker can be the narrator (2026-09-29) ─────────────────────────────

/** An audiobook whose speakers are its Narrator plus Watson, with a chapter of narration: one
 * line on the Narrator, one on nobody, one you set, one of Watson's dialogue. */
async function bookWithWatson(c) {
  const [pid, old] = await book(c, "Band");
  const r = await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Dr. Watson" } });
  expect(r.status, r.text).toBe(201);
  const watson = r.json().id;
  const sid = (await c.post(`/v1/projects/${pid}/scenes`, { json: { title: "One" } })).json().id;

  const block = async (pos, text, speaker, source) => {
    const b = await c.post(`/v1/scenes/${sid}/blocks`, { json: { position: pos, text, speaker_id: speaker, source } });
    expect(b.status, b.text).toBe(201);
    return b.json().id;
  };

  const ids = {
    on_old: await block(0, "I had called upon my friend.", old, "narration"),
    on_none: await block(1, "It was early April.", null, "narration"),
    yours: await block(2, "He rose.", old, "corrected"),
    speech: await block(3, "“What is it?”", watson, "llm"),
  };
  return [pid, sid, old, watson, ids];
}

test("any_speaker_can_be_the_narrator", async () => {
  const { c } = await appClient();
  const [pid, sid, old, watson, ids] = await bookWithWatson(c);
  const r = await c.put(`/v1/projects/${pid}/narrator`, { json: { speaker_id: watson } });
  expect(r.status, r.text).toBe(200);
  expect(r.json().moved_lines).toBe(2);

  const roles = Object.fromEntries(r.json().speakers.map((s) => [s.id, s.role_label]));
  expect(roles[watson]).toBe("narrator");
  expect(roles[old]).toBeNull(); // still a speaker, as an ordinary one
  expect((await speakers(c, pid)).filter((s) => s.role_label === "narrator").map((s) => s.id)).toEqual([watson]);

  // Narration follows the role; a line you set stays; dialogue is untouched.
  expect(await speakerOf(c, sid, ids.on_old)).toBe(watson);
  expect(await speakerOf(c, sid, ids.on_none)).toBe(watson);
  expect(await speakerOf(c, sid, ids.yours)).toBe(old);
  expect(await speakerOf(c, sid, ids.speech)).toBe(watson);
});

test("add_narrator_never_makes_a_second_one", async () => {
  const { c } = await appClient();
  const [pid, , , watson] = await bookWithWatson(c);
  await c.put(`/v1/projects/${pid}/narrator`, { json: { speaker_id: watson } });
  const r = await c.post(`/v1/projects/${pid}/narrator`);
  expect(r.status).toBe(201);
  expect(
    r
      .json()
      .speakers.filter((s) => s.role_label === "narrator")
      .map((s) => s.id),
  ).toEqual([watson]);
});

test("the_narrator_must_be_a_speaker_of_this_book", async () => {
  const { c } = await appClient();
  const pid = await createProject(c, "Band", "audiobook");
  const other = await createProject(c, "Other", "audiobook");
  const stranger = (await c.post(`/v1/projects/${other}/speakers`, { json: { name: "Stranger" } })).json().id;
  const r = await c.put(`/v1/projects/${pid}/narrator`, { json: { speaker_id: stranger } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("isn't in this book");
});

test("choosing_the_current_narrator_changes_nothing", async () => {
  const { c } = await appClient();
  const [pid, sid, old, , ids] = await bookWithWatson(c);
  const r = await c.put(`/v1/projects/${pid}/narrator`, { json: { speaker_id: old } });
  expect(r.status).toBe(200);
  expect(r.json().moved_lines).toBe(0);
  expect(await speakerOf(c, sid, ids.on_none)).toBeNull();
});

// ── Speakers — the people in a book, and their cast ─────────────────────────

test("a_speaker_is_cast_by_giving_it_a_persona_and_uncast_by_null", async () => {
  const { c } = await appClient();
  const pid = await createProject(c, "Book", "audiobook");
  const voice = (await c.post("/v1/personas", { json: { name: "Gruff dockhand" } })).json().id;
  const sp = (
    await c.post(`/v1/projects/${pid}/speakers`, {
      json: { name: "Harbek", aliases: ["Harb", " harbek "], description: "A dock guard." },
    })
  ).json();
  expect(sp.aliases, "trimmed, de-duplicated, never the speaker's own name").toEqual(["Harb"]);
  expect(sp.persona_id).toBeNull();
  expect(sp.lines).toBe(0);
  let r = await c.patch(`/v1/speakers/${sp.id}`, { json: { persona_id: voice } });
  expect(r.json().persona_id).toBe(voice);
  expect(r.json().persona_name).toBe("Gruff dockhand");
  r = await c.patch(`/v1/speakers/${sp.id}`, { json: { persona_id: null } });
  expect(r.json().persona_id).toBeNull();
  expect((await c.patch(`/v1/speakers/${sp.id}`, { json: { persona_id: "nope" } })).status).toBe(404);
});

test("one_persona_can_play_many_speakers_and_deleting_it_uncasts_them", async () => {
  const { c } = await appClient();
  const pid = await createProject(c, "Book", "audiobook");
  const voice = (await c.post("/v1/personas", { json: { name: "Guard" } })).json().id;
  const a = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "First guard", persona_id: voice } })).json();
  const b = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Second guard", persona_id: voice } })).json();
  expect(a.persona_id).toBe(voice);
  expect(b.persona_id).toBe(voice);
  const usage = (await c.get("/v1/personas/usage")).json().usage[voice];
  expect(usage.map((u) => u.speaker_name).sort()).toEqual(["First guard", "Second guard"]);
  expect((await c.delete(`/v1/personas/${voice}`)).status).toBe(200);
  expect(new Set((await speakers(c, pid)).map((s) => s.persona_id))).toEqual(new Set([null]));
});

test("clear_cast_uncasts_every_speaker_and_keeps_them", async () => {
  const { c } = await appClient();
  const pid = await createProject(c, "Book", "audiobook");
  const voice = (await c.post("/v1/personas", { json: { name: "Guard" } })).json().id;
  for (const n of ["A", "B"]) await c.post(`/v1/projects/${pid}/speakers`, { json: { name: n, persona_id: voice } });
  const r = await c.post(`/v1/projects/${pid}/speakers/uncast`);
  expect(r.status).toBe(200);
  expect(r.json().speakers.map((s) => [s.name, s.persona_id])).toEqual([
    ["A", null],
    ["B", null],
  ]);
});

test("rewrite_in_character_reads_the_speakers_who_they_are", async () => {
  // Script's right-click Rewrite: the speaker's "Who they are" is the character (it moved off
  // the persona 2026-09-29).
  const { c } = await appClient();
  const pid = await createProject(c, "Book", "audiobook");
  const sp = (await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Mara" } })).json();
  let r = await c.post(`/v1/speakers/${sp.id}/rewrite`, { json: { text: "Hi." } });
  expect(r.status).toBe(400);
  expect(r.json().detail).toContain("Who they are");

  await c.patch(`/v1/speakers/${sp.id}`, { json: { description: "Lead detective. Dry wit." } });
  const seen = {};
  vi.spyOn(run, "runFeature").mockImplementation(async (action, variables) => {
    Object.assign(seen, { action, ...variables });
    return { text: "  Well. Hi.  ", prompt_tokens: 1, completion_tokens: 2, model: "m" };
  });
  r = await c.post(`/v1/speakers/${sp.id}/rewrite`, { json: { text: "Hi." } });
  expect(r.status, r.text).toBe(200);
  expect([r.json().original, r.json().rewritten, r.json().speaker_id]).toEqual(["Hi.", "Well. Hi.", sp.id]);
  expect(seen).toEqual({ action: "persona_rewrite", personality: "Lead detective. Dry wit.", text: "Hi." });
});
