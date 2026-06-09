<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
// Projects landing view — renamed from "Books" for the multi-use-case
// rebrand, but the file keeps the BooksView name since other places
// reference it and we don't delete files. Hosts:
//   - A filter chip row for project kind (all / audiobook / game_voicelines
//     / podcast / custom).
//   - The "+ Import…" CTA that opens the new ImportModal.
//   - A simple table of committed projects.

import { ref, computed, onMounted } from "vue";
import ImportModal from "./ImportModal.vue";
import JwButton from "../components/ui/JwButton.vue";
import { projectsService } from "../services/projects.js";
import { pushToast } from "../services/toastBridge.js";

const projects = ref([]);
const loading = ref(false);
const showImport = ref(false);

const FILTERS = [
  { id: "all", label: "All" },
  { id: "audiobook", label: "Audiobook" },
  { id: "game_voicelines", label: "Game voicelines" },
  { id: "podcast", label: "Podcast" },
  { id: "custom", label: "Custom" },
];
const activeFilter = ref("all");

const visibleProjects = computed(() => {
  if (activeFilter.value === "all") return projects.value;
  return projects.value.filter((p) => p.kind === activeFilter.value);
});

async function refresh() {
  loading.value = true;
  try {
    const r = await projectsService.list();
    projects.value = r.projects || [];
  } catch (e) {
    pushToast({ message: `Failed to load projects: ${e.message || e}`, kind: "error" });
  } finally {
    loading.value = false;
  }
}

function openImport() {
  showImport.value = true;
}

function onCreated(rec) {
  pushToast({ message: `Imported "${rec.name}" (${rec.kind})`, kind: "success" });
  refresh();
}

onMounted(refresh);
</script>

<template>
  <section class="books">
    <header class="row">
      <div class="chips" role="tablist" aria-label="Filter by project kind">
        <button
          v-for="f in FILTERS"
          :key="f.id"
          type="button"
          class="chip"
          :class="{ active: activeFilter === f.id }"
          role="tab"
          :aria-selected="activeFilter === f.id"
          @click="activeFilter = f.id"
        >{{ f.label }}</button>
      </div>
      <div class="actions">
        <JwButton intent="primary" @click="openImport">+ Import…</JwButton>
      </div>
    </header>

    <div v-if="loading" class="muted">Loading projects…</div>
    <div v-else-if="!visibleProjects.length" class="empty">
      <p>No projects yet.</p>
      <p class="muted">Use <strong>+ Import…</strong> to bring in a JustWrite manuscript, CSV lines, SRT cues, or any other supported format.</p>
    </div>
    <table v-else class="proj-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Kind</th>
          <th>Source</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="p in visibleProjects" :key="p.id">
          <td>{{ p.name }}</td>
          <td><span class="pill">{{ p.kind }}</span></td>
          <td>{{ p.source }}</td>
          <td class="muted">{{ p.created_at }}</td>
        </tr>
      </tbody>
    </table>

    <ImportModal
      v-if="showImport"
      @close="showImport = false"
      @created="onCreated"
    />
  </section>
</template>

<style scoped>
.row { display: flex; justify-content: space-between; align-items: center; gap: 16px; margin-bottom: 16px; }
.chips { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--line, #e3e1dc);
  background: transparent;
  border-radius: 999px;
  padding: 4px 12px;
  font-size: 12px;
  cursor: pointer;
  color: var(--ink, #1f1f1c);
}
.chip.active { background: var(--accent, #3a7d63); color: white; border-color: transparent; }
.actions { display: flex; gap: 8px; }
.muted { color: var(--muted, #7c7a72); font-size: 13px; }
.empty { padding: 24px 0; text-align: center; }
.proj-table { width: 100%; border-collapse: collapse; }
.proj-table th, .proj-table td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line, #e3e1dc); font-size: 13px; }
.proj-table th { font-weight: 600; color: var(--muted, #7c7a72); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; }
.pill {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-soft, rgba(58, 125, 99, 0.12));
  color: var(--accent, #3a7d63);
  font-size: 11px;
  font-family: var(--font-mono, monospace);
}
</style>
