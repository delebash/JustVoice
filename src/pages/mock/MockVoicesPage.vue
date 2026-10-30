<!-- SPDX-License-Identifier: MIT -->
<!--
  Voices — the mock (dev only: #/mock/voices). The real page's template (pages/VoicesPage.vue)
  with its classes and words, on services/mock/personaMock.js in place of the server: the seven
  engines' built-in voices as the server lists them (liveSnapshot.json), the user's own clones,
  designs and blend, and the personas that use them — the persona mock's, so a persona made from a
  voice here opens there. Made up: the machine (the speech runtime installed, Kokoro loaded) and
  what the gender guess answers.

  What it draws that the app doesn't have yet: at phone width (below 600 px) the filters — model,
  language, gender, direction and the type chips — fold behind one Filters button, and show on a
  row of their own while it is pressed (decided 2026-10-16, TASKS "The run's last questions" 6;
  `.jv-filters-fold` in app.scss). A wider window shows the page as it is. Other state: ?empty (no
  voices).

  Not drawn: the AI task strip under the toolbar (shown while the gender guess runs), the save
  dialog behind ⋯ → Export…, and a voice that needs the speech runtime or whose engine is gone.
-->
<script setup>
import { computed, nextTick, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  EmptyState, UiButton, UiChip, UiField, UiInput, UiMenu, UiMenuItem, UiMenuSeparator, UiSelect, UiTable, UiTag,
  UiTextarea, confirmDialog, languageName, languageOptionsFrom, pageFlow, promptDialog, pushToast,
} from "@delebash/ui";
import PagePlayer from "../../components/PagePlayer.vue";
import PlayTransport from "../../components/PlayTransport.vue";
import { usePagePlayer } from "../../composables/usePagePlayer.js";
import { rowOptions } from "../../services/capabilities.js";
import { facetChoices, facetCounts, facetOptions, facetTotal, narrowed } from "../../services/facets.js";
import liveSnapshot from "../../services/mock/liveSnapshot.json";
import { capabilities, keepVoice, modelStatus, silentWav, store, wait } from "../../services/mock/personaMock.js";
import { DIRECTION_OPTIONS, VOICE_KINDS, baseLang, directionCell, tagCount, voiceKind, voiceKindLabel } from "../../services/personaFacts.js";
import { genderWord, voiceGender } from "../../services/voiceGender.js";
import { voiceRowState } from "../../services/voiceGrid.js";

const route = useRoute();
const router = useRouter();

if (route.query.empty !== undefined) store.voices.splice(0);
const voices = computed(() => store.voices);
const personasByVoice = computed(() => {
  const m = {};
  for (const p of store.personas) {
    if (!p.voice_id) continue;
    if (!m[p.voice_id]) m[p.voice_id] = [];
    m[p.voice_id].push(p);
  }
  return m;
});
// The engines as /v1/engines lists them; where each stands is this mock machine's.
const engines = computed(() =>
  liveSnapshot.engines
    .filter((e) => e.kind === "tts")
    .map((e) => ({ ...e, backend: "managed", status: modelStatus[e.id] || "not_loaded" })));
const capabilityRows = capabilities;

// ── Gender: the click-cycle, kept on the voice for this visit.
const GENDER_CYCLE = ["?", "F", "M", "N", ""];
function cycleGender(v) {
  const idx = GENDER_CYCLE.indexOf(voiceGender(v));
  v.gender_user_override = GENDER_CYCLE[(idx + 1) % GENDER_CYCLE.length] || null;
}
const genderGuessBusy = ref(false);
async function guessUnknownGenders() {
  const unknown = voices.value.filter((v) => voiceGender(v) === "?").slice(0, 60);
  if (!unknown.length) {
    pushToast({ message: "Nothing to guess — every voice already has a gender.", duration: 3500 });
    return;
  }
  genderGuessBusy.value = true;
  await wait(1200);
  unknown.forEach((v, i) => { v.gender_user_override = i % 2 ? "M" : "F"; });
  genderGuessBusy.value = false;
  pushToast({ message: `${unknown.length} voice${unknown.length === 1 ? "" : "s"} labeled · 0 left as Not known.`, kind: "success" });
}

// ── Catalog filtering + search — the page's own.
const search = ref("");
const typeFilter = ref("all");
const TYPE_FILTERS = [
  { id: "all", label: "All" },
  ...VOICE_KINDS.filter((k) => !k.disabled).map((k) => ({ id: k.value, label: k.label })),
];
const engineFilter = ref("all");
function setEngineFilter(id) { engineFilter.value = id; }
const engineFilterOptions = computed(() => [
  { label: `All models (${facetTotal(voices.value, voiceFilters.value, "engine")})`, value: "all" },
  ...facetOptions(voices.value, voiceFilters.value, "engine", (v) => v.model_name || v.engine, (m, n) => `${m} (${n})`),
]);
const loadedTtsEngine = computed(() => engines.value.find((e) => e.status === "loaded") || null);
const langFilter = ref("all");
const genderFilter = ref("all");
const directionFilter = ref("");
const genderOf = (v) => voiceGender(v);
const voiceFilters = computed(() => [
  { key: "engine", value: engineFilter.value, empty: "all", test: (v, x) => (v.model_name || v.engine) === x },
  { key: "type", value: typeFilter.value, empty: "all", test: (v, x) => voiceKind(v) === x },
  { key: "lang", value: langFilter.value, empty: "all", test: (v, x) => baseLang(v.language) === x },
  { key: "gender", value: genderFilter.value, empty: "all", test: (v, x) => genderOf(v) === x },
  { key: "direction", value: directionFilter.value, test: (v, x) => v.directed_by === x },
  { key: "search", value: search.value.trim().toLowerCase(),
    test: (v, q) => (v.name || "").toLowerCase().includes(q) || (v.id || "").toLowerCase().includes(q) },
]);
const langFilterOptions = computed(() => {
  const opts = facetOptions(voices.value, voiceFilters.value, "lang", (v) => baseLang(v.language), (c) => c);
  return languageOptionsFrom(opts.map((o) => o.value), {
    allLabel: `Any language (${facetTotal(voices.value, voiceFilters.value, "lang")})`,
    counts: new Map(opts.map((o) => [o.value, o.n])),
  });
});
const genderFilterOptions = computed(() => [
  { label: "Any gender", value: "all" },
  ...facetOptions(voices.value, voiceFilters.value, "gender", genderOf, (g, n) => `${genderWord(g)} (${n})`),
]);
const directionFilterOptions = computed(() =>
  facetChoices(voices.value, voiceFilters.value, "direction", DIRECTION_OPTIONS, (v, x) => v.directed_by === x));

// The fold (new here): the button says how many filters narrow the list while they're hidden.
const filtersOpen = ref(false);
const filtersSet = computed(() =>
  [engineFilter.value !== "all", langFilter.value !== "all", genderFilter.value !== "all", !!directionFilter.value, typeFilter.value !== "all"]
    .filter(Boolean).length);

const filteredVoices = computed(() => narrowed(voices.value, voiceFilters.value));
const voiceRows = computed(() =>
  filteredVoices.value.map((v) => ({
    ...v,
    _lang: languageName(v.language) || v.language || "",
    _gender: voiceGender(v) || "",
    _model: v.model_name || v.engine || "",
    _type: voiceKindLabel(v),
  })));
const FIT = { width: "1%", whiteSpace: "nowrap" };
const VOICE_COLUMNS = [
  { id: "name", accessorKey: "name", header: "Name", sortable: true, headerStyle: { width: "auto", minWidth: "240px" } },
  { id: "_gender", accessorKey: "_gender", header: "Gender", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "source", accessorKey: "_type", header: "Type", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "engine", accessorKey: "_model", header: "Model", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "_lang", accessorKey: "_lang", header: "Voice's language", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "directed", accessorKey: "directed_by", header: "Can be directed", sortable: true, headerStyle: FIT, cellStyle: FIT },
  { id: "used", header: "Used by" },
  { id: "actions", header: "", headerStyle: FIT, cellStyle: FIT },
];
function voiceRowClass(row) {
  return voiceRowState(row, [], player.key || "");
}
const typeCounts = computed(() => ({
  all: facetTotal(voices.value, voiceFilters.value, "type"),
  ...facetCounts(voices.value, voiceFilters.value, "type",
    TYPE_FILTERS.filter((f) => f.id !== "all").map((f) => f.id), (v, t) => voiceKind(v) === t),
}));

// ── Preview: a silent take of a real length, through the page's one player.
const player = usePagePlayer();
const previewingId = ref(null);
const previewText = ref("");
async function previewVoice(v) {
  previewingId.value = v.id;
  await wait(600);
  player.load(v.id, URL.createObjectURL(silentWav(4)));
  previewingId.value = null;
  await nextTick();
  player.el?.play().catch(() => {});
}

// ── Import, export, copy, delete — on the mock's library.
const bundleInput = ref(null);
function chooseVoiceFile() { bundleInput.value?.click(); }
function importVoiceFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  const name = file.name.replace(/\.jvvoice\.zip$|\.zip$/i, "") || "Imported voice";
  const v = keepVoice({ engine: "chatterbox", model: "chatterbox-turbo", source: "imported", name, language: "en", gender: "" });
  pushToast({ kind: "success", message: `${v.name} imported.` });
}
function exportVoice() { pushToast({ kind: "success", title: "Voice exported" }); }
function newPersonaFrom(voice) {
  router.push({ name: "mock-persona", params: { id: "new" }, query: { voice: voice.id } });
}
function hasClip(voice) {
  return voice.source === "cloned" || voice.source === "imported" || voice.source === "designed";
}
async function copyToModel(voice) {
  const targets = rowOptions(capabilityRows, engines.value, "supports_voice_cloning").filter((o) => o.value !== voice.model);
  if (!targets.length) {
    pushToast({ kind: "info", message: "No other model here can clone a voice." });
    return;
  }
  const picked = await promptDialog({
    title: `Copy ${voice.name} to another model`,
    message: "The same clip becomes a second voice, spoken by the model you pick — "
      + `"${voice.name}" stays as it is on ${voice.model_name || voice.engine}.`,
    fields: [
      { key: "model", label: "Model", type: "select", defaultValue: targets[0].value, options: targets },
      { key: "name", label: "Name", optional: true, placeholder: `${voice.name} (the model's name)` },
    ],
    confirmLabel: "Copy",
  });
  if (!picked?.model) return;
  const row = capabilityRows[picked.model];
  const made = keepVoice({
    engine: engines.value.find((e) => picked.model === e.id || picked.model.startsWith(`${e.id}-`))?.id || picked.model,
    model: picked.model, source: voice.source, language: voice.language, gender: voice.gender,
    name: (picked.name || "").trim() || `${voice.name} (${row?.display_name || picked.model})`,
  });
  pushToast({ kind: "success", message: `${made.name} added — ${made.model_name || made.engine}.` });
}
async function deleteVoice(voice) {
  const used = (personasByVoice.value[voice.id] || []).map((p) => p.name);
  const ok = await confirmDialog({
    title: "Delete voice?",
    message: `"${voice.name}" will be permanently removed.`
      + (used.length
        ? ` It's the voice of ${used.join(", ")} — ${used.length === 1 ? "that persona needs" : "those personas need"} another voice before ${used.length === 1 ? "it" : "they"} can speak.`
        : ""),
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  const i = store.voices.findIndex((v) => v.id === voice.id);
  if (i >= 0) store.voices.splice(i, 1);
  pushToast({ message: `"${voice.name}" deleted.` });
}

function voiceTypeVariant(kind) {
  if (kind === "builtin") return "ghost";
  if (kind === "clone") return "success";
  if (kind === "design") return "solid";
  if (kind === "blend") return "accent2";
  return "ghost";
}
</script>

<template>
  <q-page :style-fn="pageFlow" class="voices-view jv-fill">

  <!-- ── Toolbar: search + the filters (folded at phone width) + actions ── -->
  <div class="voices-view__toolbar">
    <UiInput v-model="search" placeholder="Search voices…" width="name" title="Filter by name or id" />
    <UiButton
      class="lt-sm"
      intent="secondary"
      size="small"
      :label="filtersSet ? `Filters (${filtersSet})` : 'Filters'"
      :title="filtersOpen ? 'Hide the filters' : 'Show the filters — model, language, gender, direction and type'"
      :aria-expanded="filtersOpen ? 'true' : 'false'"
      @click="filtersOpen = !filtersOpen"
    />
    <div class="jv-filters-fold" :class="{ 'is-open': filtersOpen }">
      <UiSelect
        :model-value="engineFilter"
        :options="engineFilterOptions"
        title="Show only voices on one model"
        width="id"
        @update:model-value="setEngineFilter"
      />
      <UiSelect
        v-model="langFilter"
        :options="langFilterOptions"
        title="Show only voices that speak one language"
        width="name"
      />
      <UiSelect
        v-model="genderFilter"
        :options="genderFilterOptions"
        title="Show only voices of one gender"
        width="id"
      />
      <UiSelect
        v-model="directionFilter"
        :options="directionFilterOptions"
        title="Show only voices whose model can be directed one way"
        aria-label="Can be directed"
        width="id"
      />
    </div>
    <UiChip
      as="a"
      :selected="!!loadedTtsEngine"
      href="#/ai?tab=runtime-audiocpp"
      :title="loadedTtsEngine
        ? `${loadedTtsEngine.name || loadedTtsEngine.id} is loaded — previews play instantly. Click to manage engines.`
        : 'No voice model loaded — the first preview will offer to load one. Click to open AI Settings → Speech.'"
    >{{ loadedTtsEngine ? `● ${loadedTtsEngine.name || loadedTtsEngine.id} loaded` : "○ no voice model loaded" }}</UiChip>
    <div class="jv-filters-fold" :class="{ 'is-open': filtersOpen }">
      <div class="voices-view__chips">
        <UiChip
          v-for="f in TYPE_FILTERS"
          :key="f.id"
          :selected="typeFilter === f.id"
          :title="f.id === 'all' ? 'Show every voice' : `Show only ${f.label.toLowerCase()} voices`"
          @click="typeFilter = f.id"
        >{{ f.label }} ({{ typeCounts[f.id] || 0 }})</UiChip>
      </div>
    </div>
    <span class="jv-spacer" />
    <UiButton intent="secondary" size="small" :loading="genderGuessBusy"
      :disabled="genderGuessBusy"
      label="✨ Guess unknown genders"
      title="Ask the AI to label the voices the built-in dictionary doesn't know (the voice_gender feature — runs only when you click)"
      @click="guessUnknownGenders" />
    <UiButton intent="secondary" size="small" label="⤒ Import voice…"
      title="A voice exported from JustVoice (.jvvoice.zip): its clip, description or blend, and its model"
      @click="chooseVoiceFile" />
    <input ref="bundleInput" type="file" accept=".zip,application/zip" hidden @change="importVoiceFile" />
  </div>

  <!-- ── The test line: one box, above the grid ───────────────────────── -->
  <div class="voices-view__bench">
    <UiField label="Text to synthesize" layout="block" class="voices-view__bench-field">
      <UiTextarea
        v-model="previewText"
        :rows="2"
        placeholder="The fog came in over the pier before either of them said a word."
      />
    </UiField>
    <p class="jv-muted voices-view__bench-hint">
      Type a line, then press <strong>▶</strong> on the voice you want to hear say it.
      Every voice speaks this same line, which is what makes them comparable —
      leave it empty and they each read the standard sample instead.
    </p>
  </div>

  <PagePlayer :player="player" />

  <!-- ── Voice catalog table — owns its own scroll lane ───────────────── -->
  <div class="voices-view__list">
    <UiTable
      v-if="voiceRows.length"
      class="ui-table-sticky voices-view__table"
      :data="voiceRows"
      :columns="VOICE_COLUMNS"
      data-key="id"
      :pagination="false"
      row-hover
      :row-class="voiceRowClass"
    >
      <template #name="{ row }">
        <div class="voices-view__name-cell">
          <UiButton
            intent="ghost"
            size="small"
            :loading="previewingId === row.id"
            :label="player.isPlaying(row.id) ? '⏸' : '▶'"
            :title="player.isPlaying(row.id) ? `Pause ${row.name}` : `Hear ${row.name} say the test line`"
            @click="player.key === row.id ? player.toggle() : previewVoice(row)"
          />
          <strong>{{ row.name }}</strong>
          <PlayTransport v-if="player.key === row.id" :player="player" class="voices-view__transport" />
        </div>
      </template>

      <template #_gender="{ row }">
        <button
          type="button"
          class="voices-view__gender-chip"
          :data-gender="voiceGender(row)"
          :title="`Gender: ${genderWord(voiceGender(row))} — click to change: Not known → Female → Male → Neutral → as detected`"
          @click.stop="cycleGender(store.voices.find((v) => v.id === row.id))"
        >{{ (voiceGender(row) || "?").charAt(0).toUpperCase() }}</button>
      </template>

      <template #source="{ row }">
        <UiTag :intent="voiceTypeVariant(voiceKind(row))" :value="voiceKindLabel(row)" />
      </template>

      <template #engine="{ row }">
        <span class="jv-muted">{{ row._model }}</span>
        <span
          class="jv-locality jv-locality--local"
          title="Runs on this machine — no usage cost; loads the engine into RAM/VRAM on first use"
        >LOCAL</span>
      </template>

      <template #_lang="{ row }">
        <span class="jv-muted">{{ row._lang }}</span>
        <span v-if="(row.speaks || []).length > 1" class="jv-hint voices-view__more"
          :title="`On ${row._model} this voice can also speak: ${row.speaks.map((c) => languageName(c) || c).join(', ')}`"
        > +{{ row.speaks.length - 1 }}</span>
      </template>

      <template #directed="{ row }">
        <UiTag v-if="row.directed_by" :intent="directionCell(row.directed_by, tagCount(capabilityRows[row.model])).intent"
          :title="directionCell(row.directed_by).title">{{ directionCell(row.directed_by, tagCount(capabilityRows[row.model])).label }}</UiTag>
      </template>

      <template #used="{ row }">
        <span v-if="personasByVoice[row.id]?.length" class="jv-muted"
          :title="personasByVoice[row.id].map((p) => p.name).join(', ')">
          🎭 {{ personasByVoice[row.id].slice(0, 2).map((p) => p.name).join(", ") }}<template v-if="personasByVoice[row.id].length > 2"> +{{ personasByVoice[row.id].length - 2 }}</template>
        </span>
        <span v-else class="jv-hint voices-view__unused">— unused —</span>
      </template>

      <template #actions="{ row }">
        <span class="jv-table__actions">
          <UiMenu label="Voice actions" :title="`${row.name} — actions`" trigger-class="ev-kebab" content-class="ev-menu" align="end">
            <template #trigger>⋯</template>
            <UiMenuItem class="ev-menu-item" @select="newPersonaFrom(row)">🎭 New persona from this voice</UiMenuItem>
            <UiMenuItem v-if="hasClip(row)" class="ev-menu-item" @select="copyToModel(row)">⧉ Copy to another model…</UiMenuItem>
            <UiMenuItem v-if="row.source !== 'preset'" class="ev-menu-item" @select="exportVoice(row)">⤓ Export…</UiMenuItem>
            <template v-if="row.source !== 'preset'">
              <UiMenuSeparator class="ev-menu-sep" />
              <UiMenuItem class="ev-menu-item danger" @select="deleteVoice(row)">🗑 Delete</UiMenuItem>
            </template>
          </UiMenu>
        </span>
      </template>
    </UiTable>
    <EmptyState
      v-else-if="voices.length === 0"
      icon="Sparkle"
      title="No voices registered"
      message="Load a speech model to see its built-in voices, or make one — clone, design or blend — on a persona's page."
      action-label="Open Speech"
      compact
      @action="router.push({ path: '/ai', query: { tab: 'runtime-audiocpp' } })"
    />
    <p v-else class="jv-muted" style="padding: 24px 0; text-align: center; font-style: italic;">
      No voices match "{{ search }}" or filter "{{ TYPE_FILTERS.find((f) => f.id === typeFilter)?.label || typeFilter }}".
    </p>
  </div>
  </q-page>
</template>

<style scoped>
/* The real page's own (pages/VoicesPage.vue). */
.voices-view__table :deep(.ui-table-row.voices-view__row--playing),
.voices-view__table :deep(.ui-table-row.voices-view__row--playing:hover) {
  background: var(--accent-soft);
}
.voices-view {
  display: flex;
  flex-direction: column;
}
.voices-view__list {
  flex: 1 1 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  margin-top: 14px;
}
.voices-view__table { flex: 1 1 0; min-height: 0; }
.voices-view__table :deep(.q-table__middle) { scrollbar-gutter: stable; }
.voices-view__toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  margin-bottom: 12px;
}
.voices-view__chips {
  display: inline-flex;
  flex-wrap: wrap;
  max-width: 100%;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-control);
  padding: 2px;
  gap: 2px;
}
.voices-view__chips .ui-chip {
  border: 0;
  background: transparent;
  cursor: pointer;
  font-family: inherit;
  font-weight: 500;
}
.voices-view__chips .ui-chip.is-selected {
  background: var(--accent);
  color: #fff;
}
.voices-view__bench {
  display: flex;
  align-items: flex-end;
  gap: 20px;
  margin: 10px 0 8px;
  flex-wrap: wrap;
}
.voices-view__bench-field { flex: 0 1 62ch; min-width: 340px; }
.voices-view__bench-field :deep(.ui-textarea) { width: 100%; }
.voices-view__bench-hint { flex: 1 1 40ch; max-width: 64ch; font-size: 12.5px; line-height: 1.5; margin: 0 0 2px; }
.voices-view__name-cell { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
.voices-view__name-cell > strong { white-space: normal; min-width: 0; }
.voices-view__unused { white-space: nowrap; }
.voices-view__transport { margin-left: 4px; }
.voices-view__table :deep(.ui-table) { width: auto; min-width: 720px; }
.voices-view__gender-chip {
  appearance: none;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink-2);
  width: 28px;
  height: 22px;
  border-radius: var(--r-pill);
  font-family: var(--font-mono);
  font-size: 12.5px;
  font-weight: 600;
  cursor: pointer;
  padding: 0;
  display: inline-grid;
  place-items: center;
  transition: background 0.1s, color 0.1s;
}
.voices-view__gender-chip:hover { background: var(--surface-2); color: var(--ink); }
.voices-view__gender-chip[data-gender="F"] { color: var(--accent); border-color: var(--accent-line); background: var(--accent-soft); }
.voices-view__gender-chip[data-gender="M"] { color: var(--info-blue, #2f74b5); border-color: rgba(47, 116, 181, 0.4); background: #eef4fb; }
.voices-view__gender-chip[data-gender="N"] { color: var(--warn-ink); border-color: var(--warn-line); background: var(--warn-bg); }
.voices-view__gender-chip[data-gender="?"] { color: var(--ink-3); border-color: var(--line); }
</style>
