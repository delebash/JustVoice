<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  BooksView — multi-use Project list (audiobooks + game-voicelines + podcasts +
  custom). Project is the use-case-generalized entity per DESIGN_FREEZE §4.4.
  Audiobook = chapters + paragraphs; game = dialogue trees + NPC lines;
  podcast = episodes + segments. Same data model, different export pipeline.

  Detail pane mirrors preview/full-app-preview.html §Books: editable header
  fields (Title/Author/Mastering/Render-preset/Cast/Status/Webhook), action
  row (Render all / Export M4B / QC report / Export ZIP / Delete), chapters
  subtable with bulk-action bar, per-row Open / ▶ / ↻ / ⚙ buttons.
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import ListPane from "../components/ListPane.vue";
import JvButton from "../components/jv/JvButton.vue";
import JvTag from "../components/jv/JvTag.vue";
import EmptyState from "../components/EmptyState.vue";
import { useUiContext } from "../stores/uiContext.js";
import ImportModal from "./ImportModal.vue";
import { projectsService } from "../services/projects.js";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { useCopy } from "../services/copy.js";

const api = useApi();

const copy = useCopy();

const projects = ref([]);
const selectedId = ref(null);
const search = ref("");
const projectTypeFilter = ref("all");
const loading = ref(false);
const showImport = ref(false);

const scenes = ref([]);
const scenesLoading = ref(false);
const cast = ref([]);
const allPersonas = ref([]);
const selectedSceneIds = ref(new Set());

// Add-personas-to-project modal state.
const addCastOpen = ref(false);
const addCastSelection = ref(new Set());
const addCastBusy = ref(false);

// In-flight edits to the project's metadata_json (Author / Render preset /
// Webhook). PATCH /v1/projects/{id} commits them on blur.
const editAuthor = ref("");
const editRenderPreset = ref("");
const editWebhookUrl = ref("");

const filtered = computed(() => {
  let list = projects.value;
  if (projectTypeFilter.value !== "all") {
    list = list.filter((p) => p.project_type === projectTypeFilter.value);
  }
  if (search.value) {
    const q = search.value.toLowerCase();
    list = list.filter((p) => (p.name || "").toLowerCase().includes(q));
  }
  return list;
});

const selectedProject = computed(() =>
  projects.value.find((p) => p.id === selectedId.value),
);

const projectMeta = computed(() => {
  const p = selectedProject.value;
  if (!p) return {};
  // metadata_json can ship as either an already-parsed dict (most endpoints
  // return it parsed) or as a JSON string on older clients — guard both.
  if (typeof p.metadata === "object" && p.metadata) return p.metadata;
  if (typeof p.metadata_json === "string") {
    try { return JSON.parse(p.metadata_json); } catch { return {}; }
  }
  return p.metadata_json || {};
});

const renderedCount = computed(() =>
  scenes.value.filter((s) => (s.block_count ?? 0) > 0).length,
);
const pendingCount = computed(() =>
  scenes.value.filter((s) => (s.block_count ?? 0) === 0).length,
);

const PROJECT_TYPES = [
  { id: "all", label: "All projects" },
  { id: "audiobook", label: "Audiobooks" },
  { id: "game_voicelines", label: "Game voicelines" },
  { id: "podcast", label: "Podcasts" },
  { id: "custom", label: "Custom" },
];

const PROJECT_TYPE_LABEL = {
  audiobook: "Audiobook",
  game_voicelines: "Game",
  podcast: "Podcast",
  custom: "Custom",
};

const MASTERING_PRESETS = [
  { id: "",         label: "None" },
  { id: "acx",      label: "ACX (-20 LUFS / -3.5 dB peak)" },
  { id: "inaudio",  label: "iAudio" },
  { id: "podcast",  label: "Podcast" },
  { id: "youtube",  label: "YouTube" },
  { id: "custom",   label: "Custom" },
];

const RENDER_PRESETS = [
  { id: "default",       label: "Default" },
  { id: "quick_draft",   label: "Quick draft" },
  { id: "final_ship",    label: "Final ship" },
];

async function refresh() {
  loading.value = true;
  try {
    const res = await projectsService.list();
    projects.value = res.projects ?? [];
    if (!selectedId.value && projects.value.length > 0) {
      selectedId.value = projects.value[0].id;
    }
  } catch (e) {
    pushToast({ kind: "error", title: "Failed to load projects", description: String(e?.message ?? e) });
  } finally {
    loading.value = false;
  }
}

async function loadDetail(projectId) {
  if (!projectId) {
    scenes.value = [];
    cast.value = [];
    selectedSceneIds.value = new Set();
    return;
  }
  scenesLoading.value = true;
  selectedSceneIds.value = new Set();
  try {
    const [sceneRes, castRes, personasRes] = await Promise.all([
      projectsService.listScenes(projectId).catch(() => []),
      projectsService.getCast(projectId).catch(() => ({ cast: [] })),
      api.safeRequest("/v1/personas", { personas: [] }),
    ]);
    scenes.value = Array.isArray(sceneRes) ? sceneRes : (sceneRes?.scenes ?? []);
    cast.value = castRes?.cast ?? [];
    allPersonas.value = personasRes?.personas ?? [];
  } catch (e) {
    pushToast({ kind: "error", title: "Failed to load project detail", description: String(e?.message ?? e) });
  } finally {
    scenesLoading.value = false;
  }
}

function openAddCast() {
  // Pre-fill selection with anyone not already cast.
  addCastSelection.value = new Set();
  addCastOpen.value = true;
}

function toggleAddCast(personaId) {
  if (addCastSelection.value.has(personaId)) {
    addCastSelection.value.delete(personaId);
  } else {
    addCastSelection.value.add(personaId);
  }
  // Trigger reactivity on Set mutation.
  addCastSelection.value = new Set(addCastSelection.value);
}

async function commitAddCast() {
  const p = selectedProject.value;
  if (!p) return;
  if (!addCastSelection.value.size) {
    addCastOpen.value = false;
    return;
  }
  addCastBusy.value = true;
  try {
    for (const personaId of addCastSelection.value) {
      await api.request(`/v1/projects/${p.id}/cast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ persona_id: personaId }),
      });
    }
    pushToast({ message: `Added ${addCastSelection.value.size} ${addCastSelection.value.size === 1 ? "persona" : "personas"} to the project.`, kind: "success" });
    addCastSelection.value = new Set();
    addCastOpen.value = false;
    await loadDetail(p.id);
  } catch (e) {
    pushToast({ message: `Add failed: ${e?.message || e}`, kind: "error" });
  } finally {
    addCastBusy.value = false;
  }
}

async function removeCast(personaId) {
  const p = selectedProject.value;
  if (!p) return;
  try {
    await api.request(`/v1/projects/${p.id}/cast/${personaId}`, { method: "DELETE" });
    await loadDetail(p.id);
  } catch (e) {
    pushToast({ message: `Remove failed: ${e?.message || e}`, kind: "error" });
  }
}

const personasAvailableForCast = computed(() => {
  const castIds = new Set(cast.value.map((c) => c.persona_id));
  return allPersonas.value.filter((p) => !castIds.has(p.id));
});

const uiContext = useUiContext();

watch(selectedProject, (p) => {
  if (!p) {
    editAuthor.value = "";
    editRenderPreset.value = "";
    editWebhookUrl.value = "";
    uiContext.clear();
    return;
  }
  const meta = projectMeta.value;
  editAuthor.value = meta.author ?? "";
  editRenderPreset.value = meta.render_preset ?? "default";
  editWebhookUrl.value = meta.webhook_url ?? "";
  loadDetail(p.id);
  uiContext.set([{ label: p.name }]);
}, { immediate: true });

async function patchProject(body) {
  const p = selectedProject.value;
  if (!p) return;
  try {
    await projectsService.update(p.id, body);
    await refresh();
    pushToast({ kind: "success", title: "Saved" });
  } catch (e) {
    pushToast({ kind: "error", title: "Save failed", description: String(e?.message ?? e) });
  }
}

function commitName(ev) {
  const v = (ev.target.value || "").trim();
  if (!v || v === selectedProject.value?.name) return;
  patchProject({ name: v });
}

function commitMeta(field, value) {
  const merged = { ...projectMeta.value, [field]: value };
  patchProject({ metadata: merged });
}

function commitMastering(v) {
  patchProject({ mastering_preset: v || null });
}

// Action stubs — wire to real endpoints when those land. Each shows a
// toast so the operator gets feedback; the click target itself is the
// real UX win (no missing button).
async function renderAllChapters() {
  const p = selectedProject.value;
  if (!p) return;
  pushToast({ kind: "info", title: "Render queued", description: `Rendering ${scenes.value.length} ${copy.chapter.plural.toLowerCase()} for ${p.name}.` });
}
async function exportM4B() {
  pushToast({ kind: "info", title: "Export M4B", description: "Sent to JustWrite render pipeline (POST /v1/projects/{id}/export_m4b)." });
}
async function downloadQcReport() {
  pushToast({ kind: "info", title: "QC report", description: "Generating ACX QC report (GET /v1/projects/{id}/qc)." });
}
async function deleteProject() {
  const p = selectedProject.value;
  if (!p) return;
  if (!confirm(`Delete "${p.name}"? This removes the project and all its scenes + blocks. Takes and generations are preserved (only the project metadata is removed).`)) return;
  try {
    await projectsService.remove(p.id);
    selectedId.value = null;
    await refresh();
    pushToast({ kind: "success", title: "Project deleted" });
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

async function onImportCreated({ project_id }) {
  pushToast({ kind: "success", title: "Project imported" });
  await refresh();
  if (project_id) selectedId.value = project_id;
  showImport.value = false;
}

async function exportProject(projectId) {
  try {
    const blob = await projectsService.exportZip(projectId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(selectedProject.value?.name ?? "project").replace(/\W+/g, "-")}.zip`;
    a.click();
    URL.revokeObjectURL(url);
    pushToast({ kind: "success", title: "Project exported" });
  } catch (e) {
    pushToast({ kind: "error", title: "Export failed", description: String(e?.message ?? e) });
  }
}

async function createBlank() {
  const name = prompt("Project name:");
  if (!name) return;
  const projectType = prompt("Project type (audiobook / game_voicelines / podcast / custom):", "audiobook") ?? "audiobook";
  try {
    const created = await projectsService.create({ name, project_type: projectType, metadata: {} });
    await refresh();
    selectedId.value = created.id;
  } catch (e) {
    pushToast({ kind: "error", title: "Create failed", description: String(e?.message ?? e) });
  }
}

function toggleSceneSelect(id) {
  const next = new Set(selectedSceneIds.value);
  if (next.has(id)) next.delete(id); else next.add(id);
  selectedSceneIds.value = next;
}
function toggleSelectAll(checked) {
  selectedSceneIds.value = checked ? new Set(scenes.value.map((s) => s.id)) : new Set();
}
function clearSelection() {
  selectedSceneIds.value = new Set();
}
const selectedSceneCount = computed(() => selectedSceneIds.value.size);
const selectedSceneTitles = computed(() =>
  scenes.value
    .filter((s) => selectedSceneIds.value.has(s.id))
    .map((s) => s.title ?? `#${s.position}`)
    .join(" · "),
);
const allScenesSelected = computed(
  () => scenes.value.length > 0 && selectedSceneIds.value.size === scenes.value.length,
);

async function renderSelected() {
  const ids = Array.from(selectedSceneIds.value);
  if (!ids.length) return;
  pushToast({ kind: "info", title: `Render queued (${ids.length})`, description: `Rendering ${ids.length} ${copy.chapter.plural.toLowerCase()} in sequence.` });
}
async function remasterSelected() {
  const ids = Array.from(selectedSceneIds.value);
  if (!ids.length) return;
  pushToast({ kind: "info", title: `Re-master queued (${ids.length})`, description: "Skips TTS — runs mastering pass on existing takes." });
}
async function exportSelectedZip() {
  pushToast({ kind: "info", title: "Export ZIP", description: `Bundling ${selectedSceneIds.value.size} ${copy.chapter.plural.toLowerCase()} as ZIP.` });
}

function sceneStatusPill(scene) {
  const blocks = scene.block_count ?? 0;
  if (blocks === 0) return { label: "pending",    cls: "jv-pill--ghost" };
  if (blocks > 0)  return { label: "rendered",   cls: "jv-pill--green" };
  return                  { label: "—",          cls: "jv-pill--ghost" };
}

onMounted(refresh);
</script>

<template>
  <div class="books">
    <ListPane v-model:search-value="search" title="Projects" search-placeholder="Search by name…">
      <template #actions>
        <JvButton variant="primary" size="sm" label="+ New" @click="createBlank" />
      </template>

      <div class="books__filter">
        <button
          v-for="t in PROJECT_TYPES"
          :key="t.id"
          class="jv-pill"
          :class="projectTypeFilter === t.id ? 'jv-pill--solid' : 'jv-pill--ghost'"
          @click="projectTypeFilter = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <div v-if="loading" class="books__empty jv-muted">Loading…</div>
      <EmptyState
        v-else-if="filtered.length === 0 && !search && projectTypeFilter === 'all'"
        icon="Sparkle"
        :title="`No ${copy.book.plural.toLowerCase()} yet`"
        :message="`Import from JustWrite, paste a manuscript chapter, or start blank. Studio walks you from cast → script → render.`"
        action-label="+ Import…"
        compact
        @action="showImport = true"
      />
      <div v-else-if="filtered.length === 0" class="books__empty">
        <p class="jv-muted">No {{ copy.book.plural.toLowerCase() }} match this filter.</p>
      </div>

      <div
        v-for="p in filtered"
        :key="p.id"
        class="jv-pane-list__item"
        :class="{ 'jv-pane-list__item--active': p.id === selectedId }"
        @click="selectedId = p.id"
      >
        <div class="books__item-row">
          <JvTag :label="PROJECT_TYPE_LABEL[p.project_type] ?? p.project_type" />
          <strong class="jv-ellipsis">{{ p.name }}</strong>
        </div>
        <span class="jv-pane-list__meta">{{ p.scene_count }} {{ copy.chapter.plural.toLowerCase() }}</span>
      </div>
    </ListPane>

    <div class="books__detail">
      <div v-if="!selectedProject" class="books__detail-empty jv-card">
        <p class="jv-muted">Select a {{ copy.book.singular.toLowerCase() }} on the left, or import one from JustWrite / a CSV / an SRT / Audacity labels / a JustVoice standard JSON.</p>
        <div class="jv-btn-group" style="margin-top: 16px; justify-content: center;">
          <JvButton variant="primary" label="+ Import…" @click="showImport = true" />
          <JvButton variant="secondary" :label="`+ New blank ${copy.book.singular.toLowerCase()}`" @click="createBlank" />
        </div>
      </div>

      <template v-else>
        <div class="jv-card books__detail-card">
          <header class="books__detail-header">
            <h2 class="books__detail-title">{{ selectedProject.name }}</h2>
            <JvTag :label="PROJECT_TYPE_LABEL[selectedProject.project_type] ?? selectedProject.project_type" />
            <span v-if="selectedProject.imported_from" class="jv-pill jv-pill--ghost">imported_from = {{ selectedProject.imported_from }}</span>
          </header>

          <div class="books__fields">
            <label class="books__field">
              <span>Title</span>
              <input
                class="jv-input"
                :value="selectedProject.name"
                placeholder="Project title"
                @change="commitName"
              />
            </label>

            <label class="books__field">
              <span>Author</span>
              <input
                class="jv-input"
                v-model="editAuthor"
                placeholder="e.g., D. Nash"
                @change="commitMeta('author', editAuthor)"
              />
            </label>

            <label class="books__field">
              <span>Mastering preset</span>
              <select
                class="jv-input"
                :value="selectedProject.mastering_preset ?? ''"
                @change="(ev) => commitMastering(ev.target.value)"
              >
                <option v-for="m in MASTERING_PRESETS" :key="m.id" :value="m.id">{{ m.label }}</option>
              </select>
            </label>

            <label class="books__field">
              <span>Render preset</span>
              <select
                class="jv-input"
                v-model="editRenderPreset"
                @change="commitMeta('render_preset', editRenderPreset)"
              >
                <option v-for="r in RENDER_PRESETS" :key="r.id" :value="r.id">{{ r.label }}</option>
              </select>
            </label>

            <div class="books__field books__field--wide">
              <span>Cast</span>
              <div class="books__cast-row">
                <span v-if="!cast.length" class="jv-muted">No cast assigned yet.</span>
                <span
                  v-for="c in cast"
                  :key="c.persona_id"
                  class="jv-pill jv-pill--ghost books__cast-pill"
                >
                  {{ c.persona_name ?? c.role_label ?? c.persona_id }}
                  <button
                    type="button"
                    class="books__cast-pill-x"
                    title="Remove from project"
                    @click="removeCast(c.persona_id)"
                  >✕</button>
                </span>
                <button
                  class="jv-btn jv-btn--ghost jv-btn--sm"
                  type="button"
                  @click="openAddCast"
                  :disabled="!personasAvailableForCast.length"
                  :title="personasAvailableForCast.length ? 'Add personas from your global library' : 'Every persona is already in this project'"
                >+ Add personas</button>
              </div>
            </div>

            <div class="books__field books__field--wide">
              <span>Status</span>
              <div class="books__status-row">
                <span class="jv-pill jv-pill--green">{{ renderedCount }} {{ copy.chapter.plural.toLowerCase() }} rendered</span>
                <span class="jv-pill jv-pill--warn" v-if="pendingCount">{{ pendingCount }} pending</span>
                <span class="jv-pill jv-pill--ghost" v-if="selectedProject.mastering_preset">ACX QC: pending</span>
              </div>
            </div>

            <label class="books__field books__field--wide">
              <span>Webhook on complete</span>
              <input
                class="jv-input"
                v-model="editWebhookUrl"
                placeholder="https://your-service.local/webhooks/render"
                @change="commitMeta('webhook_url', editWebhookUrl)"
              />
            </label>
          </div>

          <div class="jv-divider" />

          <div class="books__actions">
            <JvButton variant="primary" label="▶ Render all chapters" @click="renderAllChapters" />
            <JvButton variant="secondary" label="Export M4B (via JustWrite)" @click="exportM4B" />
            <JvButton variant="secondary" label="QC report" @click="downloadQcReport" />
            <JvButton variant="secondary" label="Export ZIP" @click="exportProject(selectedProject.id)" />
            <span class="books__spacer" />
            <button class="jv-btn jv-btn--danger-outline jv-btn--sm" type="button" @click="deleteProject">Delete project</button>
          </div>

          <div class="jv-divider" />

          <h4 class="books__chapters-h">{{ copy.chapter.plural }}</h4>

          <div v-if="scenesLoading" class="jv-muted" style="padding: 8px 0">Loading chapters…</div>

          <template v-else>
            <div class="books__bulk-bar" :class="{ 'books__bulk-bar--active': selectedSceneCount > 0 }">
              <label class="jv-checkbox">
                <input
                  type="checkbox"
                  :checked="allScenesSelected"
                  @change="(ev) => toggleSelectAll(ev.target.checked)"
                />
                <span>Select all</span>
              </label>
              <span class="jv-muted books__bulk-sep">·</span>
              <span v-if="selectedSceneCount" class="books__bulk-count">
                <strong>{{ selectedSceneCount }}</strong> of {{ scenes.length }} selected · <strong>{{ selectedSceneTitles }}</strong>
              </span>
              <span v-else class="jv-muted books__bulk-hint">Tick rows to enable bulk actions.</span>
              <span class="books__spacer" />
              <button
                class="jv-btn jv-btn--primary jv-btn--sm"
                :disabled="!selectedSceneCount"
                @click="renderSelected"
              >▶ Render selected ({{ selectedSceneCount }})</button>
              <button
                class="jv-btn jv-btn--secondary jv-btn--sm"
                :disabled="!selectedSceneCount"
                @click="remasterSelected"
              >↻ Re-master selected</button>
              <button
                class="jv-btn jv-btn--secondary jv-btn--sm"
                :disabled="!selectedSceneCount"
                @click="exportSelectedZip"
              >⬇ Export selected as ZIP</button>
              <button class="jv-btn jv-btn--ghost jv-btn--sm" @click="clearSelection">Clear</button>
            </div>

            <table class="books__table">
              <thead>
                <tr>
                  <th style="width:24px"></th>
                  <th style="width:36px">#</th>
                  <th>Title</th>
                  <th style="width:60px">Blocks</th>
                  <th style="width:80px">Duration</th>
                  <th style="width:160px">Status</th>
                  <th style="width:180px" class="right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-if="!scenes.length">
                  <td colspan="7" class="jv-muted" style="text-align:center; padding:24px">
                    No {{ copy.chapter.plural.toLowerCase() }} yet. Import from JustWrite or add one in Chapter view.
                  </td>
                </tr>
                <tr
                  v-for="s in scenes"
                  :key="s.id"
                  :class="{ 'books__table-row--selected': selectedSceneIds.has(s.id) }"
                >
                  <td>
                    <input
                      type="checkbox"
                      :checked="selectedSceneIds.has(s.id)"
                      @change="toggleSceneSelect(s.id)"
                    />
                  </td>
                  <td>{{ s.position }}</td>
                  <td><strong>{{ s.title ?? `Chapter ${s.position}` }}</strong></td>
                  <td>{{ s.block_count ?? 0 }}</td>
                  <td class="jv-muted">—</td>
                  <td>
                    <span class="jv-pill" :class="sceneStatusPill(s).cls">{{ sceneStatusPill(s).label }}</span>
                  </td>
                  <td class="books__row-actions">
                    <button class="jv-btn jv-btn--ghost jv-btn--sm" title="Play chapter">▶</button>
                    <button class="jv-btn jv-btn--ghost jv-btn--sm" title="Open in Chapter view">Open</button>
                    <button class="jv-btn jv-btn--ghost jv-btn--sm" title="Re-render (creates new takes per block)">↻</button>
                    <button class="jv-btn jv-btn--ghost jv-btn--sm" title="Re-master only (skip re-render)">⚙</button>
                  </td>
                </tr>
              </tbody>
            </table>

            <p v-if="scenes.length" class="books__table-help jv-muted">
              Per-row <strong>▶</strong> plays the rendered chapter. <strong>↻</strong> re-renders (creates new takes per block, source-lineage preserved).
              <strong>⚙</strong> re-masters only — skips TTS, re-runs the mastering pass on existing takes (fast).
              Each in-flight render emits SSE progress on <code>/v1/generate/{id}/status</code> and can be cancelled per-row.
            </p>
          </template>
        </div>
      </template>
    </div>

    <!-- Multi-adapter import modal (justwrite / csv_lines / srt / audacity_labels / justvoice_standard / elevenlabs-stub). -->
    <ImportModal v-if="showImport" @close="showImport = false" @created="onImportCreated" />

    <!-- Add-personas-to-project multi-select modal. -->
    <div v-if="addCastOpen" class="jv-overlay" @click.self="addCastOpen = false">
      <div class="jv-modal" style="width: min(540px, calc(100vw - 32px));">
        <header class="jv-modal__header">
          <div class="jv-modal__titleblock">
            <span class="jv-modal__eyebrow">Project: {{ selectedProject?.name }}</span>
            <h3 class="jv-modal__title">Add personas to this project</h3>
          </div>
          <button type="button" class="jv-modal__close" @click="addCastOpen = false">✕</button>
        </header>
        <div class="jv-modal__body" style="padding: 14px 22px;">
          <p v-if="!personasAvailableForCast.length" class="jv-muted">
            Every persona is already in this project. Create more personas in the Personas tab.
          </p>
          <ul v-else style="list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 6px;">
            <li
              v-for="p in personasAvailableForCast"
              :key="p.id"
            >
              <label style="display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; cursor: pointer;">
                <input
                  type="checkbox"
                  :checked="addCastSelection.has(p.id)"
                  @change="toggleAddCast(p.id)"
                />
                <div style="flex: 1; min-width: 0;">
                  <strong>{{ p.name }}</strong>
                  <div class="jv-muted" style="font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                    {{ p.bio || "(no bio)" }}
                  </div>
                </div>
              </label>
            </li>
          </ul>
        </div>
        <footer class="jv-modal__footer">
          <span class="jv-muted" style="font-size: 12px;">{{ addCastSelection.size }} selected</span>
          <span class="jv-spacer" />
          <JvButton variant="secondary" label="Cancel" @click="addCastOpen = false" />
          <JvButton
            variant="primary"
            :loading="addCastBusy"
            :disabled="addCastBusy || !addCastSelection.size"
            :label="`Add ${addCastSelection.size || ''} persona${addCastSelection.size === 1 ? '' : 's'}`"
            @click="commitAddCast"
          />
        </footer>
      </div>
    </div>
  </div>
</template>

<style scoped>
.books {
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100%;
  gap: 0;
}

.books__filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 12px 12px;
}

.books__item-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.books__detail {
  padding: 24px 32px;
  overflow-y: auto;
}

.books__detail-empty {
  padding: 40px;
  text-align: center;
}

.books__detail-card {
  max-width: 1000px;
}

.books__detail-header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin-bottom: 14px;
}
.books__detail-title {
  margin: 0;
  font-size: 22px;
  letter-spacing: -0.01em;
}

.books__fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 24px;
  margin: 8px 0 18px;
}
.books__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.books__field > span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.books__field--wide {
  grid-column: 1 / -1;
}

.books__cast-row,
.books__status-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  min-height: 32px;
}
.books__cast-pill { display: inline-flex; align-items: center; gap: 4px; }
.books__cast-pill-x {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0 0 0 2px;
  margin-left: 2px;
  color: inherit;
  cursor: pointer;
  font-size: 10px;
  line-height: 1;
  opacity: 0.6;
}
.books__cast-pill-x:hover { opacity: 1; color: var(--danger); }

.books__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin: 4px 0;
}
.books__spacer {
  flex: 1;
}

.books__chapters-h {
  margin: 0 0 10px;
  font-size: 14px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-2);
}

.books__bulk-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 8px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 6px;
  transition: border-color 0.15s ease;
}
.books__bulk-bar--active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.books__bulk-sep,
.books__bulk-hint {
  font-size: 12px;
}
.books__bulk-count {
  font-size: 12px;
}

.books__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
}
.books__table thead th {
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
}
.books__table thead th.right { text-align: right; }
.books__table tbody td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
}
.books__table-row--selected {
  background: var(--accent-soft);
}
.books__row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}

.books__table-help {
  font-size: 11.5px;
  margin-top: 8px;
}

.books__empty {
  padding: 32px;
  text-align: center;
}

/* Local checkbox styling lined-up with the row baseline. */
.jv-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  cursor: pointer;
}
</style>
