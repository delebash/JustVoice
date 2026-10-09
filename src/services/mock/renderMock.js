// SPDX-License-Identifier: MIT
//
// Studio · Render's mock data (Slice 4, decided 2026-10-04 — TASKS "Studio Slice 4"), and Script's
// chapter grid's (D7). Production minus the plumbing: no server, no audio, no persistence.
//
// The book is the app's own example, The Ninth Facet (Tamsin Vale): `ninthFacetScript.json` is
// its four chapters as Analyze leaves them — each quoted span a line with its true speaker (the
// sample's attribution-truth.json), the narration between them the Narrator's. The personas are
// the persona mock's (`personaMock.js`) and play exactly the lines its Personas page counts:
// Narrator (warm) the Narrator 126 · June Cael Ferren 25 (7 directed) · Marius Iven Sarraz 32 ·
// Gruff dockhand Brick Halvorn 16 · Street kid Nettle 19 · Elena Odeline Marran 27 (4 directed) ·
// Mara (old) Haldane Threll 6 · Old Tom (no voice) Auberon Vasht 2. Ophra Kell has no persona yet;
// 5 lines in chapter 2 have no speaker.
//
// A line's state is §8.16's vocabulary: needs a speaker · needs a voice · ready · rendered ·
// stale. "Rendered": its ★ take was made from what the line says and how it is said now;
// "stale": something it was made from changed since — you choose when to render it again (D4).

import { reactive } from "vue";
import { withAiTask } from "@delebash/llm-ui";
import { runFigures } from "../renderRun.js";
import { personaView, silentWav, store, wait } from "./personaMock.js";
import script from "./ninthFacetScript.json";

export const PROJECT = { id: "b_ninth", name: script.book, author: script.author, kind: "audiobook", language: "en" };
export const PAUSE_BETWEEN_LINES_MS = 600;     // Settings → Generation (D1)
// After the last line of one of the book's scenes, and between two lines of one paragraph
// (Settings → Generation, `models.py`; 2026-10-06 and 2026-10-07).
export const SCENE_BREAK_MS = 2000;
export const PARAGRAPH_MS = 250;
export const BOOK_LEXICON = "The Ninth Facet names";
// The audiobook kind's master target (`models.py` MasterPresets.acx).
export const MASTER = { preset: "acx", lufs: -20, peak: -3.5 };

export const SPEAKERS = [
  { id: "s_narr1", name: "Narrator", persona_id: "p_narrator", narrator: true },
  { id: "s_cael", name: "Cael Ferren", persona_id: "p_june" },
  { id: "s_iven", name: "Iven Sarraz", persona_id: "p_marius" },
  { id: "s_brick", name: "Brick Halvorn", persona_id: "p_dockhand" },
  { id: "s_nettle", name: "Nettle", persona_id: "p_street" },
  { id: "s_odeline", name: "Odeline Marran", persona_id: "p_elena" },
  { id: "s_haldane", name: "Haldane Threll", persona_id: "p_mara_old" },
  { id: "s_auberon", name: "Auberon Vasht", persona_id: "p_tom" },
  { id: "s_ophra", name: "Ophra Kell", persona_id: null },
];
const BY_NAME = Object.fromEntries(SPEAKERS.map((s) => [s.name, s.id]));
const AVATAR = {
  s_narr1: "#5b7a99", s_cael: "#c98aa7", s_iven: "#3a7d63", s_brick: "#8a6d3b", s_odeline: "#6a5acd",
  s_haldane: "#b07a2a", s_auberon: "#7a7a7a", s_nettle: "#b3552e", s_ophra: "#4f6f6f",
};
export const avatarColor = (id) => AVATAR[id] || "#9aa0a6";

export const speakerOf = (id) => SPEAKERS.find((s) => s.id === id) || null;
export function personaOfSpeaker(id) {
  const sp = speakerOf(id);
  const p = sp?.persona_id ? store.personas.find((x) => x.id === sp.persona_id) : null;
  return p ? personaView(p) : null;
}
/** A persona with a voice plays them — Cast's "cast". */
export function speakerReady(id) {
  const p = personaOfSpeaker(id);
  return !!(p && store.voices.some((v) => v.id === p.voice_id));
}

const seconds = (text) => Math.max(1, Math.round(text.length / 15));

// Which lines already carry takes: the first `rendered + stale` playable lines of a chapter.
// `script`: what Script's grid shows for it — when it was analyzed, and its checks. Each line's
// paragraph and scene in the book (`p`, `s`) give the app's `paragraph_next` and `scene_end`.
function chapter(id, src, { rendered = 0, stale = 0, analyzed = "", flagged = 0 } = {}) {
  let given = 0;
  const lines = src.lines.map((l, k) => {
    const next = src.lines[k + 1];
    const line = {
      id: `${id}_l${k + 1}`, n: k + 1, speaker_id: l.speaker ? BY_NAME[l.speaker] : null, text: l.text,
      spoken: l.speaker !== "Narrator", direction: "", override: null, takes: [], madeFrom: null,
      paragraph_next: !!next && next.p === l.p, scene_end: !!next && next.s !== l.s,
    };
    if (given < rendered + stale && line.speaker_id && speakerReady(line.speaker_id)) {
      line.takes = [{ id: `${line.id}_t1`, live: true, seconds: seconds(l.text), label: "" }];
      line.madeFrom = given < rendered ? "now" : "old";
      given += 1;
    }
    return line;
  });
  const spoken = lines.filter((l) => l.spoken).length;
  const none = lines.filter((l) => !l.speaker_id).length;
  const anchored = Math.round((spoken - none) * 0.3);
  return {
    id, n: 0, title: src.title, lines, scanned: true,
    script: { analyzed, anchored, guessed: spoken - none - anchored, flagged, none },
  };
}

export const render = reactive({
  chapters: [
    chapter("c1", script.chapters[0], { rendered: 30, stale: 4, analyzed: "yesterday", flagged: 3 }),
    chapter("c2", script.chapters[1], { rendered: 62, analyzed: "yesterday", flagged: 1 }),
    chapter("c3", script.chapters[2], { analyzed: "2 days ago", flagged: 2 }),
    chapter("c4", script.chapters[3], { analyzed: "2 days ago" }),
  ],
  // The ACX check, per chapter, once run (POST …/qc in the app).
  qc: {},
});
renumber();

/** Chapter numbers follow their order. */
export function renumber() {
  render.chapters.forEach((c, i) => { c.n = i + 1; });
}

// Directed lines, as the persona mock counts them: 7 of Cael's (June takes written direction),
// 4 of Odeline's (Elena does too). Chapter 1's first Cael line carries a second take; one of its
// narration lines carries a number override.
{
  const all = render.chapters.flatMap((c) => c.lines);
  const CAEL = [
    "Talking to the lamp, half amused.", "Low, careful — the shop is empty.", "Quiet, satisfied.",
    "Fond, to the lamp.", "Sharper — she doesn't trust it.", "Too quickly.", "Casual, and failing at it.",
  ];
  all.filter((l) => l.speaker_id === "s_cael").slice(0, 7).forEach((l, i) => { l.direction = CAEL[i]; });
  const ODELINE = ["Warm, teasing.", "Brisk, all business.", "Rattled off — she has said it many times.", "Wry."];
  all.filter((l) => l.speaker_id === "s_odeline").slice(0, 4).forEach((l, i) => { l.direction = ODELINE[i]; });

  const c1 = render.chapters[0].lines;
  const first = c1.find((l) => l.speaker_id === "s_cael");
  first.takes = [
    { id: `${first.id}_t2`, live: true, seconds: 2, label: "" },
    { id: `${first.id}_t1`, live: false, seconds: 2, label: "" },
  ];
  c1.filter((l) => l.speaker_id === "s_narr1")[1].override = { pause_after: 900 };
}

/** §8.16's state of one line. */
export function lineState(l) {
  if (!l.speaker_id) return "needs a speaker";
  if (!speakerReady(l.speaker_id)) return "needs a voice";
  if (!l.takes.length) return "ready";
  return l.madeFrom === "now" ? "rendered" : "stale";
}

export function counts(lines) {
  const c = { all: lines.length, ready: 0, stale: 0, rendered: 0, blocked: 0, noSpeaker: 0 };
  for (const l of lines) {
    const s = lineState(l);
    if (s === "ready") c.ready += 1;
    else if (s === "stale") c.stale += 1;
    else if (s === "rendered") c.rendered += 1;
    else {
      c.blocked += 1;
      if (s === "needs a speaker") c.noSpeaker += 1;
    }
  }
  return c;
}

/** The speakers whose lines can't render for want of a voice, with why. */
export function voiceless(lines) {
  const out = new Map();
  for (const l of lines) {
    if (lineState(l) !== "needs a voice") continue;
    const sp = speakerOf(l.speaker_id);
    const p = personaOfSpeaker(l.speaker_id);
    out.set(sp.id, { speaker: sp.name, persona: p?.name || null, personaId: p?.id || null });
  }
  return [...out.values()];
}

/** How the line's persona can be directed: "words" | "tags" | "sliders" (`directedByOf`). */
export function directedBy(l) {
  return personaOfSpeaker(l.speaker_id)?.directed_by || "";
}

/** The persona's standing tags on a tag model — what Render shows, read-only. */
export function standingTags(l) {
  const p = personaOfSpeaker(l.speaker_id);
  const m = p?.default_delivery?.models?.[p.model] || {};
  return [m.emotion, m.register_tag].filter(Boolean).map((t) => `[${t}]`);
}

let seq = 0;
/** A new take: kept beside the others, and live — nothing is overwritten. */
export function addTake(l, label = "") {
  seq += 1;
  for (const t of l.takes) t.live = false;
  l.takes.unshift({ id: `${l.id}_n${seq}`, live: true, seconds: seconds(l.text), label });
  l.madeFrom = "now";
}

/**
 * Why a chapter can't be joined, in the server's words (`render_chapter_api.py`, the strict
 * check) — or "" when every line can render. Lines with no speaker are caught first, by the
 * Render-stopped dialog.
 */
export function notReady(ch) {
  const parts = [];
  const uncast = new Set();
  const voicelessP = new Set();
  for (const l of ch.lines) {
    if (lineState(l) !== "needs a voice") continue;
    const p = personaOfSpeaker(l.speaker_id);
    if (p) voicelessP.add(p.name);
    else uncast.add(speakerOf(l.speaker_id).name);
  }
  if (uncast.size) parts.push(`${[...uncast].sort().join(", ")} ${uncast.size === 1 ? "has" : "have"} no persona yet — give them one in Studio · Cast.`);
  if (voicelessP.size) parts.push(`The persona ${[...voicelessP].sort().join(", ")} has no voice — pick one on the Personas page.`);
  return parts.length ? `This chapter isn't ready to render. ${parts.join(" ")}` : "";
}

/** The pause after a line when the chapter is joined (`render_chapter_api._join`): a scene's
 *  last line the scene break's, a line whose next is in its paragraph the paragraph's, else its own. */
export function pauseAfter(l) {
  if (l.scene_end) return SCENE_BREAK_MS;
  if (l.paragraph_next) return PARAGRAPH_MS;
  return l.override?.pause_after ?? PAUSE_BETWEEN_LINES_MS;
}

const LINE_MS = 400;   // how long the mock takes over one line
const LOAD_MS = 2500;  // and over loading another model
const cancelled = () => new DOMException("Render cancelled", "AbortError");

// The one speech queue, as the app's (`synth_scheduler`, 2026-10-07): one line at a time
// across every run, the runs in the order they were started, a run's lines grouped by model
// with the loaded one first — so another model loads once, inside its first line.
const queue = [];          // runs: { label, left: [lines] }
let loadedModel = "Kokoro";
const modelOf = (l) => personaOfSpeaker(l.speaker_id)?.model_name || "";
function byModel(lines) {
  const order = [...new Set([loadedModel, ...lines.map(modelOf)])];
  return [...lines].sort((a, b) => order.indexOf(modelOf(a)) - order.indexOf(modelOf(b)));
}
/** What is ahead of `run`, as `GET /v1/render_jobs/{id}`'s `waiting`. */
function ahead(run) {
  const before = queue.slice(0, queue.indexOf(run)).filter((r) => r.left.length);
  if (!before.length) return null;
  const first = before[0];
  return {
    lines: before.reduce((n, r) => n + r.left.length, 0),
    groups: [{ label: first.label, kind: "chapter", model: modelOf(first.left[0]), lines: first.left.length }],
  };
}

/**
 * Lines rendering as the app's run reports them (`services/renderRun.js`, 2026-10-07): each
 * line's state in the run, the line rendering now and how many are done on the task, what it
 * waits behind, the model a line is loading, and the strip's figures. which: "ready" — each
 * line with no take gets one; "all" — a new take for every line that can render.
 */
async function runLines(task, ch, which, steps) {
  const todo = ch.lines.filter((l) => (which === "all"
    ? ["ready", "rendered", "stale"].includes(lineState(l)) : lineState(l) === "ready"));
  const states = Object.fromEntries(todo.map((l) => [l.id, "pending"]));
  const run = { label: `${ch.n} · ${ch.title}`, left: [...todo] };
  queue.push(run);
  const t0 = Date.now();
  let done = 0;
  let audio = 0;
  const report = (current, extra = {}) => {
    task.update({ render: { lines: { ...states }, current, done, waiting: null, loading: null, ...extra } });
    task.setProgress(done, steps ?? (todo.length || 1));
    task.setStats(runFigures({ audio_seconds: audio, completed_blocks: done, failed_blocks: 0, total_blocks: todo.length },
      (Date.now() - t0) / 1000));
  };
  try {
    while (ahead(run)) {
      report(null, { waiting: ahead(run) });
      await wait(250);
      if (task.signal.aborted) throw cancelled();
    }
    run.left = byModel(run.left);
    while (run.left.length) {
      const l = run.left[0];
      if (task.signal.aborted) throw cancelled();
      states[l.id] = "running";
      const current = { block_id: l.id, n: l.n, speaker: speakerOf(l.speaker_id)?.name || "" };
      if (modelOf(l) && modelOf(l) !== loadedModel) {
        for (let ms = 0; ms < LOAD_MS; ms += 250) {
          report(current, { loading: { model: modelOf(l), seconds: ms / 1000 } });
          await wait(250);
          if (task.signal.aborted) throw cancelled();
        }
        loadedModel = modelOf(l);
      }
      report(current);
      await wait(LINE_MS);
      if (task.signal.aborted) throw cancelled();
      addTake(l);
      audio += l.takes[0].seconds;
      states[l.id] = "completed";
      done += 1;
      run.left.shift();
    }
    report(null);
  } finally {
    queue.splice(queue.indexOf(run), 1);
  }
}

/** ⚡ Render N ready / ↻ Re-render all on one chapter, as the app's kit task ("render-lines"). */
export function renderLines(ch, which) {
  return withAiTask({
    feature: "render-lines",
    label: `${ch.n} · ${ch.title} → ${which === "all" ? "a new take for every line" : "takes for the ready lines"}`,
    meta: { sceneId: ch.id },
  }, (task) => runLines(task, ch, which));
}

/**
 * Render a chapter, as the app's kit task ("render-scene"): every line with no take gets one;
 * then the ★ takes are joined, the pause between them, and mastered. Stale lines keep their
 * ★ take (D4). Resolves to { url, filename } — a silent clip as long as the chapter, to 30 s.
 */
export function renderChapter(ch, { onRetry } = {}) {
  return withAiTask({
    feature: "render-scene",
    label: `${ch.n} · ${ch.title} → chapter render`,
    onRetry,
    meta: { sceneId: ch.id },
  }, async (task) => {
    delete render.qc[ch.id];
    const why = notReady(ch);
    const steps = ch.lines.filter((l) => lineState(l) === "ready").length + 1;
    task.setProgress(0, steps);
    await wait(300);
    if (why) throw new Error(why);
    await runLines(task, ch, "ready", steps);
    await wait(500);   // the join and the master
    if (task.signal.aborted) throw cancelled();
    task.setProgress(steps, steps);
    const pause = ch.lines.slice(0, -1).reduce((ms, l) => ms + pauseAfter(l), 0) / 1000;
    const talk = ch.lines.reduce((s, l) => s + (l.takes.find((x) => x.live)?.seconds || 0), 0);
    const result = {
      url: URL.createObjectURL(silentWav(Math.min(Math.round(talk + pause), 30))),
      filename: `${ch.n}_${ch.title.replace(/[^a-z0-9_-]+/gi, "_")}.wav`,
    };
    task.update({ result });
    return result;
  });
}

/** The ACX check: each chapter that can render, measured after the master. */
export async function runQc() {
  await wait(900);
  for (const ch of render.chapters) {
    if (!ch.lines.length) continue;
    const blocked = counts(ch.lines).blocked;
    render.qc[ch.id] = blocked
      ? { ok: false, note: notReady(ch) || `${counts(ch.lines).noSpeaker} line(s) have no speaker.` }
      : { ok: ch.id !== "c3", rms: ch.id === "c3" ? -17.1 : -20.2, peak: ch.id === "c3" ? -2.9 : -3.6, rms_ok: ch.id !== "c3" };
  }
}
