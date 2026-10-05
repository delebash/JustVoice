// SPDX-License-Identifier: MIT
//
// ONE run of chapters at a time per project — whichever step started it
// (Studio Slice 3, §8.24 3b). Discover's scan and Script's Analyze both go
// through here, so neither keeps its own loop: before this, Discover had a
// hand-written loop and Analyze ran one chapter from the Script tab, and a
// second hand-written loop was about to join them.
//
//   queueChapters({ projectId, kind: "analyze" | "discover", chapters })
//
// A run already going takes the new chapters after its own ("starts after the
// current run"); a chapter is queued once per step — it can wait for Discover
// while Script analyzes it. Each chapter is ONE kit task, shown by the page of
// its step (StudioRunBanner.vue), so the strip shows that chapter's live
// tokens, its failure and its Retry.
//
// A page shows only its own step (decided 2026-10-05): Discover the scans,
// Script the Analyze — banner, strip, rows, ticks and counts. So each step
// counts its own chapters (`stepRun`), and Cancel — from its banner or its
// strip — stops that step's chapters only; the other step's go on. Chapters
// already finished are kept.
//
// The state is module-level and reactive, so the run survives leaving Studio
// and every page reading it (the grid, Discover, the chapter page, Overview)
// sees the same run. Pages hear about a finished chapter through
// `onChapterDone` and re-read what changed.

import { reactive } from "vue";
import { pushToast, runAiEndpoint, runAiEndpointStream } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { proseFromBlocks } from "./attribution.js";
import { pageTasks } from "./pageTasks.js";

// {projectId: {queue, current, done, failed, steps: {analyze?, discover?}, controller}}
// steps[kind] = {total, finished, startedAt, spent} — that step's own batch.
const runs = reactive({});
const listeners = new Set();

// The step's name leads everywhere outside its own button (2026-10-05).
const NO_MODEL = {
  analyze: "Script can't analyze without a language model — set one in AI Settings.",
  discover: "Discover can't scan without a language model — set one in AI Settings.",
};
const FEATURE = { analyze: "speaker_attribution", discover: "speaker_identification" };

/** The project's run, or null. Reactive — read it in a computed. */
export function chapterRunFor(projectId) {
  return (projectId && runs[projectId]) || null;
}

/** "current" | "queued" | null — where a chapter stands in one step's part of
 *  the run (`kind` "analyze" | "discover"), or in either step's with no kind. */
export function inRun(projectId, sceneId, kind = null) {
  const run = chapterRunFor(projectId);
  if (!run) return null;
  const mine = (q) => q.sceneId === sceneId && (!kind || q.kind === kind);
  if (run.current && mine(run.current)) return "current";
  if (run.queue.some(mine)) return "queued";
  return null;
}

/**
 * One step's part of the run, or null when that step has nothing running or
 * waiting: { running, waiting, queued, total, finished, startedAt, spent }.
 * `waiting` = its chapters are queued behind the other step's.
 */
export function stepRun(projectId, kind) {
  const run = chapterRunFor(projectId);
  const step = run?.steps?.[kind];
  if (!step) return null;
  const running = run.current?.kind === kind;
  const queued = run.queue.filter((q) => q.kind === kind).length;
  if (!running && !queued) return null;
  return { ...step, running, waiting: !running, queued };
}

/**
 * A step's strip: its chapter running now, else its last one that finished
 * (a failure stays readable). `sceneId` narrows it to one chapter. The kit
 * lists tasks oldest first, and a finished one lingers — taking the first
 * match showed a finished chapter's DONE while the next one ran (2026-10-05).
 */
export function runStripTask(tasks, projectId, kind, sceneId = null) {
  const mine = pageTasks(tasks, [FEATURE[kind]], { projectId, run: true, ...(sceneId ? { sceneId } : {}) });
  return mine.find((t) => tasks.isRunning(t.id)) || mine[mine.length - 1] || null;
}

const failKey = (kind, sceneId) => `${kind}:${sceneId}`;

/** The reason a chapter failed one step in this session's runs, or null. */
export function failureOf(projectId, sceneId, kind) {
  return runs[projectId]?.failed?.[failKey(kind, sceneId)] || null;
}

/** Hear about every finished chapter: fn({projectId, sceneId, kind, result}). Returns the unsubscribe. */
export function onChapterDone(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function dropQueued(run, kind) {
  for (let i = run.queue.length - 1; i >= 0; i--) if (run.queue[i].kind === kind) run.queue.splice(i, 1);
}

/** Stop one step's chapters. The other step's go on; chapters already finished are kept. */
export function cancelRun(projectId, kind) {
  const run = runs[projectId];
  if (!run) return;
  dropQueued(run, kind);
  if (run.current?.kind === kind) run.controller?.abort();
}

/**
 * Queue chapters on the project's run, starting it if none is going.
 * `chapters` is [{id, title, metadata}] — the scene rows. Returns how many
 * were queued (a chapter already in the run is skipped).
 */
export function queueChapters({ projectId, kind, chapters, route = null }) {
  let run = runs[projectId];
  if (!run) {
    runs[projectId] = { queue: [], current: null, done: {}, failed: {}, steps: {}, controller: null };
    run = runs[projectId];
  }
  // A step with nothing running or waiting starts a fresh batch of its own.
  if (!stepRun(projectId, kind)) run.steps[kind] = { total: 0, finished: 0, startedAt: 0, spent: 0 };
  let added = 0;
  for (const c of chapters) {
    if (inRun(projectId, c.id, kind)) continue;
    run.queue.push({ sceneId: c.id, kind, title: c.title || "", scene: c, route });
    delete run.failed[failKey(kind, c.id)];
    added += 1;
  }
  run.steps[kind].total += added;
  if (added && !run.current) drain(projectId);
  return added;
}

async function chapterText(api, projectId, scene) {
  // The stored text that produced the chapter's split when there is one (the
  // only way a re-analyze reproduces it), else its blocks joined back up. Read
  // fresh: the chapter may have been edited since it was queued. An analyzed
  // chapter edited since has no stored text, and the server then reads it as
  // its lines stand and ignores this (extraction_api._lines_to_keep,
  // 2026-09-30) — the join made every line a paragraph of its own.
  const fresh = await api.safeRequest(`/v1/projects/${projectId}/scenes`, null);
  const row = Array.isArray(fresh) ? fresh.find((s) => s.id === scene.id) : null;
  const stored = (row || scene).metadata?.source_text;
  if (stored) return stored;
  const r = await api.safeRequest(`/v1/scenes/${scene.id}/blocks`, []);
  return proseFromBlocks(Array.isArray(r) ? r : (r?.blocks ?? []));
}

function isNoModel(e) {
  return e?.status === 501 || /no llm provider|not configured/i.test(String(e?.message || e));
}

async function drain(projectId) {
  const api = useApi();
  const run = runs[projectId];
  while (run.queue.length) {
    const item = run.queue.shift();
    const step = run.steps[item.kind];
    // A step's time starts when its first chapter does, not while it waits.
    step.startedAt = step.startedAt || Date.now();
    // One controller per chapter: a cancel stops one step, and the other
    // step's next chapter needs a live signal.
    run.controller = new AbortController();
    run.current = { ...item, startedAt: Date.now() };
    let result = null;
    try {
      const text = (await chapterText(api, projectId, item.scene)).trim();
      if (!text) throw new Error("This chapter has no text yet.");
      const meta = { projectId, sceneId: item.sceneId, run: true };
      if (item.kind === "analyze") {
        result = await runAiEndpointStream({
          url: `${api.serverUrl}/v1/scenes/${item.sceneId}/analyze/stream`,
          body: { text, ...(item.route ? { route: item.route } : {}) },
          task: {
            // This chapter only — the step's banner carries "n of N" (2026-10-05).
            feature: FEATURE.analyze,
            label: `Script · analyze · ${item.title}`,
            // "1,468 words" — the chapter's words sent; "words in" read like a
            // cut-off sentence (decided 2026-10-05).
            stats: [`${text.split(/\s+/).length.toLocaleString()} words`],
            inline: true,
            meta,
            signal: run.controller.signal,
            onRetry: () => queueChapters({ projectId, kind: item.kind, chapters: [item.scene], route: item.route }),
          },
        });
      } else {
        result = await runAiEndpoint({
          request: (p, o) => api.request(p, o),
          path: `/v1/scenes/${item.sceneId}/discover-speakers`,
          body: { text },
          task: {
            feature: FEATURE.discover,
            label: `Discover · scan · ${item.title}`,
            inline: true,
            meta,
            signal: run.controller.signal,
            onRetry: () => queueChapters({ projectId, kind: item.kind, chapters: [item.scene] }),
          },
        });
      }
      run.done[item.sceneId] = item.kind;
    } catch (e) {
      const msg = String(e?.message || e);
      if (run.controller.signal.aborted || /abort/i.test(msg)) {
        // Cancel — from the step's strip or its banner — stops that step's
        // chapters; the other step's go on.
        dropQueued(run, item.kind);
      } else if (isNoModel(e)) {
        // Both steps need the model, so nothing queued can run.
        run.failed[failKey(item.kind, item.sceneId)] = { kind: item.kind, reason: NO_MODEL[item.kind] };
        run.queue.splice(0);
        pushToast({ message: NO_MODEL[item.kind], kind: "warning", duration: 6000 });
      } else {
        // The server's own words — a 409 that would destroy takes, a model
        // that would not load — are already written for the user.
        run.failed[failKey(item.kind, item.sceneId)] = { kind: item.kind, reason: msg };
      }
    }
    step.finished += 1;
    step.spent += Date.now() - run.current.startedAt;
    run.current = null;
    for (const fn of listeners) {
      try { fn({ projectId, sceneId: item.sceneId, kind: item.kind, result }); } catch { /* a listener's own problem */ }
    }
  }
  // The run is over; its failures stay on their rows until queued again.
  run.controller = null;
  run.steps = {};
}
