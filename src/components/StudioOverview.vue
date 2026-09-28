<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Overview — the project's own page (ruled 2026-09-27: "studio stays
  as container", "open project always lands on overview").

  Where each step stands (each row opens its step), Continue to the first step
  with work left, the project's settings, and the few things you do to a
  whole project: re-import, export the package, delete.

  Every count comes from studioStatus.js, which uses only data the app already
  has. Discover and Export show no count because nothing records a scan or an
  export (decision 2).

  Fields that are NOT here, on purpose:
    · Webhook on complete — `metadata.webhook_url` is read by nothing and no
      webhook ever fires (decision 1: off until webhooks are project-linked).
    · Render preset — presets die ("2 presets die").
    · A cast editor — Cast is the one editor; this page links to it.

  These settings moved here from the Projects detail pane, which was deleted
  in the same change, so each save uses the same PATCH /v1/projects/{id} and
  autosave that pane had. Author reaches the M4B `artist` tag
  (projects_api.m4b_author).
-->
<script setup>
import { computed, ref, watch } from "vue";
import {
  UiButton, UiField, UiInput, UiSelect, UiTable, UiTag, UiTextarea,
  confirmDialog, pushToast, saveBlob,
} from "@delebash/llm-ui";
import ImportModal from "../views/ImportModal.vue";
import { projectsService } from "../services/projects.js";
import { useCopy } from "../services/copy.js";
import { useProjectsStore } from "../stores/projects.js";
import { useActiveProject } from "../stores/activeProject.js";
import { continueStep, stepStatus } from "../views/studioStatus.js";

const props = defineProps({
  project: { type: Object, required: true },
  steps: { type: Array, required: true },       // stepsFor(kind), Overview included
  state: { type: Object, required: true },      // projectState(...)
});
const emit = defineEmits(["go", "reimported"]);

const copy = useCopy();
const projectsStore = useProjectsStore();
const activeProject = useActiveProject();

const KIND_LABEL = {
  audiobook: "📖 Audiobook",
  game_voicelines: "🎮 Game voicelines",
  podcast: "🎙️ Podcast",
  custom: "📄 Text",
};

// The server's mastering vocabulary (mastering.resolve_master_target): an empty
// value means "this kind's default" (KIND_MASTER_DEFAULTS — ACX for an
// audiobook, podcast for a podcast, raw otherwise), "none" means raw, and the
// four names are MASTER_PRESET_NAMES. The Projects pane labelled "" as "None",
// which on an audiobook actually mastered to ACX; and it offered "Custom",
// which the server renders raw with a warning — neither is offered here.
const KIND_DEFAULT_WORDS = { audiobook: "ACX", podcast: "Podcast" };
const MASTERING_PRESETS = computed(() => [
  { id: "", label: `This kind's default (${KIND_DEFAULT_WORDS[props.project.project_type] || "raw"})` },
  { id: "none", label: "None — raw" },
  { id: "acx", label: "ACX (-20 LUFS / -3.5 dB peak)" },
  { id: "inaudio", label: "iAudio" },
  { id: "podcast", label: "Podcast" },
  { id: "youtube", label: "YouTube" },
]);

const meta = computed(() => (props.project.metadata && typeof props.project.metadata === "object")
  ? props.project.metadata : {});

// Local copies, committed on change — the Projects pane's autosave, moved.
const editName = ref("");
const editAuthor = ref("");
const editDescription = ref("");
watch(() => props.project, (p) => {
  editName.value = p?.name || "";
  editAuthor.value = meta.value.author || "";
  editDescription.value = p?.description || "";
}, { immediate: true });

const savedFlash = ref(false);
let flashTimer = null;
async function patch(body) {
  try {
    await projectsService.update(props.project.id, body);
    await projectsStore.reload();
    // The title bar's Project and Master chips read the active project's
    // snapshot, so a rename or a new mastering target re-opens it.
    const fresh = projectsStore.byId(props.project.id);
    if (fresh && activeProject.id === fresh.id) activeProject.open(fresh);
    savedFlash.value = true;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { savedFlash.value = false; }, 1500);
  } catch (e) {
    pushToast({ kind: "error", title: "Save failed", description: String(e?.message ?? e) });
  }
}
function commitName() {
  const v = editName.value.trim();
  if (!v) { editName.value = props.project.name; return; }
  if (v !== props.project.name) patch({ name: v });
}
function commitAuthor() {
  const v = editAuthor.value.trim();
  if (v !== (meta.value.author || "")) patch({ metadata: { ...meta.value, author: v } });
}
function commitDescription() {
  const v = editDescription.value;
  if (v !== (props.project.description || "")) patch({ description: v });
}
function commitMastering(v) {
  if ((v || "") !== (props.project.mastering_preset || "")) patch({ mastering_preset: v || "" });
}

// ── Where it stands ─────────────────────────────────────────────────────
const unit = computed(() => copy.value.chapter);
const numbered = computed(() => props.steps.filter((s) => s.key !== "overview"));
const statusRows = computed(() => numbered.value.map((s) => ({ ...s, ...stepStatus(s.key, props.state, unit.value) })));
const STATUS_COLUMNS = [
  { id: "label", header: "Step" },
  { id: "text", header: "Status" },
  { id: "tag", header: "In the way", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
];
const next = computed(() => continueStep(props.project.project_type, props.state));
const nextLabel = computed(() => props.steps.find((s) => s.key === next.value)?.label || "");

// ── Whole-project actions ───────────────────────────────────────────────
const showReimport = ref(false);
function onReimported() {
  showReimport.value = false;
  emit("reimported");
}

async function exportPackage() {
  try {
    const blob = await projectsService.exportZip(props.project.id);
    await saveBlob(blob, `${(props.project.name || "project").replace(/\W+/g, "-")}.zip`,
      { title: "Save project", filterName: "JustVoice project", filterExt: "zip" });
    pushToast({ kind: "success", title: "Project exported" });
  } catch (e) {
    pushToast({ kind: "error", title: "Export failed", description: String(e?.message ?? e) });
  }
}

async function deleteProject() {
  const p = props.project;
  const ok = await confirmDialog({
    title: "Delete project?",
    message: `Delete "${p.name}"? This removes the project and everything in it. Takes and generations are kept. Personas, voices and lexicons are library-level and stay.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await projectsService.remove(p.id);
    if (activeProject.id === p.id) activeProject.clear();
    await projectsStore.reload();
    pushToast({ kind: "success", title: "Project deleted" });
    window.location.hash = "#projects";
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}
</script>

<template>
  <section class="studio-overview">
    <div class="studio-overview__main">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Where it stands</h3>
          <span class="jv-spacer" />
          <UiButton
            v-if="next"
            intent="primary"
            size="small"
            :label="`Continue — ${nextLabel} ➜`"
            :title="`The first step with work left`"
            @click="emit('go', next)"
          />
        </div>
        <div class="jv-card__body">
          <p v-if="!next" class="jv-hint">
            No text yet — add or import {{ unit.plural.toLowerCase() }} in
            <a href="#chapter">{{ unit.plural }}</a>, then come back here.
          </p>
          <UiTable class="jv-table-look studio-overview__steps" :data="statusRows" :columns="STATUS_COLUMNS"
            data-key="key" row-hover @row-click="({ data }) => emit('go', data.key)">
            <template #label="{ row }"><a class="studio-overview__step" href="#studio" @click.prevent>{{ row.label }}</a></template>
            <template #text="{ row }">{{ row.text }}</template>
            <template #tag="{ row }"><UiTag v-if="row.tag" :intent="row.tag.intent">{{ row.tag.label }}</UiTag></template>
          </UiTable>
        </div>
      </div>

      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">Project</h3>
          <span class="jv-spacer" />
          <UiTag v-if="savedFlash" intent="success">Saved ✓</UiTag>
          <span v-else class="jv-hint">changes save automatically</span>
        </div>
        <div class="jv-card__body jv-col--start">
          <UiField label="Title" layout="block">
            <UiInput v-model="editName" width="name" placeholder="Project title" @change="commitName" />
          </UiField>
          <UiField label="Author" layout="block" hint="Written into the M4B as its author.">
            <UiInput v-model="editAuthor" width="name" placeholder="e.g., D. Nash" @change="commitAuthor" />
          </UiField>
          <UiField label="Description" layout="block">
            <UiTextarea v-model="editDescription" width="prose" :rows="3" placeholder="What this project is" @blur="commitDescription" />
          </UiField>
          <UiField label="Kind" layout="block" hint="Set when the project is created.">
            <UiTag intent="ghost">{{ KIND_LABEL[project.project_type] || project.project_type }}</UiTag>
          </UiField>
          <UiField label="Mastering target" layout="block" hint="Every render is mastered to this, and Export checks against it.">
            <UiSelect :model-value="project.mastering_preset || ''" width="name" :options="MASTERING_PRESETS"
              option-value="id" @update:model-value="commitMastering" />
          </UiField>
        </div>
      </div>
    </div>

    <div class="studio-overview__side">
      <div class="jv-card jv-card--soft">
        <div class="jv-card__header"><h3 class="jv-card__title">Also from here</h3></div>
        <div class="jv-card__body jv-inline-row studio-overview__actions">
          <UiButton intent="secondary" size="small" label="↻ Re-import"
            title="Merge a newer version of the source file into this project" @click="showReimport = true" />
          <UiButton intent="secondary" size="small" label="📦 Export .justvoice.zip"
            title="The whole project — text, cast, lexicons — as one file" @click="exportPackage" />
        </div>
      </div>
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Delete project</h3></div>
        <div class="jv-card__body">
          <p class="jv-hint">
            Removes the project and everything in it. Takes and generations are kept. Personas,
            voices and lexicons are library-level and stay.
          </p>
          <UiButton intent="danger-outline" size="small" label="Delete project" @click="deleteProject" />
        </div>
      </div>
    </div>

    <ImportModal v-if="showReimport" :project-id="project.id" @close="showReimport = false" @created="onReimported" />
  </section>
</template>

<style scoped>
/* Two columns like the mock (work on the left, whole-project actions on the
   right); stacks on a narrow window. `.jv-split` is for input → result
   make-a-thing surfaces, which this is not, so the layout is local. */
.studio-overview {
  display: grid;
  grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr);
  gap: 14px;
  align-items: start;
}
.studio-overview__main,
.studio-overview__side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.studio-overview__step { font-weight: 700; color: var(--accent-ink); }
.studio-overview__steps :deep(.ui-table-row) { cursor: pointer; }
.studio-overview__actions { gap: 8px; flex-wrap: wrap; }
@media (max-width: 1100px) {
  .studio-overview { grid-template-columns: 1fr; }
}
</style>
