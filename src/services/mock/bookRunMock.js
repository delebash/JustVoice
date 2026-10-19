// SPDX-License-Identifier: MIT
//
// The one-click run's mock data (the one-click plan's slice 5; pages/mock/MockOneClickPage.vue).
// Production minus the plumbing: no server, no run.
//
// The book is the plan's own test book, Alice's Adventures in Wonderland imported with chapters
// VII and VIII only, its counts the app's own: 176 lines as imported (105 + 71, every one with no
// speaker and narration waiting for a narrator), 454 once Analyze has cut them (273 + 181; 150 + 90
// spoken), the answer key's speakers with the Queen's two names merged — Narrator 214 · Alice 92 ·
// Hatter 55 · Queen of Hearts 22 · Dormouse 21 · March Hare 16 · the King 9 · Five 7 · the White
// Rabbit 7 · Two 5 · Seven 3 · the Cheshire Cat 3 · the Knave 0 — and Script's flags after a run:
// 9 lines to check in VII, 1 in VIII (book_run.test.js and its scratch run on VII–VIII, 2026-10-16).
// Every speaker with 3 lines or more gets a voice made from the book (12 with the narrator); the
// Knave is matched from the library.
//
// The steps' times are RESEARCH §10.4–10.5's measurements where there is one (Discover 16 s + 18 s,
// Analyze 123 s + 80 s, Direction on VII 50 s and 4,250 tokens in, 2,104 out); the rest — the
// other token counts, the design, render and check times — are made up to sit beside them. The
// frontier estimate is book_run.estimateRun's arithmetic on the same book, priced at Claude Opus
// 5.5's $4 in / $20 out a million tokens (RESEARCH §10.2) as a row in AI Settings → Pricing.

import { STEP_LABELS } from "../bookRun.js";

export const PROJECT = { id: "b_alice", name: "Alice's Adventures in Wonderland", kind: "audiobook", language: "en" };
export const UNIT = { singular: "Chapter", plural: "Chapters" };
export const VII = "CHAPTER VII. A Mad Tea-Party";
export const VIII = "CHAPTER VIII. The Queen’s Croquet-Ground";
const CHAPTER_IDS = { [VII]: "sc_vii", [VIII]: "sc_viii" };

/** The states the page draws (?state=); any of them on the cloud model with ?route=frontier. */
export const STATES = ["new", "price", "blocked", "running", "paused", "stopped", "failed", "done"];

const STEPS = Object.keys(STEP_LABELS);

const LOCAL = { provider: "Built-in provider — llama.cpp", model: "gemma-4-26b-a4b-qat", cloud: false };
const CLOUD = { provider: "Claude (Anthropic)", model: "claude-opus-5-5", cloud: true };
const FEATURES = {
  discover: ["speaker_discovery", "speaker_attribution.identify", null],
  merge: ["speaker_merge", "speaker_merge.local", "local"],
  analyze: ["speaker_attribution", "speaker_attribution.direct", "local"],
  group_lines: ["speaker_group", "speaker_group", null],
  describe: ["book_voices", "book_voices.speaker", "local"],
  match: ["smart_assign", "smart_assign", null],
  direction: ["direction", "direction.local", "local"],
};
// The frontier route's estimate, step by step: tokens in, tokens out.
const FRONTIER_TOKENS = {
  discover: [7410, 130],
  merge: [304, 65],
  analyze: [7600, 15600],
  describe: [6830, 65],
  match: [120, 65],
  direction: [11140, 15600],
};
const price = ([i, o]) => Math.round(((i / 1e6) * 4 + (o / 1e6) * 20) * 100) / 100;

/** GET /v1/projects/{id}/book_run's plan — on this computer's model, or a cloud one. */
// BreezeTTS 2's licence as the server gives it (curated/breeze_tts.js, audio.cpp's licence table).
const BREEZE_LICENCE = {
  model: "breeze_tts",
  name: "BreezeTTS 2",
  commercial: "Separate licence",
  licence: "BreezeBlue Research and Non-Commercial License",
  table: "No",
  summary: "Not under its free licence: selling anything made with the downloaded model needs a separate written licence from BreezeBlue, and the free licence rules out any creator exception. (Audio made on BreezeBlue’s own paid website can be sold.)",
  url: "https://huggingface.co/BreezeBlue/Breeze-TTS-2/blob/main/LICENSE",
  checked: "2026-10-11",
};

export function mockPlan({ frontier = false, blocked = false, noFfmpeg = false } = {}) {
  const route = frontier ? CLOUD : LOCAL;
  const steps = STEPS.map((key) => {
    const f = FEATURES[key];
    if (f) {
      const recipe = f[2] ? (frontier ? "frontier" : "local") : null;
      const action = frontier && f[2] ? f[1].replace(/\.local$/, ".frontier").replace("book_voices.speaker", "book_voices.cast") : f[1];
      const t = FRONTIER_TOKENS[key];
      return {
        key,
        kind: "ai",
        ...(blocked ? { provider: null, model: null, cloud: false, configured: false } : { ...route, configured: true }),
        recipe: blocked ? null : recipe,
        feature: f[0],
        action,
        estimate: blocked ? null : t ? { tokens_in: t[0], tokens_out: t[1], price: frontier ? price(t) : 0 } : null,
      };
    }
    const model = { design: "Qwen3-TTS VoiceDesign → BreezeTTS 2 · narrator VoxCPM2", check: "Qwen3-ASR 1.7B" }[key] ?? null;
    const kind = key === "design" || key === "render" ? "speech" : key === "check" ? "recognition" : key === "export" ? "file" : "book";
    const licences = key === "design" ? [BREEZE_LICENCE] : [];
    return { key, kind, model, provider: null, cloud: false, configured: true, recipe: null, feature: null, action: null, estimate: null, licences };
  });
  const totals = Object.values(FRONTIER_TOKENS).reduce((a, t) => [a[0] + t[0], a[1] + t[1]], [0, 0]);
  return {
    project_id: PROJECT.id,
    chapters: 2,
    steps,
    estimate: blocked
      ? null
      : {
        tokens_in: totals[0],
        tokens_out: totals[1],
        price: frontier ? Math.round(Object.values(FRONTIER_TOKENS).reduce((n, t) => n + ((t[0] / 1e6) * 4 + (t[1] / 1e6) * 20), 0) * 100) / 100 : 0,
        unpriced: [],
      },
    ask_price: frontier && !blocked,
    problems: blocked
      ? [
        { step: "discover", code: "no_model", detail: null },
        { step: "design", code: "no_language", detail: null },
        { step: "design", code: "terms", detail: null, engine: "breeze_tts", name: "BreezeTTS 2", uses: ["characters"] },
      ]
      : [],
    warnings: noFfmpeg ? [{ step: "export", code: "no_ffmpeg", detail: null }] : [],
  };
}

// What each step did on this book, run on this computer: [done, total, kept, tokens in, out, calls, seconds, extra].
const DONE = {
  discover: [2, 2, 0, 9860, 610, 2, 34],
  merge: [12, 12, 0, 412, 96, 1, 4],
  add: [12, 12, 0, 0, 0, 0, 0, { added: 12 }],
  analyze: [2, 2, 0, 14920, 3410, 2, 203],
  group_lines: [2, 2, 0, 11850, 410, 5, 41],
  describe: [12, 12, 0, 21600, 1150, 12, 96],
  design: [12, 12, 0, 0, 0, 0, 300, { made: 12 }],
  match: [1, 1, 0, 1240, 40, 1, 6, { unmatched: 0 }],
  direction: [2, 2, 0, 7630, 3520, 2, 84],
  render: [454, 454, 0, 0, 0, 0, 1512, { failed: 0, audio_seconds: 2286 }],
  check: [454, 454, 0, 0, 0, 0, 240, { flagged: 1, rerendered: 3 }],
  export: [3, 3, 0, 0, 0, 0, 38],
};
const MODELS = {
  discover: ["gemma-4-26b-a4b-qat", null],
  merge: ["gemma-4-26b-a4b-qat", "local"],
  analyze: ["gemma-4-26b-a4b-qat", "local"],
  group_lines: ["gemma-4-26b-a4b-qat", null],
  describe: ["gemma-4-26b-a4b-qat", "local"],
  design: ["Qwen3-TTS VoiceDesign → BreezeTTS 2 · narrator VoxCPM2", null],
  match: ["gemma-4-26b-a4b-qat", null],
  direction: ["gemma-4-26b-a4b-qat", "local"],
  check: ["qwen3-asr-1.7b-q8", null],
};

function stepRecord(key, status, over = {}, frontier = false) {
  const [done, total, kept, tin, tout, calls, seconds, extra] = DONE[key];
  let [model, recipe] = MODELS[key] ?? [null, null];
  if (frontier && FEATURES[key]) [model, recipe] = [CLOUD.model, recipe ? "frontier" : null];
  const base = { key, status, note: null, error: null, refused: 0, phase: null };
  if (status === "pending") return { ...base, done: 0, total: 0, kept: 0, model: null, recipe: null, tokens_in: 0, tokens_out: 0, calls: 0, seconds: 0 };
  return { ...base, done, total, kept, model, recipe, tokens_in: tin, tokens_out: tout, calls, seconds, ...(extra ?? {}), ...over };
}

/** A run of the book: every step before `at` done, `at` in `status` with `over`, the rest waiting. */
function runAt(status, at, { over = {}, scene = null, error = null, frontier = false } = {}) {
  const i = at ? STEPS.indexOf(at) : STEPS.length;
  const steps = STEPS.map((key, j) => {
    if (j < i) return stepRecord(key, "done", {}, frontier);
    if (j === i) return stepRecord(key, status === "failed" ? "failed" : status === "running" ? "running" : "pending", over, frontier);
    return stepRecord(key, "pending");
  });
  const counted = steps.filter((s) => s.status !== "pending");
  const cost = frontier ? Math.round(counted.reduce((n, s) => n + (FEATURES[s.key] ? price([s.tokens_in, s.tokens_out]) : 0), 0) * 100) / 100 : 0;
  return {
    id: "run_1",
    project_id: PROJECT.id,
    scope: "project",
    status,
    step: at,
    scene_id: scene ? CHAPTER_IDS[scene] : null,
    scene_title: scene,
    error,
    steps,
    totals: {
      tokens_in: counted.reduce((n, s) => n + s.tokens_in, 0),
      tokens_out: counted.reduce((n, s) => n + s.tokens_out, 0),
      seconds: counted.reduce((n, s) => n + s.seconds, 0),
      price: cost,
    },
    redo: [],
    estimate: mockPlan({ frontier }).estimate,
    m4b: status === "completed" ? { job_id: "x_m4b", filename: "Alice's Adventures in Wonderland.m4b" } : null,
    review: status === "completed" ? REVIEW : null,
    started_at: "2026-10-16T13:02:11",
    finished_at: status === "completed" ? "2026-10-16T13:44:49" : null,
    created_at: "2026-10-16T13:02:11",
  };
}

const VOICES = ["Alice", "Hatter", "Queen of Hearts", "Dormouse", "March Hare", "the King", "Five", "the White Rabbit", "Two", "Seven", "the Cheshire Cat", "Narrator"];

/** What to check after the run (GET /v1/book_runs/{id}?review=true). */
export const REVIEW = {
  script: [
    { scene_id: "sc_vii", title: VII, lines: 9 },
    { scene_id: "sc_viii", title: VIII, lines: 1 },
  ],
  takes: [{ scene_id: "sc_vii", title: VII, block_id: "b_hair", n: 23, reasons: ["missed"] }],
  voices: VOICES.map((name, i) => ({ speaker_id: `s_${i}`, name, persona_id: `p_${i}`, lines: null })),
  uncast: [],
  refused: [],
};

/** The run in each state the page draws (null: none yet); `frontier`: its AI steps ran on the
 * cloud model, its numbers priced. */
export function mockRun(state, { frontier = false } = {}) {
  if (state === "running") {
    return runAt("running", "direction", { frontier, scene: VIII, over: { done: 1, total: 2, tokens_in: 4250, tokens_out: 2104, calls: 1, seconds: 0 } });
  }
  if (state === "paused") return runAt("paused", "direction", { frontier, scene: VIII, over: { done: 1, total: 2, tokens_in: 4250, tokens_out: 2104, calls: 1, seconds: 50 } });
  if (state === "stopped") return runAt("cancelled", "render", { frontier, over: { done: 212, total: 454, seconds: 706, failed: 0, audio_seconds: 1067 } });
  if (state === "failed") {
    return runAt("failed", "export", {
      frontier,
      over: { done: 0, total: 0, seconds: 1, error: "ffmpeg is not installed — required for M4B export. Install ffmpeg and restart the server." },
      error: { step: "export", text: "ffmpeg is not installed — required for M4B export. Install ffmpeg and restart the server." },
    });
  }
  if (state === "done") return runAt("completed", null, { frontier });
  return null;
}

/** Seconds the run has worked when the page opens (the running state's clock starts there). */
export const RUNNING_SINCE = Object.entries(DONE)
  .slice(0, STEPS.indexOf("direction"))
  .reduce((n, [, d]) => n + d[6], 0) + 50;

/** Overview's numbers in each state (studioStatus.stepStatus's input). */
export function mockOverviewState(state) {
  const before = !mockRun(state);
  if (before) {
    return {
      chapters: 2, scanned: 0, proposed: 0, analyzed: 0, fromImport: 0, running: 0, lines: 176, noNarrator: true,
      noSpeaker: 0, flagged: 0, castTotal: 0, castReady: 0, blocked: 176, cantRender: 176, rendered: 0, renderable: 0, ready: 0, stale: 0,
    };
  }
  const rendered = { running: 0, paused: 0, stopped: 212, failed: 454, done: 454 }[state];
  return {
    chapters: 2, scanned: 2, proposed: 0, analyzed: 2, fromImport: 0, running: 0, lines: 454, noNarrator: false,
    noSpeaker: 0, flagged: 10, castTotal: 13, castReady: 13, blocked: 0, cantRender: 0, rendered, renderable: 454, ready: 454 - rendered, stale: 0,
  };
}
