<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Render — the chapter grid (the mock, dev only: #/mock/render). Slice 4, D5: today's
  chapter table on the kit's table, opening one chapter's lines the way Script does. Lines,
  Rendered, ▶ Render and the ACX check stay; Cached and Render preset go. A chapter is its lines'
  ★ takes joined (D4): ▶ Render gives every line with no take one, then joins and masters it;
  stale lines keep their ★ take until you render them again on the chapter's page.
-->
<script setup>
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { AppModal, UiButton, UiCheckbox, UiProgress, UiTable, UiTag, pushToast } from "@delebash/llm-ui";
import { silentWav } from "./personaMock.js";
import { PAUSE_BETWEEN_LINES_MS, counts, render, renderChapter, runQc } from "./renderMock.js";

const emit = defineEmits(["go"]);
const router = useRouter();

const rows = computed(() => {
  const out = [];
  for (const ch of render.chapters) {
    out.push(ch);
    if (render.tasks[ch.id]) out.push({ id: `${ch.id}__task`, task: true, ch });
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

// ── Ticks ──────────────────────────────────────────────────────────────
const ticked = ref({});
const picked = computed(() => render.chapters.filter((c) => ticked.value[c.id] && c.lines.length));
const allTicked = computed(() => render.chapters.some((c) => c.lines.length)
  && render.chapters.filter((c) => c.lines.length).every((c) => ticked.value[c.id]));
function tickAll(v) {
  ticked.value = Object.fromEntries(render.chapters.filter((c) => c.lines.length).map((c) => [c.id, v]));
}
function tickUnrendered() {
  ticked.value = Object.fromEntries(render.chapters.filter((c) => counts(c.lines).ready).map((c) => [c.id, true]));
}

// ── Rendering ──────────────────────────────────────────────────────────
const running = computed(() => Object.values(render.tasks).some((t) => t.status === "running"));
const stopped = ref(null);   // [{ ch, lines }] — lines with no speaker, the Render-stopped dialog
async function renderQueue(queue) {
  const found = queue.map((ch) => ({ ch, lines: ch.lines.filter((l) => !l.speaker_id) })).filter((g) => g.lines.length);
  if (found.length) {
    stopped.value = found;
    pendingQueue.value = queue;
    return;
  }
  for (const ch of queue) await renderChapter(ch);
}
const pendingQueue = ref([]);
function renderAll() {
  tickAll(true);
  renderQueue(render.chapters.filter((c) => c.lines.length));
}
defineExpose({ renderAll });
const stoppedTotal = computed(() => (stopped.value || []).reduce((n, g) => n + g.lines.length, 0));
function assignToNarrator() {
  for (const g of stopped.value) for (const l of g.lines) l.speaker_id = "s_narr1";
  pushToast({ kind: "success", message: `${stoppedTotal.value} lines given to the Narrator.` });
  stopped.value = null;
  renderQueue(pendingQueue.value);
}

function cancel(ch) {
  render.tasks[ch.id].status = "cancelled";
}
function dismiss(ch) {
  delete render.tasks[ch.id];
}
const BADGE = {
  running: { text: "rendering", intent: "solid" },
  done: { text: "done", intent: "success" },
  error: { text: "failed", intent: "danger" },
  cancelled: { text: "cancelled", intent: "accent2" },
};
const playing = ref(null);
function play(ch) {
  playing.value = { id: ch.id, url: URL.createObjectURL(silentWav(Math.min(render.tasks[ch.id].seconds, 30))) };
}
function download(ch) {
  pushToast({ kind: "info", message: `${ch.n}-${ch.title.replace(/\s+/g, "_")}.wav saved to Downloads.` });
}
const fmtLength = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

// ── The ACX check ──────────────────────────────────────────────────────
const qcBusy = ref(false);
async function qc() {
  qcBusy.value = true;
  await runQc();
  qcBusy.value = false;
  const all = render.chapters.filter((c) => c.lines.length).every((c) => render.qc[c.id]?.ok);
  pushToast({
    kind: all ? "success" : "info",
    message: all ? "ACX QC: every chapter passes (measured after the acx master)."
      : "ACX QC: some chapters are out of spec — see the Check column.",
  });
}
function checkState(ch) {
  const t = render.tasks[ch.id];
  if (t?.status === "running") return { intent: "info", label: "rendering…" };
  const q = render.qc[ch.id];
  if (q) {
    if (q.note) return { intent: "danger", label: "✗ can't render", title: q.note };
    const numbers = `RMS ${q.rms.toFixed(1)} dB · peak ${q.peak.toFixed(1)} dB`;
    if (q.ok) return { intent: "success", label: "✓ ACX pass", title: numbers };
    return { intent: "danger", label: `✗ ${!q.rms_ok ? "RMS" : "peak"} out of spec`, title: numbers };
  }
  if (t?.status === "done") return { intent: "success", label: "rendered" };
  if (ticked.value[ch.id]) return { intent: "ghost", label: "queued" };
  return { intent: "ghost", label: "—" };
}

function open(ch) {
  router.push({ name: "mock-render-chapter", params: { id: ch.id } });
}
</script>

<template>
  <section class="mock-render">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Chapter audio</h3>
        <span class="jv-hint">{{ total.all.toLocaleString() }} lines · {{ total.rendered }} rendered · {{ total.stale }} stale ·
          {{ total.ready }} ready{{ total.blocked ? ` · ${total.blocked} can't render` : "" }}</span>
      </div>
      <div class="jv-card__body">
        <p class="jv-lede">
          Every line becomes a take, and a chapter is its lines' ★ takes joined, {{ PAUSE_BETWEEN_LINES_MS }} ms apart,
          and mastered to the book's target. Open a chapter to hear its lines, say how they're spoken, and choose
          their takes.
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
            <UiButton intent="secondary" size="small" :loading="qcBusy" :disabled="qcBusy || running" label="🎧 Run ACX QC"
              title="Join every chapter that can render and measure RMS + peak against the ACX limits, after the master"
              @click="qc" />
          </div>

          <UiTable class="jv-table-look mock-render__grid" :data="rows" :columns="COLUMNS" data-key="id" row-hover
            :full-width-row="(r) => (r.task ? 'mock-render__task-row' : false)"
            :row-class="(r) => ({ 'mock-render__row--open': !r.task })"
            @row-click="({ data }) => { if (!data.task) open(data); }">
            <template #head-sel>
              <UiCheckbox :model-value="allTicked" title="Tick every chapter" @update:model-value="tickAll" />
            </template>
            <template #sel="{ row }">
              <span @click.stop>
                <UiCheckbox :model-value="!!ticked[row.id]" :disabled="!row.lines.length"
                  :title="row.lines.length ? '' : 'No text to render'"
                  @update:model-value="(v) => (ticked = { ...ticked, [row.id]: v })" />
              </span>
            </template>
            <template #title="{ row }"><strong>{{ row.n }} · {{ row.title }}</strong></template>
            <template #lines="{ row }">
              <span v-if="row.lines.length" class="jv-mono">{{ row.lines.length }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #rendered="{ row }">
              <span v-if="!row.lines.length" class="jv-muted">no text yet</span>
              <span v-else class="mock-render__rollup">
                <span class="jv-mono">{{ counts(row.lines).rendered + counts(row.lines).stale }}/{{ row.lines.length }}</span>
                <UiTag v-if="counts(row.lines).stale" intent="accent2"
                  title="Changed since their take was made — each plays its ★ take until you render it again">{{ counts(row.lines).stale }} stale</UiTag>
                <UiTag v-if="counts(row.lines).blocked" intent="danger">{{ counts(row.lines).blocked }} can't render</UiTag>
              </span>
            </template>
            <template #check="{ row }">
              <UiTag :intent="checkState(row).intent" :title="checkState(row).title || ''">{{ checkState(row).label }}</UiTag>
            </template>
            <template #acts="{ row }">
              <span class="mock-render__acts" @click.stop>
                <UiButton v-if="row.lines.length" intent="secondary" size="small" label="▶ Render"
                  :loading="render.tasks[row.id]?.status === 'running'" :disabled="running && render.tasks[row.id]?.status !== 'running'"
                  @click="renderQueue([row])" />
                <UiButton v-else intent="secondary" size="small" label="＋ Add text" title="Opens it in Script" @click="emit('go', 'script')" />
                <UiButton intent="ghost" size="small" label="Open ➜" @click="open(row)" />
              </span>
            </template>
            <template #full-row="{ row }">
              <div class="mock-render__task">
                <UiTag :intent="BADGE[render.tasks[row.ch.id].status].intent">{{ BADGE[render.tasks[row.ch.id].status].text }}</UiTag>
                <UiProgress class="mock-render__bar-fill" :value="render.tasks[row.ch.id].done" :max="render.tasks[row.ch.id].total" bare />
                <span v-if="render.tasks[row.ch.id].status === 'running'" class="jv-hint">
                  {{ render.tasks[row.ch.id].done }} of {{ render.tasks[row.ch.id].total }} lines</span>
                <span v-else-if="render.tasks[row.ch.id].status === 'done'" class="jv-hint">
                  {{ fmtLength(render.tasks[row.ch.id].seconds) }} · mastered</span>
                <span v-if="render.tasks[row.ch.id].error" class="mock-render__error">{{ render.tasks[row.ch.id].error }}</span>
                <UiButton v-if="render.tasks[row.ch.id].status === 'running'" intent="danger-outline" size="small" label="Cancel" @click="cancel(row.ch)" />
                <UiButton v-if="['error', 'cancelled'].includes(render.tasks[row.ch.id].status)" intent="secondary" size="small"
                  label="↻ Retry" @click="renderQueue([row.ch])" />
                <template v-if="render.tasks[row.ch.id].status === 'done'">
                  <UiButton intent="ghost" size="small" label="▶ Play" title="Play here in the row" @click="play(row.ch)" />
                  <UiButton intent="ghost" size="small" label="⬇ Download" title="Download WAV" @click="download(row.ch)" />
                </template>
                <UiButton v-if="render.tasks[row.ch.id].status !== 'running'" intent="ghost" size="small" label="✕" @click="dismiss(row.ch)" />
              </div>
              <audio v-if="playing?.id === row.ch.id" :src="playing.url" controls autoplay class="jv-audio-inline mock-render__audio" />
            </template>
            <template #empty>No chapters.</template>
          </UiTable>

          <div class="jv-inline-row mock-render__go">
            <UiButton intent="primary" :disabled="!picked.length || running"
              :label="picked.length ? `▶ Render ${picked.length} chapter${picked.length === 1 ? '' : 's'}` : '▶ Render'"
              @click="renderQueue(picked)" />
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
        These would be missing from the audio, so nothing is rendered until they have a speaker. Send them all to
        the narrator, or fix them in Script.
      </p>
      <div v-for="g in stopped" :key="g.ch.id" class="mock-render__stopped">
        <strong>{{ g.ch.n }} · {{ g.ch.title }}</strong>
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
.mock-render__bar-fill { flex: 0 1 220px; min-width: 120px; }
.mock-render__error { color: var(--danger); max-width: 60ch; }
.mock-render__audio { margin-top: 6px; }
.mock-render__go { gap: 10px; align-items: center; flex-wrap: wrap; }
.mock-render__stopped-lede { margin: 0 0 12px; }
.mock-render__stopped { margin-bottom: 12px; }
.mock-render__stopped-list { margin: 6px 0 0; padding-left: 18px; line-height: 1.5; }
</style>
