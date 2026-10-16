<!-- SPDX-License-Identifier: MIT -->
<!--
  Make the audiobook — the mock (dev only: #/mock/one-click). The one-click plan's slice 5, drawn
  in the app before the real screen (§6, the 2026-10-04 mock rule): Studio's Overview of a book,
  with the run's card on top of its main column. The card is the real one (components/
  BookRunCard.vue); the page around it is Overview's own template (components/StudioOverview.vue)
  — Where it stands, Project, Also from here, Delete project — on services/mock/bookRunMock.js in
  place of the server.

  States (?state=): new (the default) · price (the cloud route's question open) · blocked (no
  language model, no Language) · running (Direction, chapter VIII) · paused (the same, after a
  restart) · stopped (Stop pressed during the render) · failed (no ffmpeg at the M4B) · done (what
  to check). Each on this computer's model, or with ?route=frontier on a cloud model — its
  estimate and price before it starts, its cost after. Start, Stop, Resume, Save and Run again
  move between them as the real ones would.

  Not drawn: the AI tasks panel's strip for the run (the kit's own, as every task's), the Save
  dialog, and the pages the links open.
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { UiButton, UiField, UiInput, UiSelect, UiTable, UiTag, UiTextarea, UiToggle, confirmDialog, pageFlow, pushToast } from "@delebash/llm-ui";
import BookRunCard from "../../components/BookRunCard.vue";
import { priceQuestion } from "../../services/bookRun.js";
import { MASTER_TARGETS } from "../../services/masterTargets.js";
import { PROJECT, RUNNING_SINCE, STATES, UNIT, mockOverviewState, mockPlan, mockRun } from "../../services/mock/bookRunMock.js";
import { bookLanguageOptions } from "../../services/personaFacts.js";
import { kindLabel } from "../../services/projectKinds.js";
import { stepStatus } from "../../services/studioStatus.js";
import { stepsFor } from "../../services/studioSteps.js";

const route = useRoute();
const router = useRouter();
const state = computed(() => (STATES.includes(String(route.query.state)) ? String(route.query.state) : "new"));
const go = (s) => router.replace({ query: { ...route.query, state: s } });

// The price question is the cloud route's.
const frontier = computed(() => route.query.route === "frontier" || state.value === "price");
// The failed state is this machine without ffmpeg.
const plan = computed(() => mockPlan({ frontier: frontier.value, blocked: state.value === "blocked", noFfmpeg: state.value === "failed" }));
const run = computed(() => mockRun(state.value, { frontier: frontier.value }));
const busy = ref(false);

// The running state's clock.
const elapsed = ref(RUNNING_SINCE);
let timer = null;
watch(() => run.value?.status, (s) => {
  clearInterval(timer);
  elapsed.value = RUNNING_SINCE;
  if (s === "running") timer = setInterval(() => { elapsed.value += 1; }, 1000);
}, { immediate: true });
onBeforeUnmount(() => clearInterval(timer));

async function askPrice() {
  const q = priceQuestion(plan.value);
  return confirmDialog({ title: q.title, message: q.message, confirmLabel: q.confirmLabel });
}
async function start() {
  if (plan.value.ask_price && !(await askPrice())) return;
  router.replace({ query: { ...route.query, state: "running", ...(frontier.value ? { route: "frontier" } : {}) } });
}
onMounted(() => { if (state.value === "price") start(); });
function save() {
  pushToast({ kind: "success", message: "Saved Alice's Adventures in Wonderland.m4b to your Downloads folder." });
}
function goStep(step, arg) {
  const where = { script: "Script", render: "Render", cast: "Cast", export: "Export", ai: "AI Settings" }[step] ?? step;
  const chapter = arg?.sceneId ? ` · ${arg.sceneId === "sc_vii" ? "CHAPTER VII" : "CHAPTER VIII"}` : "";
  pushToast({ kind: "info", message: `Opens ${where}${chapter}.` });
}
function routing(row) {
  pushToast({ kind: "info", message: `Opens AI Settings → Routing by feature on ${row.action}.` });
}

// ── The Studio frame and the rest of Overview, on the mock's numbers ───────────
const overview = computed(() => mockOverviewState(state.value));
const steps = stepsFor("audiobook");
const stepCards = computed(() => steps.map((t) => ({ ...t, sub: t.key === "overview" ? "book" : stepStatus(t.key, overview.value, UNIT).text })));
const STEP_TITLES = {
  overview: "Settings, and where each step stands",
  discover: "Find the speakers the text names",
  script: "Who speaks each line",
  cast: "Give each speaker a persona",
  render: "Every line's audio, and each chapter joined and mastered",
  export: "Package + ACX checklist",
};
const statusRows = computed(() => steps.filter((s) => s.key !== "overview").map((s) => ({ ...s, ...stepStatus(s.key, overview.value, UNIT) })));
const STATUS_COLUMNS = [
  { id: "label", header: "Step" },
  { id: "text", header: "Status" },
  { id: "tag", header: "In the way", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
];
const language = computed(() => (state.value === "blocked" ? "" : PROJECT.language));
const languageOptions = computed(() => bookLanguageOptions([{ language: "en" }], language.value));
const editName = ref(PROJECT.name);
const editAuthor = ref("");
const editDescription = ref("by Lewis Carroll");
const SPEECH_MARKS = [
  { id: "auto", label: "Auto — from the text" },
  { id: "double", label: "“Double”" },
  { id: "single", label: "‘Single’" },
  { id: "guillemets", label: "«Guillemets»" },
  { id: "german", label: "„German“" },
];
const opens = (what) => pushToast({ kind: "info", message: `Opens ${what}.` });
</script>

<template>
  <q-page :style-fn="pageFlow" class="studio jv-fill mock-one-click">
    <div class="jv-section studio__project-bar">
      <label class="studio__project-label">Book:</label>
      <UiSelect :model-value="PROJECT.id" width="name" :options="[{ value: PROJECT.id, label: PROJECT.name }]" />
    </div>

    <div class="studio__steps">
      <button v-for="t in stepCards" :key="t.key" type="button" class="jv-stepcard"
        :class="{ 'jv-stepcard--active': t.key === 'overview' }" :title="STEP_TITLES[t.key]"
        @click="t.key !== 'overview' && goStep(t.key)">
        <span class="jv-stepcard__title">{{ t.label }}</span>
        <span class="jv-stepcard__sub">{{ t.sub }}</span>
      </button>
    </div>

    <section class="studio-overview">
      <BookRunCard class="studio-overview__wide" :unit="UNIT" :plan="plan" :run="run" :busy="busy" :elapsed="elapsed"
        @start="start" @stop="go('stopped')" @resume="go('running')" @save="save" @go="goStep" @routing="routing" />
      <div class="studio-overview__main">
        <div class="jv-card">
          <div class="jv-card__header"><h3 class="jv-card__title">Where it stands</h3></div>
          <div class="jv-card__body">
            <UiTable class="jv-table-look studio-overview__steps" :data="statusRows" :columns="STATUS_COLUMNS"
              data-key="key" row-hover @row-click="({ data }) => goStep(data.key)">
              <template #label="{ row }"><a class="studio-overview__step" href="#studio" @click.prevent>{{ row.label }}</a></template>
              <template #text="{ row }">{{ row.text }}</template>
              <template #tag="{ row }">
                <span class="studio-overview__tags">
                  <UiTag v-for="t in (row.tags || (row.tag ? [row.tag] : []))" :key="t.label" :intent="t.intent"
                    :title="t.title || ''">{{ t.label }}</UiTag>
                </span>
              </template>
            </UiTable>
          </div>
        </div>

        <div class="jv-card">
          <div class="jv-card__header">
            <h3 class="jv-card__title">Project</h3>
            <span class="jv-spacer" />
            <span class="jv-hint">changes save automatically</span>
          </div>
          <div class="jv-card__body jv-col--start">
            <UiField label="Title" layout="block"><UiInput v-model="editName" width="name" placeholder="Project title" /></UiField>
            <UiField label="Author" layout="block" hint="Written into the M4B as its author.">
              <UiInput v-model="editAuthor" width="name" placeholder="e.g., D. Nash" />
            </UiField>
            <UiField label="Description" layout="block">
              <UiTextarea v-model="editDescription" width="prose" :rows="3" placeholder="What this project is" />
            </UiField>
            <UiField label="Language" layout="block"
              hint="What the book is written in. Cast warns when a speaker's persona speaks another language.">
              <UiSelect :model-value="language" width="id" :options="languageOptions" aria-label="Language" />
            </UiField>
            <UiField label="Kind" layout="block" hint="Set when the project is created.">
              <UiTag intent="ghost">{{ kindLabel(PROJECT.kind) }}</UiTag>
            </UiField>
            <UiField label="Mastering target" layout="block" hint="Every render is mastered to this, and Export checks against it.">
              <UiSelect model-value="acx" width="name" :options="MASTER_TARGETS" option-value="id" />
            </UiField>
            <UiField label="Pronunciation lexicon" layout="block">
              <div class="jv-inline-row">
                <UiSelect model-value="" width="name" :options="[{ id: '', label: 'None' }]" option-value="id" />
                <UiButton intent="ghost" size="small" label="Open ➜" @click="opens('Lexicons')" />
              </div>
            </UiField>
            <UiField label="Speech marks" layout="block"
              hint="How the book marks speech. Takes effect the next time a chapter is analyzed; a chapter whose lines you've edited keeps them.">
              <UiSelect model-value="auto" width="name" :options="SPEECH_MARKS" option-value="id" />
            </UiField>
            <UiField label="Leave out dialogue tags" layout="block"
              hint="The narrator skips lines like “said Marius,” that only say who spoke. (English dialogue tags only)">
              <UiToggle :model-value="false" aria-label="Leave out dialogue tags" />
            </UiField>
          </div>
        </div>
      </div>

      <div class="studio-overview__side">
        <div class="jv-card jv-card--soft">
          <div class="jv-card__header"><h3 class="jv-card__title">Also from here</h3></div>
          <div class="jv-card__body jv-inline-row studio-overview__actions">
            <UiButton intent="secondary" size="small" label="↻ Re-import"
              title="Merge a newer version of the source file into this project" @click="opens('Re-import')" />
            <UiButton intent="secondary" size="small" label="📦 Export .justvoice.zip"
              title="The whole project — text, speakers, personas, lexicons — as one file" @click="opens('the Save dialog')" />
          </div>
        </div>
        <div class="jv-card">
          <div class="jv-card__header"><h3 class="jv-card__title">Delete project</h3></div>
          <div class="jv-card__body">
            <p class="jv-hint">
              Removes the project and everything in it. Takes and generations are kept. Personas,
              voices and lexicons are library-level and stay.
            </p>
            <UiButton intent="danger-outline" size="small" label="Delete project" @click="opens('Delete project?')" />
          </div>
        </div>
      </div>
    </section>
  </q-page>
</template>

<style scoped>
/* The Studio frame's and Overview's own layout (pages/StudioPage.vue, components/StudioOverview.vue). */
.studio { padding: 0; display: flex; flex-direction: column; gap: 16px; }
.studio__project-bar { display: flex; align-items: center; gap: 12px; padding: 8px 12px; background: var(--surface-2);
  border-radius: 6px; border: 1px solid var(--border-soft); }
.studio__project-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); font-weight: 600; }
.studio__steps { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.studio-overview { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 14px; align-items: start; }
.studio-overview__main,
.studio-overview__side { display: flex; flex-direction: column; gap: 14px; min-width: 0; }
.studio-overview__wide { grid-column: 1 / -1; min-width: 0; }
.studio-overview__step { font-weight: 700; color: var(--accent-ink); }
.studio-overview__steps :deep(.ui-table-row) { cursor: pointer; }
.studio-overview__actions { gap: 8px; flex-wrap: wrap; }
.studio-overview__tags { display: inline-flex; gap: 5px; flex-wrap: wrap; justify-content: flex-end; }
@media (max-width: 1100px) {
  .studio-overview { grid-template-columns: 1fr; }
}
</style>
