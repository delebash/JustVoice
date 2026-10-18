// SPDX-License-Identifier: MIT
// The one-click audiobook's run — the one-click plan's slice 5 (book_run.js, api/book_runs_api.js).
// Accepted: "Alice VII from one press to an M4B, the time and the token count written down;
// resumes after a restart."
//
// Everything that would need the graphics card is faked as the slices' own tests fake it: the
// language model is `run.runFeature` (answering Analyze from the answer key, as
// one_click_alice.test.js does) and Discover's call `identify.identifySpeakers` (gemma's scan,
// alice_fixtures.js); the speech model is `voice_preview_api.synthCandidate` for the designed
// voices (book_voices.test.js) and `render_core.renderLine` for the takes (take_check.test.js);
// speech recognition `captures._sttTranscribe`; the M4B the chapter join and ffmpeg
// (export_audiobook.test.js). Everything between them is the real app: the run, its table, its
// routes, every step's function, the render job, the take check and the export job.
import { readFileSync } from "node:fs";
import path from "node:path";
import { sleep } from "@delebash/core/platform/asyncutil";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import * as captures from "../src/api/captures_api.js";
import * as renderChapterApi from "../src/api/render_chapter_api.js";
import * as vp from "../src/api/voice_preview_api.js";
import { writeWavContainer } from "../src/audio/wav.js";
import * as bookRun from "../src/book_run.js";
import { ACTIONS as VOICE_ACTIONS } from "../src/book_voices/prompts.js";
import { BookRun, Generation } from "../src/database/models.js";
import * as session from "../src/database/session.js";
import * as run from "../src/engines/llm/run.js";
import * as exportAudiobook from "../src/export_audiobook.js";
import * as identify from "../src/extraction/identify.js";
import { SpeakerCandidate } from "../src/extraction/identify.js";
import { bare } from "../src/extraction/names.js";
import { mediaFile } from "../src/media_paths.js";
import * as renderCore from "../src/render_core.js";
import { lineInputsKey, RenderedLine } from "../src/render_core.js";
import * as renderJobs from "../src/render_jobs.js";
import { ALICE, ALICE_SCANS, KEY, VII } from "./alice_fixtures.js";
import { appClient, closeApps } from "./app_helpers.js";

const h = () => session.getDb();

/** The language model's answers, counted by action. */
let calls;
/** While set, the fake model waits here — a server that dies mid-step never comes back. */
let hang;
/** A line whose every read-back hears nothing — the take check flags it. */
let deafTo;

const labels = (x) => [x.name, ...(x.aliases || [])].map(bare);
const keyNameOf = (speaker) => KEY.cast.find((k) => labels(k).some((l) => labels(speaker).includes(l)))?.name ?? null;

/** A prompt's cast (`prompts.formatCharacters`) → [{handle, name, aliases}]. */
function promptCast(text) {
  return [...String(text).matchAll(/id="([^"]*)", name="([^"]*)"(?:[^\n]*?aliases="([^"]*)")?/g)].map((m) => ({
    handle: m[1],
    name: m[2],
    aliases: m[3] ? m[3].split(", ") : [],
  }));
}

const usage = { prompt_tokens: 1000, completion_tokens: 50, model: "gemma-test" };
const answer = (obj) => ({ text: JSON.stringify(obj), ...usage });

/** One fake model for every AI step of the run, answering as a model should. */
async function fakeModel(action, variables) {
  calls[action] = (calls[action] ?? 0) + 1;
  if (hang) await hang;
  if (action.startsWith("speaker_attribution.")) {
    // Analyze: each [D#] the key's speaker, "unknown" where several speak.
    const cast = promptCast(variables.speakers);
    return answer(
      Object.entries(KEY.chapters[VII]).map(([d, who]) => {
        const hit = who === "unknown" ? null : cast.find((p) => keyNameOf(p) === who);
        return { id: `D${d}`, speaker: hit ? hit.handle : "unknown", confidence: 0.95 };
      }),
    );
  }
  if (action.startsWith("speaker_merge.")) return answer({ people: [] });
  if (action === "speaker_group") {
    // Every group line of VII is the Hatter's and the March Hare's (the key's `groups`).
    const cast = promptCast(variables.cast);
    const group = ["Hatter", "March Hare"].map((n) => cast.find((p) => keyNameOf(p) === n)?.handle).filter(Boolean);
    return answer({ reason: "they both cry it", group, speaker: group[0] });
  }
  if (action === VOICE_ACTIONS.speaker) return answer({ gender: "female", description: "Calm at rest, clear and even." });
  if (action === VOICE_ACTIONS.narrator) return answer({ gender: "female", description: "Warm, unhurried storyteller." });
  if (action === "smart_assign") {
    const speakers = promptCast(variables.speakers);
    const persona = /id="([^"]*)"/.exec(variables.personas)?.[1];
    return answer(Object.fromEntries(speakers.map((s) => [s.handle, persona])));
  }
  if (action.startsWith("direction.")) {
    const first = /\[D(\d+) ·/.exec(variables.paragraphs)?.[1];
    return answer({ lines: first ? [{ id: `D${first}`, emotion: "sad", direction: "sadly" }] : [] });
  }
  throw new Error(`the fake model has no answer for ${action}`);
}

function toneWav(seconds = 0.4, sampleRate = 24000) {
  const n = Math.trunc(seconds * sampleRate);
  return writeWavContainer(Buffer.alloc(2 * n), sampleRate, 1);
}

beforeEach(() => {
  calls = {};
  hang = null;
  deafTo = null;
  vi.spyOn(run, "runFeature").mockImplementation(fakeModel);
  vi.spyOn(run, "measureFeature").mockResolvedValue(null);
  // Discover: gemma's scan of VII, its call's numbers on the run.
  vi.spyOn(identify, "identifySpeakers").mockImplementation(async (_text, _cast, opts) => {
    calls.discover = (calls.discover ?? 0) + 1;
    if (opts?.rawOut) opts.rawOut.usage = { ...usage, duration_ms: 5, pieces: 1 };
    return ALICE_SCANS.find((x) => x.title === VII).candidates.map((x) => new SpeakerCandidate(x));
  });
  // The language model the steps run on: this machine's.
  vi.spyOn(bookRun, "stepRoute").mockReturnValue({ configured: true, model: "gemma-test", provider: "Built-in engine", provider_id: "builtin", cloud: false, detail: null });
  // The speech models: a designed voice's audition, and each line's take (its length follows its text).
  vi.spyOn(vp, "synthCandidate").mockImplementation(async () => [toneWav(), 24000, 1]);
  vi.spyOn(renderCore, "renderLine").mockImplementation(async (s, kw) => {
    const key = await lineInputsKey(s, kw.voice, kw.text, { language: kw.language, delivery: kw.delivery, seed: kw.seed, lexicons: kw.lexicons, effects: kw.effects });
    const frames = 100 * [...kw.text].length;
    return new RenderedLine({ pcm: Buffer.alloc(2 * frames), sampleRate: 16000, channels: 1, effectiveDelivery: {}, inputsKey: key || "", seed: kw.seed ?? null });
  });
  // Speech recognition hears each take's own words — but nothing at all of `deafTo`.
  vi.spyOn(captures, "ensureSttLoaded").mockImplementation(async () => [{ currentFor: () => "asr", currentVariantId: () => "qwen3-asr-1.7b-q8" }, null]);
  vi.spyOn(captures, "_sttTranscribe").mockImplementation(async (file) => {
    const gen = h()
      .all(`select * from ${Generation}`, [], Generation)
      .find((g) => g.audio_path && mediaFile(g.audio_path) === file);
    return gen.block_id === deafTo ? "" : gen.text;
  });
  // The M4B: each chapter joined and mastered, then ffmpeg.
  vi.spyOn(exportAudiobook, "haveFfmpeg").mockReturnValue(true);
  vi.spyOn(renderChapterApi, "renderSceneToWav").mockImplementation(async () => toneWav(1.0));
  vi.spyOn(exportAudiobook, "muxM4b").mockResolvedValue(Buffer.from("M4B!"));
});

afterEach(async () => {
  for (let i = 0; i < 200 && (bookRun._running.size || renderJobs._running.size); i++) await sleep(10);
  vi.restoreAllMocks();
  await closeApps();
});

/** Alice's chapter VII imported as a book of its own, in English, with one persona in the library
 * for the speaker who isn't given a voice of their own (the March Hare: 16 lines, under 20). */
async function aliceVII(dir = undefined, { acceptTerms = true } = {}) {
  const { c, dir: d } = await appClient(dir, { seed: true });
  const epub = readFileSync(path.join(ALICE, KEY.book));
  const file = { file: ["book.epub", epub, "application/epub+zip"] };
  const dry = await c.post("/v1/projects/import", { data: { source: "book_prose", dry_run: "true" }, files: file });
  expect(dry.status, dry.text).toBe(200);
  const at = dry.json().standard.scenes.findIndex((s) => s.title === VII);
  const imp = await c.post("/v1/projects/import", { data: { source: "book_prose", include_scenes: String(at) }, files: file });
  expect(imp.status, imp.text).toBe(200);
  const pid = imp.json().project_id;
  expect((await c.patch(`/v1/projects/${pid}`, { json: { language: "en" } })).status).toBe(200);
  expect((await c.patch("/v1/settings", { json: { book_voices: { min_lines: 20 } } })).status).toBe(200);
  // The character voices' model, BreezeTTS 2, has a licence to accept first, as on a real install.
  if (acceptTerms) expect((await c.post("/v1/engines/breeze_tts/terms")).status).toBe(200);
  const gentle = (await c.post("/v1/personas", { json: { name: "Gentle", voice_id: "af_heart", note: "soft and quick" } })).json().id;
  return { c, pid, gentle, dir: d };
}

/** Poll the run until it stops (any status but queued and running). */
async function settle(c, runId, { review = false } = {}) {
  let r;
  for (let i = 0; i < 1500; i++) {
    r = (await c.get(`/v1/book_runs/${runId}${review ? "?review=true" : ""}`)).json();
    if (!["queued", "running"].includes(r.status)) return r;
    await sleep(20);
  }
  throw new Error(`the run is still ${r.status} on ${r.step}`);
}

const stepOf = (r, key) => r.steps.find((s) => s.key === key);

test("alice_vii_from_one_press_to_an_m4b_with_the_time_and_tokens_written_down", { timeout: 120000 }, async () => {
  const { c, pid, gentle } = await aliceVII();

  // Before it starts: each step's model, nothing in the way, nothing to ask on this machine.
  const before = (await c.get(`/v1/projects/${pid}/book_run`)).json();
  expect(before.run).toBeNull();
  expect(before.plan.chapters).toBe(1);
  expect(before.plan.problems).toEqual([]);
  expect(before.plan.ask_price).toBe(false);
  expect(before.plan.steps.map((s) => s.key)).toEqual(bookRun.STEPS);
  expect(before.plan.steps.find((s) => s.key === "analyze")).toMatchObject({ kind: "ai", model: "gemma-test", cloud: false });
  expect(before.plan.steps.find((s) => s.key === "design").model).toBe("Qwen3-TTS VoiceDesign → BreezeTTS 2 · narrator VoxCPM2");
  expect(before.plan.estimate.price).toBe(0);
  expect(before.plan.estimate.tokens_in).toBeGreaterThan(0);

  // One press.
  const started = await c.post("/v1/book_runs", { json: { project_id: pid } });
  expect(started.status, started.text).toBe(200);
  const runId = started.json().id;
  // One run of a book at a time.
  expect((await c.post("/v1/book_runs", { json: { project_id: pid } })).status).toBe(409);
  // The take check will hear nothing of the Hatter's "Your hair wants cutting" — flagged.
  const blocks = () =>
    h()
      .all("select b.* from blocks b join scenes s on s.id = b.scene_id where s.project_id = ? order by b.position", [pid])
      .filter((b) => b.text);
  const done = await (async () => {
    for (let i = 0; i < 1500; i++) {
      const hair = blocks().find((b) => b.text.includes("Your hair wants cutting"));
      if (hair && !deafTo) deafTo = hair.id;
      const r = (await c.get(`/v1/book_runs/${runId}`)).json();
      if (!["queued", "running"].includes(r.status)) return r;
      await sleep(20);
    }
    throw new Error("the run didn't finish");
  })();
  expect(done.status, JSON.stringify(done.error)).toBe("completed");
  for (const s of done.steps) expect(["done", "skipped"], `${s.key}: ${s.error}`).toContain(s.status);

  // The time and the token count, written down per step (the plan's §5) and in all.
  for (const key of ["discover", "analyze", "group_lines", "describe", "match", "direction"]) {
    expect(stepOf(done, key), key).toMatchObject({ model: "gemma-test" });
    expect(stepOf(done, key).tokens_in, key).toBeGreaterThan(0);
    expect(stepOf(done, key).tokens_out, key).toBeGreaterThan(0);
  }
  expect(stepOf(done, "analyze").recipe).toBe("local");
  expect(stepOf(done, "direction").recipe).toBe("local");
  expect(stepOf(done, "describe").recipe).toBe("local");
  expect(done.totals.tokens_in).toBe(done.steps.reduce((n, s) => n + s.tokens_in, 0));
  expect(done.totals.tokens_in).toBeGreaterThan(0);
  expect(done.totals.seconds).toBeGreaterThan(0);
  expect(done.totals.price).toBe(0); // all on this machine
  for (const s of done.steps) expect(s.seconds, s.key).toBeGreaterThanOrEqual(0);

  // Who speaks: every keyed line right, the group lines given and flagged.
  const speakers = (await c.get(`/v1/projects/${pid}/speakers`)).json().speakers;
  const nameOf = new Map(speakers.map((s) => [s.id, s.role_label === "narrator" ? "Narrator" : keyNameOf(s)]));
  const scene = (await c.get(`/v1/projects/${pid}/scenes`)).json()[0];
  const page = (await c.get(`/v1/scenes/${scene.id}/script`)).json();
  const spoken = page.lines.filter((l) => l.spoken);
  expect(spoken.length).toBe(150);
  for (const [d, want] of Object.entries(KEY.chapters[VII])) {
    if (want === "unknown") expect(nameOf.get(spoken[Number(d)].speaker_id)).toBe("Hatter");
    else expect(nameOf.get(spoken[Number(d)].speaker_id), `D${d}`).toBe(want);
  }
  // Voices: the four with 20 lines or more designed from the book, the March Hare from the library.
  const byName = Object.fromEntries(speakers.map((s) => [s.role_label === "narrator" ? "Narrator" : keyNameOf(s), s]));
  for (const n of ["Alice", "Hatter", "Dormouse"]) expect(byName[n].persona_name, n).toBe(byName[n].name);
  expect(byName.Narrator.persona_name).toBe(`Narrator · ${(await c.get(`/v1/projects/${pid}`)).json().name}`);
  expect(byName["March Hare"].persona_id).toBe(gentle);
  expect(stepOf(done, "design").made).toBe(4);

  // Every line rendered; the take check's one deaf line rendered again once, then flagged.
  const state = (await c.get(`/v1/projects/${pid}/render_state`)).json().totals;
  expect(state.lines).toBeGreaterThan(150);
  expect(state.rendered).toBe(state.lines);
  expect(stepOf(done, "render").done).toBe(state.lines);
  expect(stepOf(done, "check")).toMatchObject({ flagged: 1, rerendered: 1 });

  // What to check afterwards: Script's group lines, the flagged take, the voices to hear.
  const reviewed = await settle(c, runId, { review: true });
  const toCheck = (await c.get(`/v1/projects/${pid}/script`)).json().chapters[0].to_check;
  expect(toCheck).toBeGreaterThanOrEqual(4); // the four group lines among them
  expect(reviewed.review.script).toEqual([{ scene_id: scene.id, title: VII, lines: toCheck }]);
  expect(reviewed.review.takes.map((t) => [t.block_id, t.reasons])).toEqual([[deafTo, ["missed"]]]);
  expect(reviewed.review.voices.map((v) => v.name).sort()).toEqual(["Alice", "Dormouse", "Hatter", "Narrator"]);
  expect(reviewed.review.uncast).toEqual([]);
  // The book's GET carries the finished run with its review.
  expect((await c.get(`/v1/projects/${pid}/book_run`)).json().run.review.takes.length).toBe(1);

  // The M4B, saved once.
  expect(done.m4b.filename).toMatch(/\.m4b$/);
  const file = await c.get(`/v1/export_jobs/${done.m4b.job_id}/file`);
  expect(file.status).toBe(200);
  expect(file.content.toString("latin1")).toBe("M4B!");
  expect((await c.get(`/v1/book_runs/${runId}`)).json().m4b).toBeNull();

  // A second press does only what is new: every chapter kept, no model asked again for them.
  const asked = { ...calls };
  const again = await c.post("/v1/book_runs", { json: { project_id: pid } });
  expect(again.status, again.text).toBe(200);
  const second = await settle(c, again.json().id);
  expect(second.status, JSON.stringify(second.error)).toBe("completed");
  for (const key of ["discover", "analyze", "direction"]) expect(stepOf(second, key), key).toMatchObject({ kept: 1, tokens_in: 0 });
  expect(calls.discover).toBe(asked.discover);
  expect(stepOf(second, "render").total).toBe(0);
});

test("a_restart_pauses_the_run_and_resume_finishes_it", { timeout: 120000 }, async () => {
  const { c, pid, dir } = await aliceVII();
  // The server dies inside the voices' descriptions: the model call never answers.
  let entered;
  const inside = new Promise((resolve) => {
    entered = resolve;
  });
  const real = fakeModel;
  vi.spyOn(run, "runFeature").mockImplementation(async (action, variables) => {
    if (action === VOICE_ACTIONS.speaker && !hang) {
      hang = new Promise(() => {});
      entered();
    }
    return real(action, variables);
  });
  const runId = (await c.post("/v1/book_runs", { json: { project_id: pid } })).json().id;
  await inside;
  const mid = (await c.get(`/v1/book_runs/${runId}`)).json();
  expect(mid).toMatchObject({ status: "running", step: "describe" });
  expect(stepOf(mid, "analyze").status).toBe("done");
  const askedBefore = { ...calls };

  // The process goes: its runner with it (it never comes back), then the server starts again on
  // the same data folder — the boot sweep pauses the run.
  bookRun._running.clear();
  await closeApps();
  const { c: c2 } = await appClient(dir);
  const paused = (await c2.get(`/v1/book_runs/${runId}`)).json();
  expect(paused).toMatchObject({ status: "paused", step: "describe" });
  expect((await c2.get(`/v1/projects/${pid}/book_run`)).json().run.status).toBe("paused");

  // Resume picks up at the descriptions: what was done before the restart is not done again.
  hang = null;
  vi.spyOn(run, "runFeature").mockImplementation(fakeModel);
  const resumed = await c2.post(`/v1/book_runs/${runId}/resume`);
  expect(resumed.status, resumed.text).toBe(200);
  const done = await settle(c2, runId);
  expect(done.status, JSON.stringify(done.error)).toBe("completed");
  expect(calls.discover).toBe(askedBefore.discover);
  expect(calls["speaker_attribution.guided"] ?? calls["speaker_attribution.direct"]).toBe(
    askedBefore["speaker_attribution.guided"] ?? askedBefore["speaker_attribution.direct"],
  );
  expect(stepOf(done, "describe").status).toBe("done");
  expect(done.m4b).not.toBeNull();
  expect(h().get(BookRun, runId).status).toBe("completed");
});

test("a_frontier_route_shows_its_price_and_the_run_asks_once", { timeout: 60000 }, async () => {
  const { c, pid } = await aliceVII();
  // Every AI step on a cloud model AI Settings → Pricing knows ($5 in, $25 out a million).
  vi.spyOn(bookRun, "stepRoute").mockReturnValue({ configured: true, model: "claude-opus-4-8", provider: "Anthropic", provider_id: "anthropic", cloud: true, detail: null });
  const plan = (await c.get(`/v1/projects/${pid}/book_run`)).json().plan;
  expect(plan.ask_price).toBe(true);
  const e = plan.estimate;
  expect(e.price).toBeCloseTo((e.tokens_in / 1e6) * 5 + (e.tokens_out / 1e6) * 25, 2);
  expect(e.unpriced).toEqual([]);
  // The lines with no single speaker are counted: Alice VII's four whose narration says several
  // speak them ("they cried out", "they both cried" ×2, "the Hatter and the March Hare went" —
  // the last needs the cast's names, unknown before Discover, so three), each with its text around.
  const group = plan.steps.find((s) => s.key === "group_lines").estimate;
  expect(group.tokens_in).toBeGreaterThan(3 * 2000);
  expect(group.tokens_out).toBeGreaterThan(0);
  // Unasked, it doesn't start.
  const refused = await c.post("/v1/book_runs", { json: { project_id: pid } });
  expect(refused.status).toBe(409);
  expect(refused.text).toContain("cloud model");
  expect(h().all(`select * from ${BookRun}`).length).toBe(0);
  // Asked once: it starts, and keeps the estimate it was shown.
  hang = new Promise(() => {}); // nothing more is needed of it here
  const ok = await c.post("/v1/book_runs", { json: { project_id: pid, accept_price: true } });
  expect(ok.status, ok.text).toBe(200);
  expect(ok.json().estimate).toEqual(e);
  // Stopped, it is resumed without asking again.
  const runId = ok.json().id;
  bookRun.cancelRun(runId);
  await sleep(50);
  bookRun._running.clear(); // the hung call never returns; the run is as a stopped one
  h().update(BookRun, { status: "cancelled" }, { id: runId });
  hang = null;
  const resumed = await c.post(`/v1/book_runs/${runId}/resume`);
  expect(resumed.status, resumed.text).toBe(200);
  expect(["queued", "running"]).toContain(resumed.json().status);
  bookRun.cancelRun(runId);
  await bookRun.finished(runId);

  // A cloud model with no price: the tokens still, the price unknown — and it still asks. (The
  // pricing table has the 5.x and 6.1 models since kit 90aeada, so the unpriced one is made up.)
  vi.spyOn(bookRun, "stepRoute").mockReturnValue({ configured: true, model: "an-unpriced-cloud-model", provider: "OpenAI", provider_id: "openai", cloud: true, detail: null });
  const unknown = (await c.get(`/v1/projects/${pid}/book_run`)).json().plan;
  expect(unknown.estimate.price).toBeNull();
  expect(unknown.estimate.unpriced).toEqual(["an-unpriced-cloud-model"]);
  expect(unknown.ask_price).toBe(true);
});

test("every_scanned_name_ignored_and_no_speaker_stops_the_run_it_would_be_one_voice", async () => {
  // Removing a speaker ignores their names (2026-10-16); removing them all leaves nothing to add.
  const { c, pid } = await aliceVII();
  const sid = (await c.get(`/v1/projects/${pid}/scenes`)).json()[0].id;
  const text = (await c.get(`/v1/scenes/${sid}/blocks`)).json().map((b) => b.text).filter(Boolean).join("\n\n");
  vi.spyOn(identify, "identifySpeakers").mockResolvedValueOnce([new SpeakerCandidate({ name: "Hatter" }), new SpeakerCandidate({ name: "March Hare" })]);
  expect((await c.post(`/v1/scenes/${sid}/discover-speakers`, { json: { text } })).status).toBe(200);
  const codes = async () => (await c.get(`/v1/projects/${pid}/book_run`)).json().plan.problems.map((p) => p.code);
  expect(await codes()).not.toContain("all_ignored");
  await c.post(`/v1/projects/${pid}/discover/ignore`, { json: { names: ["Hatter", "March Hare"] } });
  expect(await codes()).toContain("all_ignored");
  const r = await c.post("/v1/book_runs", { json: { project_id: pid } });
  expect(r.status).toBe(409);
  expect(r.text).toContain("the book would be read in one voice");
  // One name back: the run can add them again.
  await c.post(`/v1/projects/${pid}/discover/unignore`, { json: { names: ["Hatter"] } });
  expect(await codes()).not.toContain("all_ignored");
});

test("the_character_voices_licence_word_is_on_the_plan_and_unaccepted_it_stops_the_run", async () => {
  // A fresh install: BreezeTTS 2's licence not yet accepted (decided 2026-10-16, its words 2026-10-18).
  const { c, pid } = await aliceVII(undefined, { acceptTerms: false });
  const plan = (await c.get(`/v1/projects/${pid}/book_run`)).json().plan;
  const design = plan.steps.find((s) => s.key === "design");
  expect(design.licences.map((l) => [l.model, l.name, l.commercial])).toEqual([["breeze_tts", "BreezeTTS 2", "Separate licence"]]);
  expect(plan.problems).toEqual([{ step: "design", code: "terms", detail: null, engine: "breeze_tts", name: "BreezeTTS 2" }]);
  const r = await c.post("/v1/book_runs", { json: { project_id: pid } });
  expect(r.status).toBe(409);
  expect(r.text).toContain("BreezeTTS 2's licence isn't accepted on this computer. Accept it to make the character voices.");
  // Accepted once, the stop goes; the licence word stays on the card.
  expect((await c.post("/v1/engines/breeze_tts/terms")).status).toBe(200);
  const after = (await c.get(`/v1/projects/${pid}/book_run`)).json().plan;
  expect(after.problems).toEqual([]);
  expect(after.steps.find((s) => s.key === "design").licences.length).toBe(1);
});

test("what_stops_a_run_starting_is_said_before_it_starts", async () => {
  const { c, pid } = await aliceVII();
  await c.patch(`/v1/projects/${pid}`, { json: { language: "" } });
  vi.spyOn(bookRun, "stepRoute").mockReturnValue({ configured: false, model: null, provider: null, provider_id: null, cloud: false, detail: "No LLM provider registered." });
  vi.spyOn(exportAudiobook, "haveFfmpeg").mockReturnValue(false);
  const plan = (await c.get(`/v1/projects/${pid}/book_run`)).json().plan;
  expect(plan.problems.map((p) => p.code)).toEqual(["no_model", "no_language"]);
  expect(plan.warnings.map((p) => p.code)).toContain("no_ffmpeg");
  expect(plan.estimate).toBeNull();
  const r = await c.post("/v1/book_runs", { json: { project_id: pid } });
  expect(r.status).toBe(409);
  expect(r.text).toContain("No LLM provider registered.");
});
