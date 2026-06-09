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
import JvButton from "../components/jv/JvButton.vue";
import JvTag from "../components/jv/JvTag.vue";
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
      <div v-else-if="filtered.length === 0" class="books__empty">
        <p class="jv-muted">No projects yet.</p>
        <JvButton variant="secondary" size="sm" :loading="importing" :label="importing ? 'Importing…' : 'Import from JustWrite'" @click="importJustWriteFromFile" style="margin-top: 12px" />
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
        <span class="jv-pane-list__meta">{{ p.scene_count }} scenes</span>
      </div>
    </ListPane>

    <div class="books__detail">
      <div v-if="!selectedProject" class="books__detail-empty jv-card">
        <p class="jv-muted">Select a project on the left, or import a JustWrite book to get started.</p>
        <div class="jv-btn-group" style="margin-top: 16px; justify-content: center;">
          <JvButton variant="secondary" :loading="importing" :label="importing ? 'Importing…' : 'Import JustWrite book'" @click="importJustWriteFromFile" />
          <JvButton variant="secondary" label="+ New blank project" @click="createBlank" />
        </div>
      </div>

      <template v-else>
        <div class="jv-card books__detail-card">
          <header class="books__detail-header">
            <h2>{{ selectedProject.name }}</h2>
            <JvTag :label="PROJECT_TYPE_LABEL[selectedProject.project_type] ?? selectedProject.project_type" style="margin-left: 12px" />
          </header>
          <p class="jv-muted" style="margin: 8px 0 20px">{{ selectedProject.description || "No description." }}</p>

          <div class="jv-divider" />

          <dl class="books__meta">
            <div>
              <dt>Scenes</dt>
              <dd>{{ selectedProject.scene_count }}</dd>
            </div>
            <div>
              <dt>Mastering preset</dt>
              <dd>{{ selectedProject.mastering_preset ?? "—" }}</dd>
            </div>
            <div>
              <dt>Imported from</dt>
              <dd>{{ selectedProject.imported_from ?? "—" }}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{{ new Date(selectedProject.created_at).toLocaleString() }}</dd>
            </div>
          </dl>

          <div class="jv-divider" />

          <div class="jv-btn-group">
            <JvButton variant="primary" label="Render all scenes" />
            <JvButton variant="secondary" label="Export ZIP" @click="exportProject(selectedProject.id)" />
          </div>
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
  max-width: 640px;
}

.books__detail-header {
  display: flex;
  align-items: baseline;
}

.books__meta {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 24px;
  margin: 16px 0;
}

.books__meta div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.books__meta dt {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
}

.books__meta dd {
  margin: 0;
  font-size: 14px;
  color: var(--ink);
}

.books__empty {
  padding: 32px;
  text-align: center;
}
</style>
