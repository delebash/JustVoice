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
import { withAiTask } from "@delebash/llm-ui";
import { pushToast, saveBlob } from "@delebash/llm-ui";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { UiButton, UiInput, UiChip, UiTag, UiSelect, UiTable } from "@delebash/llm-ui";
import ImportModal from "./ImportModal.vue";

const api = useApi();
const activeProject = useActiveProject();
const projectsStore = useProjectsStore();

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
// The list is GROUPED: a scene-header row, then that scene's lines. UiTable's
// `:full-width-row` is exactly this shape (it was added for the model catalog's
// section headers) — returning a STRING also puts that class on the <tr>. So the
// groups flatten to one array with header sentinels, keyed by a function since a
// header carries no block_id.
const lineRows = computed(() => {
  const out = [];
  for (const g of groups.value) {
    out.push({ __group: true, scene_id: g.scene_id, title: g.title, count: g.rows.length });
    out.push(...g.rows);
  }
  return out;
});
const lineKey = (r) => (r?.__group ? `g:${r.scene_id}` : r?.block_id);
const groupRowClass = (r) => (r?.__group ? "lines__group" : false);
const LINE_COLUMNS = [
  { id: "line_id", accessorKey: "line_id", header: "Line ID", sortable: true },
  { id: "character", accessorKey: "character", header: "Character", sortable: true },
  { id: "text", header: "Text" },
  { id: "take", header: "Take" },
  { id: "actions", header: "", headerStyle: { width: "56px" },
    cellStyle: { textAlign: "right", whiteSpace: "nowrap" } },
];

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
  try {
    // One RENDER JOB server-side (Stage 2, 2026-08-08): the scheduler
    // groups its lines engine-major and a failed line no longer aborts the
    // rest — per-block isolation, and the job survives a server restart.
    await withAiTask({
      feature: "chapter",
      label: `Re-render ${targets.length} changed line${targets.length === 1 ? "" : "s"}`,
      onRetry: () => rerenderChanged(),
    }, async (task) => {
      const job = await api.request("/v1/render_jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_id: selectedProjectId.value,
          scope: "blocks",
          scope_ids: targets.map((l) => l.block_id),
        }),
      });
      const total = job.total_blocks || targets.length;
      task.setProgress(0, total);
      let last = job;
      while (!["completed", "failed", "cancelled"].includes(last.status)) {
        // The strip's Cancel aborts the kit handle's signal — the job
        // withdraws its queued lines at the next line boundary.
        if (task.signal.aborted) {
          await api.request(`/v1/render_jobs/${job.id}/cancel`, { method: "POST" });
          break;
        }
        await new Promise((r) => setTimeout(r, 1000));
        last = await api.request(`/v1/render_jobs/${job.id}`);
        task.setProgress((last.completed_blocks || 0) + (last.failed_blocks || 0), total);
      }
      if (last.failed_blocks) {
        pushToast({
          message: `${last.completed_blocks} rendered, ${last.failed_blocks} failed — failed lines stay stale.`,
          kind: "error",
        });
      }
      return last;
    });
  } catch (e) {
    pushToast({ message: `Re-render failed: ${e?.message || e}`, kind: "error" });
  } finally {
    rerendering.value = false;
    await loadLines();
  }
}

async function exportZip() {
  if (!selectedProject.value) return;
  pushToast({ message: "Rendering + zipping voicelines… cached lines are instant.", kind: "info" });
  try {
    const blob = await api.requestBlob(`/v1/projects/${selectedProject.value.id}/export_voicelines`, { method: "POST" });
    // The kit's one save door (2026-08-15) — was one of five inline copies here.
    await saveBlob(blob, `${(selectedProject.value.name || "voicelines").replace(/[^\w.-]+/g, "_")}_VO.zip`,
      { title: "Save voiceline package", filterName: "Voiceline package", filterExt: "zip" });
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
      <UiButton size="small" :disabled="rerendering" :label="`↻ Re-render ${staleLines.length} changed`" @click="rerenderChanged" />
      <span class="jv-muted">everything else stays cached</span>
    </div>

    <div v-if="!selectedProject" class="jv-banner">
      Import a dialogue CSV (Projects → Import, or the kind picker) to get a game project — its lines appear here.
    </div>

    <UiTable v-else class="jv-table-look lines__table" :data="lineRows" :columns="LINE_COLUMNS"
      :data-key="lineKey" :full-width-row="groupRowClass">
      <template #full-row="{ row }">
        {{ row.title }} — {{ row.count }} line{{ row.count === 1 ? "" : "s" }}
      </template>
      <template #line_id="{ row }"><span class="jv-mono lines__id">{{ row.line_id || "—" }}</span></template>
      <template #character="{ row }"><span class="lines__who">{{ row.character || "—" }}</span></template>
      <template #text="{ row }"><span class="lines__text" :title="row.text">{{ row.text }}</span></template>
      <template #take="{ row }"><UiTag :intent="statusPill(row.take_status).intent">{{ statusPill(row.take_status).label }}</UiTag></template>
      <template #actions="{ row }">
        <UiButton intent="ghost" size="small" label="↻" :title="`Render ${row.line_id || 'this line'}`" @click="renderOne(row)" />
      </template>
    </UiTable>

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
/* The scene-header row is a `:full-width-row`; the class comes back as that
   predicate's return value, and the rule has to reach INTO the component. */
.lines__table :deep(.ui-table-fullrow.lines__group) td {
  background: var(--surface-3);
  font-weight: 600;
  color: var(--ink);
  font-size: 12.5px;
  padding: 6px 12px;
}
.lines__id { font-size: 11.5px; white-space: nowrap; }
.lines__who { white-space: nowrap; font-weight: 600; }
.lines__text { display: block; max-width: 46ch; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
</style>
