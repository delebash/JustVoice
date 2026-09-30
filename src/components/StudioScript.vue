<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Script — the chapter grid (Slice 3, §8.24 3b). Where Script opens.

  Script answers one question: who says each line. This page is one row per
  chapter — how many lines, when it was analyzed, how its lines were decided,
  how many are flagged or have no speaker, and what state it is in. You tick
  chapters and run Analyze on them; rows fill in as each chapter finishes, and
  the run survives leaving the page (services/chapterRun.js — the same run
  Discover's scan uses). A row opens the chapter page (StudioScriptChapter).

  The numbers are the server's (GET /v1/projects/{id}/script), computed by the
  same flag function the attribution eval scores, on ONE "analyzed" rule:
  Analyze has run on the chapter. A chapter whose speakers came with the
  import is "from the import" and is never flagged.
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import {
  AiTaskStrip, UiButton, UiCheckbox, UiChip, UiProgress, UiSelect, UiTable, UiTag, useAiTasksStore,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { useCopy } from "../services/copy.js";
import { routeWords } from "../services/attribution.js";
import { cancelRun, chapterRunFor, failureOf, inRun, queueChapters } from "../services/chapterRun.js";
import { useKeptScroll } from "../composables/useKeptScroll.js";

const props = defineProps({
  project: { type: Object, required: true },
  // GET /v1/projects/{id}/script → chapters. Studio owns the fetch, because
  // Overview reads the same rows.
  chapters: { type: Array, default: () => [] },
  // The scene rows (for the text and metadata a run needs).
  scenes: { type: Array, default: () => [] },
  // The cast, [{id, name, narrator}] — a cast of only the Narrator blocks Analyze.
  cast: { type: Array, default: () => [] },
  // The chip to open on ("check" from Overview's and Home's numbers).
  filter: { type: String, default: "all" },
});
const emit = defineEmits(["open", "go", "update:filter"]);

const api = useApi();
const copy = useCopy();
const tasks = useAiTasksStore();
// Kept alive in Studio: coming back from another step finds the grid as you
// left it, scrolled where it was.
const root = ref(null);
useKeptScroll(root);
const word = computed(() => copy.value.chapter);
const lower = (n, w = word.value) => (n === 1 ? w.singular : w.plural).toLowerCase();

// ── The run ──────────────────────────────────────────────────────────────
const run = computed(() => chapterRunFor(props.project.id));
const running = computed(() => !!run.value?.current);
const runTask = computed(() =>
  tasks.visibleTasks.find((t) => t.inline && t.meta?.run && t.meta?.projectId === props.project.id
    && t.feature === "speaker_attribution") || null);

// A second's tick for the elapsed times while a run is going.
const now = ref(Date.now());
let timer = null;
watch(running, (on) => {
  clearInterval(timer);
  if (on) timer = setInterval(() => { now.value = Date.now(); }, 1000);
}, { immediate: true });

function secs(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
const runLine = computed(() => {
  const r = run.value;
  if (!r?.current) return "";
  const elapsed = now.value - r.startedAt;
  const bits = [`${r.current.title || word.value.singular}`, `${r.finished} of ${r.total} done`, secs(elapsed)];
  // Only once a chapter has finished is there anything to estimate from.
  if (r.finished > 0) bits.push(`about ${secs((elapsed / r.finished) * (r.total - r.finished))} left`);
  return bits.join(" · ");
});

// ── The rows ─────────────────────────────────────────────────────────────
const sceneById = computed(() => Object.fromEntries(props.scenes.map((s) => [s.id, s])));
const titleOf = (c) => `${c.position + 1} · ${c.title || `${word.value.singular} ${c.position + 1}`}`;

function stateOf(c) {
  const where = inRun(props.project.id, c.scene_id);
  const failed = failureOf(props.project.id, c.scene_id);
  const out = new Set();
  if (where) out.add(where === "current" ? "running" : "queued");
  if (!c.lines || c.no_dialogue_found || (failed && failed.kind === "analyze")) out.add("problem");
  if (c.analyzed || c.from_import) {
    if (c.to_check || (c.from_import && c.no_speaker)) out.add("check");
  } else if (c.lines) {
    out.add("never");
  }
  if (c.added_since?.length) out.add("stale");
  return out;
}
const rows = computed(() => props.chapters.map((c) => ({ ...c, id: c.scene_id, states: stateOf(c) })));

const CHIPS = [
  { id: "all", label: "All", tip: "" },
  { id: "check", label: "To check", tip: "Chapters with flagged lines or lines with no speaker" },
  { id: "never", label: "Not analyzed", tip: "" },
  { id: "stale", label: "Re-analyze", tip: "A speaker was added since, and the text names them" },
  { id: "problem", label: "Needs attention", tip: "Failed, can't re-cut, no text, or no dialogue found" },
];
const chip = ref(props.filter || "all");
watch(() => props.filter, (f) => { chip.value = f || "all"; });
function pickChip(id) {
  chip.value = id;
  emit("update:filter", id);
}
const chipCount = (id) => (id === "all" ? rows.value.length : rows.value.filter((r) => r.states.has(id)).length);
const shown = computed(() => (chip.value === "all" ? rows.value : rows.value.filter((r) => r.states.has(chip.value))));

// ── Ticking ──────────────────────────────────────────────────────────────
const ticked = ref({});
watch(() => props.project.id, () => { ticked.value = {}; });
// A chapter in the run, or with no text, can't be ticked.
const canTick = (r) => !!r.lines && !inRun(props.project.id, r.scene_id);
const shownTickable = computed(() => shown.value.filter(canTick));
const allShownTicked = computed(() => shownTickable.value.length > 0 && shownTickable.value.every((r) => ticked.value[r.id]));
function tickShown(on) {
  // Select-all ticks only the chapters shown; the hidden ones keep their state.
  const next = { ...ticked.value };
  for (const r of shownTickable.value) next[r.id] = on;
  ticked.value = next;
}
const picked = computed(() => rows.value.filter((r) => ticked.value[r.id] && canTick(r)));
const pickedLines = computed(() => picked.value.reduce((n, r) => n + (r.lines || 0), 0));

// ── Analyze: what it will read, and what stops it ────────────────────────
const config = ref(null);   // GET /v1/extraction/config
const route = ref("");      // "" = Auto
onMounted(async () => {
  config.value = await api.safeRequest("/v1/extraction/config", null);
});
const autoRoute = computed(() => config.value?.auto_picked || "");
const ROUTE_OPTIONS = computed(() => [
  { value: "", label: `Read: chosen for your model (${routeWords(autoRoute.value) || "…"})` },
  { value: "guided", label: "Read: with examples" },
  { value: "direct", label: "Read: rules only" },
]);
const floor = computed(() => {
  const name = route.value || autoRoute.value;
  return config.value?.routes?.find((r) => r.name === name)?.confidence_floor;
});
// No model: the route Auto would run names no model at all.
const noModel = computed(() => !!config.value && (config.value.auto_checks || []).every((c) => !c.model));
const onlyNarrator = computed(() => props.cast.length > 0 && props.cast.every((c) => c.narrator));
const blocked = computed(() => noModel.value || onlyNarrator.value);

function analyze(list) {
  if (blocked.value || !list.length) return;
  const n = queueChapters({
    projectId: props.project.id,
    kind: "analyze",
    chapters: list.map((r) => sceneById.value[r.scene_id] || { id: r.scene_id, title: r.title }),
    route: route.value || null,
  });
  if (n) {
    const next = { ...ticked.value };
    for (const r of list) delete next[r.id];
    ticked.value = next;
  }
}

// ── Columns ──────────────────────────────────────────────────────────────
// Number columns hug their content; the chapter's name takes the rest.
const RIGHT = { textAlign: "right", whiteSpace: "nowrap", width: "1%" };
const COLUMNS = computed(() => [
  { id: "sel", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "title", header: word.value.singular },
  { id: "lines", header: "Lines", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "analyzed", header: "Analyzed", headerStyle: { width: "1%", whiteSpace: "nowrap" }, cellStyle: { whiteSpace: "nowrap" } },
  { id: "anchored", header: "Book says", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "guessed", header: "AI decided", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "flagged", header: "Flagged", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "none", header: "No speaker", headerStyle: RIGHT, cellStyle: RIGHT },
  { id: "acts", header: "", headerStyle: { width: "1%" }, cellStyle: { whiteSpace: "nowrap", textAlign: "right" } },
]);

function ago(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  const d = Math.floor(ms / 86_400_000);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
// Numbers only mean something once Analyze decided them (or the import did).
const counted = (r) => r.analyzed && !r.no_dialogue_found;
const recut = (f) => /re-cut/i.test(f?.reason || "");
// Text is added in Chapters, not here.
function addText() {
  window.location.hash = "#chapter";
}
function openRow(r, focus = null) {
  if (!r.lines || inRun(props.project.id, r.scene_id) === "current") return;
  if (!r.analyzed && !r.from_import) return;
  emit("open", r.scene_id, focus);
}
</script>

<template>
  <section ref="root" class="studio-script">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Who says what</h3>
        <span class="jv-hint">{{ rows.reduce((n, r) => n + (r.lines || 0), 0).toLocaleString() }} lines ·
          {{ rows.length }} {{ lower(rows.length) }}</span>
      </div>
      <div class="jv-card__body">
        <p class="jv-lede">
          Attribution only — which speaker says each line, and what the line says. How it is
          performed, and rendering it, come later.
        </p>

        <div v-if="run?.current" class="jv-banner studio-script__run">
          <strong>✨ {{ run.current.kind === "analyze" ? "Analyze" : "Discover" }} · {{ run.total }} {{ lower(run.total) }}</strong>
          <span class="jv-hint">{{ runLine }}</span>
          <UiProgress class="studio-script__bar" :value="run.finished" :max="run.total" bare />
          <span class="jv-hint">Keeps running while you work elsewhere.</span>
          <span class="jv-spacer" />
          <UiButton intent="secondary" size="small" label="Cancel"
            title="Stops the run. Chapters already analyzed are kept."
            @click="cancelRun(project.id)" />
        </div>
        <AiTaskStrip v-if="runTask" :task="runTask" />

        <div v-if="!rows.length" class="jv-banner">
          No {{ word.plural.toLowerCase() }} yet — add or import them in
          <a href="#chapter">{{ word.plural }}</a> first.
        </div>
        <template v-else>
          <div class="jv-inline-row studio-script__chips">
            <UiChip v-for="c in CHIPS" :key="c.id" :selected="chip === c.id" :title="c.tip"
              @click="pickChip(c.id)">{{ c.label }} {{ chipCount(c.id) }}</UiChip>
            <span class="jv-hint">Select-all ticks only the {{ word.plural.toLowerCase() }} shown.</span>
          </div>

          <UiTable class="jv-table-look studio-script__grid" :data="shown" :columns="COLUMNS" data-key="id"
            row-hover :row-class="(r) => ({ 'studio-script__row--open': r.analyzed || r.from_import })"
            @row-click="({ data }) => openRow(data)">
            <template #head-sel>
              <UiCheckbox :model-value="allShownTicked" :disabled="!shownTickable.length"
                :title="`Tick every ${word.singular.toLowerCase()} shown`" @update:model-value="tickShown" />
            </template>
            <template #sel="{ row }">
              <span @click.stop>
                <UiCheckbox :model-value="!!ticked[row.id] && canTick(row)" :disabled="!canTick(row)"
                  :title="!row.lines ? 'No text to analyze' : inRun(project.id, row.scene_id) ? 'In the current run' : ''"
                  @update:model-value="(v) => (ticked = { ...ticked, [row.id]: v })" />
              </span>
            </template>
            <template #title="{ row }">
              <strong>{{ titleOf(row) }}</strong>
              <div v-if="row.no_dialogue_found" class="jv-hint studio-script__why">
                Nothing in its text was read as speech, so every line went to the Narrator.
              </div>
              <div v-else-if="failureOf(project.id, row.scene_id)?.kind === 'analyze'" class="jv-hint studio-script__why">
                {{ failureOf(project.id, row.scene_id).reason }}
              </div>
            </template>
            <template #lines="{ row }">
              <span v-if="row.lines" class="jv-mono">{{ row.lines.toLocaleString() }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #analyzed="{ row }">
              <UiTag v-if="inRun(project.id, row.scene_id) === 'current'" intent="solid">analyzing…</UiTag>
              <UiTag v-else-if="inRun(project.id, row.scene_id) === 'queued'" intent="ghost">queued</UiTag>
              <span v-else-if="!row.lines" class="jv-muted">no text yet</span>
              <template v-else>
                <span v-if="row.analyzed_at" class="jv-muted" :title="new Date(row.analyzed_at).toLocaleString()">{{ ago(row.analyzed_at) }}</span>
                <span v-else-if="row.analyzed" class="jv-muted">analyzed</span>
                <span v-else-if="row.from_import" class="jv-muted"
                  title="The script named its speakers, so there was nothing to analyze.">from the import</span>
                <span v-else class="jv-muted">never</span>
                <template v-if="failureOf(project.id, row.scene_id)?.kind === 'analyze'">
                  <UiTag v-if="recut(failureOf(project.id, row.scene_id))" intent="danger"
                    :title="failureOf(project.id, row.scene_id).reason">can't re-cut</UiTag>
                  <UiTag v-else intent="danger" :title="failureOf(project.id, row.scene_id).reason">failed</UiTag>
                </template>
                <UiTag v-for="n in row.added_since" :key="n" intent="accent2"
                  :title="`Analyzed before ${n} joined the cast, and this ${word.singular.toLowerCase()}'s text names ${n} — Analyze could not choose ${n} then.`">{{ n }} added since</UiTag>
                <UiTag v-if="row.no_dialogue_found" intent="accent2"
                  title="Nothing in this chapter was read as speech. Speech after a dash isn't read as dialogue, and neither are marks other than Overview → Speech marks is set to.">no dialogue found</UiTag>
              </template>
            </template>
            <template #anchored="{ row }">
              <span v-if="counted(row)" class="jv-mono">{{ row.anchored }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #guessed="{ row }">
              <span v-if="counted(row)" class="jv-mono">{{ row.guessed }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #flagged="{ row }">
              <UiTag v-if="counted(row) && row.flagged" intent="danger">{{ row.flagged }}</UiTag>
              <span v-else-if="counted(row)" class="jv-muted">0</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #none="{ row }">
              <UiTag v-if="(row.analyzed || row.from_import) && row.no_speaker" intent="danger">{{ row.no_speaker }}</UiTag>
              <span v-else-if="row.analyzed || row.from_import" class="jv-muted">0</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #acts="{ row }">
              <span class="studio-script__acts" @click.stop>
                <UiButton v-if="!row.lines" intent="secondary" size="small" label="＋ Add text"
                  title="Paste or import its text first" @click="addText" />
                <template v-else>
                  <UiButton v-if="recut(failureOf(project.id, row.scene_id))" intent="secondary" size="small"
                    label="Takes ➜" title="The takes recorded against this chapter's lines" @click="emit('go', 'render')" />
                  <UiButton v-if="row.added_since?.length && !inRun(project.id, row.scene_id)" intent="primary" size="small"
                    label="Re-analyze" :disabled="blocked"
                    :title="blocked ? '' : `Re-analyze ${row.title || ''} — lines you set are kept.`"
                    @click="analyze([row])" />
                  <UiButton intent="secondary" size="small" label="Review"
                    :disabled="(!row.analyzed && !row.from_import) || inRun(project.id, row.scene_id) === 'current'"
                    :title="inRun(project.id, row.scene_id) === 'current' ? 'Wait for it to finish'
                      : (!row.analyzed && !row.from_import) ? 'Analyze it first'
                      : row.to_check ? 'Opens the chapter at its first line to check' : ''"
                    @click="openRow(row, row.to_check ? 'check' : null)" />
                </template>
              </span>
            </template>
            <template #empty>No {{ word.plural.toLowerCase() }} in this view.</template>
          </UiTable>

          <div class="jv-inline-row studio-script__go">
            <UiButton intent="primary" :disabled="!picked.length || blocked"
              :label="picked.length ? `✨ Analyze ${picked.length} ${lower(picked.length)}` : '✨ Analyze'"
              @click="analyze(picked)" />
            <template v-if="noModel">
              <span class="jv-hint">Analyze needs a language model.
                <a href="#/ai">Set one in AI Settings ➜</a></span>
            </template>
            <template v-else-if="onlyNarrator">
              <span class="jv-hint">Your cast has only the Narrator, so Analyze has nobody to choose from.
                Find the speakers first — <a href="#studio" @click.prevent="emit('go', 'discover')">Discover ➜</a></span>
            </template>
            <template v-else>
              <span class="jv-hint">
                {{ picked.length
                  ? `${pickedLines.toLocaleString()} lines · ${run?.current ? "starts after the current run" : `one model call per ${word.singular.toLowerCase()}`} · each row fills in as its ${word.singular.toLowerCase()} finishes`
                  : `Pick at least one ${word.singular.toLowerCase()}.` }}
              </span>
              <UiSelect v-model="route" width="name" :options="ROUTE_OPTIONS"
                title="How the model reads: with worked examples, or with the rules only. Auto picks by the model's size." />
              <span v-if="floor != null" class="jv-hint">Keeps answers above {{ floor }}</span>
            </template>
          </div>
        </template>
      </div>
    </div>

    <div class="jv-card jv-card--soft">
      <div class="jv-card__header"><h3 class="jv-card__title">What these columns mean</h3></div>
      <div class="jv-card__body">
        <dl class="jv-deflist">
          <dt>Book says</dt>
          <dd class="jv-muted">Lines whose speaker the book names right next to them — “said Marius” — or
            elsewhere in the same paragraph. Most speech has no name beside it: “she said” and a gesture
            before the line name nobody.</dd>
          <dt>AI decided</dt>
          <dd class="jv-muted">Lines whose speaker the AI worked out from the story around them. Most spoken
            lines are decided this way, and the AI is right on nearly all of them — but it can be sure and
            wrong, so its confidence alone is not a warning.</dd>
          <dt>Flagged</dt>
          <dd class="jv-muted">Lines where the AI most often goes wrong, so you know where to read closely:
            one person speaking three times with no reply, a speaker's only line in the
            {{ word.singular.toLowerCase() }}, the book and the AI naming different speakers. These are the
            lines worth your eyes.</dd>
          <dt>No speaker</dt>
          <dd class="jv-muted">The AI wasn't sure, or gave no answer. These block rendering.</dd>
          <dt>from the import</dt>
          <dd class="jv-muted">The script named its speakers, so there was nothing to analyze. The checks
            above run only on what Analyze decided.</dd>
          <dt>added since</dt>
          <dd class="jv-muted">Analyzed before that speaker was added, and the text names them.
            Re-analyze it — lines you set are kept.</dd>
          <dt>no dialogue found</dt>
          <dd class="jv-muted">Nothing in the text was read as speech, so every line went to the Narrator.
            Speech after a dash isn't read as dialogue. If the book marks speech another way than Overview →
            Speech marks is set to, change the setting and re-analyze — unless you've edited this chapter's
            lines: then it keeps them, and a new setting won't cut it again.</dd>
          <dt>can't re-cut</dt>
          <dd class="jv-muted">Analyzing would cut this chapter's lines differently from the ones that have
            takes, and that would delete those takes, so it stops.</dd>
          <dt>failed</dt>
          <dd class="jv-muted">The AI call failed. The reason is on the row, and nothing was saved.</dd>
        </dl>
      </div>
    </div>
  </section>
</template>

<style scoped>
.studio-script { display: flex; flex-direction: column; gap: 14px; }
.studio-script__run { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.studio-script__bar { flex: 0 1 220px; min-width: 120px; }
.studio-script__chips { gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
.studio-script__grid { margin: 0 0 12px; }
.studio-script__grid :deep(.studio-script__row--open) { cursor: pointer; }
.studio-script__why { max-width: 60ch; margin-top: 3px; }
.studio-script__acts { display: inline-flex; gap: 6px; }
.studio-script__go { gap: 10px; align-items: center; flex-wrap: wrap; }
</style>
