<!-- SPDX-License-Identifier: MIT -->
<!--
  LinesView — the game dev's home base (mock #game/3, CONCEPTS §1).

  A grid, not a manuscript: every line of the project with its stable
  line id, character, text, and DERIVED take status (none / rendered /
  stale — server computes it from the latest take's text). Grouped by
  scene. Re-import merges the writers' next sheet by line id; the stale
  banner re-renders exactly the changed lines; Export downloads the
  per-line WAV zip + manifest.
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "@delebash/llm-ui";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { UiButton, UiInput, UiChip, UiTag, UiSelect } from "@delebash/llm-ui";
import ImportModal from "./ImportModal.vue";

const api = useApi();
const activeProject = useActiveProject();
const projectsStore = useProjectsStore();
const tasks = useRenderTasks();

const projects = computed(() => projectsStore.items);
const selectedProjectId = ref(null);
const lines = ref([]);
const counts = ref({ none: 0, rendered: 0, stale: 0 });
const loading = ref(false);
const search = ref("");
const statusFilter = ref("all"); // all | none | rendered | stale
const showReimport = ref(false);
const rerendering = ref(false);

const gameProjects = computed(() =>
  projects.value.filter((p) => p.project_type === "game_voicelines"),
);
const selectedProject = computed(
  () => projects.value.find((p) => p.id === selectedProjectId.value) || null,
);

const filtered = computed(() => {
  let list = lines.value;
  if (statusFilter.value !== "all") list = list.filter((l) => l.take_status === statusFilter.value);
  const q = search.value.trim().toLowerCase();
  if (q) {
    list = list.filter(
      (l) =>
        (l.line_id || "").toLowerCase().includes(q) ||
        (l.text || "").toLowerCase().includes(q) ||
        (l.character || "").toLowerCase().includes(q),
    );
  }
  return list;
});

// Grouped by scene, preserving server order.
const groups = computed(() => {
  const out = [];
  let current = null;
  for (const l of filtered.value) {
    if (!current || current.scene_id !== l.scene_id) {
      current = { scene_id: l.scene_id, title: l.scene_title || "Scene", rows: [] };
      out.push(current);
    }
    current.rows.push(l);
  }
  return out;
});

const staleLines = computed(() => lines.value.filter((l) => l.take_status === "stale"));

async function loadProjects() {
  try {
    await projectsStore.ensureLoaded();
    if (!selectedProjectId.value && gameProjects.value.length) {
      const prefer = gameProjects.value.find((p) => p.id === activeProject.id);
      selectedProjectId.value = (prefer || gameProjects.value[0]).id;
      await loadLines();
    }
  } catch (_) { /* tolerated */ }
}

async function loadLines() {
  if (!selectedProjectId.value) {
    lines.value = [];
    counts.value = { none: 0, rendered: 0, stale: 0 };
    return;
  }
  loading.value = true;
  try {
    const r = await api.request(`/v1/projects/${selectedProjectId.value}/lines`);
    lines.value = r?.lines || [];
    counts.value = r?.counts || { none: 0, rendered: 0, stale: 0 };
  } catch (e) {
    pushToast({ message: `Load failed: ${e?.message || e}`, kind: "error" });
  } finally {
    loading.value = false;
  }
}

async function renderOne(line) {
  try {
    await api.request(`/v1/blocks/${line.block_id}/render`, { method: "POST" });
    await loadLines();
    pushToast({ message: `Rendered ${line.line_id || "line"}.`, kind: "success", duration: 2500 });
  } catch (e) {
    pushToast({ message: `Render failed: ${e?.message || e}`, kind: "error" });
  }
}

async function rerenderChanged() {
  const targets = staleLines.value;
  if (!targets.length || rerendering.value) return;
  rerendering.value = true;
  let done = 0;
  let cancelled = false;
  const task = tasks.start({
    kind: "chapter",
    label: `Re-render ${targets.length} changed line${targets.length === 1 ? "" : "s"}`,
    percent: 0,
    onCancel: () => { cancelled = true; },
    onRetry: () => rerenderChanged(),
    statsFn: () => [`${done} / ${targets.length} lines`],
  });
  try {
    for (const line of targets) {
      if (cancelled) break;
      await api.request(`/v1/blocks/${line.block_id}/render`, { method: "POST" });
      done += 1;
      tasks.update(task.id, { percent: done / targets.length });
    }
    if (cancelled) tasks.cancel(task.id);
    else tasks.finish(task.id);
  } catch (e) {
    tasks.fail(task.id, e?.message || String(e));
    pushToast({ message: `Re-render failed after ${done} lines: ${e?.message || e}`, kind: "error" });
  } finally {
    rerendering.value = false;
    await loadLines();
  }
}

async function exportZip() {
  if (!selectedProject.value) return;
  pushToast({ message: "Rendering + zipping voicelines… cached lines are instant.", kind: "info" });
  try {
    const blob = await api.requestBlob("POST", `/v1/projects/${selectedProject.value.id}/export_voicelines`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(selectedProject.value.name || "voicelines").replace(/[^\w.-]+/g, "_")}_VO.zip`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast({ message: "Voiceline zip exported.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Export failed: ${e?.message || e}`, kind: "error" });
  }
}

function onReimported() {
  showReimport.value = false;
  loadLines();
}

function statusPill(s) {
  return {
    rendered: { intent: "success", label: "✓ rendered" },
    stale: { intent: "accent2", label: "● stale" },
    none: { intent: "ghost", label: "— none" },
  }[s] || { intent: "ghost", label: s };
}

onMounted(loadProjects);

// Keep the app-wide active project (sidebar vocabulary, topbar chips,
// Home resume card) in sync with this view's selection.
watch(selectedProjectId, (id) => {
  const p = projects.value.find((x) => x.id === id);
  if (p) activeProject.open(p);
});
</script>

<template>
  <div class="lines">
    <div class="jv-lib-toolbar lines__toolbar">
      <UiSelect v-model="selectedProjectId" class="lines__project" title="Game projects" placeholder="— no game projects —"
        :options="gameProjects" option-label="name" option-value="id" @update:model-value="loadLines" />
      <UiInput v-model="search" class="lines__search" placeholder="Search text, id, or character…" title="Filter the grid" />
      <div class="lines__chips">
        <UiChip
          v-for="f in ['all', 'rendered', 'stale', 'none']"
          :key="f"
          :selected="statusFilter === f"
          :title="`Show ${f === 'all' ? 'every line' : f + ' lines'}`"
          @click="statusFilter = f"
        >{{ f }} ({{ f === "all" ? lines.length : counts[f] || 0 }})</UiChip>
      </div>
      <span class="jv-spacer" />
      <UiButton intent="secondary" size="small" label="⬇ Re-import CSV" title="Merge the next sheet revision by line id — only changed lines go stale" :disabled="!selectedProject" @click="showReimport = true" />
      <UiButton intent="secondary" size="small" label="⬆ Export VO zip" title="Per-line WAVs named by line id + manifest.json" :disabled="!selectedProject" @click="exportZip" />
    </div>

    <div v-if="staleLines.length" class="jv-banner jv-banner--warn lines__stale">
      <strong>{{ staleLines.length }} line{{ staleLines.length === 1 ? "" : "s" }} changed</strong>
      since last render (text differs from the rendered take)
      <UiButton size="small" :loading="rerendering" :label="`↻ Re-render ${staleLines.length} changed`" @click="rerenderChanged" />
      <span class="jv-muted">everything else stays cached</span>
    </div>

    <div v-if="!selectedProject" class="jv-banner">
      Import a dialogue CSV (Projects → Import, or the kind picker) to get a game project — its lines appear here.
    </div>

    <table v-else class="jv-table lines__table">
      <thead>
        <tr>
          <th>Line ID</th>
          <th>Character</th>
          <th>Text</th>
          <th>Take</th>
          <th class="lines__actions-h"></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="g in groups" :key="g.scene_id">
          <tr class="lines__group">
            <td colspan="5">{{ g.title }} — {{ g.rows.length }} line{{ g.rows.length === 1 ? "" : "s" }}</td>
          </tr>
          <tr v-for="l in g.rows" :key="l.block_id">
            <td class="jv-mono lines__id">{{ l.line_id || "—" }}</td>
            <td class="lines__who">{{ l.character || "—" }}</td>
            <td class="lines__text" :title="l.text">{{ l.text }}</td>
            <td><UiTag :intent="statusPill(l.take_status).intent">{{ statusPill(l.take_status).label }}</UiTag></td>
            <td class="lines__actions">
              <UiButton intent="ghost" size="small" label="↻" :title="`Render ${l.line_id || 'this line'}`" @click="renderOne(l)" />
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <ImportModal
      v-if="showReimport"
      :project-id="selectedProjectId"
      @close="showReimport = false"
      @created="onReimported"
    />
  </div>
</template>

<style scoped>
.lines { display: flex; flex-direction: column; gap: 12px; }
/* Canonical .jv-lib-toolbar; the .lines container already provides the
   row gap, so drop the toolbar's own margin-bottom to avoid double space. */
.lines__toolbar { margin-bottom: 0; }
.lines__project { max-width: 260px; }
.lines__search { max-width: 260px; }
.lines__chips { display: inline-flex; gap: 4px; }
.lines__chips .ui-chip { cursor: pointer; border: 0; font: inherit; font-size: 11.5px; }
.lines__stale { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.lines__group td {
  background: var(--surface-3);
  font-weight: 600;
  color: var(--ink);
  font-size: 12px;
  padding: 6px 12px;
}
.lines__id { font-size: 11.5px; white-space: nowrap; }
.lines__who { white-space: nowrap; font-weight: 600; }
.lines__text { max-width: 0; width: 55%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lines__actions { text-align: right; white-space: nowrap; }
.lines__actions-h { width: 56px; }
</style>
