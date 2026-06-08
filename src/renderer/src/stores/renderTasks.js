/* Render-task store — adapted from JustWrite's `aiTasks.js` pattern.
 *
 * Tracks any long-running TTS operation (single render, chapter render,
 * engine install, training job) with elapsed time, freshness indicator,
 * cancel support. The shape matches AiTaskStrip / AiStatusPanel so we
 * can borrow those components with light renaming.
 *
 * Differences from JustWrite's version:
 *   - No `tokensIn / tokensOut / firstDeltaAt / chars` (LLM-specific)
 *   - Stats are derived per-kind via `statsFn` instead of hardcoded
 *   - "chunks" = audio frames for streaming engines; otherwise unused
 */
import { defineStore } from "pinia";
import { ref, computed } from "vue";

const HISTORY_CAP = 50;

export const useRenderTasks = defineStore("renderTasks", () => {
  const running = ref([]);  // currently active
  const history = ref([]);  // completed / failed / cancelled (capped)
  const now = ref(Date.now());
  setInterval(() => { now.value = Date.now(); }, 100);

  function _id() {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function start(opts) {
    const task = {
      id: opts.id || _id(),
      kind: opts.kind || "generate",  // 'generate' | 'chapter' | 'install' | 'train'
      feature: opts.feature || opts.kind || "generate",
      label: opts.label,
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
      status: "running",
      percent: opts.percent ?? null,
      statsFn: opts.statsFn || null,
      onCancel: opts.onCancel || null,
      meta: opts.meta || {},
    };
    running.value = [...running.value, task];
    return task;
  }

  function update(id, patch) {
    const idx = running.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    running.value = [
      ...running.value.slice(0, idx),
      { ...running.value[idx], ...patch, lastUpdateAt: Date.now() },
      ...running.value.slice(idx + 1),
    ];
  }

  function _retire(id, status, extra = {}) {
    const idx = running.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const task = { ...running.value[idx], status, finishedAt: Date.now(), ...extra };
    running.value = [...running.value.slice(0, idx), ...running.value.slice(idx + 1)];
    history.value = [task, ...history.value].slice(0, HISTORY_CAP);
  }

  function finish(id, extra = {}) { _retire(id, "completed", extra); }
  function fail(id, error) { _retire(id, "failed", { error }); }

  function cancel(id) {
    const task = running.value.find((t) => t.id === id);
    if (!task || !task.onCancel) return;
    try { task.onCancel(); } catch (_) { /* user code */ }
    _retire(id, "cancelled");
  }

  function elapsedSeconds(task) {
    const end = task.finishedAt || now.value;
    return Math.max(0, (end - task.startedAt) / 1000).toFixed(1);
  }

  function freshness(task) {
    if (task.status !== "running") return null;
    const ago = now.value - task.lastUpdateAt;
    if (ago < 3000) return "fresh";
    if (ago < 10000) return "stalling";
    return "stuck";
  }

  function stats(task) {
    if (task.statsFn) return task.statsFn(task);
    return [];
  }

  return {
    running,
    history,
    now,
    start,
    update,
    finish,
    fail,
    cancel,
    elapsedSeconds,
    freshness,
    stats,
    runningCount: computed(() => running.value.length),
  };
});
