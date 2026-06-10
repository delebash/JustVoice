<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  TaskStrip — inline progress strip for one running OR recently-finished
  task. Adapted from JustWrite's AiTaskStrip pattern.

  Visual: accent-tinted strip (NOT a plain white card) so it stands out
  even on busy views. Sparkle icon while running, status badge when
  finished. Stat chips render the store's `stats(task)` output verbatim
  (per-task statsFn — chars/words/KB out/audio sec for renders, tokens
  for LLM-driven Compose).

  Buttons (right end, in order):
    - Details → opens the side-slide TaskStatusPanel
    - Cancel (while running, if task has onCancel)
    - ✕ Dismiss (once finished, removes from running)
-->
<script setup>
import { computed } from "vue";
import { useRenderTasks } from "../stores/renderTasks.js";

const props = defineProps({ task: { type: Object, required: true } });
const store = useRenderTasks();

const elapsed = computed(() => store.elapsedSeconds(props.task));
const fresh = computed(() => store.freshness(props.task));
const statList = computed(() => store.stats(props.task));
const isFinished = computed(() => props.task.status !== "running");

const STATUS = {
  completed: { badge: "✓",  label: "done",      cls: "task-strip--ok" },
  failed:    { badge: "⚠",  label: "failed",    cls: "task-strip--fail" },
  cancelled: { badge: "⊘",  label: "cancelled", cls: "task-strip--cancel" },
};
const status = computed(() => STATUS[props.task.status] || null);
</script>

<template>
  <div class="task-strip" :class="status?.cls" :data-status="task.status">
    <!-- Spinner while running, status badge when finished -->
    <span v-if="!isFinished" class="task-strip__sparkle">✨</span>
    <span v-else class="task-strip__badge">{{ status?.badge }}</span>

    <span class="task-strip__label">{{ task.label }}</span>
    <span v-if="task.feature && task.feature !== task.kind" class="task-strip__feature">{{ task.feature }}</span>

    <!-- Live stats -->
    <span class="task-strip__stat">{{ elapsed }}s</span>
    <span v-for="(s, i) in statList" :key="i" class="task-strip__stat">{{ s }}</span>

    <!-- Freshness chip (running only) -->
    <span v-if="fresh && !isFinished" class="task-strip__stat" :data-fresh="fresh">
      <span class="task-strip__dot" />
      <template v-if="fresh === 'fresh'">live</template>
      <template v-else-if="fresh === 'stalling'">stalling</template>
      <template v-else>stuck</template>
    </span>

    <!-- Finished status label + error -->
    <span v-if="isFinished" class="task-strip__finish-tag">{{ status?.label }}</span>
    <span v-if="task.error" class="task-strip__error" :title="task.error">— {{ task.error }}</span>

    <!-- Inline progress bar (when a percent is known and we're still running) -->
    <div v-if="task.percent != null && !isFinished" class="task-strip__track">
      <div class="task-strip__fill" :style="{ width: task.percent + '%' }" />
    </div>

    <span class="task-strip__spacer" />

    <!-- Details opens the panel -->
    <button
      type="button"
      class="task-strip__btn task-strip__btn--ghost"
      data-task-panel-toggle
      title="Open the full status panel"
      @click="store.openPanel()"
    >Details</button>

    <!-- Cancel while running -->
    <button
      v-if="!isFinished && task.onCancel"
      type="button"
      class="task-strip__btn task-strip__btn--danger"
      @click="store.cancel(task.id)"
    >Cancel</button>

    <!-- Retry when finished AND a retry handler was provided -->
    <button
      v-if="isFinished && task.onRetry"
      type="button"
      class="task-strip__btn task-strip__btn--ghost"
      title="Re-run the same operation"
      @click="store.retry(task.id)"
    >↻ Retry</button>

    <!-- Dismiss when finished -->
    <button
      v-if="isFinished"
      type="button"
      class="task-strip__btn task-strip__btn--icon"
      :title="task.status === 'failed' ? 'Dismiss this error' : 'Dismiss'"
      @click="store.dismiss(task.id)"
    >✕</button>
  </div>
</template>

<style>
/* GLOBAL (not scoped) — slot inheritance + dynamic class swaps work
   cleanly without scope-attribute matching. `.task-strip*` namespace
   is unique to this component. */

.task-strip {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 10px;
  border: 1px solid var(--accent-line);
  border-radius: 8px;
  background: var(--accent-soft);
  color: var(--accent-ink);
  font-size: 12.5px;
  transition: border-color 0.18s, background 0.18s;
}
.task-strip--ok {
  border-color: var(--accent-line);
  background: var(--accent-soft);
}
.task-strip--fail {
  border-color: var(--danger-line);
  background: var(--danger-bg);
  color: var(--danger-ink);
}
.task-strip--cancel {
  border-color: var(--line-strong);
  background: var(--surface-2);
  color: var(--ink-2);
}

.task-strip__sparkle {
  font-size: 13px;
  display: inline-block;
  animation: taskStripSpin 1.2s linear infinite;
}
@keyframes taskStripSpin { from { transform: rotate(0); } to { transform: rotate(360deg); } }

.task-strip__badge {
  display: inline-grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  flex-shrink: 0;
}
.task-strip--ok     .task-strip__badge { background: var(--accent); }
.task-strip--fail   .task-strip__badge { background: var(--danger); }
.task-strip--cancel .task-strip__badge { background: var(--ink-3); }

.task-strip__label {
  font-weight: 600;
  color: inherit;
}
.task-strip__feature {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-3);
  letter-spacing: 0.05em;
}

.task-strip__stat {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: inherit;
  opacity: 0.85;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.task-strip__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.task-strip__stat[data-fresh="stalling"] .task-strip__dot { background: var(--warn); animation: taskStripBlink 1.2s ease-in-out infinite; }
.task-strip__stat[data-fresh="stuck"]    .task-strip__dot { background: var(--danger); animation: taskStripBlink 1.2s ease-in-out infinite; }
.task-strip__stat[data-fresh="stalling"] { color: var(--warn-ink); opacity: 1; }
.task-strip__stat[data-fresh="stuck"]    { color: var(--danger-ink); opacity: 1; }
@keyframes taskStripBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.task-strip__finish-tag {
  font-family: var(--font-mono);
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.task-strip__error {
  font-size: 11px;
  font-style: italic;
  max-width: 360px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-strip__track {
  width: 140px;
  height: 4px;
  background: var(--surface);
  border-radius: var(--r-pill);
  overflow: hidden;
  border: 1px solid var(--accent-line);
}
.task-strip__fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}

.task-strip__spacer { flex: 1; min-width: 4px; }

.task-strip__btn {
  font: inherit;
  font-size: 11px;
  padding: 3px 10px;
  border-radius: var(--r-pill);
  cursor: pointer;
  border: 1px solid transparent;
  background: transparent;
}
.task-strip__btn--ghost {
  color: var(--accent-ink);
  border-color: var(--accent-line);
}
.task-strip--fail   .task-strip__btn--ghost { color: var(--danger-ink); border-color: var(--danger-line); }
.task-strip--cancel .task-strip__btn--ghost { color: var(--ink-2); border-color: var(--line-strong); }
.task-strip__btn--ghost:hover { background: rgba(0, 0, 0, 0.04); }

.task-strip__btn--danger {
  color: var(--danger);
  border-color: var(--danger);
}
.task-strip__btn--danger:hover { background: var(--danger-bg); }

.task-strip__btn--icon {
  width: 22px;
  height: 22px;
  padding: 0;
  display: inline-grid;
  place-items: center;
  font-size: 12px;
  color: var(--ink-3);
  border-color: var(--line-strong);
}
.task-strip__btn--icon:hover { background: var(--surface-2); color: var(--ink); }
</style>
