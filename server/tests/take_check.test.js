// SPDX-License-Identifier: MIT
// Check the takes — the one-click plan's slice 6 (2026-10-16; take_check.js).
//
// Pins: Whisper's basic normaliser as upstream writes it; the read-back's missed and extra words;
// the verdict's thresholds (settings.take_check) and the runaway limit (the speech runtime's);
// the step itself — every take in use read back, a failed one rendered again ONCE with a new
// seed in one render job, read back again, flagged when it still fails — written to the line's
// metadata so a second run skips what was judged; and POST /v1/scenes/{id}/check_takes.
//
// The speech model and the recogniser are faked as line_takes.test.js fakes the speech model:
// renderCore.renderLine makes a short sound that records the real inputs key (its length follows
// the text, or `long` for a runaway), the Transcription feature is ready (kit_speech.js
// `transcriptionReadiness`), and captures._sttTranscribe answers from a script per line.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { stores } from "@delebash/core/llm";
import { sleep } from "@delebash/core/platform/asyncutil";
import { endState, useState } from "./engines_helpers.js";
import * as captures from "../src/api/captures_api.js";
import { router as renderLinesRouter } from "../src/api/render_lines_api.js";
import { Generation, Take } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import * as kitSettings from "../src/engines/audiocpp/kit_settings.js";
import * as kitSpeech from "../src/engines/audiocpp/kit_speech.js";
import * as lineTakes from "../src/line_takes.js";
import { mediaFile } from "../src/media_paths.js";
import * as renderCore from "../src/render_core.js";
import { lineInputsKey, RenderedLine } from "../src/render_core.js";
import * as renderJobs from "../src/render_jobs.js";
import * as takeCheck from "../src/take_check.js";
import { BasicTextNormalizer, removeSymbolsAndDiacritics } from "../src/whisper_normalizer.js";
import { inject as request } from "./helpers.js";
import { book, renderBlock, unwrap, viaRoutes } from "./render_helpers.js";

const h = () => session.getDb();

let st;
let renders;
let heardScript; // block id → transcripts, one per read-back, in order
let heardCalls;
let stt; // the recogniser's spy
let sttReady; // the Transcription feature's readiness
const long = new Set(); // texts whose next render runs away (40 s)

beforeEach(() => {
  st = useState();
  renders = [];
  heardScript = new Map();
  heardCalls = [];
  long.clear();
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (s, kw) => {
    const { voice, text } = kw;
    renders.push({ text, seed: kw.seed ?? null });
    const key = await lineInputsKey(s, voice, text, {
      language: kw.language,
      delivery: kw.delivery,
      seed: kw.seed,
      lexicons: kw.lexicons,
      effects: kw.effects,
    });
    const frames = long.has(text) ? 16000 * 40 : 100 * [...text].length;
    if (long.has(text)) long.delete(text);
    return new RenderedLine({ pcm: Buffer.alloc(2 * frames), sampleRate: 16000, channels: 1, effectiveDelivery: {}, inputsKey: key || "", seed: kw.seed ?? null });
  });
  // The recogniser: the Transcription feature's model, ready, and hearing what each line's script
  // says (the line's own words when the script has run out).
  sttReady = vi.spyOn(kitSpeech, "transcriptionReadiness").mockReturnValue({ ready: true, need: "", detail: "", model: "qwen3-asr-1.7b-q8" });
  stt = vi.spyOn(captures, "_sttTranscribe").mockImplementation(async (file, language) => {
    const gen = h()
      .all(`select * from ${Generation}`, [], Generation)
      .find((g) => g.audio_path && mediaFile(g.audio_path) === file);
    heardCalls.push({ block: gen.block_id, language });
    const script = heardScript.get(gen.block_id) ?? [];
    return script.length ? script.shift() : gen.text;
  });
});

afterEach(async () => {
  for (let i = 0; i < 100 && renderJobs._running.size; i++) await sleep(10);
  endState();
});

const meta = (blockId) => lineTakes.blockMeta(h().get("blocks", blockId));
const record = (blockId) => unwrap(meta(blockId)[lineTakes.TAKE_CHECK] ?? null);
const takes = (blockId) => h().all(`select * from ${Take} where block_id = ? order by created_at`, [blockId], Take);
const liveGen = (blockId) => lineTakes.liveTakes(h(), [blockId]).get(blockId)[1];

// ── Whisper's basic normaliser ───────────────────────────────────────────

test("whisper_basic_normaliser_as_upstream", () => {
  const n = new BasicTextNormalizer();
  // Punctuation and symbols become spaces; case goes; runs of whitespace become one space.
  expect(n.normalize("Hello, World!")).toBe("hello world ");
  // Words in brackets and in parentheses go (a performed tag, an aside).
  expect(n.normalize("[laugh] Hi (aside) there.")).toBe(" hi there ");
  // An apostrophe and a dash are punctuation: a curly and a straight one read alike.
  expect(n.normalize("Don’t—I don't")).toBe("don t i don t");
  // Diacritics stay (remove_symbols, NFKC); the diacritics option drops them.
  expect(n.normalize("Café")).toBe("café");
  expect(removeSymbolsAndDiacritics("Café œuvre")).toBe("Cafe oeuvre");
  expect(new BasicTextNormalizer({ splitLetters: true }).normalize("你好")).toBe("你 好");
});

// ── the read-back and the verdict ────────────────────────────────────────

test("read_back_counts_missed_and_extra_words", () => {
  expect(takeCheck.readBack("The Queen said, “Off with her head!”", "the queen said off with her head")).toEqual({ words: 7, missed: 0, extra: 0 });
  // Skipped words are missed.
  expect(takeCheck.readBack("one two three four five six", "one two six")).toEqual({ words: 6, missed: 3, extra: 0 });
  // A repeat, or a take that runs on, is extra.
  expect(takeCheck.readBack("No room! No room!", "No room no room no room no room")).toEqual({ words: 4, missed: 0, extra: 4 });
  // A word heard as another is missed, not extra; past it, the rest is extra.
  expect(takeCheck.readBack("He visited Worcester today", "he visited wooster today")).toEqual({ words: 4, missed: 1, extra: 0 });
  expect(takeCheck.readBack("Hello there.", "hello where and so on")).toEqual({ words: 2, missed: 1, extra: 3 });
  // Nothing heard: every word missed.
  expect(takeCheck.readBack("Hello there.", "")).toEqual({ words: 2, missed: 2, extra: 0 });
});

test("the_verdict_follows_the_settings", () => {
  const limits = { missedShare: 0.2, extraShare: 0.2, minWords: 2, runawayS: 30 };
  const judge = (text, heard, seconds = 1, l = limits) => takeCheck.judgeTake({ text, heard, seconds, limits: l });
  expect(judge("one two three four five six seven eight nine ten", "one two three four five six seven eight nine ten").ok).toBe(true);
  // One word misheard in ten is under both limits.
  expect(judge("one two three four five six seven eight nine ten", "one two three four five six seven eight nine tin").ok).toBe(true);
  // Three of ten missed: more than 20 % and at least 2.
  expect(judge("one two three four five six seven eight nine ten", "one two three four five six seven").reasons).toEqual(["missed"]);
  // One word of a two-word line missed is 50 %, but fewer than min_words.
  expect(judge("Hello there.", "hello").ok).toBe(true);
  expect(judge("No room!", "no room no room").reasons).toEqual(["extra"]);
  // Too long for its text, whatever was heard.
  expect(judge("Hello there.", "hello there", 31).reasons).toEqual(["runaway"]);
  expect(judge("Hello there.", "hello there and on and on", 45).reasons).toEqual(["runaway", "extra"]);
  // Not read back (it ran away): judged by its length, missed and extra unknown.
  expect(takeCheck.judgeTake({ text: "Hello there.", heard: null, seconds: 45, limits })).toEqual({
    ok: false,
    reasons: ["runaway"],
    words: 2,
    missed: null,
    extra: null,
  });
  // A line with no words left (a lone tag) is judged by its length only.
  expect(judge("[laugh]", "ha ha ha").ok).toBe(true);
  // A share raised by the user lets the take through.
  expect(judge("one two three four five six seven eight nine ten", "one two three four five six seven", 1, { ...limits, missedShare: 0.5 }).ok).toBe(true);
});

test("the_limits_live_in_settings", () => {
  const s = st.settings.get();
  expect(unwrap(s.take_check)).toEqual({ missed_share: 0.2, extra_share: 0.2, min_words: 2 });
  expect(takeCheck.limitsFor(s, "x".repeat(10)).runawayS).toBe(30);
  expect(takeCheck.limitsFor(s, "x".repeat(100)).runawayS).toBe(50); // 0.5 s a character
  // the runaway limit is the speech runtime's — the kit's runner settings, the rule it prices models by
  st.settings.patch({ take_check: { missed_share: 0.35 } });
  stores.getRunnerConfigStore().setSetting("runaway_min_s:audiocpp", "10");
  const l = takeCheck.limitsFor(st.settings.get(), "x".repeat(10));
  expect([l.missedShare, l.extraShare, l.minWords, l.runawayS]).toEqual([0.35, 0.2, 2, 10]);
  expect(kitSettings.runawayLimitS("x".repeat(10))).toBe(10);
});

// ── the step ─────────────────────────────────────────────────────────────

test("a_failed_take_is_rendered_again_once_then_flagged", async () => {
  const b = book(st, ["Good line here.", "No room! No room!", "One two three four five six."]);
  const [good, repeats, skips] = b.blocks;
  for (const id of b.blocks) await renderBlock(st, id);
  const firstOf = Object.fromEntries(b.blocks.map((id) => [id, liveGen(id).id]));
  // The repeat runs on both times; the skip is fixed by its re-render.
  heardScript.set(repeats, ["no room no room no room no room", "no room no room no room"]);
  heardScript.set(skips, ["one two six"]);
  renders.length = 0;

  const out = await takeCheck.checkTakes(st, [b.sid]);
  expect(out).toMatchObject({ recogniser: "qwen3-asr-1.7b-q8", checked: 5, passed: 2, rerendered: 2, flagged: 1, skipped: 0, unchecked: 0, stopped: false });
  expect(out.errors).toEqual([]);
  // One render each for the two failures, each with a seed of its own.
  expect(renders.map((r) => r.text)).toEqual(["No room! No room!", "One two three four five six."]);
  expect(renders.every((r) => Number.isInteger(r.seed))).toBe(true);
  // The recogniser was told each line's language.
  expect(heardCalls.every((c) => c.language === "en-US")).toBe(true);

  expect(takes(good).length).toBe(1);
  expect(record(good)).toMatchObject({ generation_id: firstOf[good], ok: true, flagged: false, reasons: [], words: 3, missed: 0, extra: 0, retry_of: null });

  // The repeat: re-rendered once as ↻ New take does, still failing — flagged.
  expect(takes(repeats).length).toBe(2);
  const again = liveGen(repeats);
  expect(again.source).toBe(lineTakes.NEW_TAKE);
  expect(record(repeats)).toMatchObject({ generation_id: again.id, ok: false, flagged: true, reasons: ["extra"], heard: "no room no room no room", retry_of: firstOf[repeats] });

  // The skip: its re-render passes.
  expect(takes(skips).length).toBe(2);
  expect(record(skips)).toMatchObject({ generation_id: liveGen(skips).id, ok: true, flagged: false, retry_of: firstOf[skips] });
  expect(out.lines.map((l) => [l.block_id, l.check.ok, l.check.flagged])).toEqual([
    [good, true, false],
    [repeats, false, true],
    [skips, true, false],
  ]);
  // The new takes read "rendered": a new take is judged against its own seed.
  expect((await lineTakes.sceneLines(h(), st, b.sid)).lines.map((l) => l.state)).toEqual(["rendered", "rendered", "rendered"]);

  // A second run judges nothing again and renders nothing.
  heardCalls.length = 0;
  renders.length = 0;
  const second = await takeCheck.checkTakes(st, [b.sid]);
  expect(second).toMatchObject({ checked: 0, skipped: 3, rerendered: 0, flagged: 0 });
  expect(heardCalls).toEqual([]);
  expect(renders).toEqual([]);
});

test("a_runaway_take_is_rendered_again_once_and_flagged", async () => {
  // The plan's acceptance (§10 item 6): a take that runs on past its text — here 40 s for 14
  // characters, past the 30 s floor — is rendered again once, and flagged when it runs away again.
  const b = book(st, ["Hello, Hatter."]);
  const [line] = b.blocks;
  long.add("Hello, Hatter.");
  await renderBlock(st, line);
  long.add("Hello, Hatter.");
  const out = await takeCheck.checkTakes(st, [b.sid]);
  expect(out).toMatchObject({ checked: 2, rerendered: 1, flagged: 1, passed: 0 });
  expect(takes(line).length).toBe(2);
  // A runaway fails by its length and is not read back.
  expect(heardCalls).toEqual([]);
  expect(record(line)).toMatchObject({ ok: false, flagged: true, reasons: ["runaway"], seconds: 40, limit_s: 30, heard: null, missed: null, recogniser: null });
});

test("a_runaway_fixed_by_its_rerender_passes", async () => {
  const b = book(st, ["Hello, Hatter."]);
  const [line] = b.blocks;
  long.add("Hello, Hatter.");
  await renderBlock(st, line);
  const out = await takeCheck.checkTakes(st, [b.sid]);
  expect(out).toMatchObject({ checked: 2, rerendered: 1, flagged: 0, passed: 1 });
  expect(heardCalls.length).toBe(1); // the re-render only
  expect(record(line)).toMatchObject({ ok: true, flagged: false, reasons: [], heard: "Hello, Hatter.", recogniser: "qwen3-asr-1.7b-q8" });
});

test("no_speech_recognition_stops_the_check_with_its_words", async () => {
  const b = book(st, ["One."]);
  await renderBlock(st, b.blocks[0]);
  sttReady.mockReturnValue({ ready: false, need: "engine-not-installed", detail: "", model: "qwen3-asr-1.7b-q8" });
  await expect(takeCheck.checkTakes(st, [b.sid])).rejects.toMatchObject({ statusCode: 400 });
  expect(record(b.blocks[0])).toBeNull();
  // a model not downloaded yet is no reason to stop: its first read-back's load downloads it
  sttReady.mockReturnValue({ ready: false, need: "model-not-downloaded", detail: "", model: "qwen3-asr-1.7b-q8" });
  expect((await takeCheck.checkTakes(st, [b.sid])).checked).toBe(1);
});

test("only_lines_with_a_current_take_are_checked", async () => {
  const b = book(st, ["One.", "Two.", "Three."]);
  const [one, two] = b.blocks;
  await renderBlock(st, one);
  await renderBlock(st, two);
  h().update("blocks", { text: "Two, changed." }, { id: two }); // stale now
  const out = await takeCheck.checkTakes(st, [b.sid]);
  expect(out).toMatchObject({ checked: 1, passed: 1, unchecked: 2 });
  expect(record(two)).toBeNull();
});

test("a_rerender_owed_from_a_stopped_run_is_made_without_reading_again", async () => {
  // A run stopped after it judged a take and before its re-render: the next run renders it.
  const b = book(st, ["One two three four."]);
  const [line] = b.blocks;
  await renderBlock(st, line);
  const failed = liveGen(line).id;
  const m = meta(line);
  m[lineTakes.TAKE_CHECK] = { generation_id: failed, ok: false, flagged: false, reasons: ["missed"] };
  h().update("blocks", { metadata_json: JSON.stringify(m) }, { id: line });
  const out = await takeCheck.checkTakes(st, [b.sid]);
  expect(out).toMatchObject({ checked: 1, rerendered: 1, passed: 1 });
  expect(heardCalls.length).toBe(1); // only the new take was read
  expect(record(line)).toMatchObject({ ok: true, retry_of: failed });
});

test("a_take_made_after_a_failure_is_its_one_retry", async () => {
  // A failed take, then a new take made by anyone (↻ New take): that take is the retry, so if it
  // fails too it is flagged, not rendered again.
  const b = book(st, ["One two three four."]);
  const [line] = b.blocks;
  await renderBlock(st, line);
  const failed = liveGen(line).id;
  const m = meta(line);
  m[lineTakes.TAKE_CHECK] = { generation_id: failed, ok: false, flagged: false, reasons: ["missed"] };
  h().update("blocks", { metadata_json: JSON.stringify(m) }, { id: line });
  await renderBlock(st, line, { newTake: true });
  heardScript.set(line, ["one"]);
  renders.length = 0;
  const out = await takeCheck.checkTakes(st, [b.sid]);
  expect(out).toMatchObject({ checked: 1, rerendered: 0, flagged: 1 });
  expect(renders).toEqual([]);
  expect(record(line)).toMatchObject({ ok: false, flagged: true, retry_of: failed, reasons: ["missed"] });
});

test("redo_judges_again", async () => {
  const b = book(st, ["One two three four."]);
  const [line] = b.blocks;
  await renderBlock(st, line);
  await takeCheck.checkTakes(st, [b.sid]);
  expect(record(line).ok).toBe(true);
  heardScript.set(line, ["one", "one two three four"]);
  const out = await takeCheck.checkTakes(st, [b.sid], { redo: true });
  expect(out).toMatchObject({ checked: 2, rerendered: 1, passed: 1, skipped: 0 });
});

test("a_take_the_recogniser_fails_on_is_listed_and_left", async () => {
  const b = book(st, ["One.", "Two."]);
  const [one, two] = b.blocks;
  for (const id of b.blocks) await renderBlock(st, id);
  const real = stt.getMockImplementation();
  stt.mockImplementation(async (file, language) => {
    const gen = h()
      .all(`select * from ${Generation}`, [], Generation)
      .find((g) => mediaFile(g.audio_path) === file);
    if (gen.block_id === one) throw new Error("engine transcribe failed: boom");
    return real(file, language);
  });
  const out = await takeCheck.checkTakes(st, [b.sid]);
  expect(out).toMatchObject({ checked: 1, passed: 1 });
  expect(out.errors).toEqual([{ block_id: one, error: "engine transcribe failed: boom" }]);
  expect(record(one)).toBeNull();
  expect(record(two).ok).toBe(true);
});

test("a_chapter_is_checked_once_at_a_time", async () => {
  const b = book(st, ["One."]);
  await renderBlock(st, b.blocks[0]);
  let release;
  const gate = new Promise((r) => {
    release = r;
  });
  const real = stt.getMockImplementation();
  stt.mockImplementation(async (...a) => {
    await gate;
    return real(...a);
  });
  const first = takeCheck.checkTakes(st, [b.sid]);
  await sleep(20);
  await expect(takeCheck.checkTakes(st, [b.sid])).rejects.toMatchObject({ statusCode: 409 });
  release();
  expect((await first).passed).toBe(1);
});

test("stopping_keeps_what_was_found", async () => {
  const b = book(st, ["One.", "Two."]);
  for (const id of b.blocks) await renderBlock(st, id);
  const ctl = new AbortController();
  const real = stt.getMockImplementation();
  stt.mockImplementation(async (...a) => {
    ctl.abort();
    return real(...a);
  });
  const out = await takeCheck.checkTakes(st, [b.sid], { signal: ctl.signal });
  expect(out).toMatchObject({ checked: 1, stopped: true });
  expect(record(b.blocks[0]).ok).toBe(true);
  expect(record(b.blocks[1])).toBeNull();
});

// ── the route, and Render's line page ────────────────────────────────────

test("check_takes_route_and_the_finding_on_render_lines", async () => {
  const b = book(st, ["One two three.", "Four five six."]);
  for (const id of b.blocks) await renderBlock(st, id);
  heardScript.set(b.blocks[1], ["four", "four"]);
  await viaRoutes([renderLinesRouter], async (app) => {
    const send = async (method, url, json) => {
      const r = await request(app, { method, url, ...(json !== undefined ? { payload: json } : {}) });
      return { status: r.statusCode, json: () => JSON.parse(r.body) };
    };
    const r = await send("POST", `/v1/scenes/${b.sid}/check_takes`, {});
    expect(r.status).toBe(200);
    expect(r.json()).toMatchObject({ scene_ids: [b.sid], checked: 3, passed: 1, rerendered: 1, flagged: 1 });
    const page = (await send("GET", `/v1/scenes/${b.sid}/render_lines`)).json();
    expect(page.lines[0].check).toMatchObject({ ok: true, flagged: false });
    expect(page.lines[1].check).toMatchObject({ ok: false, flagged: true, reasons: ["missed"], heard: "four", missed: 2 });
    expect(page.lines[1].check.generation_id).toBe(page.lines[1].live.generation_id);
    expect((await send("POST", "/v1/scenes/nope/check_takes", {})).status).toBe(404);
  });
});

test("a_record_about_an_older_take_is_not_shown", async () => {
  const b = book(st, ["One two three."]);
  await renderBlock(st, b.blocks[0]);
  await takeCheck.checkTakes(st, [b.sid]);
  await renderBlock(st, b.blocks[0], { newTake: true });
  const page = await lineTakes.sceneLines(h(), st, b.sid);
  expect(page.lines[0].check).toBeNull();
});
