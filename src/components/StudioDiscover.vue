<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Discover — its own step (redesign §8.5, built 2026-09-27).

  Discover is a different verb from Script's Analyze: it attributes nothing.
  It reads the prose for everyone it names and, only when you say so, adds the
  new ones to the book as SPEAKERS. Analyze can only choose from the book's
  speakers, which is why this step runs first.

  A RECORD, NOT A TO-DO LIST (decided 2026-09-29, "your rec go"). Each
  chapter's scan lives on the chapter (`scene.metadata.discover = {scanned_at,
  candidates, named_cast}`), written by the discover endpoint and replaced
  only by the next scan of that chapter: the AI's names that are not speakers
  of this book, and the speakers the text names (found by name, no AI). Add,
  Ignore and Remove change a person's STATUS — In the cast · In your library ·
  New · Ignored — and never remove them from the list, so a rescan of a
  finished chapter still shows everyone. This component keeps no results of
  its own: the list and the grid's Found column are DERIVED from the `scenes`
  prop, the speakers, the library and the ignore list
  (`studioStatus.foundSpeakers`). Studio keeps this step alive across step
  switches (KeepAlive), so a scan in flight keeps running while you look at
  Script.

  Scope is an inline grid (§8.7: never a modal) — a select-all checkbox in the
  header and one per chapter. The scan runs on the project's chapter run
  (services/chapterRun.js, 2026-09-29) — the same run Script's Analyze uses, so
  only one runs at a time and it survives leaving Studio. Each chapter is a kit
  task, shown by the AiTaskStrip at the top of this page with its Cancel.

  Speakers and personas are two things (2026-09-29): a name that is EXACTLY a
  persona in your library says so (In your library), and Add makes the speaker
  already cast with that persona — matched here in code; the model is no longer
  sent the library. Spellings of one person merge into one row ("Sedge" + "Old
  Sedge") and Add keeps the others as "Also called"; a quote the server could
  not find in the chapter is flagged; Ignore is remembered for the project and
  listed below as well. A row In the cast has Remove from cast, and ticked
  rows a "Remove N selected"; removing deletes the speaker from the book and
  its lines go back to No speaker, so it asks first, naming each one's lines
  ("yes ask first", 2026-09-29). The row then shows as New again. The
  "Already in the cast" card's ✕ and Clear all (which keeps the Narrator) ask
  the same way.
-->
<script setup>
import { computed, ref, watch } from "vue";
import {
  AiTaskStrip, UiButton, UiCheckbox, UiChip, UiTable, UiTag, confirmDialog, pushToast, useAiTasksStore,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { useProjectsStore } from "../stores/projects.js";
import { useCopy } from "../services/copy.js";
import { chapterRunFor, failureOf, inRun, queueChapters } from "../services/chapterRun.js";
import { foundSpeakers, isWaiting } from "../views/studioStatus.js";

const props = defineProps({
  project: { type: Object, required: true },
  scenes: { type: Array, default: () => [] },
  // {sceneId: spoken lines} — Studio already counts these for every chapter.
  linesByScene: { type: Object, default: () => ({}) },
  // The book's speakers, [{id, name, aliases, narrator, lines}] — who shows as
  // In the cast.
  cast: { type: Array, default: () => [] },
  // The persona library — a name that is exactly one of these shows as In
  // your library.
  personas: { type: Array, default: () => [] },
});
// A finished scan reaches Studio through the chapter run, not from here.
// `cast-changed` carries `{ moved }` > 0 when lines lost their speaker.
const emit = defineEmits(["cast-changed", "go"]);

const api = useApi();
const copy = useCopy();
const tasks = useAiTasksStore();
// The ignore list lives on the project row, so the shared store is refreshed
// after a change — every other reader of the project then sees it.
const projectsStore = useProjectsStore();

const selected = ref({});     // {sceneId: true}
const busyName = ref(null);   // a row being added, ignored or removed

watch(() => props.project?.id, () => {
  selected.value = {};
});

const plural = (n, word) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

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

const castById = computed(() => Object.fromEntries(props.cast.map((c) => [c.id, c])));

// The project's remembered Ignore list (fix 4). Seeded from the project, then
// kept current from the ignore / unignore replies.
const ignored = ref([]);
watch(() => props.project, (p) => { ignored.value = [...(p?.discover_ignored || [])]; }, { immediate: true });

// Everyone the saved scans found, each once, with a status.
const found = computed(() => foundSpeakers(props.scenes, props.cast, ignored.value, props.personas));
const counts = computed(() => ({
  all: found.value.length,
  new: found.value.filter(isWaiting).length,
  cast: found.value.filter((r) => r.status === "cast").length,
  ignored: found.value.filter((r) => r.status === "ignored").length,
}));
// The chips: New is everyone still waiting for Add or Ignore — new names and
// names a persona in your library has.
const filter = ref("all");
const shown = computed(() => found.value.filter((r) => filter.value === "all"
  || (filter.value === "new" ? isWaiting(r) : r.status === filter.value)));
// Per chapter: everyone it names, and how many of them are still waiting.
function foundIn(scene) {
  const rows = found.value.filter((r) => r.chapters.includes(scene.id));
  return { total: rows.length, waiting: rows.filter(isWaiting).length };
}
const STATUS = {
  new: { label: "New", intent: "accent2", title: "No speaker or persona has this name. Add makes them a speaker in this book." },
  library: { label: "In your library", intent: "info" },
  cast: { label: "In the cast", intent: "success" },
  ignored: { label: "Ignored", intent: "secondary", title: "You ignored this name for this book. Undo shows it as new again." },
};
function statusTitle(r) {
  if (r.status === "library") return `A persona in your library is called ${r.persona.name}. Add makes ${r.persona.name} a speaker in this book, already cast with that persona.`;
  if (r.status === "cast") return `${r.speaker.name} is a speaker in this book.`;
  return STATUS[r.status].title;
}

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
  { id: "found", header: "Found" },
]);
const RESULT_COLUMNS = [
  { id: "pick", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "name", accessorKey: "name", header: "Name", sortable: true },
  { id: "status", header: "Status" },
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

// One row as promote takes it: a speaker with the other spellings as "Also
// called". A library row takes the persona's exact name, so the server casts
// the new speaker with it (the exact-name rule every new speaker follows).
function toCandidate(c) {
  const name = c.status === "library" ? c.persona.name : c.name;
  return { name, description: c.role_hint || null, aliases: c.names.filter((n) => n !== name) };
}
async function promote(rows) {
  return api.request(`/v1/projects/${props.project.id}/speakers/promote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates: rows.map(toCandidate) }),
  });
}

// Tick several rows, then act on them together (2026-09-29): waiting rows
// take Add or Ignore, rows In the cast take Remove. Keyed by the row's key;
// only rows still in that status count, so a row that changed since it was
// ticked is not acted on.
const picked = ref({});
const tickable = (r) => isWaiting(r) || r.status === "cast";
const pickedWaiting = computed(() => found.value.filter((r) => isWaiting(r) && picked.value[r.key]));
const pickedCast = computed(() => found.value.filter((r) => r.status === "cast" && picked.value[r.key]));
const tickableShown = computed(() => shown.value.filter(tickable));
const allRowsPicked = computed(() =>
  tickableShown.value.length > 0 && tickableShown.value.every((r) => picked.value[r.key]));
function pickAll(on) {
  picked.value = on ? Object.fromEntries(tickableShown.value.map((r) => [r.key, true])) : {};
}
const bulkBusy = ref(false);

async function addSelected() {
  const rows = pickedWaiting.value;
  if (!rows.length || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    await promote(rows);
    const lib = rows.filter((r) => r.status === "library").length;
    for (const r of rows) delete picked.value[r.key];
    pushToast({
      message: `${rows.length} added to the cast${lib ? ` (${lib} already cast with the persona of that name)` : ""} — give them personas in Cast.`,
      kind: "success",
    });
    emit("cast-changed");
  } catch (e) {
    pushToast({ message: `Add failed: ${e?.message || e}`, kind: "error" });
  } finally {
    bulkBusy.value = false;
  }
}

async function ignoreSelected() {
  const rows = pickedWaiting.value;
  if (!rows.length || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    const names = rows.flatMap((c) => c.names);
    const r = await api.request(`/v1/projects/${props.project.id}/discover/ignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names }),
    });
    ignored.value = r?.ignored || ignored.value;
    projectsStore.reload();
    for (const row of rows) delete picked.value[row.key];
  } catch (e) {
    pushToast({ message: `Ignore failed: ${e?.message || e}`, kind: "error" });
  } finally {
    bulkBusy.value = false;
  }
}

async function removeSelected() {
  const rows = pickedCast.value;
  if (!rows.length || bulkBusy.value) return;
  bulkBusy.value = true;
  try {
    if (await removeSpeakers(rows.map((r) => castById.value[r.speaker.id]).filter(Boolean))) {
      for (const r of rows) delete picked.value[r.key];
    }
  } finally {
    bulkBusy.value = false;
  }
}

async function add(c) {
  busyName.value = c.key;
  try {
    await promote([c]);
    pushToast({
      message: c.status === "library"
        ? `${c.persona.name} added to the cast — played by your persona of that name.`
        : `${c.name} added to the cast — give them a persona in Cast.`,
      kind: "success",
    });
    emit("cast-changed");
  } catch (e) {
    pushToast({ message: `Add failed: ${e?.message || e}`, kind: "error" });
  } finally {
    busyName.value = null;
  }
}

// Take names off the ignore list — a row's Undo, an Ignored tag's ✕, or
// "Clear all". No confirmation (decided 2026-09-29): the name only shows as
// new again.
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
        ? `${names[0]} is no longer ignored.`
        : `${names.length} names are no longer ignored.`,
      kind: "info",
    });
  } catch (e) {
    pushToast({ message: `Couldn't take that off the list: ${e?.message || e}`, kind: "error" });
  }
}

// Remove speakers from the book — a row's Remove from cast, "Remove N
// selected", the cast card's ✕ or its "Clear all" (which keeps the Narrator).
// Their lines go back to No speaker, so it asks first, naming each one's lines
// ("yes ask first", 2026-09-29). True when they were removed.
const castBusy = ref(false);
async function removeSpeakers(people) {
  if (!people.length || castBusy.value) return false;
  const lines = people.reduce((n, p) => n + (p.lines || 0), 0);
  const ok = await confirmDialog(people.length === 1
    ? {
      title: `Remove ${people[0].name} from the cast?`,
      message: lines ? `${plural(lines, "line")} will have no speaker.` : "",
      confirmLabel: "Remove",
      danger: true,
    }
    : {
      title: `Remove ${people.length} speakers from the cast?`,
      message: `${people.map((p) => `${p.name} — ${plural(p.lines || 0, "line")}`).join(" · ")}.${lines ? ` ${plural(lines, "line")} will have no speaker.` : ""}`,
      confirmLabel: `Remove ${people.length}`,
      danger: true,
    });
  if (!ok) return false;
  castBusy.value = true;
  let failed = 0;
  for (const p of people) {
    try {
      await api.request(`/v1/speakers/${p.id}`, { method: "DELETE" });
    } catch { failed += 1; }
  }
  castBusy.value = false;
  emit("cast-changed", { moved: lines });
  pushToast({
    message: failed
      ? `${people.length - failed} removed from the cast; ${failed} failed.`
      : people.length === 1
        ? `${people[0].name} removed from the cast.`
        : `${people.length} removed from the cast.`,
    kind: failed ? "warning" : "success",
  });
  return true;
}
async function removeRow(row) {
  const sp = castById.value[row.speaker.id];
  if (!sp) return;
  busyName.value = row.key;
  try {
    await removeSpeakers([sp]);
  } finally {
    busyName.value = null;
  }
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
          Reads the prose for everyone it names: speakers already in the cast, names a persona in
          your library has, and new names. Nothing is created until you add someone. Script can only
          give a line to a speaker in this {{ copy.book.singular.toLowerCase() }}, so this step runs first.
        </p>

        <div v-if="!scenes.length" class="jv-banner">
          No {{ chapterWord.plural.toLowerCase() }} yet — add or import them in
          <a href="#studio" @click.prevent="emit('go', 'script')">Script</a> first.
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
            <template #found="{ row }">
              <template v-if="foundIn(row).total">
                <span class="jv-mono">{{ foundIn(row).total }}</span>
                <UiTag v-if="foundIn(row).waiting" intent="accent2" class="studio-discover__new"
                  :title="`${foundIn(row).waiting} not in the cast yet`">{{ foundIn(row).waiting }} new</UiTag>
              </template>
              <span v-else-if="row.metadata?.discover?.scanned_at" class="jv-muted">nobody</span>
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
        <h3 class="jv-card__title">Speakers found</h3>
        <span class="jv-hint">nothing is created until you add someone</span>
      </div>
      <div class="jv-card__body">
        <div v-if="found.length" class="jv-inline-row studio-discover__chips">
          <UiChip :selected="filter === 'all'" @click="filter = 'all'">All {{ counts.all }}</UiChip>
          <UiChip :selected="filter === 'new'" title="Not in this cast yet: new names, and names a persona in your library has"
            @click="filter = 'new'">New {{ counts.new }}</UiChip>
          <UiChip :selected="filter === 'cast'" @click="filter = 'cast'">In the cast {{ counts.cast }}</UiChip>
          <UiChip :selected="filter === 'ignored'" @click="filter = 'ignored'">Ignored {{ counts.ignored }}</UiChip>
        </div>
        <UiTable class="jv-table-look" :data="shown" :columns="RESULT_COLUMNS" data-key="key">
          <template #head-pick>
            <UiCheckbox :model-value="allRowsPicked" :disabled="!tickableShown.length || bulkBusy"
              :title="allRowsPicked ? 'Untick every name shown' : 'Tick every name shown'"
              @update:model-value="pickAll" />
          </template>
          <template #pick="{ row }">
            <UiCheckbox v-if="tickable(row)" :model-value="!!picked[row.key]" :disabled="bulkBusy"
              @update:model-value="(v) => (picked = { ...picked, [row.key]: v })" />
          </template>
          <template #name="{ row }">
            <strong>{{ row.name }}</strong>
            <div v-if="row.names.some((n) => n !== row.name)" class="jv-hint">also written {{ row.names.filter((n) => n !== row.name).join(", ") }}</div>
            <div v-if="row.role_hint" class="jv-hint">{{ row.role_hint }}</div>
          </template>
          <template #status="{ row }">
            <UiTag :intent="STATUS[row.status].intent" :title="statusTitle(row)">{{ STATUS[row.status].label }}</UiTag>
          </template>
          <template #lines="{ row }">
            <span v-if="row.lines" class="jv-mono" title="Roughly how many lines of dialogue they speak in what was scanned">≈ {{ row.lines }}</span>
            <span v-else-if="row.mentions" class="jv-muted" title="How many times the text names them in what was scanned">named {{ row.mentions }}×</span>
            <span v-else class="jv-mono" title="Named, but not heard speaking in what was scanned">0</span>
          </template>
          <template #evidence="{ row }">
            <span class="studio-discover__quote">{{ row.evidence ? `“${row.evidence}”` : "—" }}</span>
            <UiTag v-if="row.evidence_found === false" intent="danger"
              title="This quote is not in the chapter — the model may have invented it, and the name with it.">quote not in the chapter</UiTag>
          </template>
          <template #chapters="{ row }">
            <span class="jv-muted">{{ row.chapters.map((id) => titleById[id]).filter(Boolean).join(", ") }}</span>
          </template>
          <template #actions="{ row }">
            <template v-if="isWaiting(row)">
              <UiButton intent="primary" size="small" label="＋ Add" :loading="busyName === row.key"
                :disabled="busyName !== null"
                :title="row.status === 'library' ? `Add ${row.persona.name} to this book, cast with your persona of that name` : `Add ${row.name} to this book as a speaker`"
                @click="add(row)" />
              <UiButton intent="ghost" size="small" label="Ignore" :disabled="busyName !== null"
                title="Mark it Ignored for this book. It stays in this list; Undo takes it back."
                @click="ignore(row)" />
            </template>
            <template v-else-if="row.status === 'cast'">
              <span class="jv-muted studio-discover__incast">already in the cast</span>
              <UiButton intent="ghost" size="small" label="Remove from cast" :loading="busyName === row.key"
                :disabled="busyName !== null || castBusy"
                :title="`Remove ${row.speaker.name} from this book — asks first; their lines go back to No speaker`"
                @click="removeRow(row)" />
            </template>
            <UiButton v-else-if="row.status === 'ignored'" intent="ghost" size="small" label="Undo"
              title="Take it off the ignore list — it shows as new again" @click="unignore(row.names)" />
          </template>
          <template #empty>
            {{ !scenes.some((s) => s.metadata?.discover?.scanned_at)
              ? "Scan some chapters to see who they name."
              : found.length ? "Nobody here — try All." : "The chapters scanned name nobody." }}
          </template>
        </UiTable>
        <div v-if="counts.new || counts.cast" class="jv-inline-row studio-discover__bulk">
          <UiButton intent="primary" size="small" :disabled="!pickedWaiting.length || bulkBusy || busyName !== null"
            :loading="bulkBusy" :label="pickedWaiting.length ? `＋ Add ${pickedWaiting.length} selected` : '＋ Add selected'"
            title="Add every ticked name to this book — a name a persona in your library has arrives cast with it"
            @click="addSelected" />
          <UiButton intent="ghost" size="small" :disabled="!pickedWaiting.length || bulkBusy || busyName !== null"
            :label="pickedWaiting.length ? `Ignore ${pickedWaiting.length} selected` : 'Ignore selected'"
            title="Mark every ticked name Ignored for this book"
            @click="ignoreSelected" />
          <UiButton intent="ghost" size="small" :disabled="!pickedCast.length || bulkBusy || busyName !== null || castBusy"
            :label="pickedCast.length ? `Remove ${pickedCast.length} selected` : 'Remove selected'"
            title="Remove every ticked speaker from this book — asks first; their lines go back to No speaker"
            @click="removeSelected" />
          <span class="jv-hint">{{ pickedWaiting.length || pickedCast.length ? `${pickedWaiting.length + pickedCast.length} ticked` : "Tick names to add, ignore or remove several at once." }}</span>
        </div>
      </div>
    </div>

    <div v-if="ignored.length" class="jv-card jv-card--soft">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Ignored</h3>
        <span class="jv-hint">{{ ignored.length }} · shown as Ignored in this {{ copy.book.singular.toLowerCase() }}</span>
        <UiButton intent="ghost" size="small" label="Clear all"
          title="Take every name off this list — they show as new again" @click="unignore([...ignored])" />
      </div>
      <div class="jv-card__body studio-discover__cast">
        <UiTag v-for="n in ignored" :key="n" intent="ghost" removable :value="n"
          :title="`✕ takes ${n} off the list — it shows as new again`" @remove="unignore([n])" />
      </div>
    </div>

    <div class="jv-card jv-card--soft">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Already in the cast</h3>
        <span class="jv-hint">{{ cast.length }}</span>
        <UiButton v-if="clearable.length" intent="ghost" size="small" label="Clear all" :disabled="castBusy"
          title="Remove everyone but the Narrator from this book — asks first; their lines go back to No speaker"
          @click="removeSpeakers(clearable)" />
      </div>
      <div class="jv-card__body">
        <div class="studio-discover__cast">
          <UiTag v-for="c in cast" :key="c.id" intent="ghost" removable :value="c.name"
            :title="`✕ removes ${c.name} from this book — asks first; their lines go back to No speaker`"
            @remove="removeSpeakers([c])">🎭 {{ c.name }}</UiTag>
          <span v-if="!cast.length" class="jv-muted">Nobody yet.</span>
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
.studio-discover__chips { gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.studio-discover__new { margin-left: 6px; }
.studio-discover__incast { font-size: 12px; margin-right: 6px; }
.studio-discover__bulk { gap: 8px; align-items: center; margin-top: 10px; }
</style>
