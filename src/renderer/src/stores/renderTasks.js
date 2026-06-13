// SPDX-License-Identifier: GPL-3.0-or-later
/* Render-task store — adapted from JustWrite's `aiTasks.js` pattern.
 *
 * Tracks any long-running TTS operation (single render, chapter render,
 * engine install, training job) with elapsed time, freshness indicator,
 * cancel support. The shape matches AiTaskStrip / AiStatusPanel so we
 * can borrow those components with light renaming.
 *
 * Display lifecycle (JustWrite parity — user complaint 2026-06-09 that
 * tasks "flash and disappear" was fixed here):
 *   - `start()` adds to `running[]` with status='running'.
 *   - `finish()` / `fail()` / `cancel()` mark the task's status but
 *     KEEP it in `running[]` so the strip stays visible. A delayed
 *     auto-dismiss moves it to history after:
 *        - completed:  5s
 *        - cancelled:  3s
 *        - failed:    NEVER auto-dismisses — manual ✕ only (so the
 *                     user has time to read the error)
 *   - `dismiss(id)` removes immediately (used by the ✕ button).
 *
 * Differences from JustWrite's version:
 *   - No `tokensIn / tokensOut / firstDeltaAt / chars` (LLM-specific)
 *   - Stats are derived per-kind via `statsFn` instead of hardcoded
 *   - "chunks" = audio frames for streaming engines; otherwise unused
 */
import { defineStore } from "pinia";
import { ref, computed, watch } from "vue";

const HISTORY_CAP = 50;
const AUTO_DISMISS_MS = {
  completed: 5000,
  cancelled: 3000,
  failed: null,  // null = never auto-dismiss; user must click ✕
};

export const useRenderTasks = defineStore("renderTasks", () => {
  const running = ref([]);  // active OR finished-but-still-visible
  const history = ref([]);  // dismissed (capped)
  const panelOpen = ref(false);  // right-side status panel visibility
  const now = ref(Date.now());
  // 10Hz reactive tick drives elapsed-time UI on running tasks. Only run
  // while there's an active task — without this gate it fires forever
  // and invalidates every computed/watch that touches `now`, even when
  // nothing's rendering.
  let nowTimer = null;
  function startNowTick() {
    if (nowTimer) return;
    nowTimer = setInterval(() => { now.value = Date.now(); }, 100);
  }
  function stopNowTick() {
    if (!nowTimer) return;
    clearInterval(nowTimer);
    nowTimer = null;
  }
  watch(
    () => running.value.length,
    (n) => { n > 0 ? startNowTick() : stopNowTick(); },
  );

  // Pending auto-dismiss timers keyed by task id — used so we can
  // cancel a scheduled dismiss if the user clicks ✕ first.
  const _timers = new Map();

  function _id() {
    return `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function start(opts) {
    const task = {
      id: opts.id || _id(),
      kind: opts.kind || "generate",  // 'generate' | 'chapter' | 'install' | 'train' | 'load' | 'compose'
      feature: opts.feature || opts.kind || "generate",
      label: opts.label,
      startedAt: Date.now(),
      lastUpdateAt: Date.now(),
      status: "running",
      percent: opts.percent ?? null,
      statsFn: opts.statsFn || null,
      onCancel: opts.onCancel || null,
      // onRetry — re-runs the same operation. Shown on the strip / panel
      // for finished tasks (failed / cancelled) per the standing rule:
      // every long-running op gets progress + cancel + retry.
      onRetry: opts.onRetry || null,
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

  function _markStatus(id, status, extra = {}) {
    const idx = running.value.findIndex((t) => t.id === id);
    if (idx < 0) return null;
    const updated = {
      ...running.value[idx],
      status,
      finishedAt: Date.now(),
      lastUpdateAt: Date.now(),
      ...extra,
    };
    running.value = [
      ...running.value.slice(0, idx),
      updated,
      ...running.value.slice(idx + 1),
    ];
    return updated;
  }

  function _scheduleAutoDismiss(id, status) {
    const ms = AUTO_DISMISS_MS[status];
    if (ms == null) return;  // failed tasks stick around
    const handle = setTimeout(() => {
      _timers.delete(id);
      dismiss(id);
    }, ms);
    _timers.set(id, handle);
  }

  function finish(id, extra = {}) {
    if (_markStatus(id, "completed", extra)) _scheduleAutoDismiss(id, "completed");
  }
  function fail(id, error) {
    _markStatus(id, "failed", { error });
    // No auto-dismiss for failed — user must click ✕ to clear.
  }

  function cancel(id) {
    const task = running.value.find((t) => t.id === id);
    if (!task) return;
    if (task.status === "running" && task.onCancel) {
      try { task.onCancel(); } catch (_) { /* user code */ }
    }
    if (_markStatus(id, "cancelled")) _scheduleAutoDismiss(id, "cancelled");
  }

  // Re-run a finished task. Calls its `onRetry` (which typically just
  // invokes the same view-level function that originally called start)
  // and dismisses the old task — the retry creates its own new task.
  function retry(id) {
    const task = running.value.find((t) => t.id === id) || history.value.find((t) => t.id === id);
    if (!task || !task.onRetry || task.status === "running") return;
    try { task.onRetry(); } catch (_) { /* user code */ }
    dismiss(id);
  }

  // Move a finished task to history immediately (user clicked ✕, or
  // auto-dismiss timer fired). No-op for tasks still running.
  function dismiss(id) {
    const idx = running.value.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const task = running.value[idx];
    if (task.status === "running") return;
    // Clear any pending auto-dismiss timer.
    const handle = _timers.get(id);
    if (handle) { clearTimeout(handle); _timers.delete(id); }
    running.value = [...running.value.slice(0, idx), ...running.value.slice(idx + 1)];
    history.value = [task, ...history.value].slice(0, HISTORY_CAP);
  }

  function elapsedSeconds(task) {
    const end = task.finishedAt || now.value;
    return Math.max(0, (end - task.startedAt) / 1000).toFixed(1);
  }

  // Single-call kinds (extract / compose / load) are one long HTTP
  // request with no incremental updates — silence is their normal
  // working state, so their quiet window is minutes, not seconds
  // (user-hit 2026-06-12: speaker identification said "stuck" while
  // it was running fine).
  const SINGLE_CALL_KINDS = new Set(["extract", "compose", "load"]);
  function freshness(task) {
    if (task.status !== "running") return null;
    const ago = now.value - task.lastUpdateAt;
    if (SINGLE_CALL_KINDS.has(task.kind) || SINGLE_CALL_KINDS.has(task.feature)) {
      return ago < 120000 ? "working" : "stuck";
    }
    if (ago < 3000) return "fresh";
    if (ago < 10000) return "working";
    return "stuck";
  }

  function stats(task) {
    if (task.statsFn) return task.statsFn(task);
    return [];
  }

  // Status-panel actions — slide-in panel showing Running + Recent.
  function openPanel() { panelOpen.value = true; }
  function closePanel() { panelOpen.value = false; }
  function togglePanel() { panelOpen.value = !panelOpen.value; }

  // Mass-action helpers — Cancel all running, Clear all history.
  function cancelAll() {
    const ids = running.value
      .filter((t) => t.status === "running")
      .map((t) => t.id);
    for (const id of ids) cancel(id);
  }
  function clearHistory() { history.value = []; }

  return {
    running,
    history,
    panelOpen,
    now,
    start,
    update,
    finish,
    fail,
    cancel,
    dismiss,
    retry,
    openPanel,
    closePanel,
    togglePanel,
    cancelAll,
    clearHistory,
    elapsedSeconds,
    freshness,
    stats,
    runningCount: computed(() => running.value.filter((t) => t.status === "running").length),
    activeCount: computed(() => running.value.length),  // running + just-finished-but-visible
  };
});
