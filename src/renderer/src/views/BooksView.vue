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
import JvButton from "../components/jv/JvButton.vue";
import JvTag from "../components/jv/JvTag.vue";
import EmptyState from "../components/EmptyState.vue";
import { useUiContext } from "../stores/uiContext.js";
import ImportModal from "./ImportModal.vue";
import NewProjectModal from "../components/NewProjectModal.vue";
import { projectsService } from "../services/projects.js";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import { useCopy } from "../services/copy.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useOnboarding } from "../stores/onboarding.js";
import { useProjectsCache } from "../stores/projectsCache.js";
import { storeToRefs } from "pinia";

const api = useApi();
const activeProject = useActiveProject();
const onboarding = useOnboarding();
const projectsCache = useProjectsCache();
// SWR-cached list — survives view unmount, instant-paints on revisit,
// and the `showLoading` getter only flips true when there's nothing to
// show AND the fetch has been pending ≥250ms (sub-perceptual flash kill).
const { projects, showLoading: loading } = storeToRefs(projectsCache);

const copy = useCopy();

const selectedId = ref(null);
const search = ref("");
const projectTypeFilter = ref("all");
const showImport = ref(false);
const showNewProject = ref(false);
const newProjectKind = ref("");

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
  { id: "all", label: "All" },
  { id: "audiobook", label: "📖 Audiobooks" },
  { id: "game_voicelines", label: "🎮 Games" },
  { id: "podcast", label: "🎙️ Podcasts" },
  { id: "custom", label: "📄 Text" },
];
const KIND_ICON = { audiobook: "📖", game_voicelines: "🎮", podcast: "🎙️", custom: "📄" };

function fmtAgo(iso) {
  if (!iso) return "—";
  const ago = Date.now() - new Date(iso).getTime();
  if (ago < 3_600_000) return Math.max(1, Math.floor(ago / 60_000)) + " min";
  if (ago < 86_400_000) return Math.floor(ago / 3_600_000) + " h";
  return Math.floor(ago / 86_400_000) + " d";
}

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

// Mutations (create / delete / update) call `refresh()` to force a
// re-fetch; navigations use `refreshIfStale()` to revalidate in the
// background only if the cache window has expired. The store also paints
// instantly from the last visit's snapshot (constructor reads localStorage).
async function refresh() {
  try {
    await projectsCache.refresh();
    // No auto-select — rows start collapsed; browsing is explicit.
  } catch (e) {
    pushToast({ kind: "error", title: "Failed to load projects", description: String(e?.message ?? e) });
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
    flashSaved();
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

async function deleteProject() {
  const p = selectedProject.value;
  if (!p) return;
  const ok = await confirmDialog({
    title: "Delete project?",
    message: `Delete "${p.name}"? This removes the project and all its scenes + blocks. Takes and generations are preserved (only the project metadata is removed).`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await projectsService.remove(p.id);
    selectedId.value = null;
    await refresh();
    pushToast({ kind: "success", title: "Project deleted" });
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

const KIND_HOME_HASH = { audiobook: "#chapter", game_voicelines: "#lines", podcast: "#chapter", custom: "#chapter" };
const KIND_TO_FOCUS = { audiobook: "audiobook", game_voicelines: "game", podcast: "podcast", custom: "multiple" };
function landInHomeBase(rec) {
  if (!rec) return;
  // The first project quietly sets the workspace focus — no quiz
  // (user decision 2026-06-12). Changeable any time in Settings.
  if (onboarding.primaryUseCase === "unset") {
    onboarding.set({ primary: KIND_TO_FOCUS[rec.project_type] || "multiple" }).catch(() => {});
  }
  activeProject.open(rec);
  window.location.hash = KIND_HOME_HASH[rec.project_type] || "#chapter";
}

// "Not making projects?" path from the kind picker — dictation /
// accessibility users set a focus instead of creating anything.
async function onFocusOnly(focusId) {
  showNewProject.value = false;
  try { await onboarding.set({ primary: focusId }); } catch { /* persists next time */ }
  window.location.hash = focusId === "dictation" ? "#captures" : "#settings";
}

async function onImportCreated({ project_id }) {
  pushToast({ kind: "success", title: "Project imported" });
  await refresh();
  if (project_id) selectedId.value = project_id;
  showImport.value = false;
  landInHomeBase(projects.value.find((p) => p.id === project_id));
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

// Mock's Open ➜ — make it the active project and land in its kind's
// home base (Chapters / Lines / Episodes).
const KIND_HOME = { audiobook: "#chapter", game_voicelines: "#lines", podcast: "#chapter", custom: "#chapter" };
function openProjectHome(p) {
  activeProject.open(p);
  window.location.hash = KIND_HOME[p.project_type] || "#chapter";
}

function createBlank() {
  // Kind picker modal — native prompt() dialogs are banned (project_gotchas).
  showNewProject.value = true;
}

async function onCreateProject({ name, project_type }) {
  try {
    const created = await projectsService.create({ name, project_type, metadata: {} });
    showNewProject.value = false;
    await refresh();
    selectedId.value = created.id;
    landInHomeBase(projects.value.find((p) => p.id === created.id));
  } catch (e) {
    pushToast({ kind: "error", title: "Create failed", description: String(e?.message ?? e) });
  }
}

async function onCreateDemo(kind) {
  try {
    const r = await api.request("/v1/projects/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    showNewProject.value = false;
    await refresh();
    selectedId.value = r.project_id;
    pushToast({ kind: "success", title: "Demo project loaded", description: "Explore freely — deleting it touches nothing else." });
  } catch (e) {
    pushToast({ kind: "error", title: "Demo failed", description: String(e?.message ?? e) });
  }
}

function onCreateFromImport() {
  showNewProject.value = false;
  showImport.value = true;
}


function sceneStatusPill(scene) {
  const blocks = scene.block_count ?? 0;
  if (blocks === 0) return { label: "pending",    cls: "jv-pill--ghost" };
  if (blocks > 0)  return { label: "rendered",   cls: "jv-pill--green" };
  return                  { label: "—",          cls: "jv-pill--ghost" };
}

onMounted(() => {
  // SWR: paint the cache immediately, fetch in background only if stale.
  projectsCache.refreshIfStale();
  // Home's Start-something pills hand a kind over via sessionStorage —
  // consume it once and open the kind picker preselected.
  try {
    if (window.sessionStorage?.getItem("jv.books.openImport")) {
      window.sessionStorage.removeItem("jv.books.openImport");
      showImport.value = true;
    }
    const k = window.sessionStorage?.getItem("jv.books.createKind");
    if (k !== null) {
      window.sessionStorage.removeItem("jv.books.createKind");
      newProjectKind.value = k || "";
      showNewProject.value = true;
    }
  } catch { /* ignore */ }
});

// Browsing ≠ activating (user decision 2026-06-12): expanding a row to
// peek at details must NOT re-tailor the whole app. Only Open ➜,
// create, and import activate (landInHomeBase / openProjectHome).
</script>

<template>
  <div class="books">
    <!-- Mock grid (user-approved 2026-06-12): toolbar + flat table; a
         row click expands its detail card inline (provider-row pattern);
         Open ➜ is the ONLY activation. -->
    <div class="books__toolbar">
      <input v-model="search" class="jv-input jv-input--sm books__search" placeholder="Search projects…" />
      <button
        v-for="t in PROJECT_TYPES"
        :key="t.id"
        class="jv-pill"
        :class="projectTypeFilter === t.id ? 'jv-pill--solid' : 'jv-pill--ghost'"
        @click="projectTypeFilter = t.id"
      >{{ t.label }}</button>
      <span class="jv-spacer" />
      <JvButton variant="secondary" size="sm" label="⬇ Import" title="Create a project from a file — EPUB, DOCX, CSV, markdown, JustWrite JSON" @click="showImport = true" />
      <JvButton variant="primary" size="sm" label="＋ New project" @click="createBlank" />
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

    <table v-else class="jv-table books__grid">
      <thead><tr>
        <th>Project</th>
        <th>Kind</th>
        <th class="books__num">Structure</th>
        <th class="books__num">Last opened</th>
        <th></th>
      </tr></thead>
      <tbody>
        <template v-for="p in filtered" :key="p.id">
          <tr class="books__row" :class="{ 'books__row--open': p.id === selectedId }" :title="p.id === selectedId ? 'Collapse details' : 'Expand details — settings, cast, chapters, export'" @click="selectedId = p.id === selectedId ? null : p.id">
            <td><strong>{{ p.name }}</strong></td>
            <td>{{ KIND_ICON[p.project_type] || "📄" }} {{ PROJECT_TYPE_LABEL[p.project_type] ?? p.project_type }}</td>
            <td class="books__num jv-muted">{{ p.scene_count }} {{ copy.chapter.plural.toLowerCase() }}</td>
            <td class="books__num jv-muted">{{ fmtAgo(p.updated_at) }}</td>
            <td class="books__row-actions">
              <JvButton variant="ghost" size="sm" label="Open ➜" :title="`Make it the active project — the sidebar reshapes to ${PROJECT_TYPE_LABEL[p.project_type] || 'this kind'}`" @click.stop="openProjectHome(p)" />
            </td>
          </tr>
          <tr v-if="p.id === selectedId" class="books__expand">
            <td colspan="5" class="books__expand-cell">
              <div class="books__detail">
      <template v-if="selectedProject">
        <div class="jv-card books__detail-card">
          <header class="books__detail-header">
            <h2 class="books__detail-title">{{ selectedProject.name }}</h2>
            <JvTag :label="PROJECT_TYPE_LABEL[selectedProject.project_type] ?? selectedProject.project_type" />
            <span v-if="selectedProject.imported_from" class="jv-pill jv-pill--ghost">imported_from = {{ selectedProject.imported_from }}</span>
          </header>

          <div class="books__autosave jv-muted">
            Changes save automatically
            <span v-if="savedFlash" class="jv-pill jv-pill--green">Saved ✓</span>
          </div>
          <div class="books__fields">
            <label class="books__field">
              <span>Title</span>
              <input
                class="jv-input jv-w-name"
                :value="selectedProject.name"
                placeholder="Project title"
                @change="commitName"
              />
            </label>

            <label class="books__field">
              <span>Author</span>
              <input
                class="jv-input jv-w-name"
                v-model="editAuthor"
                placeholder="e.g., D. Nash"
                @change="commitMeta('author', editAuthor)"
              />
            </label>

            <label class="books__field">
              <span>Mastering target</span>
              <select
                class="jv-input jv-w-name"
                :value="selectedProject.mastering_preset ?? ''"
                @change="(ev) => commitMastering(ev.target.value)"
              >
                <option v-for="m in MASTERING_PRESETS" :key="m.id" :value="m.id">{{ m.label }}</option>
              </select>
            </label>

            <label class="books__field">
              <span>Render preset</span>
              <select
                class="jv-input jv-w-name"
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
                class="jv-input jv-w-url"
                v-model="editWebhookUrl"
                placeholder="https://your-service.local/webhooks/render"
                @change="commitMeta('webhook_url', editWebhookUrl)"
              />
            </label>
          </div>

          <div class="jv-divider" />

          <!-- Render + export live on Studio (4 · Export) — Projects is
               the library (user decision 2026-06-12). -->
          <div class="books__actions">
            <JvButton variant="primary" label="Open in Studio ➜" title="Cast → Script → Render → Export" @click="openInStudio" />
            <span class="books__spacer" />
            <button class="jv-btn jv-btn--danger-outline jv-btn--sm" type="button" @click="deleteProject">Delete project</button>
          </div>

          <div class="jv-divider" />

          <h4 class="books__chapters-h">{{ copy.chapter.plural }}</h4>

          <div v-if="scenesLoading" class="jv-muted" style="padding: 8px 0">Loading chapters…</div>

          <template v-else>
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
                  <td></td>
                  <td>{{ s.position }}</td>
                  <td><strong>{{ s.title ?? `Chapter ${s.position}` }}</strong></td>
                  <td>{{ s.block_count ?? 0 }}</td>
                  <td class="jv-muted">—</td>
                  <td>
                    <span class="jv-pill" :class="sceneStatusPill(s).cls">{{ sceneStatusPill(s).label }}</span>
                  </td>
                  <td class="books__row-actions">
                    <button class="jv-btn jv-btn--ghost jv-btn--sm" title="Open in Chapter view">Open</button>
                  </td>
                </tr>
              </tbody>
            </table>

          </template>
        </div>
      </template>
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <!-- Multi-adapter import modal (justwrite / csv_lines / srt / audacity_labels / justvoice_standard / elevenlabs-stub). -->
    <ImportModal v-if="showImport" @close="showImport = false" @created="onImportCreated" />
    <NewProjectModal
      v-if="showNewProject"
      :initial-kind="newProjectKind"
      @focus-only="onFocusOnly"
      @close="showNewProject = false"
      @create="onCreateProject"
      @import="onCreateFromImport"
      @demo="onCreateDemo"
    />

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
                  type="checkbox" class="jv-check"
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
.books__autosave { display: flex; align-items: center; gap: 8px; font-size: 11.5px; margin-bottom: 6px; min-height: 22px; }

.books {
  display: flex;
  flex-direction: column;
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

.books__detail { min-width: 0; }

.books__detail-empty {
  padding: 40px;
  text-align: center;
}

.books__detail-card {
  max-width: var(--shell-page);
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
.books__qc { margin-top: 14px; display: flex; flex-direction: column; gap: 8px; }
.books__qc-head { display: flex; align-items: center; gap: 10px; }
.books__qc-limits { font-size: 11.5px; }
.books__qc-bad { color: var(--danger, #a8442e); font-weight: 600; }
.books__notes {
  margin: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface-2); font-size: 12.5px; line-height: 1.6;
  white-space: pre-wrap; max-height: 360px; overflow-y: auto;
}

.books__open {
  appearance: none; border: 0; background: transparent;
  color: var(--accent-ink); font: inherit; font-size: 11px; font-weight: 600;
  cursor: pointer; margin-left: 8px; padding: 0;
}
.books__open:hover { text-decoration: underline; }

.books__toolbar { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
.books__search { max-width: 260px; }
.books__grid { margin: 0; }
.books__num { text-align: right; }
.books__row { cursor: pointer; }
.books__row:hover td { background: var(--surface-2); }
.books__row--open td { background: var(--accent-soft); }
.books__row-actions { text-align: right; white-space: nowrap; }
.books__expand-cell { padding: 0 !important; background: var(--surface-2); }
.books__expand-cell .books__detail { padding: 14px 16px; }
</style>
