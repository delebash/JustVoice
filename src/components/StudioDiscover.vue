<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Discover — its own step (redesign §8.5, built 2026-09-27).

  Discover is a different verb from Script's Analyze: it attributes nothing.
  It reads the prose for names NOT yet in the cast and, only when you say so,
  creates personas for them. Analyze can only choose from personas that
  exist, which is why this step runs first.

  SAVED, NOT HELD (2026-09-27, "both"). Each chapter's scan lives on the
  chapter (`scene.metadata.discover = {scanned_at, candidates}`), written by
  the discover endpoint and pruned server-side by promote and by
  /discover/ignore. This component therefore keeps no results of its own: the
  Proposed list and the grid's Last scanned / Proposed columns are DERIVED
  from the `scenes` prop, and every change is handed back to Studio through
  `scans` so Overview's counts move with it. Studio also keeps this step
  alive across step switches (KeepAlive), so a scan in flight keeps running
  while you look at Script.

  Scope is an inline grid (§8.7: never a modal) — a select-all checkbox in the
  header and one per chapter. The scan runs on the project's chapter run
  (services/chapterRun.js, 2026-09-29) — the same run Script's Analyze uses, so
  only one runs at a time and it survives leaving Studio. Each chapter is a kit
  task, shown by the AiTaskStrip at the top of this page with its Cancel.

  2026-09-27 fixes (A B C D + 1-5): a proposal that names a persona already in
  your LIBRARY says so ("→ Brick Halvorn") and Add re-links that persona and
  learns the name as an alias instead of making a duplicate; spellings of one
  person merge into one row ("Sedge" + "Old Sedge"); a quote the server could
  not find in the chapter is flagged; Ignore is remembered for the project and
  listed below. Each ignored name and each cast member has its own ✕, and both
  lists have "Clear all" (2026-09-29) — the cast's keeps the Narrator.
-->
<script setup>
import { computed, ref, watch } from "vue";
import {
  AiTaskStrip, UiButton, UiCheckbox, UiTable, UiTag, pushToast, useAiTasksStore,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { useProjectsStore } from "../stores/projects.js";
import { useCopy } from "../services/copy.js";
import { chapterRunFor, failureOf, inRun, queueChapters } from "../services/chapterRun.js";
import { proposedSpeakers } from "../views/studioStatus.js";

const props = defineProps({
  project: { type: Object, required: true },
  scenes: { type: Array, default: () => [] },
  // {sceneId: spoken lines} — Studio already counts these for every chapter.
  linesByScene: { type: Object, default: () => ({}) },
  // The cast, [{id, name, narrator}] — a proposal for one of them is not shown.
  cast: { type: Array, default: () => [] },
});
// `scans`: {sceneId: discover|null} — the saved-scan changes for Studio to
// fold into its chapter rows (null = that chapter's saved list emptied). A
// finished scan reaches Studio through the chapter run instead.
const emit = defineEmits(["cast-changed", "go", "scans"]);

const api = useApi();
const copy = useCopy();
const tasks = useAiTasksStore();
// The ignore list lives on the project row, so the shared store is refreshed
// after a change — every other reader of the project then sees it.
const projectsStore = useProjectsStore();

const selected = ref({});     // {sceneId: true}
const busyName = ref(null);   // a proposal being added or ignored

watch(() => props.project?.id, () => {
  selected.value = {};
});

// Where a chapter stands in the project's run: "scanning" (this one now),
// "queued", or a failure from this session's scans.
function rowState(scene) {
  const where = inRun(props.project.id, scene.id);
  if (where) return where === "current" ? "scanning" : "queued";
  return failureOf(props.project.id, scene.id)?.kind === "discover" ? "failed" : null;
}
const failureText = (scene) => failureOf(props.project.id, scene.id)?.reason || "";

const chapterWord = computed(() => copy.value.chapter);
const titleOf = (s) => s.title || `${chapterWord.value.singular} ${s.position + 1}`;
const titleById = computed(() => Object.fromEntries(props.scenes.map((s) => [s.id, titleOf(s)])));

const castNames = computed(() => props.cast.map((c) => c.name));
const proposals = computed(() => proposedSpeakers(props.scenes, props.cast));
// Per chapter: how many of its proposals are still waiting — the same rows,
// counted where they were found.
function waitingIn(scene) {
  return proposals.value.filter((r) => r.chapters.includes(scene.id)).length;
}

// The project's remembered Ignore list (fix 4). Seeded from the project, then
// kept current from the ignore / unignore replies.
const ignored = ref([]);
watch(() => props.project, (p) => { ignored.value = [...(p?.discover_ignored || [])]; }, { immediate: true });

const run = computed(() => chapterRunFor(props.project.id));
const scanning = computed(() => run.value?.current?.kind === "discover");
// A chapter already in the run can't be queued again.
const pickable = (s) => !inRun(props.project.id, s.id);
const pickedScenes = computed(() => props.scenes.filter((s) => selected.value[s.id] && pickable(s)));
const pickedLines = computed(() =>
  pickedScenes.value.reduce((n, s) => n + (props.linesByScene[s.id] || 0), 0));
const allPicked = computed(() => {
  const open = props.scenes.filter(pickable);
  return open.length > 0 && open.every((s) => selected.value[s.id]);
});
function toggleAll(on) {
  selected.value = on ? Object.fromEntries(props.scenes.filter(pickable).map((s) => [s.id, true])) : {};
}
function toggleOne(id, on) {
  selected.value = { ...selected.value, [id]: on };
}

// The page's own strip: the Discover run, running or lingering.
const discoverTask = computed(() =>
  tasks.visibleTasks.find((t) => t.feature === "speaker_identification" && t.inline
    && t.meta?.projectId === props.project?.id) || null);

const GRID_COLUMNS = computed(() => [
  { id: "sel", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "title", header: chapterWord.value.singular },
  { id: "lines", header: "Lines", headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
  { id: "scanned", header: "Last scanned" },
  { id: "proposed", header: "Proposed" },
]);
const RESULT_COLUMNS = [
  { id: "name", accessorKey: "name", header: "Name in the prose", sortable: true },
  { id: "lines", accessorKey: "lines", header: "Lines", sortable: true,
    headerStyle: { textAlign: "right" }, cellStyle: { textAlign: "right" } },
  { id: "evidence", header: "First appearance" },
  { id: "chapters", header: "Where" },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap", textAlign: "right" } },
];

function ago(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  const d = Math.floor(ms / 86_400_000);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

// Queue the ticked chapters on the project's run. A run already going (an
// Analyze, say) takes them after its own.
function scan() {
  const targets = pickedScenes.value;
  if (!targets.length) return;
  queueChapters({ projectId: props.project.id, kind: "discover", chapters: targets });
  selected.value = {};
}

// The server prunes a name from every chapter's saved list on promote and on
// ignore; this mirrors that onto Studio's rows so nothing has to re-fetch.
function pruneLocally(names) {
  const drop = new Set(names.map((n) => (n || "").trim().toLowerCase()));
  const patch = {};
  for (const s of props.scenes) {
    const saved = s.metadata?.discover;
    if (!saved?.candidates?.length) continue;
    const keep = saved.candidates.filter((c) => !drop.has((c.name || "").trim().toLowerCase()));
    if (keep.length !== saved.candidates.length) patch[s.id] = { ...saved, candidates: keep };
  }
  if (Object.keys(patch).length) emit("scans", patch);
}

async function add(c) {
  busyName.value = c.key;
  try {
    // A library match re-links that persona (and teaches it these names);
    // otherwise one new persona, with the other spellings as its aliases.
    const others = c.names.filter((n) => n !== c.name);
    const body = c.library
      ? { candidates: [{ name: c.names[0], persona_id: c.library.persona_id, aliases: c.names.slice(1) }] }
      : { candidates: [{ name: c.name, personality: c.role_hint || null, aliases: others }] };
    const r = await api.request(`/v1/projects/${props.project.id}/personas/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    pruneLocally(c.names);
    pushToast({
      message: c.library
        ? `${c.library.name} is in the cast now${c.names.some((n) => n !== c.library.name) ? ` — and knows "${c.names.filter((n) => n !== c.library.name).join('", "')}" as another name` : ""}.`
        : (r?.created || []).length
          ? `${c.name} added to the cast — give them a voice in Cast.`
          : `${c.name} already existed as a persona — linked to this project.`,
      kind: "success",
    });
    emit("cast-changed");
  } catch (e) {
    pushToast({ message: `Add failed: ${e?.message || e}`, kind: "error" });
  } finally {
    busyName.value = null;
  }
}

// Take names off the ignore list — one (its ✕) or all ("Clear all"). No
// confirmation (decided 2026-09-29): a name taken off only means Discover may
// propose it again.
async function unignore(names) {
  if (!names.length) return;
  try {
    const r = await api.request(`/v1/projects/${props.project.id}/discover/unignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    });
    ignored.value = r?.ignored || [];
    projectsStore.reload();
    pushToast({
      message: names.length === 1
        ? `${names[0]} can be proposed again — scan a chapter that names them.`
        : `${names.length} names can be proposed again.`,
      kind: "info",
    });
  } catch (e) {
    pushToast({ message: `Couldn't take that off the list: ${e?.message || e}`, kind: "error" });
  }
}

// Take personas out of this project's cast — one (its ✕) or all ("Clear
// all", which keeps the Narrator: decided 2026-09-29). The persona stays in
// the library, and lines already given to it keep it. No confirmation here.
const castBusy = ref(false);
async function uncast(people) {
  if (!people.length || castBusy.value) return;
  castBusy.value = true;
  let failed = 0;
  for (const p of people) {
    try {
      await api.request(`/v1/projects/${props.project.id}/cast/${p.id}`, { method: "DELETE" });
    } catch { failed += 1; }
  }
  castBusy.value = false;
  emit("cast-changed");
  pushToast({
    message: failed
      ? `${people.length - failed} removed from the cast; ${failed} failed.`
      : people.length === 1
        ? `${people[0].name} removed from the cast — still in your library.`
        : `${people.length} removed from the cast — still in your library.`,
    kind: failed ? "warning" : "success",
  });
}
const clearable = computed(() => props.cast.filter((c) => !c.narrator));

async function ignore(c) {
  busyName.value = c.key;
  try {
    const r = await api.request(`/v1/projects/${props.project.id}/discover/ignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: c.names }),
    });
    ignored.value = r?.ignored || ignored.value;
    projectsStore.reload();
    pruneLocally(c.names);
  } catch (e) {
    pushToast({ message: `Ignore failed: ${e?.message || e}`, kind: "error" });
  } finally {
    busyName.value = null;
  }
}
</script>

<template>
  <section class="studio-discover">
    <AiTaskStrip v-if="discoverTask" :task="discoverTask" />

    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Who speaks in this {{ copy.book.singular.toLowerCase() }}?</h3>
      </div>
      <div class="jv-card__body">
        <p class="jv-lede">
          Reads the prose for names that aren't in your cast yet. Nothing is created until you add
          each one. Script can only give a line to a persona that exists, so this step runs first.
        </p>

        <div v-if="!scenes.length" class="jv-banner">
          No {{ chapterWord.plural.toLowerCase() }} yet — add or import them in
          <a href="#chapter">{{ chapterWord.plural }}</a> first.
        </div>
        <template v-else>
          <UiTable class="jv-table-look studio-discover__grid" :data="scenes" :columns="GRID_COLUMNS" data-key="id">
            <template #head-sel>
              <UiCheckbox :model-value="allPicked" :disabled="!scenes.some(pickable)"
                :title="allPicked ? 'Select none' : 'Select all'"
                @update:model-value="toggleAll" />
            </template>
            <template #sel="{ row }">
              <UiCheckbox :model-value="!!selected[row.id] && pickable(row)" :disabled="!pickable(row)"
                :title="pickable(row) ? '' : 'In the current run'"
                @update:model-value="(v) => toggleOne(row.id, v)" />
            </template>
            <template #title="{ row }"><strong>{{ titleOf(row) }}</strong></template>
            <template #lines="{ row }"><span class="jv-mono">{{ (linesByScene[row.id] || 0).toLocaleString() }}</span></template>
            <template #scanned="{ row }">
              <UiTag v-if="rowState(row) === 'scanning'" intent="solid">scanning…</UiTag>
              <UiTag v-else-if="rowState(row) === 'queued'" intent="ghost">queued</UiTag>
              <template v-else-if="rowState(row) === 'failed'">
                <UiTag intent="danger" :title="failureText(row)">failed</UiTag>
                <div v-if="failureText(row)" class="jv-hint studio-discover__why">{{ failureText(row) }}</div>
              </template>
              <span v-else-if="row.metadata?.discover?.scanned_at" class="jv-muted"
                :title="new Date(row.metadata.discover.scanned_at).toLocaleString()">{{ ago(row.metadata.discover.scanned_at) }}</span>
              <span v-else class="jv-muted">never</span>
            </template>
            <template #proposed="{ row }">
              <UiTag v-if="waitingIn(row)" intent="accent2">{{ waitingIn(row) }}</UiTag>
              <span v-else-if="row.metadata?.discover?.scanned_at" class="jv-muted">none</span>
              <span v-else class="jv-muted">—</span>
            </template>
          </UiTable>

          <div class="jv-inline-row studio-discover__run">
            <UiButton
              intent="primary"
              :disabled="!pickedScenes.length"
              :loading="scanning"
              :label="pickedScenes.length
                ? `🔍 Scan ${pickedScenes.length} ${(pickedScenes.length === 1 ? chapterWord.singular : chapterWord.plural).toLowerCase()}`
                : '🔍 Scan'"
              @click="scan"
            />
            <span class="jv-hint">
              {{ pickedScenes.length
                ? `${pickedLines.toLocaleString()} lines · ${run?.current ? "starts after the current run" : `one model call per ${chapterWord.singular.toLowerCase()}`}; each row fills in when its ${chapterWord.singular.toLowerCase()} finishes, and a new scan replaces that ${chapterWord.singular.toLowerCase()}'s last one`
                : `Tick the ${chapterWord.plural.toLowerCase()} to read.` }}
            </span>
          </div>
        </template>
      </div>
    </div>

    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Proposed speakers</h3>
        <span class="jv-hint">nothing is created until you add it</span>
      </div>
      <div class="jv-card__body">
        <UiTable class="jv-table-look" :data="proposals" :columns="RESULT_COLUMNS" data-key="key">
          <template #name="{ row }">
            <strong>{{ row.name }}</strong>
            <div v-if="row.names.length > 1" class="jv-hint">also written {{ row.names.filter((n) => n !== row.name).join(", ") }}</div>
            <div v-if="row.library" class="studio-discover__lib">
              <UiTag intent="accent2" :title="`${row.library.name} is already in your library. Add puts that persona in this cast and remembers ${row.names.join(', ')} as a name for them — no duplicate.`">→ {{ row.library.name }} · in your library</UiTag>
            </div>
            <div v-if="row.role_hint" class="jv-hint">{{ row.role_hint }}</div>
          </template>
          <template #lines="{ row }"><span class="jv-mono" :title="row.lines ? 'Roughly how many lines of dialogue they speak in what was scanned' : 'Named, but not heard speaking in what was scanned'">{{ row.lines ? `≈ ${row.lines}` : "0" }}</span></template>
          <template #evidence="{ row }">
            <span class="studio-discover__quote">{{ row.evidence ? `“${row.evidence}”` : "—" }}</span>
            <UiTag v-if="row.evidence_found === false" intent="danger"
              title="This quote is not in the chapter — the model may have invented it, and the name with it.">quote not in the chapter</UiTag>
          </template>
          <template #chapters="{ row }">
            <span class="jv-muted">{{ row.chapters.map((id) => titleById[id]).filter(Boolean).join(", ") }}</span>
          </template>
          <template #actions="{ row }">
            <UiButton intent="primary" size="small" label="＋ Add" :loading="busyName === row.key"
              :disabled="busyName !== null"
              :title="row.library ? `Put ${row.library.name} (already in your library) in this cast` : `Create a persona for ${row.name} and put them in this cast`"
              @click="add(row)" />
            <UiButton intent="ghost" size="small" label="Ignore" :disabled="busyName !== null"
              title="Drop it, and keep it out of later scans of this project. Its ✕ in Ignored undoes it."
              @click="ignore(row)" />
          </template>
          <template #empty>
            {{ scenes.some((s) => s.metadata?.discover?.scanned_at)
              ? "Nobody waiting — every name found is in the cast or was ignored."
              : "Scan some chapters to see who they name." }}
          </template>
        </UiTable>
      </div>
    </div>

    <div v-if="ignored.length" class="jv-card jv-card--soft">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Ignored</h3>
        <span class="jv-hint">{{ ignored.length }} · never proposed again in this {{ copy.book.singular.toLowerCase() }}</span>
        <span class="jv-spacer" />
        <UiButton intent="ghost" size="small" label="Clear all"
          title="Take every name off this list — Discover may propose them again" @click="unignore([...ignored])" />
      </div>
      <div class="jv-card__body studio-discover__cast">
        <UiTag v-for="n in ignored" :key="n" intent="ghost" removable :value="n"
          :title="`✕ lets Discover propose ${n} again`" @remove="unignore([n])" />
      </div>
    </div>

    <div class="jv-card jv-card--soft">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Already in the cast</h3>
        <span class="jv-hint">{{ castNames.length }}</span>
        <span class="jv-spacer" />
        <UiButton v-if="clearable.length" intent="ghost" size="small" label="Clear all" :disabled="castBusy"
          title="Take everyone but the Narrator out of this cast — they stay in your library, and lines already given to them keep them"
          @click="uncast(clearable)" />
      </div>
      <div class="jv-card__body">
        <div class="studio-discover__cast">
          <UiTag v-for="c in cast" :key="c.id" intent="ghost" removable :value="c.name"
            :title="`✕ takes ${c.name} out of this cast — the persona stays in your library`"
            @remove="uncast([c])">🎭 {{ c.name }}</UiTag>
          <span v-if="!castNames.length" class="jv-muted">Nobody yet.</span>
        </div>
        <p class="jv-hint">
          Script can only choose from these.
          <a href="#studio" @click.prevent="emit('go', 'script')">Go to Script ➜</a>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.studio-discover { display: flex; flex-direction: column; gap: 14px; }
.studio-discover__grid { margin: 10px 0 12px; }
.studio-discover__run { gap: 10px; align-items: center; }
.studio-discover__cast { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
.studio-discover__why { max-width: 60ch; margin-top: 4px; }
.studio-discover__quote { display: block; max-width: 46ch; color: var(--ink-2); font-style: italic; }
.studio-discover__lib { margin: 3px 0; }
</style>
