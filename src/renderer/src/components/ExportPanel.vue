<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  ExportPanel — the export step (mock: journeys export screen).

  Package card (M4B + chapter-WAV zip) + honest ACX checklist (only
  measured items get ✓/✗; unmeasured say so) + show notes for podcasts.
  Lifted out of ChapterView's fold-out panel (user decision 2026-06-12:
  export lives as Studio step 4; Projects and Chapters link here).

  Props: project (ProjectResponse record) + scenes (list).
-->
<script setup>
import { ref, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { projectsService } from "../services/projects.js";
import { useCopy } from "../services/copy.js";
import { UiButton, UiTag } from "@delebash/llm-ui";

const props = defineProps({
  project: { type: Object, required: true },
  scenes: { type: Array, default: () => [] },
});

const api = useApi();
const copy = useCopy();

const exportQc = ref(null);
const exportQcBusy = ref(false);
const exportBusy = ref("");
const showNotes = ref(null);

const qcError = ref("");
async function runExportQc() {
  if (!props.project?.id || exportQcBusy.value) return;
  exportQcBusy.value = true;
  exportQc.value = null;
  qcError.value = "";
  try {
    exportQc.value = await api.request(`/v1/projects/${props.project.id}/qc`);
  } catch (e) {
    // A 400 here usually means nothing is renderable yet (no engine
    // loaded / no rendered chapters) — say that, in place, instead of
    // toasting a raw error (user-hit: QC exploded on opening Export).
    qcError.value = String(e?.message || e).includes("400")
      ? "Nothing to measure yet — load an engine and render at least one chapter, then re-check."
      : `QC failed: ${e?.message || e}`;
  } finally {
    exportQcBusy.value = false;
  }
}

const qcDurationLabel = computed(() => {
  const total = (exportQc.value?.chapters || []).reduce((s, c) => s + (c.duration_s || 0), 0);
  if (!total) return "";
  const h = Math.floor(total / 3600), m = Math.round((total % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
});

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportM4B() {
  const p = props.project;
  if (!p || exportBusy.value) return;
  exportBusy.value = "m4b";
  pushToast({ message: "Export M4B — rendering anything not cached, then muxing chapters…", kind: "info" });
  try {
    const blob = await api.requestBlob("POST", `/v1/projects/${p.id}/export_m4b`);
    saveBlob(blob, `${(p.name || "book").replace(/[^\w.-]+/g, "_")}.m4b`);
    pushToast({ message: "M4B exported.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Export failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  } finally {
    exportBusy.value = "";
  }
}

async function exportChapterWavs() {
  const p = props.project;
  if (!p || exportBusy.value) return;
  exportBusy.value = "zip";
  pushToast({ message: "Packaging per-chapter audio…", kind: "info" });
  try {
    const blob = await projectsService.exportZip(p.id, { includeAudio: true, includeMasters: true });
    saveBlob(blob, `${(p.name || "book").replace(/[^\w.-]+/g, "_")}.zip`);
    pushToast({ message: "Chapter package exported.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Export failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  } finally {
    exportBusy.value = "";
  }
}

async function generateShowNotes() {
  const p = props.project;
  if (!p) return;
  showNotes.value = null;
  pushToast({ message: "Drafting show notes from the segments…", kind: "info" });
  try {
    showNotes.value = await api.request(`/v1/projects/${p.id}/show-notes`, { method: "POST" });
  } catch (e) {
    pushToast({ message: `Show notes failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  }
}

// Copy the drafted show-notes markdown. `navigator` is NOT in Vue's
// template global allowlist, so calling navigator.clipboard inline in the
// template threw a TypeError on click — it has to live in setup scope.
async function copyShowNotes() {
  const md = showNotes.value?.markdown;
  if (!md) return;
  try {
    await navigator.clipboard?.writeText(md);
    pushToast({ message: "Show notes copied.", kind: "success", duration: 2000 });
  } catch (e) {
    pushToast({ message: `Copy failed: ${e?.message || e}`, kind: "error" });
  }
}

// No auto-run (user-hit: opening Export fired QC and 400'd with no
// engine). The checklist sits at "unchecked" until Re-check is clicked.
</script>

<template>
  <div class="exportp">
    <div class="jv-card exportp__card">
      <div class="exportp__h">
        <strong>{{ copy.book.singular }} package</strong>
        <UiTag :intent="exportQc?.all_ok ? 'success' : 'ghost'">{{ exportQc?.all_ok ? "ready" : "unchecked" }}</UiTag>
      </div>
      <div class="exportp__id">
        <span class="exportp__portrait">{{ (project.name || "?").slice(0, 1).toUpperCase() }}</span>
        <div>
          <div class="exportp__name">{{ project.name }}</div>
          <div class="jv-muted" style="font-size:12px">
            {{ scenes.length }} {{ copy.chapter.plural.toLowerCase() }}<template v-if="qcDurationLabel"> · {{ qcDurationLabel }}</template>
          </div>
        </div>
      </div>
      <div class="exportp__row"><span>Format</span><b>M4B (AAC) · chapter markers from {{ copy.chapter.singular.toLowerCase() }} titles</b></div>
      <div class="exportp__row"><span>Also export</span><b>per-{{ copy.chapter.singular.toLowerCase() }} WAV + masters (zip)</b></div>
      <div class="exportp__row"><span>Master</span><b>{{ project.mastering_preset || (project.project_type === "audiobook" ? "ACX −20 LUFS" : "default") }}</b></div>
      <div class="exportp__actions">
        <UiButton intent="primary" :loading="exportBusy === 'm4b'" :disabled="!!exportBusy" label="⬇ Export M4B" @click="exportM4B" />
        <UiButton intent="secondary" :loading="exportBusy === 'zip'" :disabled="!!exportBusy" :label="`⬇ ${copy.chapter.singular} WAVs (zip)`" @click="exportChapterWavs" />
        <UiButton v-if="project.project_type === 'podcast'" intent="secondary" label="📝 Show notes" title="Draft episode show notes from the segments (LLM)" @click="generateShowNotes" />
      </div>
      <div v-if="showNotes" class="exportp__notes">
        <div class="exportp__h" style="margin-bottom:6px">
          <strong>Show notes</strong>
          <span class="jv-spacer" />
          <UiButton intent="ghost" size="small" label="⧉ Copy" title="Copy markdown" @click="copyShowNotes" />
          <UiButton intent="ghost" size="small" label="✕" @click="showNotes = null" />
        </div>
        <pre class="exportp__notes-pre">{{ showNotes.markdown }}</pre>
      </div>
    </div>

    <div class="jv-card exportp__card">
      <div class="exportp__h">
        <strong>ACX checklist</strong>
        <span class="jv-spacer" />
        <UiButton intent="ghost" size="small" :loading="exportQcBusy" label="↻ Re-check" title="Render every chapter (cache-served when unchanged) and measure RMS + peak against the ACX limits" @click="runExportQc" />
      </div>
      <p v-if="exportQcBusy" class="jv-muted">Rendering + measuring {{ copy.chapter.plural.toLowerCase() }} — cached audio makes this fast…</p>
      <div v-else-if="qcError" class="jv-banner jv-banner--warn" style="font-size:12px">{{ qcError }}</div>
      <template v-else-if="exportQc">
        <ul class="exportp__ckl">
          <li><span :class="exportQc.chapters.every(c => c.rms_ok) ? 'ok' : 'bad'">{{ exportQc.chapters.every(c => c.rms_ok) ? "✓" : "✗" }}</span>
            RMS between −23 dB and −18 dB ({{ exportQc.chapters.filter(c => c.rms_ok).length }} of {{ exportQc.chapters.length }} {{ copy.chapter.plural.toLowerCase() }})</li>
          <li><span :class="exportQc.chapters.every(c => c.peak_ok) ? 'ok' : 'bad'">{{ exportQc.chapters.every(c => c.peak_ok) ? "✓" : "✗" }}</span>
            Peak ≤ −3 dB</li>
          <li><span class="dim">○</span> Noise floor ≤ −60 dB RMS <span class="jv-muted">— not measured yet (needs room-tone analysis)</span></li>
          <li><span class="dim">○</span> Room tone head/tail <span class="jv-muted">— not measured yet</span></li>
          <li><span class="dim">○</span> Opening & closing credits <span class="jv-muted">— add as {{ copy.chapter.plural.toLowerCase() }}</span></li>
        </ul>
        <div class="jv-banner" :class="exportQc.all_ok ? 'jv-banner--info' : 'jv-banner--warn'" style="margin-top:10px;font-size:12px">
          {{ exportQc.all_ok
            ? "Measured checks pass. Mastering chain: project target — duplicate under Render Presets to tweak."
            : "Some chapters are out of spec — fix levels in Studio · Render, then re-check." }}
        </div>
      </template>
      <p v-else class="jv-muted">Run the check to measure every {{ copy.chapter.singular.toLowerCase() }} against the ACX limits.</p>
    </div>
  </div>
</template>

<style scoped>
.exportp { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; align-items: start; }
@media (max-width: 980px) { .exportp { grid-template-columns: 1fr; } }
.exportp__card { padding: 16px 18px; margin: 0; }
.exportp__h { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.exportp__id { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.exportp__portrait {
  width: 44px; height: 44px; border-radius: 10px; background: var(--accent);
  color: #fff; font-weight: 800; font-size: 20px;
  display: inline-flex; align-items: center; justify-content: center;
}
.exportp__name { font-weight: 700; font-size: 16px; }
.exportp__row { display: flex; justify-content: space-between; gap: 12px; font-size: 12.5px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.exportp__row span { color: var(--ink-3); }
.exportp__actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 14px; }
.exportp__ckl { list-style: none; margin: 0; padding: 0; font-size: 13px; }
.exportp__ckl li { padding: 5px 0; display: flex; gap: 8px; align-items: baseline; }
.exportp__ckl .ok { color: var(--accent-ink); font-weight: 700; }
.exportp__ckl .bad { color: var(--danger, #b04a3e); font-weight: 700; }
.exportp__ckl .dim { color: var(--ink-3); }
.exportp__notes { margin-top: 14px; }
.exportp__notes-pre { background: var(--surface-2); border-radius: 8px; padding: 12px; font-size: 12px; white-space: pre-wrap; max-height: 320px; overflow-y: auto; }
</style>
