<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  BooksView — multi-use Project list (audiobooks + game-voicelines + podcasts +
  custom). Project is the use-case-generalized entity per DESIGN_FREEZE §4.4.
  Audiobook = chapters + paragraphs; game = dialogue trees + NPC lines;
  podcast = episodes + segments. Same data model, different export pipeline.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import ListPane from "../components/ListPane.vue";
import { projectsService } from "../services/projects.js";
import { pushToast } from "../services/toastBridge.js";

const projects = ref([]);
const selectedId = ref(null);
const search = ref("");
const projectTypeFilter = ref("all");
const loading = ref(false);
const importing = ref(false);

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

async function importJustWriteFromFile() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    importing.value = true;
    try {
      const text = await file.text();
      const book = JSON.parse(text);
      const result = await projectsService.importJustWrite(book);
      pushToast({
        kind: "success",
        title: "JustWrite book imported",
        description: `${result.scene_count} scenes, ${result.block_count} blocks, ${result.persona_count} personas`,
      });
      await refresh();
      selectedId.value = result.project_id;
    } catch (e) {
      pushToast({ kind: "error", title: "Import failed", description: String(e?.message ?? e) });
    } finally {
      importing.value = false;
    }
  };
  input.click();
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

onMounted(refresh);
</script>

<template>
  <div class="books">
    <ListPane v-model:search-value="search" title="Projects" search-placeholder="Search by name…">
      <template #actions>
        <button class="btn btn--primary" @click="createBlank">+ New</button>
      </template>

      <div class="books__filter">
        <button
          v-for="t in PROJECT_TYPES"
          :key="t.id"
          class="filter-chip"
          :class="{ 'filter-chip--active': projectTypeFilter === t.id }"
          @click="projectTypeFilter = t.id"
        >
          {{ t.label }}
        </button>
      </div>

      <div v-if="loading" class="books__empty">Loading…</div>
      <div v-else-if="filtered.length === 0" class="books__empty">
        <p>No projects yet.</p>
        <button class="btn" @click="importJustWriteFromFile" :disabled="importing">
          {{ importing ? "Importing…" : "Import from JustWrite" }}
        </button>
      </div>
      <div
        v-for="p in filtered"
        :key="p.id"
        class="books__item"
        :class="{ 'books__item--active': p.id === selectedId }"
        @click="selectedId = p.id"
      >
        <div class="books__item-row">
          <span class="books__type-pill">{{ PROJECT_TYPE_LABEL[p.project_type] ?? p.project_type }}</span>
          <strong class="books__item-name">{{ p.name }}</strong>
        </div>
        <span class="books__item-meta">{{ p.scene_count }} scenes</span>
      </div>
    </ListPane>

    <div class="books__detail">
      <div v-if="!selectedProject" class="books__detail-empty">
        <p>Select a project on the left, or import a JustWrite book to get started.</p>
        <div class="books__cta-row">
          <button class="btn" @click="importJustWriteFromFile" :disabled="importing">
            {{ importing ? "Importing…" : "Import JustWrite book" }}
          </button>
          <button class="btn" @click="createBlank">+ New blank project</button>
        </div>
      </div>
      <template v-else>
        <header class="books__detail-header">
          <h2>{{ selectedProject.name }}</h2>
          <span class="books__type-pill books__type-pill--inline">{{
            PROJECT_TYPE_LABEL[selectedProject.project_type] ?? selectedProject.project_type
          }}</span>
        </header>
        <p class="books__description">{{ selectedProject.description || "No description." }}</p>
        <dl class="books__meta">
          <div><dt>Scenes</dt><dd>{{ selectedProject.scene_count }}</dd></div>
          <div><dt>Mastering preset</dt><dd>{{ selectedProject.mastering_preset ?? "—" }}</dd></div>
          <div><dt>Imported from</dt><dd>{{ selectedProject.imported_from ?? "—" }}</dd></div>
          <div><dt>Created</dt><dd>{{ new Date(selectedProject.created_at).toLocaleString() }}</dd></div>
        </dl>
        <div class="books__detail-actions">
          <button class="btn btn--primary">Render all scenes</button>
          <button class="btn" @click="exportProject(selectedProject.id)">Export ZIP</button>
        </div>
      </template>
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
.filter-chip {
  background: transparent;
  border: 1px solid var(--line, #e3e1dc);
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  color: inherit;
}
.filter-chip--active {
  background: var(--accent, #3a7d63);
  color: #fff;
  border-color: var(--accent, #3a7d63);
}
.books__item {
  padding: 12px 16px;
  border-radius: 6px;
  margin: 0 8px 4px;
  cursor: pointer;
}
.books__item:hover { background: var(--surface-2, #fbfaf7); }
.books__item--active {
  background: var(--accent, #3a7d63);
  color: #fff;
}
.books__item-row { display: flex; align-items: center; gap: 8px; }
.books__item-name { font-size: 14px; }
.books__item-meta { font-size: 12px; opacity: 0.7; display: block; margin-top: 2px; }
.books__type-pill {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.08);
  font-weight: 600;
}
.books__item--active .books__type-pill { background: rgba(255, 255, 255, 0.2); }
.books__type-pill--inline { vertical-align: middle; margin-left: 12px; }
.books__detail {
  padding: 32px;
  overflow-y: auto;
}
.books__detail-empty {
  padding: 40px;
  text-align: center;
  color: var(--ink-2, #4a4a4a);
}
.books__detail-header { display: flex; align-items: baseline; }
.books__detail-header h2 { margin: 0; }
.books__description { color: var(--ink-2, #4a4a4a); margin: 8px 0 24px; }
.books__meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 24px;
  margin-bottom: 24px;
}
.books__meta div { display: flex; flex-direction: column; }
.books__meta dt { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.6; }
.books__meta dd { margin: 0; font-size: 14px; }
.books__detail-actions { display: flex; gap: 8px; }
.books__empty { padding: 32px; text-align: center; color: var(--ink-3, #888); }
.books__cta-row { display: flex; gap: 8px; justify-content: center; margin-top: 16px; }
.btn {
  height: 32px;
  padding: 0 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--line-strong, #cfccc4);
  background: var(--surface-2, #fbfaf7);
  color: inherit;
}
.btn--primary {
  background: var(--accent, #3a7d63);
  color: #fff;
  border-color: var(--accent, #3a7d63);
}
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
