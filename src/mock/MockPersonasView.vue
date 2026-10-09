<!-- SPDX-License-Identifier: MIT -->
<!--
  The Personas list — the mock (dev only, #/mock/personas). Decided
  2026-10-04: a mock is a page in the app, built from the kit's own components
  on made-up data, so what it shows is what ships
  (docs/plans/2026-10-04-persona-voice-making.md §2).

  The same page as views/PersonasView.vue, with `personaMock.js` in place of
  the server: ▶ · Persona · Built on · Model · Can be directed · Speaks ·
  Shaped · Used by · ⋯. `#/mock/personas?empty` shows the page with no
  personas at all.
-->
<script setup>
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { UiMenu, UiMenuItem, UiMenuSeparator } from "@delebash/llm-ui";
import {
  EmptyState, UiButton, UiCheckbox, UiInput, UiSelect, UiTable, UiTag,
  confirmDialog, languageName, promptDialog, pushToast,
} from "@delebash/llm-ui";
import { facetChoices, facetOptions, narrowed } from "../services/facets.js";
import { DIRECTION_OPTIONS, PERSONA_IS, baseLang, directionCell, tagCount, voiceKindLabel } from "../services/personaFacts.js";
import { capabilities, effectLabels, personaView, silentWav, store, wait } from "./personaMock.js";

const NARROW = { width: "1%", whiteSpace: "nowrap" };
const PERSONA_COLUMNS = [
  { id: "pick", header: "", headerStyle: NARROW, cellStyle: NARROW },
  { id: "play", header: "", headerStyle: NARROW, cellStyle: NARROW },
  { id: "name", accessorKey: "name", header: "Persona", sortable: true },
  { id: "built", accessorKey: "_built", header: "Built on", sortable: true, cellStyle: { whiteSpace: "nowrap" } },
  { id: "model", accessorKey: "model_name", header: "Model", sortable: true, cellStyle: { whiteSpace: "nowrap" } },
  { id: "directed", accessorKey: "_directed", header: "Can be directed", sortable: true, cellStyle: { whiteSpace: "nowrap" } },
  { id: "speaks", accessorKey: "_speaks", header: "Speaks", sortable: true, cellStyle: { whiteSpace: "nowrap" } },
  { id: "shaped", accessorKey: "_shaped", header: "Shaped", sortable: true, cellStyle: { whiteSpace: "nowrap" } },
  { id: "used", accessorKey: "_used", header: "Used by", sortable: true },
  { id: "more", header: "", headerStyle: NARROW, cellStyle: { ...NARROW, textAlign: "right" } },
];

const route = useRoute();
const router = useRouter();
const empty = computed(() => route.query.empty !== undefined);
const personas = computed(() => (empty.value ? [] : store.personas.map(personaView)));
const voiceById = computed(() => Object.fromEntries(store.voices.map((v) => [v.id, v])));
const usage = computed(() => store.usage);

function openPersona(id) {
  router.push({ name: "mock-persona", params: { id } });
}

// ── Filters ─────────────────────────────────────────────────────────────
const search = ref("");
const modelFilter = ref("");
const directionFilter = ref("");
const languageFilter = ref("");
const usageFilter = ref("");

// Each filter lists only what the others leave, with counts that match the
// table (decided 2026-10-05, services/facets.js) — Kokoro + Tags, or a book
// none of a model's personas plays in, used to be an empty table.
function usedAs(p, u) {
  if (u === "used") return usageCount(p.id) > 0;
  if (u === "unused") return !usageCount(p.id);
  return (usage.value[p.id] || []).some((x) => `book:${x.project_id}` === u);
}
const personaFilters = computed(() => [
  { key: "model", value: modelFilter.value, test: (p, m) => p.model === m },
  { key: "direction", value: directionFilter.value, test: (p, d) => p.directed_by === d },
  { key: "language", value: languageFilter.value, test: (p, c) => baseLang(p.speaks) === c },
  { key: "usage", value: usageFilter.value, test: usedAs },
  { key: "search", value: search.value.trim().toLowerCase(),
    test: (p, q) => (p.name || "").toLowerCase().includes(q) || (p.note || "").toLowerCase().includes(q) },
]);
const modelOptions = computed(() => {
  const names = Object.fromEntries(personas.value.map((p) => [p.model, p.model_name || p.model]));
  return [{ value: "", label: "All models" },
    ...facetOptions(personas.value, personaFilters.value, "model", (p) => p.model, (m, n) => `${names[m] || m} (${n})`)];
});
const directionOptions = computed(() =>
  facetChoices(personas.value, personaFilters.value, "direction", DIRECTION_OPTIONS, (p, d) => p.directed_by === d));
const languageOptions = computed(() => [
  { value: "", label: "Any language" },
  ...facetOptions(personas.value, personaFilters.value, "language", (p) => baseLang(p.speaks), (c, n) => `${languageName(c) || c} (${n})`),
]);
const usageOptions = computed(() => {
  const books = new Map();
  for (const list of Object.values(usage.value)) for (const u of list) books.set(u.project_id, u.project_name);
  return facetChoices(personas.value, personaFilters.value, "usage", [
    { value: "", label: "All" },
    { value: "used", label: "In use" },
    { value: "unused", label: "Unused" },
    ...[...books].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => ({ value: `book:${id}`, label: `In ${name}` })),
  ], usedAs);
});

const filteredPersonas = computed(() => narrowed(personas.value, personaFilters.value));
// Every column sorts by what it shows (decided 2026-10-05 — only Persona and
// Model did). The kit table sorts a column by a value on its row, so each
// shown column gets one here.
const personaRows = computed(() => filteredPersonas.value.map((p) => ({
  ...p,
  _built: voiceById.value[p.voice_id]?.name || (p.voice_id ? "voice missing" : ""),
  _directed: p.directed_by ? directed(p).label : "",
  _speaks: p.speaks ? languageName(p.speaks) || p.speaks : "",
  _shaped: shaped(p) || "as the voice",
  _used: usedBy(p.id),
})));
const filtering = computed(() => !!(search.value.trim() || modelFilter.value || directionFilter.value
  || languageFilter.value || usageFilter.value));
function clearFilters() {
  search.value = ""; modelFilter.value = ""; directionFilter.value = "";
  languageFilter.value = ""; usageFilter.value = "";
}

// ── Cells ───────────────────────────────────────────────────────────────
function usageCount(personaId) {
  return (usage.value[personaId] || []).length;
}
function usedBy(personaId) {
  const byName = new Map();
  for (const u of usage.value[personaId] || []) {
    if (!byName.has(u.speaker_name)) byName.set(u.speaker_name, []);
    if (!byName.get(u.speaker_name).includes(u.project_name)) byName.get(u.speaker_name).push(u.project_name);
  }
  return [...byName].map(([name, books]) => `${name} — ${books.join(" · ")}`).join(", ");
}
function playsText(personaId) {
  return (usage.value[personaId] || []).map((u) => `${u.speaker_name} (${u.project_name})`).join(", ");
}
function directed(p) {
  return directionCell(p.directed_by, tagCount(capabilities[p.model]));
}
function signed(n, digits) {
  const s = Math.abs(n).toFixed(digits);
  return n > 0 ? `+${s}` : n < 0 ? `−${s}` : s;
}
function shaped(p) {
  const d = p.default_delivery || {};
  const bits = [];
  if (d.speed !== null && d.speed !== undefined) bits.push(`${Number(d.speed).toFixed(2)}×`);
  if (d.pitch) bits.push(`${signed(Number(d.pitch), 0)} st`);
  if (d.gain_db) bits.push(`${signed(Number(d.gain_db), 1)} dB`);
  const fx = p.effects_chain || [];
  if (fx.length === 1) bits.push(effectLabels[fx[0].type] || fx[0].type || "1 effect");
  else if (fx.length > 1) bits.push(`${fx.length} effects`);
  return bits.join(" · ");
}

// ── ▶ ───────────────────────────────────────────────────────────────────
const playingId = ref(null);
const audition = ref(null);
async function play(p) {
  if (!p.voice_id || playingId.value) return;
  playingId.value = p.id;
  await wait();
  if (audition.value?.url) URL.revokeObjectURL(audition.value.url);
  audition.value = { url: URL.createObjectURL(silentWav(4)), name: p.name, model: p.model_name || "" };
  playingId.value = null;
}

// ── ⋯ Rename · Merge into… · Delete ─────────────────────────────────────
function stored(id) {
  return store.personas.find((x) => x.id === id);
}
async function rename(p) {
  const name = (await promptDialog({
    title: `Rename ${p.name}`,
    label: "Name",
    defaultValue: p.name,
    message: "The new name shows everywhere this persona plays — Cast, Used by, Generate.",
    confirmLabel: "Rename",
  }))?.trim();
  if (!name || name === p.name) return;
  stored(p.id).name = name;
  pushToast({ kind: "success", message: `Renamed to ${name}.` });
}

async function merge(p) {
  const others = personas.value.filter((x) => x.id !== p.id);
  if (!others.length) {
    pushToast({ kind: "info", message: "There's no other persona to merge into." });
    return;
  }
  const plays = usageCount(p.id) ? ` It plays ${playsText(p.id)}.` : " It plays no one yet.";
  const choice = await promptDialog({
    title: `Merge ${p.name} into…`,
    message: `Every speaker persona ${p.name} plays is played by the persona you pick, and persona ${p.name} is deleted.`
      + `${plays} The persona you pick keeps its own voice and settings.`,
    fields: [{
      key: "into",
      label: "Merge into",
      type: "select",
      defaultValue: others[0].id,
      options: others.map((x) => ({ value: x.id, label: x.model_name ? `${x.name} · ${x.model_name}` : x.name })),
    }],
    confirmLabel: "Merge",
    danger: true,
  });
  const into = choice?.into;
  if (!into) return;
  const moved = store.usage[p.id] || [];
  store.usage[into] = [...(store.usage[into] || []), ...moved];
  delete store.usage[p.id];
  store.personas = store.personas.filter((x) => x.id !== p.id);
  const n = moved.length;
  pushToast({
    kind: "success",
    message: `Persona ${p.name} merged into ${stored(into)?.name ? `persona ${stored(into).name}` : "the persona"}`
      + (n ? ` — ${n} speaker${n === 1 ? "" : "s"} moved.` : "."),
  });
}

const picked = ref({});
const pickedPersonas = computed(() => filteredPersonas.value.filter((p) => picked.value[p.id]));
const allPicked = computed(() =>
  filteredPersonas.value.length > 0 && filteredPersonas.value.every((p) => picked.value[p.id]));
function pickAll(on) {
  picked.value = on ? Object.fromEntries(filteredPersonas.value.map((p) => [p.id, true])) : {};
}
function drop(ids) {
  for (const id of ids) delete store.usage[id];
  store.personas = store.personas.filter((x) => !ids.includes(x.id));
}
async function removePicked() {
  const list = pickedPersonas.value;
  if (!list.length) return;
  const played = list.filter((p) => usageCount(p.id)).map((p) => playsText(p.id)).join(", ");
  const n = list.reduce((sum, p) => sum + usageCount(p.id), 0);
  const ok = await confirmDialog({
    title: `Delete ${list.length} persona${list.length === 1 ? "" : "s"}?`,
    message: `${list.length === 1 ? "Persona" : "Personas"} ${list.map((p) => p.name).join(", ")}.`
      + (n
        ? ` ${n} speaker${n === 1 ? "" : "s"} lose${n === 1 ? "s" : ""} their persona and need${n === 1 ? "s" : ""} another in Cast before rendering: ${played}.`
        : "")
      + " Voices and lexicons are kept.",
    danger: true,
    confirmLabel: `Delete ${list.length}`,
  });
  if (!ok) return;
  drop(list.map((p) => p.id));
  picked.value = {};
  pushToast({ kind: "success", message: `${list.length} persona${list.length === 1 ? "" : "s"} deleted.` });
}

async function removePersona(p) {
  const ok = await confirmDialog({
    title: "Delete persona?",
    message: `Persona "${p.name}" will be removed. Voice and lexicon are kept (only the binding is removed).`
      + (usageCount(p.id) ? ` It plays ${playsText(p.id)} — ${usageCount(p.id) === 1 ? "that speaker loses its" : "those speakers lose their"} persona.` : ""),
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  const snapshot = JSON.parse(JSON.stringify(stored(p.id)));
  const plays = store.usage[p.id];
  drop([p.id]);
  pushToast({
    kind: "success",
    message: `${p.name} deleted.`,
    duration: 6000,
    action: {
      label: "Undo",
      fn: () => {
        store.personas.push(snapshot);
        if (plays) store.usage[p.id] = plays;
        pushToast({ kind: "success", message: `${p.name} restored.` });
      },
    },
  });
}

const AVATAR_COLORS = ["#3a7d63", "#7c5cbf", "#b3552e", "#2e7d8a", "#a8763e", "#947b2f", "#c98aa7", "#5b7a99", "#b04a3e"];
function colorFor(name) {
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
</script>

<template>
  <div class="personas">
    <div class="jv-lib-toolbar">
      <UiInput v-model="search" placeholder="Search personas…" size="small" width="id" />
      <UiSelect v-model="modelFilter" :options="modelOptions" width="id" aria-label="Model"
        title="Show only personas on one model" />
      <UiSelect v-model="directionFilter" :options="directionOptions" width="id" aria-label="Can be directed"
        title="Show only personas that can be directed one way" />
      <UiSelect v-model="languageFilter" :options="languageOptions" width="id" aria-label="Speaks"
        title="Show only personas that speak one language" />
      <UiSelect v-model="usageFilter" :options="usageOptions" width="id" aria-label="Used"
        title="In use, unused, or in one book" />
      <span class="jv-spacer" />
      <UiButton intent="primary" size="small" label="＋ New persona" @click="openPersona('new')" />
    </div>

    <div v-if="audition" class="jv-inline-row personas__audition">
      <span class="jv-muted">▶ <strong>{{ audition.name }}</strong><template v-if="audition.model"> · {{ audition.model }}</template></span>
      <audio :src="audition.url" controls autoplay class="jv-audio-inline" />
    </div>

    <EmptyState
      v-if="!personas.length"
      icon="Sparkle"
      title="No personas yet"
      :message="PERSONA_IS"
      action-label="＋ Create your first persona"
      @action="openPersona('new')"
    />
    <UiTable v-else class="jv-table-look" :data="personaRows" :columns="PERSONA_COLUMNS"
      data-key="id" row-hover @row-click="({ data }) => openPersona(data.id)">
      <template #head-pick>
        <UiCheckbox :model-value="allPicked" :disabled="!filteredPersonas.length"
          :title="allPicked ? 'Untick every persona shown' : 'Tick every persona shown'" @update:model-value="pickAll" />
      </template>
      <template #pick="{ row }">
        <span @click.stop>
          <UiCheckbox :model-value="!!picked[row.id]"
            @update:model-value="(v) => (picked = { ...picked, [row.id]: v })" />
        </span>
      </template>
      <template #play="{ row }">
        <span @click.stop>
          <UiButton intent="ghost" size="small" label="▶" :loading="playingId === row.id"
            :disabled="!row.model || (!!playingId && playingId !== row.id)"
            :title="row.model ? `Hear ${row.name} speak` : 'No voice yet'" @click="play(row)" />
        </span>
      </template>
      <template #name="{ row }">
        <span class="personas__card-avatar personas__avatar-sm" :style="{ background: colorFor(row.name) }">{{ (row.name || "?").charAt(0).toUpperCase() }}</span>
        <strong>{{ row.name }}</strong>
        <div v-if="row.note" class="jv-muted personas__row-sub">{{ row.note.slice(0, 70) }}{{ row.note.length > 70 ? "…" : "" }}</div>
      </template>
      <template #built="{ row }">
        <template v-if="voiceById[row.voice_id]">
          {{ voiceById[row.voice_id].name }} <span class="jv-hint">{{ voiceKindLabel(voiceById[row.voice_id]) }}</span>
        </template>
        <span v-else-if="row.voice_id" class="jv-muted" title="This voice isn't in the library any more">voice missing</span>
        <span v-else class="jv-muted">no voice yet</span>
      </template>
      <template #model="{ row }">
        <span v-if="row.model_name">{{ row.model_name }}</span>
        <span v-else class="jv-muted">—</span>
      </template>
      <template #directed="{ row }">
        <UiTag v-if="row.directed_by" :intent="directed(row).intent" :title="directed(row).title">{{ directed(row).label }}</UiTag>
        <span v-else class="jv-muted">—</span>
      </template>
      <template #speaks="{ row }">
        <span v-if="row.speaks">{{ languageName(row.speaks) || row.speaks }}</span>
        <span v-else class="jv-muted">—</span>
      </template>
      <template #shaped="{ row }">
        <span class="jv-hint">{{ shaped(row) || "as the voice" }}</span>
      </template>
      <template #used="{ row }">
        <span v-if="usageCount(row.id)" class="jv-muted personas__books">{{ usedBy(row.id) }}</span>
        <span v-else class="jv-muted" title="No speaker in any book has this persona">— not used yet —</span>
      </template>
      <template #more="{ row }">
        <span @click.stop>
          <UiMenu label="Persona actions" trigger-class="ev-kebab" content-class="ev-menu" align="end">
            <template #trigger>⋯</template>
            <UiMenuItem class="ev-menu-item" @select="openPersona(row.id)">✎ Edit</UiMenuItem>
            <UiMenuItem class="ev-menu-item" @select="rename(row)">✏️ Rename</UiMenuItem>
            <UiMenuItem class="ev-menu-item" :disabled="personas.length < 2" @select="merge(row)">🔗 Merge into…</UiMenuItem>
            <UiMenuSeparator class="ev-menu-sep" />
            <UiMenuItem class="ev-menu-item danger" @select="removePersona(row)">🗑 Delete</UiMenuItem>
          </UiMenu>
        </span>
      </template>
      <template #empty>
        No persona matches these filters.
        <UiButton v-if="filtering" intent="ghost" size="small" label="Clear filters" @click="clearFilters" />
      </template>
    </UiTable>
    <div v-if="filteredPersonas.length" class="jv-inline-row personas__bulk">
      <UiButton intent="danger-outline" size="small" :disabled="!pickedPersonas.length"
        :label="pickedPersonas.length ? `Delete ${pickedPersonas.length} selected` : 'Delete selected'"
        @click="removePicked" />
      <span class="jv-hint">{{ pickedPersonas.length ? `${pickedPersonas.length} ticked` : "Tick personas to delete several at once." }}</span>
    </div>
  </div>
</template>

<style scoped>
.personas { display: flex; flex-direction: column; }
.personas__card-avatar {
  width: 36px; height: 36px; border-radius: 50%; color: #fff; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; flex: none;
}
.personas__row-sub { font-size: 12.5px; margin-left: 36px; }
.personas__avatar-sm { width: 26px; height: 26px; font-size: 12px; vertical-align: middle; margin-right: 8px; }
.personas__books { display: inline-block; max-width: 40ch; }
.personas__bulk { gap: 8px; align-items: center; margin-top: 10px; }
.personas__audition { gap: 10px; align-items: center; margin-bottom: 8px; }
</style>
