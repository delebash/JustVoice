<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Import review — the mock's "Import — stillwater.epub" PAGE (user
  decision 2026-06-12: the picker stays a small dialog; the RESULTS are
  a regular in-app page). Two-col: Detected structure (include
  checkboxes per chapter) · Import summary (+ speakers-found-later
  banner). Footer: Import N chapters ➜ / Cancel — go back.

  Arrives via #importreview with the file + dry-run in importDraft;
  with no draft it bounces back to Projects.
-->
<script setup>
import { ref, computed, onMounted } from "vue";
import { pushToast } from "../services/toastBridge.js";
import { projectsService } from "../services/projects.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { getImportDraft, clearImportDraft, updateImportStandard } from "../stores/importDraft.js";
import { UiButton } from "@delebash/llm-ui";

const activeProject = useActiveProject();
const projectsStore = useProjectsStore();
const draft = ref(null);
const committing = ref(false);
const excluded = ref(new Set());

onMounted(() => {
  draft.value = getImportDraft();
  if (!draft.value) window.location.hash = "#projects";
});

// ── Chapter-split strategy (book_prose only) — changing it re-runs the
// dry run server-side and replaces the detected structure.
const SPLIT_OPTIONS = [
  { value: "auto", label: "Auto (format default)" },
  { value: "h1", label: "Chapter headings (H1)" },
  { value: "h1_h2", label: "H1 + H2 headings" },
  { value: "none", label: "Don't split — one chapter" },
];
const splitBusy = ref(false);
const showSplit = computed(() => draft.value?.source === "book_prose");

async function changeSplit(splitOn) {
  if (!draft.value || splitBusy.value || splitOn === draft.value.splitOn) return;
  splitBusy.value = true;
  try {
    const res = await projectsService.runImport({
      source: draft.value.source,
      file: draft.value.file,
      dryRun: true,
      splitOn,
    });
    updateImportStandard(res?.standard, splitOn);
    draft.value = getImportDraft();
    excluded.value = new Set(); // chapter indices changed — reset picks
  } catch (e) {
    pushToast({ kind: "error", title: "Re-split failed", description: String(e?.message ?? e) });
  } finally {
    splitBusy.value = false;
  }
}

const WORDS_PER_MINUTE = 155;
function estAudio(words) {
  if (!words) return "—";
  const min = words / WORDS_PER_MINUTE;
  return min < 1 ? "<1 min" : `~${Math.round(min)} min`;
}

const scenes = computed(() => {
  const list = draft.value?.standard?.scenes || [];
  return list.map((sc, i) => {
    const words = (sc.lines || []).reduce(
      (acc, l) => acc + (l.text ? l.text.split(/\s+/).length : 0), 0,
    );
    return { index: i, title: sc.title || `Chapter ${i + 1}`, lines: sc.lines?.length || 0, words, est: estAudio(words) };
  });
});

function toggle(i) {
  const next = new Set(excluded.value);
  if (next.has(i)) next.delete(i); else next.add(i);
  excluded.value = next;
}

const included = computed(() => scenes.value.filter((s) => !excluded.value.has(s.index)));
const totalWords = computed(() => included.value.reduce((a, s) => a + s.words, 0));
const totalEst = computed(() => {
  const min = totalWords.value / WORDS_PER_MINUTE;
  if (!min) return "—";
  const h = Math.floor(min / 60);
  return h ? `≈ ${h} h ${String(Math.round(min % 60)).padStart(2, "0")} m` : `≈ ${Math.round(min)} min`;
});
const characterCount = computed(() => draft.value?.standard?.characters?.length || 0);
const warnings = computed(() => draft.value?.standard?.warnings || []);

async function doImport() {
  if (!included.value.length || committing.value) return;
  committing.value = true;
  try {
    const res = await projectsService.runImport({
      source: draft.value.source,
      file: draft.value.file,
      dryRun: false,
      projectId: draft.value.projectId,
      includeScenes: excluded.value.size ? included.value.map((s) => s.index) : null,
      splitOn: draft.value.splitOn,
    });
    const pid = res?.project_id || res?.standard?.project?.id;
    pushToast({ kind: "success", title: `Imported "${res?.standard?.project?.name || draft.value.file.name}"` });
    clearImportDraft();
    // Reload the SHARED projects store so every consumer (Chapters,
    // Studio, etc.) sees the new project — not just a local list. Then
    // activate + land in the kind's home base (same as create).
    try {
      await projectsStore.reload();
      const rec = projectsStore.byId(pid);
      if (rec) {
        activeProject.open(rec);
        window.location.hash = rec.project_type === "game_voicelines" ? "#lines" : "#chapter";
        return;
      }
    } catch { /* fall through */ }
    window.location.hash = "#projects";
  } catch (e) {
    pushToast({ kind: "error", title: "Import failed", description: String(e?.message ?? e) });
  } finally {
    committing.value = false;
  }
}

function cancel() {
  clearImportDraft();
  window.location.hash = "#projects";
}
</script>

<template>
  <div v-if="draft" class="imrev">
    <!-- File strip -->
    <div class="imrev__filebar jv-card">
      <span class="imrev__ext">{{ (draft.file.name.split(".").pop() || "").toUpperCase() }}</span>
      <strong>{{ draft.file.name }}</strong>
      <span class="jv-muted">· {{ (draft.file.size / 1024).toFixed(0) }} KB</span>
      <span class="jv-spacer" />
      <UiButton intent="secondary" size="small" label="Choose another file" title="Back to Projects — the import dialog reopens" @click="cancel" />
    </div>

    <div class="imrev__cols">
      <!-- Detected structure -->
      <div class="jv-card imrev__card">
        <div class="imrev__cardhead">
          <strong>Detected structure</strong>
          <span class="jv-pill jv-pill--green">{{ scenes.length }} chapter{{ scenes.length === 1 ? "" : "s" }}</span>
          <span class="jv-spacer" />
          <label v-if="showSplit" class="imrev__split">
            <span class="jv-muted">Split on</span>
            <select
              class="jv-input jv-input--sm"
              :value="draft.splitOn || 'auto'"
              :disabled="splitBusy"
              title="How chapters are detected — changing it re-reads the file"
              @change="changeSplit($event.target.value)"
            >
              <option v-for="o in SPLIT_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
            </select>
            <span v-if="splitBusy" class="jv-boot-banner__spinner" />
          </label>
        </div>
        <ul v-if="warnings.length" class="imrev__warnings">
          <li v-for="(w, i) in warnings" :key="i">⚠ {{ w }}</li>
        </ul>
        <table class="jv-table imrev__table">
          <thead><tr><th style="width:30px"></th><th>Chapter</th><th class="r">Lines</th><th class="r">Words</th><th class="r">Est. audio</th></tr></thead>
          <tbody>
            <tr v-for="row in scenes" :key="row.index" :class="{ 'imrev__off': excluded.has(row.index) }">
              <td><input type="checkbox" class="jv-check" :checked="!excluded.has(row.index)" :title="excluded.has(row.index) ? 'Excluded — will not import' : 'Included'" @change="toggle(row.index)" /></td>
              <td class="imrev__title">{{ row.title }}</td>
              <td class="r">{{ row.lines }}</td>
              <td class="r">{{ row.words.toLocaleString() }}</td>
              <td class="r">{{ row.est }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- Import summary -->
      <div class="jv-card imrev__card imrev__summary">
        <div class="imrev__cardhead"><strong>Import summary</strong></div>
        <div class="imrev__sum"><span>Chapters</span><b>{{ included.length }}</b></div>
        <div class="imrev__sum"><span>Words</span><b>{{ totalWords.toLocaleString() }}</b></div>
        <div class="imrev__sum"><span>Estimated audio</span><b>{{ totalEst }}</b></div>
        <div class="imrev__sum"><span>Speakers</span><b>{{ characterCount || "found later, in Script" }}</b></div>
        <div class="jv-banner jv-banner--info" style="font-size:12px; margin-top:12px">
          Nothing is assigned automatically. The <strong>Script</strong> step finds speakers per
          chapter and offers to add them to your cast.
        </div>
        <div class="imrev__actions">
          <UiButton
            intent="primary"
            :loading="committing"
            :disabled="committing || !included.length"
            :label="`Import ${included.length} ${included.length === 1 ? 'chapter' : 'chapters'} ➜`"
            @click="doImport"
          />
          <UiButton intent="ghost" label="Cancel — go back" @click="cancel" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.imrev { display: flex; flex-direction: column; gap: 12px; }
.imrev__filebar { display: flex; align-items: center; gap: 10px; padding: 12px 16px; margin: 0; }
.imrev__ext {
  font-size: 10px; font-weight: 800; letter-spacing: .05em;
  background: var(--ink-2); color: #fff; border-radius: 4px; padding: 2px 7px;
}
.imrev__cols { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(300px, 1fr); gap: 12px; align-items: start; }
@media (max-width: 980px) { .imrev__cols { grid-template-columns: 1fr; } }
.imrev__card { padding: 14px 16px; margin: 0; }
.imrev__cardhead { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.imrev__split { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; }
.imrev__table { margin: 0; }
.imrev__table .r { text-align: right; }
.imrev__off td { opacity: 0.45; }
.imrev__off .imrev__title { text-decoration: line-through; }
.imrev__warnings { margin: 0 0 10px; padding-left: 18px; font-size: 12px; color: var(--warn-ink); }
.imrev__sum { display: flex; justify-content: space-between; font-size: 12.5px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.imrev__sum span { color: var(--ink-3); }
.imrev__actions { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
</style>
