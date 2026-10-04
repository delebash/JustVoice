<!-- SPDX-License-Identifier: MIT -->
<!--
  PersonasView — the library of finished voices (2026-09-29: speakers and
  personas are two things).

  A persona is a finished spoken voice: a voice (which carries the model that
  speaks it), plus pace, pitch, gain, direction, effects and lexicon, and a
  short note on how it sounds. The PEOPLE in a book are its speakers (Studio · Discover finds
  them, Cast gives each one a persona); one persona can play many speakers.
  So a persona has no "Also called" and no character sheet — those moved to
  the speaker — and personas have no name rule: "Used by" (speaker — book)
  tells two of the same name apart.

  The library list: filter chips (All / Used / Unused / By project), who each
  persona plays, and ticks + "Delete N selected". A row, Edit and ＋ New
  persona open the persona's own page (PersonaEditorView, /personas/:id —
  the persona redesign, 2026-10-03); the dialog editor that lived here went
  with it.
-->
<script setup>
import { computed, onActivated, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { useApi } from "../stores/api.js";
import { pushToast } from "@delebash/llm-ui";
import { confirmDialog } from "@delebash/llm-ui";
import { UiButton, UiCheckbox, UiInput, UiSelect, UiTable } from "@delebash/llm-ui";
import { EmptyState } from "@delebash/llm-ui";
import { usePersonasStore } from "../stores/personas.js";
import { useVoicesStore } from "../stores/voices.js";
import { useProjectsStore } from "../stores/projects.js";

// Kit grid in the JustVoice look (`jv-table-look`); sorting comes with it,
// which matters here — "which project uses this persona most" was unanswerable
// without re-reading the whole list.
const PERSONA_COLUMNS = [
  { id: "pick", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "name", accessorKey: "name", header: "Persona", sortable: true },
  { id: "voice", header: "Voice" },
  { id: "used", header: "Used by" },
  { id: "actions", header: "Actions",
    headerStyle: { width: "150px", textAlign: "right" },
    cellStyle: { textAlign: "right", whiteSpace: "nowrap" } },
];
const api = useApi();

// The lists come from shared stores (single source of truth). Mutations
// here call loadAll() which reload()s the stores, so every other view
// (Chapters, Studio, Generate, …) reflects the change.
const personasStore = usePersonasStore();
const voicesStore = useVoicesStore();
const projectsStore = useProjectsStore();
const personas = computed(() => personasStore.items);
const voices = computed(() => voicesStore.items);
const projects = computed(() => projectsStore.items);
// {persona_id: [{project_id, project_name, speaker_id, speaker_name, lines}]} —
// the speakers each persona plays. Per-view, not shared.
const usage = ref({});
const loading = ref(false);

// One persona is edited on its own page; `new` opens a blank one.
const router = useRouter();
function openPersona(id) {
  router.push({ name: "persona", params: { id } });
}

const FILTERS = ["all", "used", "unused", "by-project"];
const filter = ref("all");
const filterProjectId = ref("");
const search = ref("");

const filteredPersonas = computed(() => {
  let list = personas.value;
  if (filter.value === "used") list = list.filter((p) => (usage.value[p.id] || []).length > 0);
  if (filter.value === "unused") list = list.filter((p) => !(usage.value[p.id] || []).length);
  if (filter.value === "by-project" && filterProjectId.value) {
    list = list.filter((p) =>
      (usage.value[p.id] || []).some((u) => u.project_id === filterProjectId.value),
    );
  }
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((p) =>
    (p.name || "").toLowerCase().includes(q) || (p.note || "").toLowerCase().includes(q));
  return list;
});

function usageCount(personaId) {
  return (usage.value[personaId] || []).length;
}
// "Used by", as the mock: "June — Stillwater", one speaker name across books
// as "Narrator — Stillwater · Emberfall".
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
    message: `${list.map((p) => p.name).join(", ")}.`
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

// Reload everything: the shared stores + the per-view usage map. Called on
// mount and after every persona mutation so the change propagates to all
// consumers.
async function loadAll() {
  loading.value = true;
  try {
    const [, , , uRes] = await Promise.all([
      personasStore.reload(),
      voicesStore.reload(),
      projectsStore.reload(),
      api.safeRequest("/v1/personas/usage", { usage: {} }),
    ]);
    usage.value = uRes?.usage ?? {};
    // No auto-select: the card grid is the landing view; clicking a
    // card drills into the editor (grid pattern, user decision 2026-06-12).
  } finally {
    loading.value = false;
  }
}

// Single delete path — called from each list row (Delete lives on the
// row, NOT the editor footer, per G-PERSONA-4). Keeps the snapshot Undo.
async function removePersona(p) {
  const ok = await confirmDialog({
    title: "Delete persona?",
    message: `"${p.name}" will be removed. Voice and lexicon are kept (only the binding is removed).`
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
      <UiInput v-model="search" placeholder="Search personas…" size="small" width="name" />
      <!-- Library-mode filter chips: All / Used / Unused / By project.
           Cross-project Personas are the model — these help find them. -->
      <button
        v-for="f in FILTERS"
        :key="f"
        type="button"
        class="jv-chip-card personas__chip"
        :class="{ 'personas__chip--active': filter === f }"
        @click="filter = f"
      >{{ f === 'by-project' ? 'By project' : (f.charAt(0).toUpperCase() + f.slice(1)) }}</button>
      <UiSelect
        v-if="filter === 'by-project'"
        width="name"
        v-model="filterProjectId"
        placeholder="— pick a project —"
        :options="projects" option-label="name" option-value="id"
      />
      <span class="jv-spacer" />
      <UiButton intent="primary" size="small" label="+ New persona" @click="openPersona('new')" />
    </div>

    <div v-if="loading" class="jv-muted personas__empty">Loading…</div>
    <EmptyState
      v-else-if="!filteredPersonas.length && !personas.length"
      icon="Sparkle"
      title="No personas yet"
      message="A persona is a finished spoken voice — a voice, which carries the model that speaks it, plus pace, pitch, gain, direction and effects. Cast gives one to each speaker in a book, and one persona can play many."
      action-label="+ Create your first persona"
      @action="openPersona('new')"
    />
    <!-- One empty state, owned by the grid; `row-hover` carries the pointer
         cursor and the row tint that two scoped rules used to do by hand. -->
    <UiTable v-else class="jv-table-look" :data="filteredPersonas" :columns="PERSONA_COLUMNS"
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
      <template #name="{ row }">
        <span class="personas__card-avatar personas__avatar-sm" :style="{ background: colorFor(row.name) }">{{ (row.name || "?").charAt(0).toUpperCase() }}</span>
        <strong>{{ row.name }}</strong>
        <div v-if="row.note" class="jv-muted personas__row-sub">{{ row.note.slice(0, 70) }}{{ row.note.length > 70 ? "…" : "" }}</div>
      </template>
      <template #voice="{ row }">
        <span class="jv-muted">{{ voices.find((v) => v.id === row.voice_id)?.name || (row.voice_id || "no voice yet") }}</span>
      </template>
      <template #used="{ row }">
        <span v-if="usageCount(row.id)" class="jv-muted personas__books">{{ usedBy(row.id) }}</span>
        <span v-else class="jv-muted" title="No speaker in any book has this persona">— not used yet —</span>
      </template>
      <template #actions="{ row }">
        <div class="jv-table__actions" @click.stop>
          <UiButton intent="ghost" size="small" label="Edit" @click="openPersona(row.id)" />
          <UiButton intent="danger-outline" size="small" label="Delete" @click="removePersona(row)" />
        </div>
      </template>
      <template #empty>No personas match this filter.</template>
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

.personas__chip {
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
  user-select: none;
  border: 1px solid var(--border-soft);
}
.personas__chip--active {
  background: var(--accent);
  color: var(--surface);
  border-color: var(--accent);
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
.personas__books { display: inline-block; max-width: 48ch; }
.personas__bulk { gap: 8px; align-items: center; margin-top: 10px; }

</style>
