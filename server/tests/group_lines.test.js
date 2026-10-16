// SPDX-License-Identifier: MIT
// Lines with no single speaker — the one-click plan's answer 7 (slice 4): "the AI gives a group
// line to one member of the group the text names ("they" = the Hatter and the March Hare → one of
// them), or to the narrator when it's unclear, and flags it."
//
// What these pin: the answer's group is cast members only, each once, and the line goes to the one
// it chose — else the first it named, else the narrator, else (no narrator) nowhere; a failed
// question leaves its line, no model at all stops the step; Script marks every given line "group";
// through the app, only lines Analyze left blank are asked about — never a line you set — a
// chapter never analyzed is refused, and a re-analyze clears the record. The main pass is
// `pipeline.runFeature` (its measure stubbed to "can't say"); the question is
// `group_lines.runFeature`.
import { LLMNotConfiguredError } from "@delebash/llm-runner/llm";
import { afterEach, describe, expect, test, vi } from "vitest";
import { Line, flagGroups } from "../src/extraction/flags.js";
import * as gl from "../src/extraction/group_lines.js";
import { decide } from "../src/extraction/group_lines.js";
import * as pipeline from "../src/extraction/pipeline.js";
import { appClient, closeApps } from "./app_helpers.js";
import { bookJson, scene } from "./jw_fixtures.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await closeApps();
});

const ids = { hatter: "id-hatter", march_hare: "id-hare", alice: "id-alice", narrator: "narrator" };
const resolve = (raw) => ids[raw] ?? "unknown";

describe("who gets the line", () => {
  test("one of the group the answer named — its pick when that is one of them", () => {
    expect(decide({ group: ["hatter", "march_hare"], speaker: "march_hare" }, resolve, "id-narr")).toEqual({ speaker: "id-hare", group: ["id-hatter", "id-hare"] });
    expect(decide({ group: ["hatter", "march_hare"], speaker: "alice" }, resolve, "id-narr")).toEqual({ speaker: "id-hatter", group: ["id-hatter", "id-hare"] });
    expect(decide({ group: ["hatter", "hatter", "nobody", "narrator"], speaker: "unknown" }, resolve, "id-narr")).toEqual({ speaker: "id-hatter", group: ["id-hatter"] });
  });

  test("no one the text makes clear: the narrator, or nowhere when the book has none", () => {
    expect(decide({ group: [], speaker: "unknown" }, resolve, "id-narr")).toEqual({ speaker: "id-narr", group: [] });
    expect(decide({}, resolve, "id-narr")).toEqual({ speaker: "id-narr", group: [] });
    expect(decide({ group: "hatter" }, resolve, null)).toEqual({ speaker: null, group: [] });
  });

  test("the question: the line marked in the text around it, and the cast", async () => {
    const calls = [];
    vi.spyOn(gl, "runFeature").mockImplementation(async (action, variables) => {
      calls.push([action, variables]);
      return { text: '{"reason": "they = the two", "group": ["hatter", "march_hare"], "speaker": "hatter"}', prompt_tokens: 50, completion_tokens: 9, model: "gemma" };
    });
    const usage = { prompt_tokens: 0, completion_tokens: 0, model: "" };
    const paragraphs = ["The Hatter and the March Hare were having tea.", "“No room! No room!” they cried out."];
    const got = await gl.askLine({ paragraph_idx: 1, text: "No room! No room!" }, paragraphs, {
      castText: '- id="hatter", name="Hatter"',
      resolve,
      narratorId: "id-narr",
      words: 1500,
      usage,
    });
    expect(got).toEqual({ speaker: "id-hatter", group: ["id-hatter", "id-hare"], model: "gemma" });
    expect(calls[0][0]).toBe("speaker_group");
    expect(calls[0][1].chapter).toContain("“⟦No room! No room!⟧” they cried out.");
    expect(calls[0][1].chapter).toContain("were having tea");
    expect(calls[0][1].line).toBe("No room! No room!");
    expect(calls[0][1].cast).toBe('- id="hatter", name="Hatter"');
    expect(usage).toEqual({ prompt_tokens: 50, completion_tokens: 9, model: "gemma" });
  });

  test("a failed question leaves its line; no model at all stops the step", async () => {
    const kw = { castText: "", resolve, narratorId: "id-narr", words: 50, usage: { prompt_tokens: 0, completion_tokens: 0, model: "" } };
    vi.spyOn(gl, "runFeature").mockRejectedValueOnce(new Error("timeout"));
    expect(await gl.askLine({ paragraph_idx: 0, text: "Hi." }, ["Hi."], kw)).toBeNull();
    vi.spyOn(gl, "runFeature").mockRejectedValueOnce(new LLMNotConfiguredError("no LLM provider registered"));
    await expect(gl.askLine({ paragraph_idx: 0, text: "Hi." }, ["Hi."], kw)).rejects.toBeInstanceOf(LLMNotConfiguredError);
  });
});

describe("Script's mark", () => {
  const say = (i, who, { group = null, source = "llm" } = {}) => new Line({ id: `d${i}`, speaker: who, text: "“Line.”", spoken: true, source, paragraph: i, group });

  test("every line given this way is marked, first, with another of the group", () => {
    const groups = flagGroups([say(0, "hatter", { group: ["hatter", "hare"] }), say(1, "narrator", { group: [] }), say(2, "alice"), say(3, "alice")], new Set(["hatter", "hare", "alice", "narrator"]));
    expect(groups.filter((g) => g.check === "group").map((g) => [g.speaker, g.lines, g.other])).toEqual([
      ["hatter", ["d0"], "hare"],
      ["narrator", ["d1"], null],
    ]);
    // First of the line's marks — the question Script asks of it (the hatter's only line too).
    expect(groups.filter((g) => g.lines.includes("d0")).map((g) => g.check)).toEqual(["group", "only"]);
  });

  test("a line you set is never marked", () => {
    expect(flagGroups([say(0, "hare", { group: ["hatter", "hare"], source: "corrected" })], new Set(["hare"]))).toEqual([]);
  });
});

// ── Through the app ────────────────────────────────────────────────────────

const P1 = "Mara and Renn sat by the fire.";
const P2 = "“Not again!” they cried together.";
const P3 = "“Again,” said Renn.";
const P4 = "“Who goes there?”";

/** A one-chapter book, Renn added beside Mara, the narrator, and the chapter's text. */
async function setup({ narrator = true } = {}) {
  const { c } = await appClient(undefined, { seed: true });
  const r = await c.post("/v1/projects/import?source=justwrite", { json: bookJson({ chapters: [["ch1", "One", [scene("scn1", P1, P2, P3, P4)]]] }) });
  expect(r.status, r.text).toBe(200);
  const pid = r.json().project_id;
  const sid = (await c.get(`/v1/projects/${pid}/scenes`)).json()[0].id;
  expect((await c.post(`/v1/projects/${pid}/speakers`, { json: { name: "Renn" } })).status).toBe(201);
  if (narrator) expect((await c.post(`/v1/projects/${pid}/narrator`)).status).toBe(201);
  const speakers = Object.fromEntries((await c.get(`/v1/projects/${pid}/speakers`)).json().speakers.map((s) => [s.name, s.id]));
  return { c, pid, sid, speakers, text: [P1, P2, P3, P4].join("\n\n") };
}

/** Analyze with a model that places no one: the group line and the untagged one stay blank. */
async function analyze(c, sid, text) {
  vi.spyOn(pipeline, "measureFeature").mockResolvedValue(null);
  vi.spyOn(pipeline, "runFeature").mockResolvedValue({ text: "[]", prompt_tokens: 0, completion_tokens: 0, model: "stub" });
  const r = await c.post(`/v1/scenes/${sid}/analyze`, { json: { text } });
  expect(r.status, r.text).toBe(200);
}

/** The question answers by the line: the group line is Mara and Renn's, the other no one's. */
function stubQuestion(calls = []) {
  return vi.spyOn(gl, "runFeature").mockImplementation(async (action, variables) => {
    calls.push(variables.line);
    const ans = variables.line.includes("Not again") ? { group: ["mara_vance", "renn"], speaker: "renn" } : { group: [], speaker: "unknown" };
    return { text: JSON.stringify({ reason: "…", ...ans }), prompt_tokens: 40, completion_tokens: 8, model: "gemma" };
  });
}

const spokenLines = async (c, sid) => (await c.get(`/v1/scenes/${sid}/script`)).json();

test("a group line goes to one of the group, an unclear one to the narrator, both marked to check", async () => {
  const { c, sid, speakers, text } = await setup();
  await analyze(c, sid, text);
  const calls = [];
  stubQuestion(calls);
  const r = await c.post(`/v1/scenes/${sid}/group-lines`);
  expect(r.status, r.text).toBe(200);
  const got = r.json();
  expect(calls).toEqual(["“Not again!”", "“Who goes there?”"]);
  expect(got).toMatchObject({ asked: 2, given: 1, to_narrator: 1, left: 0, failed: 0 });
  expect(got.usage).toMatchObject({ prompt_tokens: 80, completion_tokens: 16, model: "gemma", pieces: 2 });

  const page = await spokenLines(c, sid);
  const line = (words) => page.lines.find((l) => l.text.includes(words));
  const group = line("Not again");
  expect(group).toMatchObject({ speaker_id: speakers.Renn, source: "llm", confidence: null });
  expect(group.metadata.group_line).toEqual({ group: [speakers["Mara Vance"], speakers.Renn], model: "gemma" });
  expect(page.flag_groups[group.flags[0]]).toMatchObject({ check: "group", speaker: speakers.Renn, other: speakers["Mara Vance"] });
  const unclear = line("Who goes there");
  expect(unclear.speaker_id).toBe(speakers.Narrator);
  expect(page.flag_groups[unclear.flags[0]]).toMatchObject({ check: "group", speaker: speakers.Narrator, other: null });
  // Both count as To check; nothing is left that can't render.
  expect(page.chapter.no_speaker).toBe(0);
  expect(page.chapter.to_check).toBeGreaterThanOrEqual(2);

  // Asked again: nothing is left with no speaker, so nothing is asked.
  const again = await c.post(`/v1/scenes/${sid}/group-lines`);
  expect(again.json()).toMatchObject({ asked: 0, given: 0 });
  expect(calls.length).toBe(2);

  // A re-analyze decides the lines again and drops the record.
  await analyze(c, sid, text);
  const after = (await spokenLines(c, sid)).lines.find((l) => l.text.includes("Not again"));
  expect(after.speaker_id).toBeNull();
  expect(after.metadata.group_line).toBeUndefined();
});

test("a line you set is never asked about; with no narrator an unclear line stays blank", async () => {
  const { c, sid, speakers, text } = await setup({ narrator: false });
  await analyze(c, sid, text);
  const before = await spokenLines(c, sid);
  const mine = before.lines.find((l) => l.text.includes("Not again"));
  expect((await c.patch(`/v1/blocks/${mine.id}`, { json: { speaker_id: speakers["Mara Vance"], source: "corrected" } })).status).toBe(200);
  const calls = [];
  stubQuestion(calls);
  const got = (await c.post(`/v1/scenes/${sid}/group-lines`)).json();
  expect(calls).toEqual(["“Who goes there?”"]);
  expect(got).toMatchObject({ asked: 1, given: 0, to_narrator: 0, left: 1 });
  const page = await spokenLines(c, sid);
  expect(page.lines.find((l) => l.text.includes("Who goes there")).speaker_id).toBeNull();
  expect(page.lines.find((l) => l.text.includes("Not again")).speaker_id).toBe(speakers["Mara Vance"]);
});

test("a chapter never analyzed is refused; no model is a 501", async () => {
  const { c, sid, text } = await setup();
  const spy = stubQuestion();
  let r = await c.post(`/v1/scenes/${sid}/group-lines`);
  expect(r.status).toBe(409);
  expect(r.text).toContain("Analyze this chapter first");
  expect(spy).not.toHaveBeenCalled();
  await analyze(c, sid, text);
  vi.spyOn(gl, "runFeature").mockRejectedValue(new LLMNotConfiguredError("no LLM provider registered"));
  r = await c.post(`/v1/scenes/${sid}/group-lines`);
  expect(r.status).toBe(501);
  expect((await c.post("/v1/scenes/nope/group-lines")).status).toBe(404);
});
