<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Render — the chapter grid (the mock, dev only: #/mock/render). Slice 4, D5: today's
  chapter table on the kit's table, opening one chapter's lines the way Script does. Lines,
  Rendered, ▶ Render and the ACX check stay; Cached and Render preset go. A chapter is its lines'
  takes in use joined (D4): ▶ Render gives every line with no take one, then joins and masters it;
  stale lines keep their take in use until you render them again on the chapter's page.

  A render is the app's kit task (2026-10-07): the chapter page's strip in the progress row, with
  the line rendering now; a finished chapter's ▶ Play on the page's one player.
-->
<script setup>
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  AiTaskStrip, AppModal, UiButton, UiCheckbox, UiTable, UiTag, pushToast, useAiTasksStore, withAiTask,
} from "@delebash/llm-ui";
import PagePlayer from "../components/PagePlayer.vue";
import PageTaskStrips from "../components/PageTaskStrips.vue";
import PlayTransport from "../components/PlayTransport.vue";
import { usePagePlayer } from "../composables/usePagePlayer.js";
import { CANT_RENDER, partOf } from "../services/lineStates.js";
import { loadingText, waitingText } from "../services/renderRun.js";
import { PROJECT, counts, render, renderChapter, runQc } from "./renderMock.js";

const emit = defineEmits(["go"]);
const router = useRouter();
const tasks = useAiTasksStore();

const titleOf = (ch) => `${ch.n} · ${ch.title}`;
const lineName = (c) => `line ${c.n}${c.speaker ? ` · ${c.speaker}` : ""}`;

// ── The grid, with a progress row under a chapter while it renders ───
function taskFor(id) {
  return tasks.visibleTasks.find((t) => t.feature === "render-scene" && t.meta?.sceneId === id) || null;
}
const isRunning = (id) => {
  const t = taskFor(id);
  return !!t && tasks.isRunning(t.id);
};
const anyRunning = computed(() => render.chapters.some((c) => isRunning(c.id)));
const rows = computed(() => {
  const out = [];
  for (const ch of render.chapters) {
    out.push(ch);
    if (taskFor(ch.id)) out.push({ id: `${ch.id}__task`, task: true, ch });
  }
  return out;
});
const RIGHT = { textAlign: "right", whiteSpace: "nowrap", width: "1%" };
const COLUMNS = [
  { id: "sel", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "title", header: "Chapter" },
  { id: "lines", header: "Lines", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "rendered", header: "Rendered", cellStyle: { whiteSpace: "nowrap" } },
  { id: "check", header: "Check", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap" } },
  { id: "acts", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap", textAlign: "right" } },
];
const total = computed(() => counts(render.chapters.flatMap((c) => c.lines)));

// One player for the page, as the app's: key "chapter:<id>"; dismissing the row stops it.
const player = usePagePlayer();
const playKey = (id) => `chapter:${id}`;
watch(() => String(player.key || "").startsWith("chapter:") && !taskFor(player.key.slice(8)), (gone) => {
  if (gone) player.stop();
});

// ── Ticks ──────────────────────────────────────────────────────────────
const ticked = ref({});
const tickable = computed(() => render.chapters.filter((c) => c.lines.length));
const picked = computed(() => tickable.value.filter((c) => ticked.value[c.id]));
const allTicked = computed(() => tickable.value.length > 0 && tickable.value.every((c) => ticked.value[c.id]));
function tickAll(v) {
  ticked.value = Object.fromEntries(tickable.value.map((c) => [c.id, v]));
}
function tickUnrendered() {
  ticked.value = Object.fromEntries(render.chapters.filter((c) => counts(c.lines).ready).map((c) => [c.id, true]));
}

// ── Rendering ──────────────────────────────────────────────────────────
const stopped = ref(null);   // [{ ch, lines }] — lines with no speaker, the Render-stopped dialog
const pendingQueue = ref([]);
// The chapters still waiting in a run of several — "queued" in Check while they wait.
const waiting = ref(new Set());
async function renderQueue(queue) {
  const found = queue.map((ch) => ({ ch, lines: ch.lines.filter((l) => !l.speaker_id) })).filter((g) => g.lines.length);
  if (found.length) {
    stopped.value = found;
    pendingQueue.value = queue;
    return;
  }
  waiting.value = new Set(queue.map((c) => c.id));
  try {
    for (const ch of queue) {
      waiting.value = new Set([...waiting.value].filter((id) => id !== ch.id));
      await renderOne(ch);
    }
  } finally {
    waiting.value = new Set();
  }
}
async function renderOne(ch) {
  try {
    const r = await renderChapter(ch, { onRetry: () => renderQueue([ch]) });
    if (r?.url) player.play(playKey(ch.id), r.url);
  } catch (e) {
    if (e?.name !== "AbortError") pushToast({ kind: "error", message: `${titleOf(ch)}: ${e?.message || e}`, duration: 9000 });
  }
}
function renderAll() {
  tickAll(true);
  renderQueue(tickable.value);
}
const stoppedTotal = computed(() => (stopped.value || []).reduce((n, g) => n + g.lines.length, 0));
function assignToNarrator() {
  for (const g of stopped.value) for (const l of g.lines) l.speaker_id = "s_narr1";
  pushToast({ kind: "success", message: "Those lines now read as Narrator." });
  stopped.value = null;
  renderQueue(pendingQueue.value);
}

// ── The ACX check ──────────────────────────────────────────────────────
const qcBusy = ref(false);
async function qc() {
  qcBusy.value = true;
  try {
    await withAiTask({ feature: "acx-qc", label: `ACX QC · ${PROJECT.name}`, meta: { projectId: PROJECT.id } }, () => runQc());
  } finally {
    qcBusy.value = false;
  }
  const all = tickable.value.every((c) => render.qc[c.id]?.ok);
  pushToast({
    kind: all ? "success" : "info",
    duration: 6000,
    message: all ? "ACX QC: every chapter passes (measured after the acx master)."
      : "ACX QC: some chapters are out of spec — see the Check column.",
  });
}
function checkState(ch) {
  if (isRunning(ch.id)) return { intent: "info", label: "rendering…" };
  const q = render.qc[ch.id];
  if (q) {
    if (q.note) return { intent: "danger", label: "✗ can't render", title: q.note };
    const numbers = `RMS ${q.rms.toFixed(1)} dB · peak ${q.peak.toFixed(1)} dB`;
    if (q.ok) return { intent: "success", label: "✓ ACX pass", title: numbers };
    return { intent: "danger", label: `✗ ${!q.rms_ok ? "RMS" : "peak"} out of spec`, title: numbers };
  }
  const t = taskFor(ch.id);
  if (t?.status === "done") return { intent: "success", label: "rendered" };
  if (t?.status === "error") return { intent: "danger", label: "failed", title: t.error || "" };
  if (t?.status === "cancelled") return { intent: "accent2", label: "cancelled" };
  if (waiting.value.has(ch.id)) return { intent: "ghost", label: "queued" };
  return { intent: "ghost", label: "—" };
}

function open(ch) {
  router.push({ name: "mock-render-chapter", params: { id: ch.id } });
}
</script>

<template>
  <section class="mock-render">
    <PagePlayer :player="player" />
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Chapter audio</h3>
        <span class="jv-hint">{{ total.all.toLocaleString() }} lines · {{ total.rendered }} rendered · {{ total.stale }} stale ·
          {{ total.ready }} ready{{ total.blocked ? ` · ${total.blocked} can't render` : "" }}</span>
      </div>
      <div class="jv-card__body">
        <p class="jv-lede">
          Every line becomes a take, and a chapter is its lines' takes in use joined and mastered to the book's target.
          Open a chapter to hear its lines, say how they're spoken, and choose their takes.
        </p>

        <div v-if="!render.chapters.length" class="jv-banner">
          No chapters yet — add or import them in <a href="#" @click.prevent="emit('go', 'script')">Script ➜</a>
        </div>
        <template v-else>
          <div class="jv-inline-row mock-render__bar">
            <UiButton intent="secondary" size="small" label="Select unrendered"
              title="Tick every chapter with lines that have no take yet" @click="tickUnrendered" />
            <span class="jv-hint">{{ picked.length }} selected</span>
            <span class="jv-spacer" />
            <UiButton intent="secondary" size="small" :loading="qcBusy" :disabled="qcBusy || anyRunning" label="🎧 Run ACX QC"
              title="Join every chapter that can render and measure RMS + peak against the ACX limits, after the master"
              @click="qc" />
          </div>
          <PageTaskStrips :features="['acx-qc']" :meta="{ projectId: PROJECT.id }" />

          <UiTable class="jv-table-look mock-render__grid" :data="rows" :columns="COLUMNS" data-key="id" row-hover
            :full-width-row="(r) => (r.task ? 'mock-render__task-row' : false)"
            :row-class="(r) => ({ 'mock-render__row--open': !r.task })"
            @row-click="({ data }) => { if (!data.task) open(data); }">
            <template #head-sel>
              <UiCheckbox :model-value="allTicked" :disabled="!tickable.length" title="Tick every chapter" @update:model-value="tickAll" />
            </template>
            <template #sel="{ row }">
              <span @click.stop>
                <UiCheckbox :model-value="!!ticked[row.id] && !!row.lines.length" :disabled="!row.lines.length"
                  :title="row.lines.length ? '' : 'No text to render'"
                  @update:model-value="(v) => (ticked = { ...ticked, [row.id]: v })" />
              </span>
            </template>
            <template #title="{ row }"><strong>{{ titleOf(row) }}</strong></template>
            <template #lines="{ row }">
              <span v-if="row.lines.length" class="jv-mono">{{ row.lines.length }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #rendered="{ row }">
              <span v-if="!row.lines.length" class="jv-muted">no text yet</span>
              <span v-else class="mock-render__rollup">
                <span>{{ partOf(counts(row.lines).rendered, row.lines.length, "line") }}</span>
                <UiTag v-if="counts(row.lines).stale" intent="accent2"
                  title="Changed since their take was made — each plays its take in use until you render it again">{{ counts(row.lines).stale }} stale</UiTag>
                <UiTag v-if="counts(row.lines).blocked" intent="danger">{{ counts(row.lines).blocked }} {{ CANT_RENDER }}</UiTag>
              </span>
            </template>
            <template #check="{ row }">
              <UiTag :intent="checkState(row).intent" :title="checkState(row).title || ''">{{ checkState(row).label }}</UiTag>
            </template>
            <template #acts="{ row }">
              <span class="mock-render__acts" @click.stop>
                <UiButton v-if="row.lines.length" intent="secondary" size="small" label="▶ Render"
                  :loading="isRunning(row.id)" :disabled="anyRunning && !isRunning(row.id)"
                  title="Each line with no take gets one, then the chapter is joined and mastered"
                  @click="renderQueue([row])" />
                <UiButton v-else intent="secondary" size="small" label="＋ Add text" title="Opens Script" @click="emit('go', 'script')" />
                <UiButton intent="ghost" size="small" label="Open ➜" @click="open(row)" />
              </span>
            </template>
            <template #full-row="{ row }">
              <div class="mock-render__task">
                <AiTaskStrip :task="taskFor(row.ch.id)" class="mock-render__strip">
                  <template #extra-stats="{ task }">
                    <span v-if="loadingText(task.render?.loading)" class="sts-stat">{{ loadingText(task.render.loading) }}</span>
                    <span v-else-if="task.render?.current" class="sts-stat">{{ lineName(task.render.current) }}</span>
                    <span v-else-if="waitingText(task.render?.waiting)" class="sts-stat">{{ waitingText(task.render.waiting) }}</span>
                  </template>
                </AiTaskStrip>
                <template v-if="taskFor(row.ch.id).status === 'done' && taskFor(row.ch.id).result?.url">
                  <UiButton intent="ghost" size="small" :label="player.isPlaying(playKey(row.ch.id)) ? '⏸ Pause' : '▶ Play'"
                    :title="player.isPlaying(playKey(row.ch.id)) ? 'Pause' : 'Play here in the row'"
                    @click="player.play(playKey(row.ch.id), taskFor(row.ch.id).result.url)" />
                  <UiButton as="a" :href="taskFor(row.ch.id).result.url" :download="taskFor(row.ch.id).result.filename"
                    intent="ghost" size="small" title="Download WAV">⬇ Download</UiButton>
                </template>
                <PlayTransport v-if="player.key === playKey(row.ch.id)" :player="player" width="long" />
              </div>
            </template>
            <template #empty>No chapters.</template>
          </UiTable>

          <div class="jv-inline-row mock-render__go">
            <UiButton intent="primary" :disabled="!picked.length || anyRunning"
              :label="picked.length ? `▶ Render ${picked.length} chapter${picked.length === 1 ? '' : 's'}` : '▶ Render'"
              @click="renderQueue(picked)" />
            <UiButton intent="secondary" :disabled="!tickable.length || anyRunning" label="▶ Render all"
              title="Render every chapter: each line with no take gets one, then it is joined and mastered"
              @click="renderAll" />
            <span class="jv-hint">{{ picked.length
              ? `${picked.reduce((n, c) => n + counts(c.lines).ready, 0)} lines get their first take · stale lines keep theirs · one chapter at a time`
              : "Pick at least one chapter." }}</span>
          </div>
        </template>
      </div>
    </div>

    <AppModal v-if="stopped" eyebrow="Render stopped"
      :title="`${stoppedTotal} line${stoppedTotal === 1 ? '' : 's'} have no speaker`" max-width="720px" dismissable
      @close="stopped = null">
      <p class="jv-muted mock-render__stopped-lede">
        These would be missing from the audio, so nothing is rendered until they have a speaker. Send them all to the
        narrator, or fix them in Script.
      </p>
      <div v-for="g in stopped" :key="g.ch.id" class="mock-render__stopped">
        <strong>{{ titleOf(g.ch) }}</strong>
        <span class="jv-muted"> — {{ g.lines.length }}</span>
        <UiButton intent="ghost" size="small" label="Fix in Script ➜"
          title="Opens this chapter on its lines with no speaker, the first one selected"
          @click="stopped = null; emit('go', 'script')" />
        <ul class="mock-render__stopped-list">
          <li v-for="l in g.lines.slice(0, 8)" :key="l.id" class="jv-muted">{{ l.text }}</li>
          <li v-if="g.lines.length > 8" class="jv-muted">…and {{ g.lines.length - 8 }} more</li>
        </ul>
      </div>
      <template #footer>
        <UiButton intent="secondary" label="Not now" @click="stopped = null" />
        <UiButton intent="primary" label="Assign all to Narrator" @click="assignToNarrator" />
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.mock-render { display: flex; flex-direction: column; gap: 14px; }
.mock-render__bar { gap: 8px; flex-wrap: wrap; align-items: center; margin: 0 0 10px; }
.mock-render__grid { margin: 0 0 12px; }
.mock-render__grid :deep(.mock-render__row--open) { cursor: pointer; }
.mock-render__grid :deep(.mock-render__task-row) td { background: var(--surface-2); }
.mock-render__rollup { display: inline-flex; align-items: center; gap: 6px; }
.mock-render__acts { display: inline-flex; gap: 6px; }
.mock-render__task { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.mock-render__strip { flex: 1 1 auto; min-width: 0; }
.mock-render__go { gap: 10px; align-items: center; flex-wrap: wrap; }
.mock-render__stopped-lede { margin: 0 0 12px; }
.mock-render__stopped { margin-bottom: 12px; }
.mock-render__stopped-list { margin: 6px 0 0; padding-left: 18px; line-height: 1.5; }
</style>
