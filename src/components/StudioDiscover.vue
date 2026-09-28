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
  header and one per chapter. The run is the kit task (`withAiTask`, inline),
  shown by the AiTaskStrip at the top of this page with its Cancel — the same
  strip Script shows for Analyze.

  2026-09-27 fixes (A B C D + 1-5): a proposal that names a persona already in
  your LIBRARY says so ("→ Brick Halvorn") and Add re-links that persona and
  learns the name as an alias instead of making a duplicate; spellings of one
  person merge into one row ("Sedge" + "Old Sedge"); a quote the server could
  not find in the chapter is flagged; Ignore is remembered for the project and
  listed below with Restore.
-->
<script setup>
import { computed, ref, watch } from "vue";
import {
  AiTaskStrip, UiButton, UiCheckbox, UiTable, UiTag, pushToast, useAiTasksStore, withAiTask,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { useProjectsStore } from "../stores/projects.js";
import { useCopy } from "../services/copy.js";
import { proseFromBlocks } from "../services/attribution.js";
import { proposedSpeakers } from "../views/studioStatus.js";

const props = defineProps({
  project: { type: Object, required: true },
  scenes: { type: Array, default: () => [] },
  // {sceneId: spoken lines} — Studio already counts these for every chapter.
  linesByScene: { type: Object, default: () => ({}) },
  // The cast, [{id, name}] — a proposal for one of them is not shown.
  cast: { type: Array, default: () => [] },
});
// `scans`: {sceneId: discover|null} — the saved-scan changes for Studio to
// fold into its chapter rows (null = that chapter's saved list emptied).
const emit = defineEmits(["cast-changed", "go", "scans"]);

const api = useApi();
const copy = useCopy();
const tasks = useAiTasksStore();
// The ignore list lives on the project row, so the shared store is refreshed
// after a change — every other reader of the project then sees it.
const projectsStore = useProjectsStore();

const selected = ref({});     // {sceneId: true}
const running = ref({});      // {sceneId: "scanning" | "failed"} — this run only
const failure = ref({});      // {sceneId: the server's reason} — shown on the row
const busyName = ref(null);   // a proposal being added or ignored

watch(() => props.project?.id, () => {
  selected.value = {};
  running.value = {};
  failure.value = {};
});

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

const scanning = computed(() => Object.values(running.value).includes("scanning"));
const pickedScenes = computed(() => props.scenes.filter((s) => selected.value[s.id]));
const pickedLines = computed(() =>
  pickedScenes.value.reduce((n, s) => n + (props.linesByScene[s.id] || 0), 0));
const allPicked = computed(() => props.scenes.length > 0 && pickedScenes.value.length === props.scenes.length);
function toggleAll(on) {
  selected.value = on ? Object.fromEntries(props.scenes.map((s) => [s.id, true])) : {};
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

// The chapter's prose, exactly as Analyze would read it: the stored text that
// produced its split when there is one, else its blocks joined back up.
async function sceneText(scene) {
  if (scene.metadata?.source_text) return scene.metadata.source_text;
  const r = await api.safeRequest(`/v1/scenes/${scene.id}/blocks`, []);
  return proseFromBlocks(Array.isArray(r) ? r : (r?.blocks ?? []));
}

// Token usage across the run's calls, for the strip's finish line.
function addUsage(total, u) {
  if (!u || typeof u !== "object") return total;
  const out = { ...(total || {}) };
  for (const [k, v] of Object.entries(u)) if (typeof v === "number") out[k] = (out[k] || 0) + v;
  return out;
}

async function scan() {
  const targets = pickedScenes.value;
  if (!targets.length || scanning.value) return;
  running.value = Object.fromEntries(targets.map((s) => [s.id, "scanning"]));
  failure.value = {};
  const noun = (targets.length === 1 ? chapterWord.value.singular : chapterWord.value.plural).toLowerCase();
  try {
    await withAiTask({
      feature: "speaker_identification",
      label: `Discover speakers · ${targets.length} ${noun}`,
      inline: true,
      meta: { projectId: props.project.id },
      onRetry: () => scan(),
    }, async (task) => {
      task.setProgress(0, targets.length);
      let done = 0;
      let failed = 0;
      let usage = null;
      for (const scene of targets) {
        if (task.signal.aborted) break;
        task.setStats([`reading ${titleOf(scene)}`, `${done} of ${targets.length} done`]);
        try {
          const text = (await sceneText(scene)).trim();
          if (text) {
            const out = await api.request(`/v1/scenes/${scene.id}/discover-speakers`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ text }),
              signal: task.signal,
            });
            usage = addUsage(usage, out?.usage);
            // The server saved it; mirror the saved shape so the rows fill in
            // now, without re-reading the project.
            emit("scans", {
              [scene.id]: { scanned_at: new Date().toISOString(), candidates: out?.candidates || [] },
            });
          }
          const { [scene.id]: _drop, ...rest } = running.value;
          running.value = rest;
        } catch (e) {
          if (task.signal.aborted) break;
          running.value = { ...running.value, [scene.id]: "failed" };
          if (e?.status === 501 || /no llm provider/i.test(String(e?.message || e))) {
            throw new Error("Discover needs a language model — wire one in AI Settings.");
          }
          // The server's own words (a model that would not load, say) — a bare
          // "failed" tells you nothing you can act on.
          failure.value = { ...failure.value, [scene.id]: String(e?.message || e) };
          failed += 1;
        }
        done += 1;
        task.setProgress(done, targets.length);
      }
      // Every chapter failing is a failed run, and the strip says why; some
      // failing leaves a finished run with the reasons on their rows.
      if (failed && failed === targets.length) {
        throw new Error(failure.value[targets[0].id] || "Discover failed.");
      }
      task.setStats([
        `${proposals.value.length} to review`,
        ...(failed ? [`${failed} ${failed === 1 ? chapterWord.value.singular : chapterWord.value.plural} failed`.toLowerCase()] : []),
      ]);
      return { result: null, usage };
    });
  } catch (e) {
    if (!/abort/i.test(String(e?.message || e))) {
      pushToast({ message: String(e?.message || e), kind: "warning", duration: 6000 });
    }
  } finally {
    // Chapters never reached (Cancel) go back to their saved state.
    running.value = Object.fromEntries(Object.entries(running.value).filter(([, v]) => v === "failed"));
  }
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

async function restore(name) {
  try {
    const r = await api.request(`/v1/projects/${props.project.id}/discover/unignore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ names: [name] }),
    });
    ignored.value = r?.ignored || [];
    projectsStore.reload();
    pushToast({ message: `${name} can be proposed again — scan a chapter that names them.`, kind: "info" });
  } catch (e) {
    pushToast({ message: `Restore failed: ${e?.message || e}`, kind: "error" });
  }
}

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
              <UiCheckbox :model-value="allPicked" :disabled="scanning"
                :title="allPicked ? 'Select none' : 'Select all'"
                @update:model-value="toggleAll" />
            </template>
            <template #sel="{ row }">
              <UiCheckbox :model-value="!!selected[row.id]" :disabled="scanning"
                @update:model-value="(v) => toggleOne(row.id, v)" />
            </template>
            <template #title="{ row }"><strong>{{ titleOf(row) }}</strong></template>
            <template #lines="{ row }"><span class="jv-mono">{{ (linesByScene[row.id] || 0).toLocaleString() }}</span></template>
            <template #scanned="{ row }">
              <UiTag v-if="running[row.id] === 'scanning'" intent="solid">scanning…</UiTag>
              <template v-else-if="running[row.id] === 'failed'">
                <UiTag intent="danger" :title="failure[row.id] || ''">failed</UiTag>
                <div v-if="failure[row.id]" class="jv-hint studio-discover__why">{{ failure[row.id] }}</div>
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
              :disabled="!pickedScenes.length || scanning"
              :loading="scanning"
              :label="pickedScenes.length
                ? `🔍 Scan ${pickedScenes.length} ${(pickedScenes.length === 1 ? chapterWord.singular : chapterWord.plural).toLowerCase()}`
                : '🔍 Scan'"
              @click="scan"
            />
            <span class="jv-hint">
              {{ pickedScenes.length
                ? `${pickedLines.toLocaleString()} lines · one model call per ${chapterWord.singular.toLowerCase()}; each row fills in when its ${chapterWord.singular.toLowerCase()} finishes, and a new scan replaces that ${chapterWord.singular.toLowerCase()}'s last one`
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
              title="Drop it, and keep it out of later scans of this project. Restore undoes it."
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
      </div>
      <div class="jv-card__body studio-discover__cast">
        <span v-for="n in ignored" :key="n" class="studio-discover__ignored">
          <UiTag intent="ghost">{{ n }}</UiTag>
          <UiButton intent="ghost" size="small" label="Restore" :title="`Let Discover propose ${n} again`" @click="restore(n)" />
        </span>
      </div>
    </div>

    <div class="jv-card jv-card--soft">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Already in the cast</h3>
        <span class="jv-hint">{{ castNames.length }}</span>
      </div>
      <div class="jv-card__body">
        <div class="studio-discover__cast">
          <UiTag v-for="n in castNames" :key="n" intent="ghost">🎭 {{ n }}</UiTag>
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
.studio-discover__ignored { display: inline-flex; align-items: center; gap: 4px; }
</style>
