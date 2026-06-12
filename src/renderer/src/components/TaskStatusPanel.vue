<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  TaskStatusPanel — right-side slide-in showing all in-flight render /
  install / train / compose tasks + recent history. Adapted from
  JustWrite's AiStatusPanel.

  Opens via TaskStrip's "Details" button, the floating "Open status
  panel" button (always-visible when something is running), or the
  topbar status pill (future). Closes on backdrop click / Escape / ✕.

  Status states (per task):
    running   — actively in flight
    completed — finished cleanly
    cancelled — user pressed Cancel
    failed    — backend/network error (sticks until manually dismissed)
-->
<script setup>
import { computed, onMounted, onBeforeUnmount } from "vue";
import { useRenderTasks } from "../stores/renderTasks.js";

const tasks = useRenderTasks();

const runningTasks  = computed(() => tasks.running.filter((t) => t.status === "running"));
const finishedTasks = computed(() => tasks.running.filter((t) => t.status !== "running"));

// Click-outside dismiss — but don't close on clicks inside the panel,
// on the floating opener pill, or inside the TaskStrip Details button.
function onDocClick(e) {
  if (!tasks.panelOpen) return;
  const t = e.target;
  if (!t) return;
  if (t.closest?.(".task-panel")) return;
  if (t.closest?.("[data-task-panel-toggle]")) return;
  if (t.closest?.('[role="dialog"], [role="listbox"]')) return;
  tasks.closePanel();
}
function onDocKey(e) {
  if (e.key === "Escape" && tasks.panelOpen) {
    e.stopPropagation();
    tasks.closePanel();
  }
}
onMounted(() => {
  document.addEventListener("click", onDocClick);
  document.addEventListener("keydown", onDocKey);
});
onBeforeUnmount(() => {
  document.removeEventListener("click", onDocClick);
  document.removeEventListener("keydown", onDocKey);
});

function fmtElapsed(task) {
  const end = task.finishedAt || tasks.now;
  const ms = Math.max(0, end - task.startedAt);
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
function fmtAgo(ts) {
  if (!ts) return "—";
  const m = Math.floor((tasks.now - ts) / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const STATUS_ICON = {
  completed: "✓",
  failed:    "⚠",
  cancelled: "⊘",
};
</script>

<template>
  <Teleport to="body">
    <transition name="task-panel-slide">
      <aside v-if="tasks.panelOpen" class="task-panel" role="dialog" aria-label="Task status">
        <header class="task-panel__head">
          <div>
            <div class="task-panel__eyebrow">Status</div>
            <h2 class="task-panel__title">AI tasks</h2>
          </div>
          <button type="button" class="task-panel__close" @click="tasks.closePanel()">✕ Close</button>
        </header>

        <!-- ── Running section ──────────────────────────────────────── -->
        <section class="task-panel__section">
          <div class="task-panel__section-h">
            <span>Running</span>
            <span class="task-panel__count">{{ runningTasks.length }}</span>
            <span class="task-panel__spacer" />
            <button
              v-if="runningTasks.length > 1"
              type="button"
              class="task-panel__action"
              @click="tasks.cancelAll()"
            >✕ Cancel all</button>
          </div>

          <div v-if="!runningTasks.length" class="task-panel__empty">
            Nothing running. Start a render, install, or LLM action and you'll see live status here.
          </div>

          <div v-for="t in runningTasks" :key="t.id" class="task-panel__card">
            <div class="task-panel__card-h">
              <span class="task-panel__card-label">{{ t.label }}</span>
              <span class="task-panel__card-feature">{{ t.feature || t.kind }}</span>
              <span class="task-panel__spacer" />
              <button
                v-if="t.onCancel"
                type="button"
                class="task-panel__cancel"
                @click="tasks.cancel(t.id)"
              >✕ Cancel</button>
            </div>
            <div class="task-panel__stats">
              <span class="task-panel__stat" :data-fresh="tasks.freshness(t) || 'fresh'">
                <span class="task-panel__dot" />
                {{ tasks.freshness(t) === "stuck" ? "Stuck" : tasks.freshness(t) === "working" ? "Working…" : "Live" }}
              </span>
              <span class="task-panel__stat">{{ fmtElapsed(t) }}</span>
              <span v-for="(s, i) in tasks.stats(t)" :key="i" class="task-panel__stat">{{ s }}</span>
            </div>
            <div v-if="t.percent != null" class="task-panel__track">
              <div class="task-panel__fill" :style="{ width: t.percent + '%' }" />
            </div>
          </div>
        </section>

        <!-- ── Recent section ───────────────────────────────────────── -->
        <section class="task-panel__section">
          <div class="task-panel__section-h">
            <span>Recent</span>
            <span class="task-panel__count">{{ tasks.history.length + finishedTasks.length }}</span>
            <span class="task-panel__spacer" />
            <button
              v-if="tasks.history.length"
              type="button"
              class="task-panel__action"
              @click="tasks.clearHistory()"
            >🗑 Clear</button>
          </div>

          <div v-if="!tasks.history.length && !finishedTasks.length" class="task-panel__empty task-panel__empty--small">
            No completed tasks yet.
          </div>

          <!-- Still-visible finished tasks (in 5s/3s auto-dismiss window) -->
          <div
            v-for="h in finishedTasks"
            :key="h.id"
            class="task-panel__hist"
            :data-status="h.status"
          >
            <span class="task-panel__hist-icon">{{ STATUS_ICON[h.status] }}</span>
            <div class="task-panel__hist-body">
              <div class="task-panel__hist-line">
                <span class="task-panel__hist-label">{{ h.label }}</span>
                <span class="task-panel__hist-ago">just now</span>
              </div>
              <div class="task-panel__hist-meta">
                <span>{{ fmtElapsed(h) }}</span>
                <span v-for="(s, i) in tasks.stats(h)" :key="i">· {{ s }}</span>
              </div>
              <div v-if="h.error" class="task-panel__hist-error">{{ h.error }}</div>
            </div>
            <div class="task-panel__hist-actions">
              <button
                v-if="h.onRetry"
                type="button"
                class="task-panel__hist-retry"
                title="Re-run the same operation"
                @click="tasks.retry(h.id)"
              >↻</button>
              <button
                type="button"
                class="task-panel__hist-dismiss"
                title="Dismiss"
                @click="tasks.dismiss(h.id)"
              >✕</button>
            </div>
          </div>

          <!-- Historic (already dismissed) -->
          <div
            v-for="h in tasks.history"
            :key="h.id"
            class="task-panel__hist"
            :data-status="h.status"
          >
            <span class="task-panel__hist-icon">{{ STATUS_ICON[h.status] }}</span>
            <div class="task-panel__hist-body">
              <div class="task-panel__hist-line">
                <span class="task-panel__hist-label">{{ h.label }}</span>
                <span class="task-panel__hist-ago">{{ fmtAgo(h.finishedAt) }}</span>
              </div>
              <div class="task-panel__hist-meta">
                <span>{{ fmtElapsed(h) }}</span>
                <span v-for="(s, i) in tasks.stats(h)" :key="i">· {{ s }}</span>
              </div>
              <div v-if="h.error" class="task-panel__hist-error">{{ h.error }}</div>
            </div>
            <div class="task-panel__hist-actions">
              <button
                v-if="h.onRetry"
                type="button"
                class="task-panel__hist-retry"
                title="Re-run the same operation"
                @click="tasks.retry(h.id)"
              >↻</button>
            </div>
          </div>
        </section>
      </aside>
    </transition>

    <!-- (The persistent "open status panel" affordance lives on the
         topbar status pill — App.vue makes the `Operational · URL` pill
         clickable and appends `· N in flight` when tasks are active.
         No floating bottom-right pill needed.) -->
  </Teleport>
</template>

<style>
/* GLOBAL (not scoped) so the strip's slot content + dynamic JS-driven
   class swaps inherit the same chip styling without scope-attribute
   gymnastics. The `.task-panel*` namespace is unique to this file. */

.task-panel {
  position: fixed;
  top: 64px; right: 16px; bottom: 24px;
  width: min(420px, calc(100vw - 32px));
  z-index: 230;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 12px;
  box-shadow: var(--shadow-3);
  display: flex;
  flex-direction: column;
  padding: 16px 18px 10px;
  gap: 14px;
  overflow: hidden;
  pointer-events: auto;
}
.task-panel-slide-enter-active,
.task-panel-slide-leave-active {
  transition: transform 0.22s cubic-bezier(0.4, 0, 0.2, 1), opacity 0.22s;
}
.task-panel-slide-enter-from,
.task-panel-slide-leave-to {
  transform: translateX(110%);
  opacity: 0;
}

.task-panel__head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 14px;
  flex-shrink: 0;
}
.task-panel__eyebrow {
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 600;
}
.task-panel__title {
  font-size: 18px;
  font-weight: 600;
  margin: 3px 0 0;
}
.task-panel__close {
  font: inherit;
  font-size: 11px;
  padding: 4px 10px;
  border: 1px solid var(--line-strong);
  border-radius: var(--r-pill);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
}
.task-panel__close:hover { background: var(--surface-2); color: var(--ink); }

.task-panel__section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  overflow-y: auto;
  min-height: 0;
}
.task-panel__section + .task-panel__section {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
.task-panel__section-h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 10px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--ink-3);
  font-weight: 600;
}
.task-panel__count {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--ink-2);
  font-weight: 500;
  letter-spacing: 0;
}
.task-panel__spacer { flex: 1; }
.task-panel__action {
  font: inherit;
  font-size: 10.5px;
  padding: 3px 8px;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
}
.task-panel__action:hover { color: var(--ink); background: var(--surface-2); border-radius: 4px; }

.task-panel__empty {
  font-size: 12.5px;
  color: var(--ink-3);
  font-style: italic;
  padding: 12px 14px;
  background: var(--surface-2);
  border-radius: 8px;
  line-height: 1.5;
}
.task-panel__empty--small { padding: 8px 12px; font-size: 11.5px; }

/* Running task card — accent-tinted */
.task-panel__card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid var(--accent-line);
  border-radius: 9px;
  background: var(--accent-soft);
}
.task-panel__card-h { display: flex; align-items: center; gap: 8px; }
.task-panel__card-label {
  font-weight: 600;
  font-size: 13px;
  color: var(--accent-ink);
}
.task-panel__card-feature {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-3);
  letter-spacing: 0.05em;
}
.task-panel__cancel {
  font: inherit;
  font-size: 10.5px;
  padding: 3px 9px;
  border: 1px solid var(--danger);
  background: transparent;
  color: var(--danger);
  border-radius: var(--r-pill);
  cursor: pointer;
}
.task-panel__cancel:hover { background: var(--danger-bg); }

.task-panel__stats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--accent-ink);
  opacity: 0.92;
  font-variant-numeric: tabular-nums;
}
.task-panel__stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.task-panel__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
}
.task-panel__stat[data-fresh="fresh"]    .task-panel__dot { background: var(--accent); }
.task-panel__stat[data-fresh="working"] .task-panel__dot { background: var(--accent); }
.task-panel__stat[data-fresh="stuck"]    .task-panel__dot { background: var(--danger); animation: taskPanelBlink 1.2s ease-in-out infinite; }
.task-panel__stat[data-fresh="working"] { color: var(--ink-2); }
.task-panel__stat[data-fresh="stuck"]    { color: var(--danger-ink); }
@keyframes taskPanelBlink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

.task-panel__track {
  height: 5px;
  background: var(--surface);
  border: 1px solid var(--accent-line);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.task-panel__fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s;
}

/* History row */
.task-panel__hist {
  display: grid;
  grid-template-columns: 22px 1fr auto;
  gap: 8px;
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
  align-items: start;
}
.task-panel__hist-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}
.task-panel__hist-retry {
  font: inherit;
  font-size: 12px;
  background: transparent;
  border: 1px solid var(--accent-line);
  color: var(--accent-ink);
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 4px;
}
.task-panel__hist-retry:hover { background: var(--accent-soft); }
.task-panel__hist:last-child { border-bottom: 0; }
.task-panel__hist-icon {
  display: grid;
  place-items: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  color: #fff;
  font-weight: 700;
  font-size: 11px;
  margin-top: 1px;
}
.task-panel__hist[data-status="completed"] .task-panel__hist-icon { background: var(--accent); }
.task-panel__hist[data-status="failed"]    .task-panel__hist-icon { background: var(--danger); }
.task-panel__hist[data-status="cancelled"] .task-panel__hist-icon { background: var(--ink-3); }
.task-panel__hist-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.task-panel__hist-line { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
.task-panel__hist-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.task-panel__hist-ago {
  font-family: var(--font-mono);
  font-size: 10px;
  color: var(--ink-3);
  white-space: nowrap;
}
.task-panel__hist-meta {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--ink-3);
  font-variant-numeric: tabular-nums;
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}
.task-panel__hist-error {
  font-size: 11px;
  color: var(--danger-ink);
  margin-top: 4px;
  line-height: 1.4;
  word-wrap: break-word;
}
.task-panel__hist-dismiss {
  font: inherit;
  font-size: 11px;
  background: transparent;
  border: 0;
  color: var(--ink-3);
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 4px;
}
.task-panel__hist-dismiss:hover { background: var(--surface-2); color: var(--ink); }

</style>
