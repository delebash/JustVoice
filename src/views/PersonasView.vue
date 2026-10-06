<!-- SPDX-License-Identifier: MIT -->
<!--
  PersonasView — the library of finished voices (2026-09-29: speakers and
  personas are two things; 2026-10-03: the persona redesign, mock `_s9`).

  A persona is a finished spoken voice: a voice (which carries the model that
  speaks it), plus pace, pitch, gain, direction, effects and lexicon, and a
  short note on how it sounds. The PEOPLE in a book are its speakers (Studio ·
  Discover finds them, Cast gives each one a persona); one persona can play
  many speakers.

  The list, as the mock draws it: ▶ (the persona speaking, not the bare
  voice) · Persona · Built on · Model · Can be directed · Speaks · Shaped ·
  Used by · ⋯ (Rename · Merge into… · Delete). Filters: search, model, can be
  directed, language, usage (All · In use · Unused · each book). The ticks and
  "Delete N selected" (ruled 2026-09-29) stay. A row, ＋ New persona and the
  empty state open the persona's own page (PersonaEditorView, /personas/:id).
  The model, direction kind and language come from the server's persona read
  (`PersonaView`) — the same answer Cast and the page show.
-->
<script setup>
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal,
  DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger,
} from "reka-ui";
import {
  EmptyState, UiButton, UiCheckbox, UiInput, UiSelect, UiTable, UiTag,
  confirmDialog, languageName, promptDialog, pushToast,
} from "@delebash/llm-ui";
import { handleTermsRefusal } from "../services/engineTerms.js";
import { facetChoices, facetOptions, narrowed } from "../services/facets.js";
import { DIRECTION_OPTIONS, directionCell, tagCount, voiceKindWord } from "../services/personaFacts.js";
import { auditionPersona } from "../services/voiceAudition.js";
import { useApi } from "../stores/api.js";
import { usePersonasStore } from "../stores/personas.js";
import { useProjectsStore } from "../stores/projects.js";
import { useVoicesStore } from "../stores/voices.js";

// Kit grid in the JustVoice look (`jv-table-look`); sorting comes with it.
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
const api = useApi();

// The lists come from shared stores (single source of truth). Mutations
// here call loadAll() which reload()s the stores, so every other view
// (Chapters, Studio, Generate, …) reflects the change.
const personasStore = usePersonasStore();
const voicesStore = useVoicesStore();
const projectsStore = useProjectsStore();
const personas = computed(() => personasStore.items);
const voiceById = computed(() => Object.fromEntries(voicesStore.items.map((v) => [v.id, v])));
// {persona_id: [{project_id, project_name, speaker_id, speaker_name, lines}]} —
// the speakers each persona plays. Per-view, not shared.
const usage = ref({});
// Capability rows by model — for the number of tags a tag model lists.
const caps = ref({});
// Effect type → its name ("eq_mid" → "EQ — Mid peak"), for the Shaped column.
const effectLabels = ref({});
const loading = ref(false);

// One persona is edited on its own page; `new` opens a blank one.
const router = useRouter();
function openPersona(id) {
  router.push({ name: "persona", params: { id } });
}

// ── Filters ─────────────────────────────────────────────────────────────
const search = ref("");
const modelFilter = ref("");
const directionFilter = ref("");
const languageFilter = ref("");
// All · In use · Unused · one book (plan §6.2 call 7: "By project" folds in).
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
  { key: "language", value: languageFilter.value, test: (p, c) => p.speaks === c },
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
  ...facetOptions(personas.value, personaFilters.value, "language", (p) => p.speaks, (c, n) => `${languageName(c) || c} (${n})`),
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
// "Used by", as the mock: "Cael Ferren — The Ninth Facet", one speaker name across books
// as "Narrator — The Ninth Facet · Emberfall".
function usedBy(personaId) {
  const byName = new Map();
  for (const u of usage.value[personaId] || []) {
    if (!byName.has(u.speaker_name)) byName.set(u.speaker_name, []);
    if (!byName.get(u.speaker_name).includes(u.project_name)) byName.get(u.speaker_name).push(u.project_name);
  }
  return [...byName].map(([name, books]) => `${name} — ${books.join(" · ")}`).join(", ");
}
// "Nettle (The Ninth Facet)" — who loses this persona when it goes.
function playsText(personaId) {
  return (usage.value[personaId] || []).map((u) => `${u.speaker_name} (${u.project_name})`).join(", ");
}
function directed(p) {
  return directionCell(p.directed_by, tagCount(caps.value[p.model]));
}
// "1.05× · −1.0 dB · 2 effects" — what the persona does to its voice.
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
  if (fx.length === 1) bits.push(effectLabels.value[fx[0].type] || fx[0].type || "1 effect");
  else if (fx.length > 1) bits.push(`${fx.length} effects`);
  return bits.join(" · ");
}

// ── ▶ — the persona speaking its stock line ──────────────────────────────
// Through the path a chapter renders with; asks before loading a model, as
// every ▶ does. One compact player above the table serves every row.
const playingId = ref(null);
const audition = ref(null); // {url, name, model}
async function play(p) {
  if (!p.voice_id || playingId.value) return;
  playingId.value = p.id;
  try {
    const blob = await auditionPersona(api, p);
    if (blob instanceof Blob) {
      if (audition.value?.url) URL.revokeObjectURL(audition.value.url);
      audition.value = { url: URL.createObjectURL(blob), name: p.name, model: p.model_name || "" };
    }
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ kind: "error", message: `Couldn't play ${p.name}: ${e?.message || e}` });
  } finally {
    playingId.value = null;
  }
}

// ── ⋯ Rename · Merge into… · Delete ─────────────────────────────────────
async function rename(p) {
  const name = (await promptDialog({
    title: `Rename ${p.name}`,
    label: "Name",
    defaultValue: p.name,
    message: "The new name shows everywhere this persona plays — Cast and Used by.",
    confirmLabel: "Rename",
  }))?.trim();
  if (!name || name === p.name) return;
  try {
    await api.request(`/v1/personas/${p.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }),
    });
    await loadAll();
    pushToast({ kind: "success", message: `Renamed to ${name}.` });
  } catch (e) {
    pushToast({ kind: "error", message: `Rename failed: ${e?.message || e}` });
  }
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
  try {
    const r = await api.request(`/v1/personas/${p.id}/merge`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ into }),
    });
    await loadAll();
    const n = r?.speakers || 0;
    pushToast({
      kind: "success",
      message: `Persona ${p.name} merged into ${r?.into_name ? `persona ${r.into_name}` : "the persona"}`
        + (n ? ` — ${n} speaker${n === 1 ? "" : "s"} moved.` : "."),
    });
  } catch (e) {
    pushToast({ kind: "error", message: `Merge failed: ${e?.message || e}` });
  }
}

// Tick several personas and delete them at once (decided 2026-09-29). Each
// goes the way a single Delete does: every speaker it played is left with no
// persona (their lines keep their speaker). Ticks count only for personas the
// current filter shows.
const picked = ref({});
const pickedPersonas = computed(() => filteredPersonas.value.filter((p) => picked.value[p.id]));
const allPicked = computed(() =>
  filteredPersonas.value.length > 0 && filteredPersonas.value.every((p) => picked.value[p.id]));
function pickAll(on) {
  picked.value = on ? Object.fromEntries(filteredPersonas.value.map((p) => [p.id, true])) : {};
}
const bulkDeleting = ref(false);
async function removePicked() {
  const list = pickedPersonas.value;
  if (!list.length || bulkDeleting.value) return;
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
  bulkDeleting.value = true;
  let failed = 0;
  for (const p of list) {
    try {
      await api.request(`/v1/personas/${p.id}`, { method: "DELETE" });
    } catch { failed += 1; }
  }
  bulkDeleting.value = false;
  picked.value = {};
  await loadAll();
  pushToast({
    kind: failed ? "warning" : "success",
    message: failed
      ? `${list.length - failed} deleted; ${failed} failed.`
      : `${list.length} persona${list.length === 1 ? "" : "s"} deleted.`,
  });
}

// Reload everything: the shared stores, the per-view usage map and the
// capability rows. Called on mount, on coming back to the list, and after
// every persona mutation so the change propagates to all consumers.
async function loadAll() {
  loading.value = !personas.value.length;
  try {
    const [, , , uRes, cRes, fRes] = await Promise.all([
      personasStore.reload(),
      voicesStore.reload(),
      projectsStore.reload(),
      api.safeRequest("/v1/personas/usage", { usage: {} }),
      api.safeRequest("/v1/engines/capabilities", { engines: {} }),
      api.safeRequest("/v1/effects/catalog", { effects: [] }),
    ]);
    usage.value = uRes?.usage ?? {};
    caps.value = cRes?.engines ?? {};
    effectLabels.value = Object.fromEntries((fRes?.effects || []).map((e) => [e.type, e.label]));
  } finally {
    loading.value = false;
  }
}

// Single delete path — called from each row's ⋯. Keeps the snapshot Undo.
async function removePersona(p) {
  const ok = await confirmDialog({
    title: "Delete persona?",
    message: `Persona "${p.name}" will be removed. Voice and lexicon are kept (only the binding is removed).`
      + (usageCount(p.id) ? ` It plays ${playsText(p.id)} — ${usageCount(p.id) === 1 ? "that speaker loses its" : "those speakers lose their"} persona.` : ""),
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  // Full shape captured so Undo can re-create. The id may not be
  // reusable post-delete; we POST the body and accept the new id.
  const snapshot = { ...p };
  const personaName = snapshot.name || "Persona";
  try {
    await api.request(`/v1/personas/${snapshot.id}`, { method: "DELETE" });
    await loadAll();
    pushToast({
      kind: "success",
      message: `${personaName} deleted.`,
      duration: 6000,
      action: {
        label: "Undo",
        fn: async () => {
          try {
            await api.request("/v1/personas", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: snapshot.name,
                voice_id: snapshot.voice_id,
                voice_instruct: snapshot.voice_instruct,
                note: snapshot.note,
                language: snapshot.language,
                avatar_path: snapshot.avatar_path,
                default_delivery: snapshot.default_delivery || {},
                effects_chain: snapshot.effects_chain || [],
                lexicon_id: snapshot.lexicon_id,
              }),
            });
            await loadAll();
            pushToast({ kind: "success", message: `${personaName} restored.` });
          } catch (e) {
            pushToast({ kind: "error", message: `Undo failed: ${e?.message || e}` });
          }
        },
      },
    });
  } catch (e) {
    pushToast({ kind: "error", message: `Delete failed: ${e?.message ?? e}` });
  }
}

// Same avatar palette/hash as the Studio cast cards — one name, one colour,
// everywhere.
const AVATAR_COLORS = ["#3a7d63", "#7c5cbf", "#b3552e", "#2e7d8a", "#a8763e", "#947b2f", "#c98aa7", "#5b7a99", "#b04a3e"];
function colorFor(name) {
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

onMounted(loadAll);
// Back from a persona's page (views are KeepAlive-cached): what it saved,
// renamed or merged shows at once.
let mounted = false;
onActivated(() => { if (mounted) loadAll(); mounted = true; });
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

    <!-- Compact player — one in-flow player above the table serves every ▶
         (the ruling 2026-08-15: playback is compact and in place). -->
    <div v-if="audition" class="jv-inline-row personas__audition">
      <span class="jv-muted">▶ <strong>{{ audition.name }}</strong><template v-if="audition.model"> · {{ audition.model }}</template></span>
      <audio :src="audition.url" controls autoplay class="jv-audio-inline" />
    </div>

    <div v-if="loading" class="jv-muted personas__empty">Loading…</div>
    <EmptyState
      v-else-if="!personas.length"
      icon="Sparkle"
      title="No personas yet"
      message="A persona is a voice from your library — the voice, which carries the model that speaks it, plus pace, pitch, gain, direction and effects. Cast gives one to each speaker in a book, and one persona can play many."
      action-label="＋ Create your first persona"
      @action="openPersona('new')"
    />
    <!-- `row-hover` carries the pointer cursor and the row tint. -->
    <UiTable v-else class="jv-table-look" :data="personaRows" :columns="PERSONA_COLUMNS"
      data-key="id" row-hover @row-click="({ data }) => openPersona(data.id)">
      <template #head-pick>
        <UiCheckbox :model-value="allPicked" :disabled="!filteredPersonas.length || bulkDeleting"
          :title="allPicked ? 'Untick every persona shown' : 'Tick every persona shown'" @update:model-value="pickAll" />
      </template>
      <template #pick="{ row }">
        <span @click.stop>
          <UiCheckbox :model-value="!!picked[row.id]" :disabled="bulkDeleting"
            @update:model-value="(v) => (picked = { ...picked, [row.id]: v })" />
        </span>
      </template>
      <template #play="{ row }">
        <span @click.stop>
          <UiButton intent="ghost" size="small" label="▶" :loading="playingId === row.id"
            :disabled="!row.voice_id || (!!playingId && playingId !== row.id)"
            :title="row.voice_id ? `Hear ${row.name} speak` : 'No voice yet'" @click="play(row)" />
        </span>
      </template>
      <template #name="{ row }">
        <span class="personas__card-avatar personas__avatar-sm" :style="{ background: colorFor(row.name) }">{{ (row.name || "?").charAt(0).toUpperCase() }}</span>
        <strong>{{ row.name }}</strong>
        <div v-if="row.note" class="jv-muted personas__row-sub">{{ row.note.slice(0, 70) }}{{ row.note.length > 70 ? "…" : "" }}</div>
      </template>
      <template #built="{ row }">
        <template v-if="voiceById[row.voice_id]">
          {{ voiceById[row.voice_id].name }} <span class="jv-hint">{{ voiceKindWord(voiceById[row.voice_id]) }}</span>
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
          <!-- The row menu — reka's DropdownMenu, the Speech engines rows'
               pattern (`.ev-kebab` / `.ev-menu`); the portal escapes the
               table's overflow. -->
          <DropdownMenuRoot>
            <DropdownMenuTrigger class="ev-kebab" aria-label="Persona actions" title="Persona actions">⋯</DropdownMenuTrigger>
            <DropdownMenuPortal>
              <DropdownMenuContent class="ev-menu" align="end" :side-offset="4" :collision-padding="8">
                <DropdownMenuItem class="ev-menu-item" @select="openPersona(row.id)">✎ Edit</DropdownMenuItem>
                <DropdownMenuItem class="ev-menu-item" @select="rename(row)">✏️ Rename</DropdownMenuItem>
                <DropdownMenuItem class="ev-menu-item" :disabled="personas.length < 2" @select="merge(row)">🔗 Merge into…</DropdownMenuItem>
                <DropdownMenuSeparator class="ev-menu-sep" />
                <DropdownMenuItem class="ev-menu-item danger" @select="removePersona(row)">🗑 Delete</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuPortal>
          </DropdownMenuRoot>
        </span>
      </template>
      <template #empty>
        No persona matches these filters.
        <UiButton v-if="filtering" intent="ghost" size="small" label="Clear filters" @click="clearFilters" />
      </template>
    </UiTable>
    <div v-if="!loading && filteredPersonas.length" class="jv-inline-row personas__bulk">
      <UiButton intent="danger-outline" size="small" :disabled="!pickedPersonas.length || bulkDeleting"
        :loading="bulkDeleting"
        :label="pickedPersonas.length ? `Delete ${pickedPersonas.length} selected` : 'Delete selected'"
        @click="removePicked" />
      <span class="jv-hint">{{ pickedPersonas.length ? `${pickedPersonas.length} ticked` : "Tick personas to delete several at once." }}</span>
    </div>
  </div>
</template>

<style scoped>
.personas {
  display: flex;
  flex-direction: column;
}

.personas__empty {
  padding: 40px 0;
  font-size: 13px;
  text-align: center;
}

.personas__card-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

/* The row's cursor and hover tint come from UiTable's `row-hover`. */
.personas__row-sub { font-size: 12.5px; margin-left: 36px; }
.personas__avatar-sm { width: 26px; height: 26px; font-size: 12px; vertical-align: middle; margin-right: 8px; }
.personas__books { display: inline-block; max-width: 40ch; }
.personas__bulk { gap: 8px; align-items: center; margin-top: 10px; }
.personas__audition { gap: 10px; align-items: center; margin-bottom: 8px; }
</style>
