<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Render — the chapter grid (Studio Slice 4, decided 2026-10-04;
  docs/plans/2026-10-04-slice-4-render.md, drawn first as the in-app mock
  src/mock/MockRenderGrid.vue). D5: the chapter table on the kit's table,
  opening one chapter's lines (StudioRenderChapter.vue) the way Script does.
  Lines, Rendered, ▶ Render and the ACX check stay; Cached and Render preset
  went.

  A chapter is its lines' takes in use joined and mastered (D4). ▶ Render gives
  every line with no take one, then joins the chapter (services/renderRun.js);
  stale lines keep their take in use until you render them again on the chapter's
  page. The counts are GET /v1/projects/{id}/render_state, in §8.16's words.

  Shapes: Script's chapter grid (StudioScript.vue) — card, chips row, kit
  table in .jv-table-look, the verb under the grid; the progress row is a
  full-width row of the same table.
-->
<script setup>
import { computed, ref } from "vue";
import {
  AiTaskStrip, AppModal, UiButton, UiCheckbox, UiTable, UiTag, pushToast, useAiTasksStore, withAiTask,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { useCopy } from "../services/copy.js";
import { CANT_RENDER, partOf } from "../services/lineStates.js";
import { renderChapter } from "../services/renderRun.js";
import PageTaskStrips from "./PageTaskStrips.vue";

const props = defineProps({
  project: { type: Object, required: true },
  scenes: { type: Array, default: () => [] },
  // GET /v1/projects/{id}/render_state — Studio owns it (its step card and Overview read it too).
  renderState: { type: Object, default: null },
  // The book's speakers — the Render-stopped dialog sends lines to the narrator.
  speakers: { type: Array, default: () => [] },
  // GET /v1/projects/{id}/script's rows — whether a chapter was analyzed.
  chapters: { type: Array, default: () => [] },
});
const emit = defineEmits(["open", "go", "changed"]);

const api = useApi();
const tasks = useAiTasksStore();
const copy = useCopy();
const word = computed(() => copy.value.chapter);
const lower = (n) => (n === 1 ? word.value.singular : word.value.plural).toLowerCase();

const stateById = computed(() => Object.fromEntries((props.renderState?.chapters || []).map((c) => [c.scene_id, c])));
const totals = computed(() => props.renderState?.totals || null);
const ordered = computed(() => [...props.scenes].sort((a, b) => a.position - b.position));
const counts = (s) => stateById.value[s.id] || null;
const blockedOf = (c) => (c ? c.needs_speaker + c.needs_voice : 0);
// "12 of 40 lines" under Rendered — a current take (services/lineStates.js,
// 2026-10-06); the chapter's stale lines show as their own tag.
const titleOf = (s) => `${s.position + 1} · ${s.title || `${word.value.singular} ${s.position + 1}`}`;
const lineName = (c) => `line ${c.n}${c.speaker ? ` · ${c.speaker}` : ""}`;

// ── The grid, with a progress row under a chapter while it renders ───
function taskFor(sceneId) {
  return tasks.visibleTasks.find((t) => t.feature === "render-scene" && t.meta?.sceneId === sceneId) || null;
}
const isRunning = (sceneId) => {
  const t = taskFor(sceneId);
  return !!t && tasks.isRunning(t.id);
};
const anyRunning = computed(() => ordered.value.some((s) => isRunning(s.id)));
const rows = computed(() => {
  const out = [];
  for (const s of ordered.value) {
    out.push(s);
    if (taskFor(s.id)) out.push({ id: `${s.id}__task`, task: true, scene: s });
  }
  return out;
});
const RIGHT = { textAlign: "right", whiteSpace: "nowrap", width: "1%" };
const COLUMNS = computed(() => [
  { id: "sel", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "title", header: word.value.singular },
  { id: "lines", header: "Lines", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "rendered", header: "Rendered", cellStyle: { whiteSpace: "nowrap" } },
  { id: "check", header: "Check", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap" } },
  { id: "acts", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap", textAlign: "right" } },
]);
const playing = ref(null);   // { id, url }

// ── Ticks ────────────────────────────────────────────────────────────
const ticked = ref({});
const hasLines = (s) => (counts(s)?.lines || 0) > 0;
const picked = computed(() => ordered.value.filter((s) => ticked.value[s.id] && hasLines(s)));
const tickable = computed(() => ordered.value.filter(hasLines));
const allTicked = computed(() => tickable.value.length > 0 && tickable.value.every((s) => ticked.value[s.id]));
function tickAll(v) {
  ticked.value = Object.fromEntries(tickable.value.map((s) => [s.id, v]));
}
function tickUnrendered() {
  ticked.value = Object.fromEntries(ordered.value.filter((s) => counts(s)?.ready).map((s) => [s.id, true]));
}
const pickedReady = computed(() => picked.value.reduce((n, s) => n + (counts(s)?.ready || 0), 0));

// ── Rendering ────────────────────────────────────────────────────────
// Lines with no speaker stop a render one step early, where the fix is: the
// lines named, with the one-click way out (the server refuses them anyway).
const stopped = ref(null);   // [{ scene, lines: [{block_id, text}], analyzed }]
const stoppedQueue = ref([]);
const fixing = ref(false);
const stoppedTotal = computed(() => (stopped.value || []).reduce((n, g) => n + g.lines.length, 0));
const narrator = computed(() => props.speakers.find((sp) => sp.role_label === "narrator") || null);

// The chapters still waiting in a run of several — "queued" in Check while they
// wait, and only then (a ticked chapter that failed said "queued", 2026-10-07).
const waiting = ref(new Set());
async function renderQueue(queue) {
  const found = [];
  for (const s of queue) {
    if (!counts(s)?.needs_speaker) continue;
    const page = await api.safeRequest(`/v1/scenes/${s.id}/render_lines`, null);
    const lines = (page?.lines || []).filter((l) => l.state === "needs a speaker");
    if (lines.length) {
      found.push({ scene: s, lines, analyzed: !!props.chapters.find((c) => c.scene_id === s.id)?.analyzed });
    }
  }
  if (found.length) {
    stopped.value = found;
    stoppedQueue.value = queue;
    return;
  }
  waiting.value = new Set(queue.map((s) => s.id));
  try {
    for (const s of queue) {
      waiting.value = new Set([...waiting.value].filter((id) => id !== s.id));
      await renderOne(s);
    }
  } finally {
    waiting.value = new Set();
  }
}
async function renderOne(s) {
  try {
    const r = await renderChapter(api, {
      sceneId: s.id, projectId: props.project.id, title: titleOf(s), onRetry: () => renderQueue([s]),
    });
    if (r?.url) playing.value = { id: s.id, url: r.url };
  } catch (e) {
    if (e?.name !== "AbortError") pushToast({ kind: "error", message: `${titleOf(s)}: ${e?.message || e}`, duration: 9000 });
  } finally {
    emit("changed");
  }
}
/** ▶ Render all (Studio's step bar). */
function renderAll() {
  tickAll(true);
  renderQueue(tickable.value);
}
defineExpose({ renderAll });

async function assignToNarrator() {
  if (!narrator.value) return;
  fixing.value = true;
  let failed = 0;
  for (const g of stopped.value) {
    for (const l of g.lines) {
      try {
        await api.request(`/v1/blocks/${l.block_id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          // `corrected` freezes a line against every future re-analyze — honest
          // only where a run decided something and you overrule it.
          body: JSON.stringify(g.analyzed
            ? { speaker_id: narrator.value.id, source: "corrected" }
            : { speaker_id: narrator.value.id }),
        });
      } catch { failed += 1; }
    }
  }
  fixing.value = false;
  stopped.value = null;
  emit("changed");
  pushToast({
    kind: failed ? "warning" : "success",
    message: failed
      ? `Assigned those lines to ${narrator.value.name}; ${failed} failed.`
      : `Those lines now read as ${narrator.value.name}.`,
  });
  if (!failed) renderQueue(stoppedQueue.value);
}

// ── The ACX check ────────────────────────────────────────────────────
const qcBusy = ref(false);
const qcByScene = ref({});
async function runQc() {
  if (qcBusy.value) return;
  qcBusy.value = true;
  try {
    const r = await withAiTask({
      feature: "acx-qc",
      label: `ACX QC · ${props.project.name || ""}`,
      meta: { projectId: props.project.id },
    }, (task) => api.request(`/v1/projects/${props.project.id}/qc`, { signal: task.signal }));
    qcByScene.value = Object.fromEntries((r?.chapters || []).map((c) => [c.scene_id, c]));
    if (r?.note) pushToast({ kind: "warning", message: r.note, duration: 9000 });
    else {
      pushToast({
        kind: r?.all_ok ? "success" : "info",
        duration: 6000,
        message: r?.all_ok
          ? `ACX QC: every ${word.value.singular.toLowerCase()} passes${r?.master_preset ? ` (measured after the ${r.master_preset} master)` : ""}.`
          : `ACX QC: some ${word.value.plural.toLowerCase()} are out of spec — see the Check column.`,
      });
    }
  } catch (e) {
    if (e?.name !== "AbortError") pushToast({ kind: "error", message: `ACX QC failed: ${e?.message || e}` });
  } finally {
    qcBusy.value = false;
  }
}
function checkState(s) {
  if (isRunning(s.id)) return { intent: "info", label: "rendering…" };
  const qc = qcByScene.value[s.id];
  if (qc) {
    const numbers = `RMS ${qc.rms_dbfs?.toFixed?.(1)} dB · peak ${qc.peak_dbfs?.toFixed?.(1)} dB · ${Math.round(qc.duration_s || 0)}s`;
    if (qc.ok) return { intent: "success", label: "✓ ACX pass", title: numbers };
    // A chapter that can't render failed for a reason the numbers don't carry.
    if (qc.note) return { intent: "danger", label: "✗ can't render", title: qc.note };
    return { intent: "danger", label: `✗ ${!qc.rms_ok ? "RMS" : "peak"} out of spec`, title: numbers };
  }
  if (taskFor(s.id)?.status === "done") return { intent: "success", label: "rendered" };
  if (taskFor(s.id)?.status === "error") return { intent: "danger", label: "failed", title: taskFor(s.id).error || "" };
  if (taskFor(s.id)?.status === "cancelled") return { intent: "accent2", label: "cancelled" };
  if (waiting.value.has(s.id)) return { intent: "ghost", label: "queued" };
  return { intent: "ghost", label: "—" };
}
</script>

<template>
  <section class="studio-render">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">{{ word.singular }} audio</h3>
        <span v-if="totals" class="jv-hint">{{ totals.lines.toLocaleString() }} lines · {{ totals.rendered.toLocaleString() }} rendered ·
          {{ totals.stale.toLocaleString() }} stale · {{ totals.ready.toLocaleString() }} ready{{ totals.needs_speaker + totals.needs_voice
            ? ` · ${(totals.needs_speaker + totals.needs_voice).toLocaleString()} can't render` : "" }}</span>
      </div>
      <div class="jv-card__body">
        <p class="jv-lede">
          Every line becomes a take, and a {{ word.singular.toLowerCase() }} is its lines' takes in use joined and mastered to
          the book's target. Open a {{ word.singular.toLowerCase() }} to hear its lines, say how they're spoken, and
          choose their takes.
        </p>

        <div v-if="!scenes.length" class="jv-banner">
          No {{ word.plural.toLowerCase() }} yet — add or import them in
          <a href="#studio" @click.prevent="emit('go', 'script')">Script ➜</a>
        </div>
        <template v-else>
          <div class="jv-inline-row studio-render__bar">
            <UiButton intent="secondary" size="small" label="Select unrendered"
              :title="`Tick every ${word.singular.toLowerCase()} with lines that have no take yet`" @click="tickUnrendered" />
            <span class="jv-hint">{{ picked.length }} selected</span>
            <span class="jv-spacer" />
            <UiButton intent="secondary" size="small" :loading="qcBusy" :disabled="qcBusy || anyRunning" label="🎧 Run ACX QC"
              :title="`Join every ${word.singular.toLowerCase()} that can render and measure RMS + peak against the ACX limits, after the master`"
              @click="runQc" />
          </div>
          <PageTaskStrips :features="['acx-qc']" :meta="{ projectId: project.id }" />

          <UiTable class="jv-table-look studio-render__grid" :data="rows" :columns="COLUMNS" data-key="id" row-hover
            :full-width-row="(r) => (r.task ? 'studio-render__task-row' : false)"
            :row-class="(r) => ({ 'studio-render__row--open': !r.task })"
            @row-click="({ data }) => { if (!data.task) emit('open', data.id); }">
            <template #head-sel>
              <UiCheckbox :model-value="allTicked" :disabled="!tickable.length"
                :title="`Tick every ${word.singular.toLowerCase()}`" @update:model-value="tickAll" />
            </template>
            <template #sel="{ row }">
              <span @click.stop>
                <UiCheckbox :model-value="!!ticked[row.id] && hasLines(row)" :disabled="!hasLines(row)"
                  :title="hasLines(row) ? '' : 'No text to render'"
                  @update:model-value="(v) => (ticked = { ...ticked, [row.id]: v })" />
              </span>
            </template>
            <template #title="{ row }"><strong>{{ titleOf(row) }}</strong></template>
            <template #lines="{ row }">
              <span v-if="hasLines(row)" class="jv-mono">{{ counts(row).lines.toLocaleString() }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #rendered="{ row }">
              <span v-if="!counts(row)" class="jv-muted">…</span>
              <span v-else-if="!hasLines(row)" class="jv-muted">no text yet</span>
              <span v-else class="studio-render__rollup">
                <span>{{ partOf(counts(row).rendered, counts(row).lines, "line") }}</span>
                <UiTag v-if="counts(row).stale" intent="accent2"
                  title="Changed since their take was made — each plays its take in use until you render it again">{{ counts(row).stale }} stale</UiTag>
                <UiTag v-if="blockedOf(counts(row))" intent="danger">{{ blockedOf(counts(row)) }} {{ CANT_RENDER }}</UiTag>
              </span>
            </template>
            <template #check="{ row }">
              <UiTag :intent="checkState(row).intent" :title="checkState(row).title || ''">{{ checkState(row).label }}</UiTag>
            </template>
            <template #acts="{ row }">
              <span class="studio-render__acts" @click.stop>
                <UiButton v-if="hasLines(row)" intent="secondary" size="small" label="▶ Render"
                  :loading="isRunning(row.id)" :disabled="anyRunning && !isRunning(row.id)"
                  :title="`Each line with no take gets one, then the ${word.singular.toLowerCase()} is joined and mastered`"
                  @click="renderQueue([row])" />
                <UiButton v-else intent="secondary" size="small" label="＋ Add text" title="Opens Script" @click="emit('go', 'script')" />
                <UiButton intent="ghost" size="small" label="Open ➜" @click="emit('open', row.id)" />
              </span>
            </template>
            <template #full-row="{ row }">
              <!-- The chapter page's strip (decided 2026-10-07): progress, the line
                   rendering now, the figures, Cancel · Retry · dismiss. -->
              <div class="studio-render__task">
                <AiTaskStrip :task="taskFor(row.scene.id)" class="studio-render__strip">
                  <template #extra-stats="{ task }">
                    <span v-if="task.render?.current" class="sts-stat">{{ lineName(task.render.current) }}</span>
                  </template>
                </AiTaskStrip>
                <template v-if="taskFor(row.scene.id).status === 'done' && taskFor(row.scene.id).result?.url">
                  <UiButton intent="ghost" size="small" label="▶ Play" title="Play here in the row"
                    @click="playing = { id: row.scene.id, url: taskFor(row.scene.id).result.url }" />
                  <UiButton as="a" :href="taskFor(row.scene.id).result.url" :download="taskFor(row.scene.id).result.filename"
                    intent="ghost" size="small" title="Download WAV">⬇ Download</UiButton>
                </template>
              </div>
              <audio v-if="playing?.id === row.scene.id" :src="playing.url" controls autoplay
                class="jv-audio-inline studio-render__audio" />
            </template>
            <template #empty>No {{ word.plural.toLowerCase() }}.</template>
          </UiTable>

          <div class="jv-inline-row studio-render__go">
            <UiButton intent="primary" :disabled="!picked.length || anyRunning"
              :label="picked.length ? `▶ Render ${picked.length} ${lower(picked.length)}` : '▶ Render'"
              @click="renderQueue(picked)" />
            <span class="jv-hint">{{ picked.length
              ? `${pickedReady.toLocaleString()} lines get their first take · stale lines keep theirs · one ${word.singular.toLowerCase()} at a time`
              : `Pick at least one ${word.singular.toLowerCase()}.` }}</span>
          </div>
        </template>
      </div>
    </div>

    <AppModal v-if="stopped" eyebrow="Render stopped"
      :title="`${stoppedTotal} line${stoppedTotal === 1 ? '' : 's'} have no speaker`" max-width="720px" dismissable
      @close="stopped = null">
      <p class="jv-muted studio-render__stopped-lede">
        These would be missing from the audio, so nothing is rendered until they have a speaker. Send them all to the
        narrator, or fix them in Script.
      </p>
      <div v-for="g in stopped" :key="g.scene.id" class="studio-render__stopped">
        <strong>{{ titleOf(g.scene) }}</strong>
        <span class="jv-muted"> — {{ g.lines.length }}</span>
        <UiButton intent="ghost" size="small" label="Fix in Script ➜"
          :title="`Opens this ${word.singular.toLowerCase()} on its lines with no speaker, the first one selected`"
          @click="stopped = null; emit('go', 'script', { sceneId: g.scene.id, focus: 'none' })" />
        <ul class="studio-render__stopped-list">
          <li v-for="l in g.lines.slice(0, 8)" :key="l.block_id" class="jv-muted">{{ l.text }}</li>
          <li v-if="g.lines.length > 8" class="jv-muted">…and {{ g.lines.length - 8 }} more</li>
        </ul>
      </div>
      <template #footer>
        <UiButton intent="secondary" label="Not now" @click="stopped = null" />
        <UiButton intent="primary" :loading="fixing" :disabled="fixing || !narrator"
          :label="`Assign all to ${narrator ? narrator.name : 'Narrator'}`"
          :title="narrator ? '' : 'This book has no narrator — add one on Cast'" @click="assignToNarrator" />
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.studio-render { display: flex; flex-direction: column; gap: 14px; }
.studio-render__bar { gap: 8px; flex-wrap: wrap; align-items: center; margin: 0 0 10px; }
.studio-render__grid { margin: 0 0 12px; }
.studio-render__grid :deep(.studio-render__row--open) { cursor: pointer; }
.studio-render__grid :deep(.studio-render__task-row) td { background: var(--surface-2); }
.studio-render__rollup { display: inline-flex; align-items: center; gap: 6px; }
.studio-render__acts { display: inline-flex; gap: 6px; }
.studio-render__task { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.studio-render__strip { flex: 1 1 auto; min-width: 0; }
.studio-render__audio { margin-top: 6px; }
.studio-render__go { gap: 10px; align-items: center; flex-wrap: wrap; }
.studio-render__stopped-lede { margin: 0 0 12px; }
.studio-render__stopped { margin-bottom: 12px; }
.studio-render__stopped-list { margin: 6px 0 0; padding-left: 18px; line-height: 1.5; }
</style>
