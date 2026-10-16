// SPDX-License-Identifier: MIT
// The one-click plan's slice 4 on Alice VII–VIII, through the app's routes, with every model call
// faked (docs/plans/2026-10-11-one-click-audiobook.md §10, item 4). Accepted: "Alice VII–VIII give
// one Queen, no one with 0 lines becomes a speaker, and 'No room!' goes to the Hatter or the March
// Hare, flagged."
//
// The run's steps 1–4 and answer 7, as the run will take them: the EPUB imported (its chapters VII
// and VIII), + Add Narrator, Discover on each chapter (the model's names as gemma gave them,
// alice_fixtures.js), the names merged (the local recipe's one call answering as a model should),
// the people added, Analyze on each chapter (the model answering the key; for the five lines
// several people say, one of the group in chapter VII — as gemma did on 2026-10-16, RESEARCH
// §10.23 — and "unknown" for the soldiers), then the lines with no single speaker given out (the
// model naming the key's groups). What is checked is what the app wrote: Script's lines and flags.
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import * as gl from "../src/extraction/group_lines.js";
import * as identify from "../src/extraction/identify.js";
import { SpeakerCandidate } from "../src/extraction/identify.js";
import * as mergeNames from "../src/extraction/merge_names.js";
import { bare } from "../src/extraction/names.js";
import * as pipeline from "../src/extraction/pipeline.js";
import { ALICE, ALICE_SCANS, KEY, NEVER_SPEAK, ONE_QUEEN, VII, VIII } from "./alice_fixtures.js";
import { appClient, closeApps } from "./app_helpers.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApps();
});

const labels = (x) => [x.name, ...(x.aliases || [])].map(bare);
/** The key's cast member a book speaker is — one of its names is one of theirs, an article aside. */
const keyNameOf = (speaker) => KEY.cast.find((k) => labels(k).some((l) => labels(speaker).includes(l)))?.name ?? null;

/** The prompt's cast (`prompts.formatCharacters`) → [{handle, name, aliases}]. */
function promptCast(text) {
  return [...text.matchAll(/id="([^"]*)", name="([^"]*)"(?:[^\n]*?aliases="([^"]*)")?/g)].map((m) => ({
    handle: m[1],
    name: m[2],
    aliases: m[3] ? m[3].split(", ") : [],
  }));
}

/** Analyze's model: each [D#] the key's speaker; where the key has no one, the last of the group
 * it names (the March Hare, for the Hatter and the March Hare), else "unknown". */
async function answerFromKey(_action, variables) {
  const chapter = variables.paragraphs.includes("No room!") ? VII : VIII;
  const cast = promptCast(variables.speakers);
  const out = Object.entries(KEY.chapters[chapter]).map(([d, who]) => {
    const one = who === "unknown" ? (KEY.groups[chapter][d] ?? []).at(-1) : who;
    const hit = one ? cast.find((p) => keyNameOf(p) === one) : null;
    return { id: `D${d}`, speaker: hit ? hit.handle : "unknown", confidence: 0.95 };
  });
  return { text: JSON.stringify(out), prompt_tokens: 0, completion_tokens: 0, model: "stub" };
}

test("Alice VII–VIII: one Queen, no one with 0 lines a speaker, 'No room!' to the Hatter or the March Hare, flagged", async () => {
  const { c } = await appClient(undefined, { seed: true });
  const epub = readFileSync(path.join(ALICE, KEY.book));
  const file = { file: ["book.epub", epub, "application/epub+zip"] };
  // 1 · Import the two keyed chapters.
  const dry = await c.post("/v1/projects/import", { data: { source: "book_prose", dry_run: "true" }, files: file });
  expect(dry.status, dry.text).toBe(200);
  const keep = dry
    .json()
    .standard.scenes.map((s, i) => [s.title, i])
    .filter(([t]) => t === VII || t === VIII)
    .map(([, i]) => i);
  expect(keep.length).toBe(2);
  const imp = await c.post("/v1/projects/import", { data: { source: "book_prose", include_scenes: keep.join(",") }, files: file });
  expect(imp.status, imp.text).toBe(200);
  const pid = imp.json().project_id;
  const scenes = (await c.get(`/v1/projects/${pid}/scenes`)).json();
  expect(scenes.map((s) => s.title)).toEqual([VII, VIII]);
  expect((await c.post(`/v1/projects/${pid}/narrator`)).status).toBe(201);
  const texts = {};
  for (const s of scenes) {
    texts[s.title] = (await c.get(`/v1/scenes/${s.id}/blocks`))
      .json()
      .map((b) => b.text)
      .filter(Boolean)
      .join("\n\n");
  }

  // 2 · Discover each chapter, then merge the names.
  for (const s of scenes) {
    const scan = ALICE_SCANS.find((x) => x.title === s.title);
    vi.spyOn(identify, "identifySpeakers").mockResolvedValueOnce(scan.candidates.map((x) => new SpeakerCandidate(x)));
    expect((await c.post(`/v1/scenes/${s.id}/discover-speakers`, { json: { text: texts[s.title] } })).status).toBe(200);
  }
  vi.spyOn(mergeNames, "runFeature").mockResolvedValue({ text: JSON.stringify(ONE_QUEEN), prompt_tokens: 0, completion_tokens: 0, model: "stub" });
  const merged = (await c.post(`/v1/projects/${pid}/speakers/merge`)).json();
  expect(merged.recipe).toBe("local");

  // 3 · Add them.
  const add = await c.post(`/v1/projects/${pid}/speakers/promote`, {
    json: { candidates: merged.people.map((p) => ({ name: p.name, description: p.description, aliases: p.aliases })) },
  });
  expect(add.status, add.text).toBe(200);
  let speakers = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  // One Queen.
  expect(speakers.filter((s) => keyNameOf(s) === "Queen of Hearts").map((s) => [s.name, s.aliases])).toEqual([["Queen of Hearts", ["the Queen"]]]);
  // No one Discover counted no lines for.
  for (const n of NEVER_SPEAK) expect(speakers.map((s) => s.name)).not.toContain(n);
  // Every speaker of the key is there, once.
  const spoken = new Set(Object.values(KEY.chapters).flatMap((m) => Object.values(m)));
  for (const k of KEY.cast.filter((k) => spoken.has(k.name))) expect(speakers.filter((s) => keyNameOf(s) === k.name).length, k.name).toBe(1);

  // 4 · Analyze each chapter.
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(pipeline, "runFeature").mockImplementation(answerFromKey);
  for (const s of scenes) expect((await c.post(`/v1/scenes/${s.id}/analyze`, { json: { text: texts[s.title] } })).status).toBe(200);

  // Answer 7 · the lines with no single speaker. The model names the key's group for each.
  const groupOf = new Map(); // a line's words → the key's group
  for (const s of scenes) {
    const lines = (await c.get(`/v1/scenes/${s.id}/script`)).json().lines.filter((l) => l.spoken);
    for (const [d, group] of Object.entries(KEY.groups[s.title])) groupOf.set(lines[Number(d)].text.trim(), group);
  }
  const asked = [];
  vi.spyOn(gl, "runFeature").mockImplementation(async (_action, variables) => {
    asked.push(variables.line);
    const cast = promptCast(variables.cast);
    const group = (groupOf.get(variables.line) ?? []).map((who) => cast.find((p) => keyNameOf(p) === who)?.handle).filter(Boolean);
    return { text: JSON.stringify({ reason: "…", group, speaker: group[0] ?? "unknown" }), prompt_tokens: 0, completion_tokens: 0, model: "stub" };
  });
  const given = {};
  for (const s of scenes) {
    const r = await c.post(`/v1/scenes/${s.id}/group-lines`);
    expect(r.status, r.text).toBe(200);
    given[s.title] = r.json();
  }
  // Only the five lines several people say were asked about: the four Analyze named, their
  // narration saying "they" or "the Hatter and the March Hare", and the one it left blank.
  expect(asked.sort()).toEqual([...groupOf.keys()].sort());
  expect(given[VII]).toMatchObject({ asked: 4, given: 4, kept: 0, to_narrator: 0, left: 0 });
  expect(given[VIII]).toMatchObject({ asked: 1, given: 0, kept: 0, to_narrator: 1, left: 0 });

  // What Script now shows: every keyed line right, the group lines given and flagged.
  speakers = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  const nameOf = new Map(speakers.map((s) => [s.id, s.role_label === "narrator" ? "Narrator" : keyNameOf(s)]));
  for (const s of scenes) {
    const page = (await c.get(`/v1/scenes/${s.id}/script`)).json();
    const lines = page.lines.filter((l) => l.spoken);
    expect(lines.length).toBe(Object.keys(KEY.chapters[s.title]).length);
    expect(page.chapter.no_speaker).toBe(0);
    for (const [d, want] of Object.entries(KEY.chapters[s.title])) {
      const line = lines[Number(d)];
      const got = nameOf.get(line.speaker_id);
      if (want !== "unknown") {
        expect(got, `${s.title} D${d}`).toBe(want);
        continue;
      }
      const group = KEY.groups[s.title][d];
      // Analyze's pick (the last of the group) is kept when the answer's group holds it.
      if (group.length) expect(got, `${s.title} D${d}`).toBe(group.at(-1));
      else expect(got, `${s.title} D${d}`).toBe("Narrator");
      expect(page.flag_groups[line.flags[0]].check, `${s.title} D${d}`).toBe("group");
    }
  }
  // "No room!" — the Hatter or the March Hare, flagged.
  const vii = (await c.get(`/v1/scenes/${scenes[0].id}/script`)).json();
  const noRoom = vii.lines.find((l) => l.text.includes("No room!"));
  expect(["Hatter", "March Hare"]).toContain(nameOf.get(noRoom.speaker_id));
  expect(vii.flag_groups[noRoom.flags[0]]).toMatchObject({ check: "group" });

  // Every speaker has lines now — but the Knave, whom Discover counted 1 line for and the book
  // gives none: the count is Discover's, not the text's (RESEARCH §10.4).
  const silent = speakers.filter((s) => !s.lines).map((s) => s.name);
  expect(silent).toEqual(["the Knave"]);
});
