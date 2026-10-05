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
// current run"); a chapter already in the run is not queued twice. Each
// chapter is ONE kit task (inline — the page that shows the run mounts its own
// AiTaskStrip), so the strip shows that chapter's live tokens, its failure and
// its Cancel. Cancel — from the strip or from `cancelRun` — stops the whole
// run; chapters already finished are kept.
//
// The state is module-level and reactive, so the run survives leaving Studio
// and every page reading it (the grid, Discover, the chapter page, Overview)
// sees the same run. Pages hear about a finished chapter through
// `onChapterDone` and re-read what changed.

import { reactive } from "vue";
import { pushToast, runAiEndpoint, runAiEndpointStream } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { proseFromBlocks } from "./attribution.js";

// {projectId: {queue, current, done, failed, finished, total, startedAt, controller, kind}}
const runs = reactive({});
const listeners = new Set();

const NO_MODEL = {
  analyze: "Analyze needs a language model. Set one in AI Settings.",
  discover: "Discover needs a language model — wire one in AI Settings.",
};

/** The project's run, or null. Reactive — read it in a computed. */
export function chapterRunFor(projectId) {
  return (projectId && runs[projectId]) || null;
}

/** "current" | "queued" | null — where a chapter stands in its project's run. */
export function inRun(projectId, sceneId) {
  const run = chapterRunFor(projectId);
  if (!run) return null;
  if (run.current?.sceneId === sceneId) return "current";
  if (run.queue.some((q) => q.sceneId === sceneId)) return "queued";
  return null;
}

/** "analyze" | "discover" | null — what the run is doing, or will do, to this chapter.
 *  Both steps share the run, so a row says which: Discover's "scanning…" is not
 *  Script's "analyzing…" (2026-10-05). */
export function runKind(projectId, sceneId) {
  const run = chapterRunFor(projectId);
  if (!run) return null;
  if (run.current?.sceneId === sceneId) return run.current.kind;
  return run.queue.find((q) => q.sceneId === sceneId)?.kind || null;
}

const RUN_FEATURES = ["speaker_attribution", "speaker_identification"];

/**
 * The run's strip: the chapter running now, else the last one that finished
 * (a failure stays readable). `sceneId` narrows it to one chapter. The kit
 * lists tasks oldest first, and a finished one lingers — taking the first
 * match showed a finished chapter's DONE while the next one ran (2026-10-05).
 */
export function runStripTask(tasks, projectId, sceneId = null) {
  const mine = tasks.visibleTasks.filter((t) => t.inline && t.meta?.run && t.meta?.projectId === projectId
    && RUN_FEATURES.includes(t.feature) && (!sceneId || t.meta?.sceneId === sceneId));
  return mine.find((t) => tasks.isRunning(t.id)) || mine[mine.length - 1] || null;
}

/** The reason a chapter failed in this session's runs, or null. */
export function failureOf(projectId, sceneId) {
  return runs[projectId]?.failed?.[sceneId] || null;
}

/** Hear about every finished chapter: fn({projectId, sceneId, kind, result}). Returns the unsubscribe. */
export function onChapterDone(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Stop the project's run. Chapters already finished are kept. */
export function cancelRun(projectId) {
  const run = runs[projectId];
  if (!run) return;
  run.queue.splice(0);
  run.controller?.abort();
}

/**
 * Queue chapters on the project's run, starting it if none is going.
 * `chapters` is [{id, title, metadata}] — the scene rows. Returns how many
 * were queued (a chapter already in the run is skipped).
 */
export function queueChapters({ projectId, kind, chapters, route = null }) {
  let run = runs[projectId];
  if (!run) {
    runs[projectId] = {
      queue: [], current: null, done: {}, failed: {}, finished: 0, total: 0,
      startedAt: 0, controller: null, kind,
    };
    run = runs[projectId];
  }
  let added = 0;
  for (const c of chapters) {
    if (inRun(projectId, c.id)) continue;
    run.queue.push({ sceneId: c.id, kind, title: c.title || "", scene: c, route });
    delete run.failed[c.id];
    added += 1;
  }
  run.total += added;
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
  run.startedAt = run.startedAt || Date.now();
  run.controller = new AbortController();
  while (run.queue.length) {
    const item = run.queue.shift();
    run.current = { ...item, startedAt: Date.now() };
    const position = `${run.finished + 1} of ${run.total}`;
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
            feature: "speaker_attribution",
            label: `Analyze · ${item.title}`,
            stats: [position, `${text.split(/\s+/).length.toLocaleString()} words in`],
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
            feature: "speaker_identification",
            label: `Discover speakers · ${item.title}`,
            stats: [position],
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
        // Cancel — from the strip or the page — stops the whole run.
        run.queue.splice(0);
      } else if (isNoModel(e)) {
        run.failed[item.sceneId] = { kind: item.kind, reason: NO_MODEL[item.kind] };
        run.queue.splice(0);
        pushToast({ message: NO_MODEL[item.kind], kind: "warning", duration: 6000 });
      } else {
        // The server's own words — a 409 that would destroy takes, a model
        // that would not load — are already written for the user.
        run.failed[item.sceneId] = { kind: item.kind, reason: msg };
      }
    }
    run.finished += 1;
    run.current = null;
    for (const fn of listeners) {
      try { fn({ projectId, sceneId: item.sceneId, kind: item.kind, result }); } catch { /* a listener's own problem */ }
    }
  }
  // The run is over; its failures stay on their rows until queued again.
  run.controller = null;
  run.finished = 0;
  run.total = 0;
  run.startedAt = 0;
}
