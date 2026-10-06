<!-- SPDX-License-Identifier: MIT -->
<!--
  ProjectsView — the list of projects (audiobooks + game-voicelines + podcasts +
  custom). Project is the use-case-generalized entity per DESIGN_FREEZE §4.4.
  Audiobook = chapters + paragraphs; game = dialogue trees + NPC lines;
  podcast = episodes + segments. Same data model, different export pipeline.

  A plain list (2026-09-27). Studio is the project's home and opening a project
  always lands on its Overview, which now holds everything the old detail pane
  did — title, author, description, mastering target, re-import, export,
  delete. The pane's cast pills are gone because Cast is the one cast editor;
  its Render-preset and Webhook fields are gone because presets die and no
  webhook ever read that field.
-->
<script setup>
import { computed, onActivated, onMounted, ref } from "vue";
import { UiButton, UiInput, UiChip } from "@delebash/llm-ui";
import { EmptyState } from "@delebash/llm-ui";
import ImportModal from "./ImportModal.vue";
import NewProjectModal from "../components/NewProjectModal.vue";
import { projectsService } from "../services/projects.js";
import { openProjectInStudio } from "../services/openProject.js";
import { useApi } from "../stores/api.js";
import { pushToast } from "@delebash/llm-ui";
import { chapterWordForKind, useCopy } from "../services/copy.js";
import { PROJECT_KINDS, kindLabel, projectKind } from "../services/projectKinds.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useOnboarding } from "../stores/onboarding.js";
import { useProjectsStore } from "../stores/projects.js";

const api = useApi();
const activeProject = useActiveProject();
const onboarding = useOnboarding();

const copy = useCopy();

// Projects come from the shared store (single source of truth). Every
// mutation here calls store.reload() so other views reflect it immediately.
const projectsStore = useProjectsStore();
const projects = computed(() => projectsStore.items);

const search = ref("");
const projectTypeFilter = ref("all");
const loading = computed(() => !projectsStore.loaded);
const showImport = ref(false);
const showNewProject = ref(false);
const newProjectKind = ref("");

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

// One kinds map (services/projectKinds.js — the one-wording audit B9, 2026-10-06).
const PROJECT_TYPES = [
  { id: "all", label: "All" },
  ...Object.entries(PROJECT_KINDS).map(([id, k]) => ({ id, label: `${k.icon} ${k.plural}` })),
];
// Each row's chapter count in ITS kind's word — it was the open project's (C2).
const chaptersWord = (p) => {
  const w = chapterWordForKind(projectKind(p.project_type).kind);
  return (p.scene_count === 1 ? w.singular : w.plural).toLowerCase();
};

function fmtAgo(iso) {
  if (!iso) return "—";
  const ago = Date.now() - new Date(iso).getTime();
  if (ago < 3_600_000) return `${Math.max(1, Math.floor(ago / 60_000))} min`;
  if (ago < 86_400_000) return `${Math.floor(ago / 3_600_000)} h`;
  return `${Math.floor(ago / 86_400_000)} d`;
}


// Refresh the shared projects store. Called after every mutation here
// (create/import) so all consumers — Chapters, Studio, etc. — reflect it.
async function refresh() {
  try {
    await projectsStore.reload();
  } catch (e) {
    pushToast({ kind: "error", title: "Failed to load projects", description: String(e?.message ?? e) });
  }
}

const KIND_TO_FOCUS = { audiobook: "audiobook", game_voicelines: "game", podcast: "podcast", custom: "multiple" };
// A new project — created or imported — opens like any other: on its Overview.
function landOnOverview(rec) {
  if (!rec) return;
  // The first project quietly sets the workspace focus — no quiz
  // (user decision 2026-06-12). Changeable any time in Settings.
  if (onboarding.primaryUseCase === "unset") {
    onboarding.set({ primary: KIND_TO_FOCUS[rec.project_type] || "multiple" }).catch(() => {});
  }
  openProjectInStudio(activeProject, rec);
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
  showImport.value = false;
  landOnOverview(projects.value.find((p) => p.id === project_id));
}

function createBlank() {
  // Kind picker modal — native prompt() dialogs are banned (project_gotchas).
  showNewProject.value = true;
}

async function onCreateProject({ name, project_type, language }) {
  try {
    const created = await projectsService.create({ name, project_type, language, metadata: {} });
    showNewProject.value = false;
    await refresh();
    landOnOverview(projects.value.find((p) => p.id === created.id));
  } catch (e) {
    pushToast({ kind: "error", title: "Create failed", description: String(e?.message ?? e) });
  }
}

// A demo opens like any new project (2026-10-05) — it skipped this, so after
// a reset the focus stayed "unset" and the menu kept every kind's items.
async function onCreateDemo(kind) {
  try {
    const run = await api.request("/v1/projects/demo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    showNewProject.value = false;
    await refresh();
    pushToast({ kind: "success", title: "Demo project loaded", description: "Explore freely — deleting it touches nothing else." });
    landOnOverview(projects.value.find((p) => p.id === run?.project_id));
  } catch (e) {
    pushToast({ kind: "error", title: "Demo failed", description: String(e?.message ?? e) });
  }
}

function onCreateFromImport() {
  showNewProject.value = false;
  showImport.value = true;
}

onMounted(() => {
  // Warm the shared store (idempotent).
  projectsStore.ensureLoaded();
});

// Home's Start-something pills (and Chapters' "1 Import") hand their ask over
// via sessionStorage. Consumed on EVERY entry: this view is kept alive
// (App.vue), so a mounted-time read fires once per session and the second
// "start an audiobook" click of a session would open nothing.
onActivated(() => {
  try {
    if (window.sessionStorage?.getItem("jv.projects.openImport")) {
      window.sessionStorage.removeItem("jv.projects.openImport");
      showImport.value = true;
    }
    const k = window.sessionStorage?.getItem("jv.projects.createKind");
    if (k !== null) {
      window.sessionStorage.removeItem("jv.projects.createKind");
      newProjectKind.value = k || "";
      showNewProject.value = true;
    }
  } catch { /* ignore */ }
});
</script>

<template>
  <div class="projects">
    <div class="jv-lib-toolbar">
      <UiInput v-model="search" size="small" class="projects__search" placeholder="Search projects…" />
      <UiChip
        v-for="t in PROJECT_TYPES"
        :key="t.id"
        :selected="projectTypeFilter === t.id"
        @click="projectTypeFilter = t.id"
      >{{ t.label }}</UiChip>
      <span class="jv-spacer" />
      <UiButton intent="secondary" size="small" label="⬇ Import" title="Create a project from a file — EPUB, DOCX, CSV, markdown, JustWrite JSON" @click="showImport = true" />
      <UiButton intent="primary" size="small" label="＋ New project" @click="createBlank" />
    </div>

    <div v-if="loading" class="projects__empty jv-muted">Loading…</div>
    <EmptyState
      v-else-if="filtered.length === 0 && !search && projectTypeFilter === 'all'"
      icon="Sparkle"
      :title="`No ${copy.book.plural.toLowerCase()} yet`"
      :message="`Import from JustWrite, paste a manuscript chapter, or start blank. Studio walks you from discover → script → cast → render.`"
      action-label="+ Import…"
      compact
      @action="showImport = true"
    />
    <div v-else-if="filtered.length === 0" class="projects__empty">
      <p class="jv-muted">No {{ copy.book.plural.toLowerCase() }} match this filter.</p>
    </div>

    <table v-else class="jv-table projects__grid">
      <thead><tr>
        <th>Project</th>
        <th>Kind</th>
        <th class="projects__num">Structure</th>
        <th class="projects__num">Last opened</th>
      </tr></thead>
      <tbody>
        <tr v-for="p in filtered" :key="p.id" class="projects__row"
          title="Open in Studio — its Overview holds the settings and where each step stands"
          @click="openProjectInStudio(activeProject, p)">
          <td><strong class="projects__name">{{ p.name }}</strong></td>
          <td>{{ kindLabel(p.project_type) }}</td>
          <td class="projects__num jv-muted">{{ p.scene_count }} {{ chaptersWord(p) }}</td>
          <td class="projects__num jv-muted">{{ fmtAgo(p.updated_at) }}</td>
        </tr>
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
  </div>
</template>

<style scoped>
.projects {
  display: flex;
  flex-direction: column;
  gap: 0;
}
.projects__empty {
  padding: 32px;
  text-align: center;
}
.projects__search { max-width: 260px; }
.projects__grid { margin: 0; }
.projects__num { text-align: right; }
.projects__row { cursor: pointer; }
.projects__row:hover td { background: var(--surface-2); }
.projects__name { color: var(--accent-ink); }
</style>
