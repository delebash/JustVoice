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

  Chapters themselves are managed here (Studio Slice 4, D7, 2026-10-04 — the
  old Chapters page was deleted): "＋ Add chapter" beside the chips, Rename ·
  Move up · Move down · Delete in each row's ⋯ menu (Personas' ev-kebab menu),
  and "＋ Add text" on a chapter with none — paste it, each paragraph a line.
  "✎ Edit text" in the ⋯ menu reopens a chapter's text (2026-10-05): lines
  left as they are keep everything; changed and new paragraphs become new
  lines with no speaker, counted "changed since" until Re-analyze. A chapter
  with lines opens before Analyze, so its words can be fixed first.
  With no chapters at all, the page offers Import and ＋ Add chapter (G6).

  A book with narration needs a narrator (decided 2026-10-05): ✨ Analyze on a
  book with none asks first (NarratorNeeded.vue), and a book analyzed before it
  had one shows one banner — its narration waiting — with ＋ Add Narrator; that
  narration is not counted as No speaker or To check. The run banner is
  StudioRunBanner.vue, showing only Analyze — Discover's scans share the queue
  and show on Discover (decided 2026-10-05).
-->
<script setup>
import { computed, ref, watch } from "vue";
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal,
  DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger,
} from "reka-ui";
import {
  AppModal, EmptyState, UiButton, UiCheckbox, UiChip, UiSelect, UiTable, UiTag,
  UiTextarea, confirmDialog, promptDialog, pushToast,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { useCopy } from "../services/copy.js";
import { routeWords } from "../services/attribution.js";
import { chapterRunFor, failureOf, inRun, queueChapters } from "../services/chapterRun.js";
import { addNarrator, hasNarrator, narrationOf } from "../services/narrator.js";
import NarratorNeeded from "./NarratorNeeded.vue";
import StudioRunBanner from "./StudioRunBanner.vue";
import { useKeptScroll } from "../composables/useKeptScroll.js";
import { useAnalyzeModel } from "../composables/useAnalyzeModel.js";

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
// `cast-changed` ({ moved }): a narrator was added here, and narration moved to it.
const emit = defineEmits(["open", "go", "update:filter", "changed", "cast-changed"]);

const api = useApi();
const copy = useCopy();
// Kept alive in Studio: coming back from another step finds the grid as you
// left it, scrolled where it was.
const root = ref(null);
useKeptScroll(root);
const word = computed(() => copy.value.chapter);
const lower = (n, w = word.value) => (n === 1 ? w.singular : w.plural).toLowerCase();

// ── The run ──────────────────────────────────────────────────────────────
// Its banner and strip are StudioRunBanner.vue; the grid reads where each
// chapter stands in Analyze's part of it — this page shows only Analyze.
const run = computed(() => chapterRunFor(props.project.id));

// ── The rows ─────────────────────────────────────────────────────────────
const sceneById = computed(() => Object.fromEntries(props.scenes.map((s) => [s.id, s])));
const titleOf = (c) => `${c.position + 1} · ${c.title || `${word.value.singular} ${c.position + 1}`}`;

function stateOf(c) {
  const where = inRun(props.project.id, c.scene_id, "analyze");
  const failed = failureOf(props.project.id, c.scene_id, "analyze");
  const out = new Set();
  if (where) out.add(where === "current" ? "running" : "queued");
  if (!c.lines || c.no_dialogue_found || failed) out.add("problem");
  if (c.analyzed || c.from_import) {
    if (c.to_check || (c.from_import && c.no_speaker)) out.add("check");
  } else if (c.lines) {
    out.add("never");
  }
  if (c.added_since?.length || c.edited_since) out.add("stale");
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
const canTick = (r) => !!r.lines && !inRun(props.project.id, r.scene_id, "analyze");
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
// GET /v1/extraction/config, re-read when the page comes back or a model loads.
const { config, noModel } = useAnalyzeModel();
const route = ref("");      // "" = Auto
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
const onlyNarrator = computed(() => props.cast.length > 0 && props.cast.every((c) => c.narrator));
const blocked = computed(() => noModel.value || onlyNarrator.value);

// A book with narration needs a narrator before Analyze runs (2026-10-05).
const narratorAsk = ref(null);   // the chapters waiting on the answer
const narratorBusy = ref(false);
const narrationWaiting = computed(() => props.chapters.reduce((n, c) => n + (c.narration_waiting || 0), 0));
function analyze(list, { narratorChecked = false } = {}) {
  if (blocked.value || !list.length) return;
  if (!narratorChecked && !hasNarrator(props.cast) && narrationOf(list) > 0) {
    narratorAsk.value = list;
    return;
  }
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

async function addNarratorNow({ thenAnalyze = null } = {}) {
  narratorBusy.value = true;
  const moved = await addNarrator(props.project.id);
  narratorBusy.value = false;
  if (moved === null) return;
  emit("cast-changed", { moved });
  narratorAsk.value = null;
  if (thenAnalyze) analyze(thenAnalyze, { narratorChecked: true });
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
// ── The chapters themselves (D7) ─────────────────────────────────────────
const JSON_HEADERS = { "Content-Type": "application/json" };
const ordered = computed(() => [...props.chapters].sort((a, b) => a.position - b.position));
async function addChapter() {
  const n = props.chapters.length;
  const title = (await promptDialog({
    title: `New ${word.value.singular.toLowerCase()}`,
    label: "Title",
    placeholder: `${word.value.singular} ${n + 1}`,
    confirmLabel: "Add",
  }))?.trim();
  if (!title) return;
  try {
    await api.request(`/v1/projects/${props.project.id}/scenes`, {
      method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ title, position: n }),
    });
    emit("changed");
    pushToast({ kind: "success", message: `“${title}” added — paste its text with ＋ Add text.` });
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't add the ${word.value.singular.toLowerCase()}: ${e?.message || e}` });
  }
}
async function rename(r) {
  const title = (await promptDialog({
    title: `Rename ${word.value.singular.toLowerCase()}`,
    label: "Title",
    defaultValue: r.title || "",
    confirmLabel: "Rename",
  }))?.trim();
  if (!title || title === r.title) return;
  await patchScene(r, { title });
}
function move(r, dir) {
  const target = r.position + dir;
  if (target < 0 || target >= props.chapters.length) return;
  patchScene(r, { position: target });
}
async function patchScene(r, body) {
  try {
    await api.request(`/v1/scenes/${r.scene_id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(body) });
    emit("changed");
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't change the ${word.value.singular.toLowerCase()}: ${e?.message || e}` });
  }
}
async function remove(r) {
  const ok = await confirmDialog({
    title: `Delete “${r.title || titleOf(r)}”?`,
    message: r.lines
      ? `Its ${r.lines.toLocaleString()} lines and every take rendered from them go with it — permanently.`
      : "It has no text yet.",
    danger: true,
    confirmLabel: `Delete ${word.value.singular.toLowerCase()}`,
  });
  if (!ok) return;
  try {
    await api.request(`/v1/scenes/${r.scene_id}`, { method: "DELETE" });
    emit("changed");
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't delete it: ${e?.message || e}` });
  }
}
// ＋ Add text — paste a chapter's text; each paragraph becomes a line with no
// speaker yet, for Analyze to attribute. ✎ Edit text reopens it (decided
// 2026-10-05): the server keeps every line left as it is (PUT /text).
const paste = ref(null);   // { row, text, busy, edit, was }
const paragraphs = computed(() => (paste.value?.text || "").split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean));
function addText(r) {
  paste.value = { row: r, text: "", busy: false, edit: false };
}
async function editText(r) {
  try {
    const { text } = await api.request(`/v1/scenes/${r.scene_id}/text`);
    paste.value = { row: r, text, was: text, busy: false, edit: true };
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't open the text: ${e?.message || e}` });
  }
}
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
async function saveText() {
  const { row, text } = paste.value;
  const put = (dryRun) => api.request(`/v1/scenes/${row.scene_id}/text`, {
    method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ text, dry_run: dryRun }),
  });
  paste.value.busy = true;
  try {
    const plan = await put(true);
    if (!plan.changed && !plan.added && !plan.removed) {
      paste.value = null;
      pushToast({ kind: "info", message: "Nothing changed." });
      return;
    }
    if (plan.takes_lost) {
      const ok = await confirmDialog({
        title: "Delete their takes?",
        message: `${plural(plan.takes_lost, "line")} you changed or removed ${plan.takes_lost === 1 ? "has" : "have"} takes. Saving deletes those takes.`,
        danger: true,
        confirmLabel: "Save and delete the takes",
      });
      if (!ok) { paste.value.busy = false; return; }
    }
    const done = await put(false);
    paste.value = null;
    emit("changed");
    const bits = [done.changed && `${done.changed} changed`, done.added && `${done.added} added`,
      done.removed && `${done.removed} removed`].filter(Boolean).join(", ");
    pushToast({ kind: "success", message: `Saved — ${bits}. ${row.analyzed
      ? "Re-analyze works out who speaks the new lines; lines you set are kept."
      : "✨ Analyze works out who speaks each line."}` });
  } catch (e) {
    if (paste.value) paste.value.busy = false;
    pushToast({ kind: "error", message: `Couldn't save the text: ${e?.message || e}` });
  }
}
async function addLines() {
  const { row } = paste.value;
  const list = paragraphs.value;
  paste.value.busy = true;
  try {
    for (let i = 0; i < list.length; i++) {
      await api.request(`/v1/scenes/${row.scene_id}/blocks`, {
        method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ position: i, text: list[i] }),
      });
    }
    paste.value = null;
    emit("changed");
    pushToast({ kind: "success", message: `${list.length} lines added — ✨ Analyze works out who speaks each one.` });
  } catch (e) {
    paste.value.busy = false;
    pushToast({ kind: "error", message: `Couldn't add the text: ${e?.message || e}` });
  }
}
// Import opens on Projects, the way a new book starts.
function startImport() {
  try { window.sessionStorage?.setItem("jv.projects.openImport", "1"); } catch { /* private mode */ }
  window.location.hash = "#projects";
}
function openRow(r, focus = null) {
  if (!r.lines || inRun(props.project.id, r.scene_id, "analyze") === "current") return;
  // Before Analyze too (decided 2026-10-05), so its words can be fixed first.
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

        <StudioRunBanner :project="project" kind="analyze" />

        <div v-if="narrationWaiting && !hasNarrator(cast)" class="jv-banner jv-banner--warn studio-script__narrator">
          <span><strong>This book has no narrator</strong> — {{ narrationWaiting.toLocaleString() }} lines of narration
            are waiting for one.</span>
          <UiButton intent="primary" size="small" label="＋ Add Narrator" :loading="narratorBusy"
            title="Makes a speaker called Narrator — played by your persona called Narrator if you have one — and gives it the narration"
            @click="addNarratorNow()" />
          <a href="#studio" class="jv-hint" @click.prevent="emit('go', 'cast')">Told in the first person? Tick that speaker on Cast ➜</a>
        </div>

                <EmptyState v-if="!rows.length" icon="Sparkle" :title="`No ${word.plural.toLowerCase()} yet`"
          :message="`Import a manuscript — EPUB, DOCX, Markdown or plain text — and it splits into ${word.plural.toLowerCase()}, with a preview before anything is added. Or add a ${word.singular.toLowerCase()} and paste its text.`"
          compact>
          <template #actions>
            <UiButton intent="primary" label="⬆ Import a manuscript…" @click="startImport" />
            <UiButton intent="secondary" :label="`＋ Add ${word.singular.toLowerCase()}`" @click="addChapter" />
          </template>
        </EmptyState>
        <template v-else>
          <div class="jv-inline-row studio-script__chips">
            <UiChip v-for="c in CHIPS" :key="c.id" :selected="chip === c.id" :title="c.tip"
              @click="pickChip(c.id)">{{ c.label }} {{ chipCount(c.id) }}</UiChip>
            <span class="jv-hint">Select-all ticks only the {{ word.plural.toLowerCase() }} shown.</span>
            <span class="jv-spacer" />
            <UiButton intent="secondary" size="small" :label="`＋ Add ${word.singular.toLowerCase()}`"
              :title="`A new ${word.singular.toLowerCase()} at the end — paste its text next`" @click="addChapter" />
          </div>

          <UiTable class="jv-table-look studio-script__grid" :data="shown" :columns="COLUMNS" data-key="id"
            row-hover :row-class="(r) => ({ 'studio-script__row--open': !!r.lines })"
            @row-click="({ data }) => openRow(data)">
            <template #head-sel>
              <UiCheckbox :model-value="allShownTicked" :disabled="!shownTickable.length"
                :title="`Tick every ${word.singular.toLowerCase()} shown`" @update:model-value="tickShown" />
            </template>
            <template #sel="{ row }">
              <span @click.stop>
                <UiCheckbox :model-value="!!ticked[row.id] && canTick(row)" :disabled="!canTick(row)"
                  :title="!row.lines ? 'No text to analyze' : inRun(project.id, row.scene_id, 'analyze') ? 'Already queued to analyze' : ''"
                  @update:model-value="(v) => (ticked = { ...ticked, [row.id]: v })" />
              </span>
            </template>
            <template #title="{ row }">
              <strong>{{ titleOf(row) }}</strong>
              <div v-if="row.no_dialogue_found" class="jv-hint studio-script__why">
                Nothing in its text was read as speech, so every line went to the Narrator.
              </div>
              <div v-else-if="failureOf(project.id, row.scene_id, 'analyze')" class="jv-hint studio-script__why">
                {{ failureOf(project.id, row.scene_id, 'analyze').reason }}
              </div>
            </template>
            <template #lines="{ row }">
              <span v-if="row.lines" class="jv-mono">{{ row.lines.toLocaleString() }}</span>
              <span v-else class="jv-muted">—</span>
            </template>
            <template #analyzed="{ row }">
              <UiTag v-if="inRun(project.id, row.scene_id, 'analyze') === 'current'" intent="solid">analyzing…</UiTag>
              <UiTag v-else-if="inRun(project.id, row.scene_id, 'analyze') === 'queued'" intent="ghost">queued</UiTag>
              <span v-else-if="!row.lines" class="jv-muted">no text yet</span>
              <template v-else>
                <span v-if="row.analyzed_at" class="jv-muted" :title="new Date(row.analyzed_at).toLocaleString()">{{ ago(row.analyzed_at) }}</span>
                <span v-else-if="row.analyzed" class="jv-muted">analyzed</span>
                <span v-else-if="row.from_import" class="jv-muted"
                  title="The script named its speakers, so there was nothing to analyze.">from the import</span>
                <span v-else class="jv-muted">never</span>
                <template v-if="failureOf(project.id, row.scene_id, 'analyze')">
                  <UiTag v-if="recut(failureOf(project.id, row.scene_id, 'analyze'))" intent="danger"
                    :title="failureOf(project.id, row.scene_id, 'analyze').reason">can't re-cut</UiTag>
                  <UiTag v-else intent="danger" :title="failureOf(project.id, row.scene_id, 'analyze').reason">failed</UiTag>
                </template>
                <UiTag v-for="n in row.added_since" :key="n" intent="accent2"
                  :title="`Analyzed before ${n} was added as a speaker, and this ${word.singular.toLowerCase()}'s text names ${n} — Analyze could not choose ${n} then.`">{{ n }} added since</UiTag>
                <UiTag v-if="row.edited_since" intent="accent2"
                  :title="`${plural(row.edited_since, 'line')} added or changed with ✎ Edit text since the last Analyze, with no speaker yet. Re-analyze works out who speaks them; lines you set are kept.`">{{ row.edited_since }} changed since</UiTag>
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
                  title="Paste its text" @click="addText(row)" />
                <template v-else>
                  <UiButton v-if="recut(failureOf(project.id, row.scene_id, 'analyze'))" intent="secondary" size="small"
                    label="Takes ➜" title="The takes recorded against this chapter's lines" @click="emit('go', 'render')" />
                  <UiButton v-if="(row.added_since?.length || row.edited_since) && !inRun(project.id, row.scene_id, 'analyze')" intent="primary" size="small"
                    label="Re-analyze" :disabled="blocked"
                    :title="blocked ? '' : `Re-analyze ${row.title || ''} — lines you set are kept.`"
                    @click="analyze([row])" />
                  <UiButton intent="secondary" size="small" label="Review"
                    :disabled="(!row.analyzed && !row.from_import) || inRun(project.id, row.scene_id, 'analyze') === 'current'"
                    :title="inRun(project.id, row.scene_id, 'analyze') === 'current' ? 'Wait for it to finish'
                      : (!row.analyzed && !row.from_import) ? 'Analyze it first'
                      : row.to_check ? 'Opens the chapter at its first line to check' : ''"
                    @click="openRow(row, row.to_check ? 'check' : null)" />
                </template>
                <DropdownMenuRoot>
                  <DropdownMenuTrigger class="ev-kebab" :aria-label="`${word.singular} actions`"
                    :title="`${word.singular} actions`">⋯</DropdownMenuTrigger>
                  <DropdownMenuPortal>
                    <DropdownMenuContent class="ev-menu" align="end" :side-offset="4" :collision-padding="8">
                      <DropdownMenuItem class="ev-menu-item"
                        :disabled="!row.lines || inRun(project.id, row.scene_id, 'analyze') === 'current'"
                        @select="editText(row)">✎ Edit text</DropdownMenuItem>
                      <DropdownMenuItem class="ev-menu-item" @select="rename(row)">✏️ Rename</DropdownMenuItem>
                      <DropdownMenuItem class="ev-menu-item" :disabled="row.position === 0" @select="move(row, -1)">↑ Move up</DropdownMenuItem>
                      <DropdownMenuItem class="ev-menu-item" :disabled="row.position >= ordered.length - 1"
                        @select="move(row, 1)">↓ Move down</DropdownMenuItem>
                      <DropdownMenuSeparator class="ev-menu-sep" />
                      <DropdownMenuItem class="ev-menu-item danger" :disabled="inRun(project.id, row.scene_id) === 'current'"
                        @select="remove(row)">🗑 Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenuPortal>
                </DropdownMenuRoot>
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
              <span class="jv-hint">This book's only speaker is the Narrator, so Analyze has nobody to choose from.
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
          <dt>changed since</dt>
          <dd class="jv-muted">Lines added or changed with ✎ Edit text since the last Analyze. They have no
            speaker until you re-analyze — lines you set are kept.</dd>
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

    <AppModal v-if="paste" :eyebrow="paste.edit ? '✎ Edit text' : '＋ Add text'" :title="titleOf(paste.row)"
      max-width="720px" dismissable @close="paste = null">
      <p v-if="paste.edit" class="jv-lede studio-script__paste-lede">
        Each paragraph is a line. Lines you leave as they are keep their speaker and takes; a changed or new
        paragraph becomes a new line with no speaker{{ paste.row.analyzed ? " — Re-analyze works out who speaks it" : "" }}.
      </p>
      <p v-else class="jv-lede studio-script__paste-lede">
        Paste the {{ word.singular.toLowerCase() }}'s text. Each paragraph becomes a line; ✨ Analyze then works out
        who speaks each one.
      </p>
      <UiTextarea v-model="paste.text" :rows="12" :placeholder="`Paste the ${word.singular.toLowerCase()} text…`" />
      <template #footer>
        <span class="jv-hint">{{ paragraphs.length ? `${paragraphs.length} paragraph${paragraphs.length === 1 ? "" : "s"}` : "" }}</span>
        <span class="jv-spacer" />
        <UiButton intent="secondary" label="Cancel" @click="paste = null" />
        <UiButton v-if="paste.edit" intent="primary" label="Save" :loading="paste.busy"
          :disabled="!paragraphs.length || paste.text === paste.was || paste.busy" @click="saveText" />
        <UiButton v-else intent="primary" label="Add as lines" :loading="paste.busy" :disabled="!paragraphs.length || paste.busy"
          @click="addLines" />
      </template>
    </AppModal>

    <NarratorNeeded v-if="narratorAsk" :busy="narratorBusy" @close="narratorAsk = null"
      @cast="narratorAsk = null; emit('go', 'cast')" @add="addNarratorNow({ thenAnalyze: narratorAsk })" />
  </section>
</template>

<style scoped>
.studio-script { display: flex; flex-direction: column; gap: 14px; }
.studio-script__narrator { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.studio-script__chips { gap: 6px; flex-wrap: wrap; margin: 0 0 10px; }
.studio-script__grid { margin: 0 0 12px; }
.studio-script__grid :deep(.studio-script__row--open) { cursor: pointer; }
.studio-script__why { max-width: 60ch; margin-top: 3px; }
.studio-script__acts { display: inline-flex; gap: 6px; align-items: center; }
.studio-script__paste-lede { margin: 0 0 10px; }
.studio-script__go { gap: 10px; align-items: center; flex-wrap: wrap; }
</style>
