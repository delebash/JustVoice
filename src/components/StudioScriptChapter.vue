<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Script — one chapter (Slice 3, §8.24 3c).

  The app's own table, in reading order: one row is one line, with a speaker
  dropdown on every row, and the columns Speaker · Decided by · Text ·
  Confidence · Check. "Decided by" shows the evidence — the book's own words
  when it names the speaker (“said Marius”), otherwise "AI, from the story
  around it". A line where the AI most often goes wrong is tinted and asks its
  question in the Check column, with "Show the lines around" and an optional
  "Looks right". Ticking rows changes several lines at once; "Next to check"
  jumps to the next such line. The keys are an extra behind "Shortcuts".

  Everything that decides what a row shows, what a key does and what a change
  sends lives in views/scriptReview.js (pure, unit-tested); the lines, their
  flags and the counts come from GET /v1/scenes/{id}/script and are re-read
  after every change. Rewrite in character stays on the Text cell's
  right-click until Slice 4 moves it to Render (the parent owns its modal).
  Direction, takes and rendering are Render's, never Script's.
-->
<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import {
  AiTaskStrip, AppModal, UiButton, UiCheckbox, UiChip, UiSelect, UiTable, UiTag, pushToast,
  useAiTasksStore,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import { useCopy } from "../services/copy.js";
import { routeWords } from "../services/attribution.js";
import { useKeptScroll } from "../composables/useKeptScroll.js";
import { inRun, onChapterDone, queueChapters } from "../services/chapterRun.js";
import {
  KEYS, applyLocally, checkQuestion, confidenceCell, confirm, decidedBy, filterCounts, keyAction,
  markOf, move, nextToCheck, numberKeys, popUndo, pushUndo, setSpeaker, speakerOptions, swap,
  swapState, toCheck, visibleLines, wasBefore,
} from "../views/scriptReview.js";

const props = defineProps({
  project: { type: Object, required: true },
  sceneId: { type: String, required: true },
  // The grid's rows (GET /v1/projects/{id}/script) — for previous / next.
  chapters: { type: Array, default: () => [] },
  scenes: { type: Array, default: () => [] },
  // [{id, name, narrator}] — a cast of only the Narrator blocks Analyze.
  cast: { type: Array, default: () => [] },
  // Where to land: "check" (first line to check) · "none" (first line with no speaker).
  focus: { type: String, default: null },
  // Bumped by the parent when it changed a line itself (a rewrite).
  version: { type: Number, default: 0 },
});
const emit = defineEmits(["back", "open", "go", "changed", "cast-changed", "rewrite"]);

const api = useApi();
const copy = useCopy();
const tasks = useAiTasksStore();
const word = computed(() => copy.value.chapter);

// ── The page ─────────────────────────────────────────────────────────────
const page = ref(null);
const lines = ref([]);
const loading = ref(false);
const loadError = ref("");

async function load() {
  const id = props.sceneId;
  loading.value = true;
  try {
    const r = await api.request(`/v1/scenes/${id}/script`);
    if (id !== props.sceneId) return;     // switched chapters mid-load
    page.value = r;
    lines.value = r.lines || [];
    loadError.value = "";
  } catch (e) {
    loadError.value = String(e?.message || e);
  } finally {
    loading.value = false;
  }
}

const filter = ref("all");
const speaker = ref("all");
const around = ref(false);
const selected = ref(null);
const ticked = ref({});
const undoStack = ref([]);
const justRan = ref(null);      // {route_used, route_source, confidence_floor} after a run here

async function openChapter() {
  // Leaving the chapter clears its undo (approved: "since you opened the chapter").
  undoStack.value = [];
  ticked.value = {};
  around.value = false;
  speaker.value = "all";
  justRan.value = null;
  selected.value = null;
  await load();
  if (props.focus === "check") {
    filter.value = "check";
    selected.value = nextToCheck(lines.value, null, 1);
  } else if (props.focus === "none") {
    filter.value = "none";
    selected.value = lines.value.find((ln) => ln.speakable && !ln.marker && !ln.persona_id)?.id ?? null;
  } else {
    filter.value = "all";
  }
  scrollToSelected();
}
watch(() => [props.sceneId, props.focus], openChapter, { immediate: true });
watch(() => props.version, load);

const chapter = computed(() => page.value?.chapter || null);
const groups = computed(() => page.value?.flag_groups || []);
const speakers = computed(() => page.value?.speakers || []);
const narratorId = computed(() => page.value?.narrator_id || null);
const nameOf = (id) => speakers.value.find((s) => s.persona_id === id)?.name || (id ? "someone not in the cast" : "nobody");

const counts = computed(() => filterCounts(lines.value));
const shown = computed(() =>
  visibleLines(lines.value, { filter: filter.value, speaker: speaker.value, around: around.value }));

// ── What stops Analyze (the same two states the grid shows) ──────────────
const config = ref(null);
onMounted(async () => { config.value = await api.safeRequest("/v1/extraction/config", null); });
const noModel = computed(() => !!config.value && (config.value.auto_checks || []).every((c) => !c.model));
const onlyNarrator = computed(() => props.cast.length > 0 && props.cast.every((c) => c.narrator));

// ── Header words ─────────────────────────────────────────────────────────
function ago(iso) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} h ago`;
  const d = Math.floor(ms / 86_400_000);
  return d === 1 ? "yesterday" : `${d} days ago`;
}
const title = computed(() => {
  const c = chapter.value;
  return c ? `${c.position + 1} · ${c.title || `${word.value.singular} ${c.position + 1}`}` : "";
});
const subline = computed(() => {
  const c = chapter.value;
  if (!c) return "";
  const bits = [`${c.lines.toLocaleString()} lines`, `${c.spoken.toLocaleString()} spoken`];
  if (c.analyzed_at) bits.push(`analyzed ${ago(c.analyzed_at)}`);
  else if (c.analyzed) bits.push("analyzed");
  else if (c.from_import) bits.push("speakers from the import");
  else bits.push("not analyzed yet");
  if (c.changed) bits.push(`${c.changed} line${c.changed === 1 ? "" : "s"} changed speaker`);
  return bits.join(" · ");
});

// ── The run (Re-analyze this chapter stays on the page) ──────────────────
const runningHere = computed(() => inRun(props.project.id, props.sceneId));
const runTask = computed(() =>
  tasks.visibleTasks.find((t) => t.inline && t.meta?.run && t.meta?.sceneId === props.sceneId
    && t.feature === "speaker_attribution") || null);
function reanalyze() {
  const scene = props.scenes.find((s) => s.id === props.sceneId) || { id: props.sceneId, title: chapter.value?.title };
  queueChapters({ projectId: props.project.id, kind: "analyze", chapters: [scene] });
}
const offDone = onChapterDone(({ projectId, sceneId, kind, result }) => {
  if (projectId !== props.project.id || sceneId !== props.sceneId || kind !== "analyze") return;
  if (result) {
    justRan.value = { route_used: result.route_used, route_source: result.route_source, floor: result.confidence_floor };
    // The lines may have been re-cut; nothing in the undo stack is safe to replay.
    undoStack.value = [];
    ticked.value = {};
  }
  load();
});

// ── Sending changes ──────────────────────────────────────────────────────
const busy = ref(false);

async function send(changes, label) {
  if (!changes.length || busy.value) return;
  // On a chapter Analyze never ran on, a speaker you give is not marked as
  // yours: `corrected` freezes a line against every future Analyze, and there
  // it would make attribution impossible for the lines you touched — the same
  // rule the render blocker's "Assign all" has always kept.
  if (chapter.value && !chapter.value.analyzed) {
    changes = changes.map((c) => {
      const { source: _drop, ...after } = c.after;
      return { ...c, after };
    }).filter((c) => Object.keys(c.after).length);
    if (!changes.length) return;
  }
  busy.value = true;
  const before = lines.value;
  lines.value = applyLocally(lines.value, changes);
  let failed = 0;
  const sent = [];
  for (const c of changes) {
    try {
      const r = await api.request(`/v1/blocks/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c.after),
      });
      sent.push({ ...c, fixId: r?.fix_id || null });
    } catch {
      failed += 1;
    }
  }
  undoStack.value = pushUndo(undoStack.value, sent, label);
  busy.value = false;
  if (failed) {
    lines.value = before;
    pushToast({ message: `${failed} of ${changes.length} change${changes.length === 1 ? "" : "s"} didn't save.`, kind: "error" });
  }
  await load();
  emit("changed");
}

function setOne(line, personaId) {
  if (!personaId) return;
  selected.value = line.id;
  send(setSpeaker(lines.value, [line.id], personaId), "speaker");
}
function looksRight(line, whole) {
  const ids = whole ? markOf(groups.value, lines.value, line.id) : [line.id];
  send(confirm(lines.value, ids), "looks right");
}
const tickedIds = computed(() => lines.value.filter((ln) => ticked.value[ln.id]).map((ln) => ln.id));
const bulkSpeaker = ref(null);
function setTicked(personaId) {
  if (!personaId) return;
  send(setSpeaker(lines.value, tickedIds.value, personaId), "speaker");
  bulkSpeaker.value = null;
  ticked.value = {};
}
const swapCheck = computed(() => swapState(lines.value, tickedIds.value));
function swapTicked() {
  send(swap(lines.value, tickedIds.value), "swap");
  ticked.value = {};
}
function confirmTicked() {
  send(confirm(lines.value, tickedIds.value), "looks right");
  ticked.value = {};
}
const noSpeakerIds = computed(() => lines.value.filter((ln) => ln.speakable && !ln.marker && !ln.persona_id).map((ln) => ln.id));
function allToNarrator() {
  if (narratorId.value) send(setSpeaker(lines.value, noSpeakerIds.value, narratorId.value), "narrator");
}

async function undo() {
  const u = popUndo(undoStack.value);
  if (!u.entry || busy.value) return;
  busy.value = true;
  undoStack.value = u.rest;
  let failed = 0;
  for (const p of u.patches) {
    try {
      await api.request(`/v1/blocks/${p.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p.body),
      });
    } catch { failed += 1; }
  }
  // Taking a change back takes back the fix it taught the next Analyze.
  for (const fx of u.fixIds) {
    try { await api.request(`/v1/projects/${props.project.id}/corrections/${fx}`, { method: "DELETE" }); } catch { /* already gone */ }
  }
  busy.value = false;
  pushToast({
    message: failed ? `Undo: ${failed} line${failed === 1 ? "" : "s"} couldn't be put back.` : "Undone — your last change is back as it was.",
    kind: failed ? "warning" : "success",
  });
  await load();
  emit("changed");
}

async function putBackInCast(s) {
  try {
    await api.request(`/v1/projects/${props.project.id}/cast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: s.persona_id }),
    });
    pushToast({ message: `${s.name} is back in this cast — their ${s.lines} line${s.lines === 1 ? "" : "s"} keep their speaker.`, kind: "success" });
    emit("cast-changed");
    await load();
  } catch (e) {
    pushToast({ message: `Couldn't add ${s.name}: ${e?.message || e}`, kind: "error" });
  }
}

// ── Moving around ────────────────────────────────────────────────────────
function scrollToSelected() {
  nextTick(() => {
    const el = selected.value && document.querySelector(`[data-script-line="${selected.value}"]`);
    el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
  });
}
function select(id) {
  if (!id) return;
  selected.value = id;
  // Keep it visible: a filter that hides it steps aside.
  if (!shown.value.some((ln) => ln.id === id)) {
    filter.value = "all";
    speaker.value = "all";
  }
  scrollToSelected();
}
// Wraps past either end (decided 2026-09-29): a lone line to check is always
// reached, even when it is the one selected — it scrolls back into view.
function nextCheck(dir = 1) {
  const id = nextToCheck(lines.value, selected.value, dir);
  if (!id) {
    pushToast({ message: "Nothing to check in this chapter.", kind: "info" });
    return;
  }
  const from = lines.value.findIndex((ln) => ln.id === selected.value);
  const to = lines.value.findIndex((ln) => ln.id === id);
  const wrapped = from >= 0 && (dir > 0 ? to <= from : to >= from);
  select(id);
  if (wrapped && counts.value.check > 1) {
    pushToast({
      message: dir > 0 ? "Back to the first line to check." : "Back to the last line to check.",
      kind: "info",
    });
  }
}
function showAround(line) {
  // Every line back, this one selected.
  filter.value = "all";
  speaker.value = "all";
  around.value = false;
  select(line.id);
}

const order = computed(() => [...props.chapters].sort((a, b) => a.position - b.position));
const at = computed(() => order.value.findIndex((c) => c.scene_id === props.sceneId));
const prevChapter = computed(() => order.value[at.value - 1] || null);
const nextChapter = computed(() => order.value[at.value + 1] || null);
const chapterName = (c) => `${c.position + 1} · ${c.title || `${word.value.singular} ${c.position + 1}`}`;
function goChapter(delta) {
  const c = delta < 0 ? prevChapter.value : nextChapter.value;
  if (c) emit("open", c.scene_id, c.to_check ? "check" : null);
}

// ── Keys (an extra, behind "Shortcuts") ──────────────────────────────────
const keysOpen = ref(false);
function inField(target) {
  const el = target instanceof Element ? target : null;
  if (!el) return false;
  return !!el.closest("input, textarea, select, [contenteditable='true'], [role='combobox'], [role='listbox'], .ui-select-content");
}
function onButton(target) {
  const el = target instanceof Element ? target : null;
  return !!el?.closest("button, a[href], [role='button'], [role='checkbox'], [role='menuitem']");
}
const root = ref(null);
// Kept alive in Studio: coming back from another step finds the page scrolled
// where you left it.
useKeptScroll(root);
function onKey(ev) {
  if (keysOpen.value || document.querySelector(".ui-modal")) return;
  // Studio is kept alive behind other views: never act from off screen.
  if (!root.value || root.value.offsetParent === null) return;
  // A focused button, link or checkbox keeps its own Enter and Space.
  if ((ev.key === "Enter" || ev.key === " ") && onButton(ev.target)) return;
  const a = keyAction(ev, inField(ev.target));
  if (!a) return;
  const line = lines.value.find((ln) => ln.id === selected.value);
  ev.preventDefault();
  switch (a.type) {
    case "move": select(move(shown.value, selected.value, a.delta)); break;
    case "next": nextCheck(a.dir); break;
    case "speaker": {
      if (!line) break;
      const pid = a.n === 0 ? narratorId.value : numberKeys(speakers.value, narratorId.value)[a.n - 1];
      if (pid) setOne(line, pid);
      break;
    }
    case "confirm": if (line) looksRight(line, a.whole); break;
    case "tick": if (line) ticked.value = { ...ticked.value, [line.id]: !ticked.value[line.id] }; break;
    case "chapter": goChapter(a.delta); break;
    case "undo": undo(); break;
    default: break;
  }
}
onMounted(() => window.addEventListener("keydown", onKey));
// Studio sits in the app's KeepAlive: leaving the view deactivates this page
// without unmounting it, and its keys must go with it.
onActivated(() => {
  window.removeEventListener("keydown", onKey);
  window.addEventListener("keydown", onKey);
});
onDeactivated(() => window.removeEventListener("keydown", onKey));
onBeforeUnmount(() => {
  window.removeEventListener("keydown", onKey);
  offDone();
});

// ── The table ────────────────────────────────────────────────────────────
const COLUMNS = [
  { id: "tick", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "speaker", header: "Speaker", headerStyle: { width: "15rem" } },
  { id: "by", header: "Decided by", headerStyle: { width: "14rem" } },
  { id: "text", header: "Text" },
  { id: "conf", header: "Confidence", headerStyle: { width: "1%", whiteSpace: "nowrap" }, cellStyle: { whiteSpace: "nowrap" } },
  { id: "check", header: "Check", headerStyle: { width: "20rem" } },
];
const allShownTicked = computed(() => {
  const list = shown.value.filter((ln) => ln.speakable && !ln.marker);
  return list.length > 0 && list.every((ln) => ticked.value[ln.id]);
});
function tickShown(on) {
  const next = { ...ticked.value };
  for (const ln of shown.value) if (ln.speakable && !ln.marker) next[ln.id] = on;
  ticked.value = next;
}
function rowClass(ln) {
  const i = shown.value.indexOf(ln);
  const nxt = shown.value[i + 1];
  return {
    "jv-row--selected": ln.id === selected.value,
    "jv-row--attention": ln.speakable && !ln.marker && !ln.persona_id,
    "jv-row--flag": (ln.flags || []).length > 0,
    // The lines of a paragraph sit together: the divider only under its last line.
    "jv-row--para-open": !!nxt && ln.paragraph != null && nxt.paragraph === ln.paragraph,
    "studio-script-ch__narr": ln.source === "narration",
  };
}
const optionsFor = (ln) => speakerOptions(speakers.value, narratorId.value, ln);
const speakerFilterOptions = computed(() => [
  { value: "all", label: "Every speaker" },
  ...[...speakers.value].filter((s) => s.lines > 0).sort((a, b) => b.lines - a.lines)
    .map((s) => ({ value: s.persona_id, label: `${s.name} · ${s.lines}${s.in_cast ? "" : " · not in this cast"}` })),
]);
const flagged = (ln) => (ln.flags || []).length > 0;
</script>

<template>
  <section ref="root" class="studio-script-ch">
    <div class="jv-inline-row studio-script-ch__crumbs">
      <UiButton intent="ghost" size="small" :label="`← All ${word.plural.toLowerCase()}`" @click="emit('back')" />
    </div>

    <div v-if="loadError && !page" class="jv-banner jv-banner--danger">Couldn't load this {{ word.singular.toLowerCase() }}: {{ loadError }}</div>

    <template v-if="page">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">{{ title }}</h3>
          <span class="jv-hint">{{ subline }}</span>
        </div>
        <div class="jv-card__body">
          <p class="jv-lede">
            <template v-if="justRan?.route_used">
              Just read <strong>{{ routeWords(justRan.route_used) }}</strong>
              {{ justRan.route_source === "auto" ? "(chosen for your model)" : "(you chose it)" }},
              keeping answers above {{ justRan.floor }} confidence.
            </template>
            Script decides who says each spoken line, so each one is voiced by the right persona.
          </p>
          <div class="studio-script-ch__verbs">
            <span class="studio-script-ch__verb">
              <UiButton intent="primary" :disabled="!!runningHere || noModel || onlyNarrator"
                :loading="runningHere === 'current'"
                :label="chapter.analyzed ? `✨ Re-analyze this ${word.singular.toLowerCase()}` : `✨ Analyze this ${word.singular.toLowerCase()}`"
                @click="reanalyze" />
              <span class="jv-hint">
                <template v-if="noModel">Analyze needs a language model. <a href="#/ai">Set one in AI Settings ➜</a></template>
                <template v-else-if="onlyNarrator">Your cast has only the Narrator, so Analyze has nobody to choose from.
                  Find the speakers first — <a href="#studio" @click.prevent="emit('go', 'discover')">Discover ➜</a></template>
                <template v-else-if="runningHere === 'queued'">Queued — starts after the current run.</template>
                <template v-else>Works out who speaks each line, choosing from the cast. Narration is never sent
                  to the model. Lines you set are kept. Stays on this page.</template>
              </span>
            </span>
            <span class="studio-script-ch__verb">
              <UiButton intent="secondary" :label="`📚 Analyze several ${word.plural.toLowerCase()}`" @click="emit('back')" />
              <span class="jv-hint">Opens the {{ word.singular.toLowerCase() }} grid. Pick what to run; each row fills in
                as its {{ word.singular.toLowerCase() }} finishes.</span>
            </span>
            <span class="jv-spacer" />
            <span class="studio-script-ch__verb">
              <UiButton intent="secondary" label="🔍 A speaker is missing" @click="emit('go', 'discover')" />
              <span class="jv-hint">Analyze can only pick personas in the cast. Discover finds names in the text
                that aren't in it yet.</span>
            </span>
          </div>
          <AiTaskStrip v-if="runTask" :task="runTask" />
        </div>
      </div>

      <div v-if="counts.none" class="jv-banner jv-banner--warn studio-script-ch__banner">
        <span><strong>{{ counts.none }} line{{ counts.none === 1 ? " has" : "s have" }} no speaker.</strong>
          The render stops on these rather than dropping them silently — set a speaker on each, or send
          them all to the narrator.</span>
        <span class="jv-spacer" />
        <UiButton intent="secondary" size="small" :disabled="!narratorId || busy"
          :label="`Assign ${counts.none} → ${nameOf(narratorId)}`"
          :title="narratorId ? 'Everything the model couldn\'t place becomes narration.' : 'This project has no Narrator persona — set a speaker on each line instead.'"
          @click="allToNarrator" />
      </div>
      <div v-for="s in chapter.not_in_cast" :key="s.persona_id" class="jv-banner jv-banner--info studio-script-ch__banner">
        <span><strong>{{ s.name }} isn't in this cast.</strong>
          {{ s.lines }} line{{ s.lines === 1 ? "" : "s" }} in this {{ word.singular.toLowerCase() }}
          {{ s.lines === 1 ? "is" : "are" }} theirs. They keep their speaker, but Analyze can't choose them
          and Cast doesn't list them.</span>
        <span class="jv-spacer" />
        <UiButton intent="secondary" size="small" label="Put them back in the cast" @click="putBackInCast(s)" />
      </div>

      <div class="jv-card studio-script-ch__lines">
        <div class="jv-inline-row studio-script-ch__bar">
          <UiChip :selected="filter === 'all'" @click="filter = 'all'">All {{ counts.all }}</UiChip>
          <UiChip :selected="filter === 'check'" title="Flagged lines and lines with no speaker"
            @click="filter = 'check'">To check {{ counts.check }}</UiChip>
          <UiChip :selected="filter === 'none'" @click="filter = 'none'">No speaker {{ counts.none }}</UiChip>
          <UiChip v-if="counts.changed" :selected="filter === 'changed'"
            title="Lines whose speaker the last Analyze changed"
            @click="filter = 'changed'">Changed {{ counts.changed }}</UiChip>
          <UiSelect v-model="speaker" width="name" :options="speakerFilterOptions" />
          <span class="jv-spacer" />
          <UiButton intent="secondary" size="small" label="Next to check ➜"
            title="Jump to the next flagged or no-speaker line (n)" :disabled="!counts.check" @click="nextCheck(1)" />
          <UiButton intent="ghost" size="small" label="⌨ Shortcuts" @click="keysOpen = true" />
        </div>

        <UiTable class="jv-table-look ui-table-top studio-script-ch__table" :data="shown" :columns="COLUMNS"
          data-key="id" :row-class="rowClass" @row-click="({ data }) => (selected = data.id)">
          <template #head-tick>
            <UiCheckbox :model-value="allShownTicked" title="Tick every line shown" @update:model-value="tickShown" />
          </template>
          <template #tick="{ row }">
            <span :data-script-line="row.id" @click.stop>
              <UiCheckbox v-if="row.speakable && !row.marker" :model-value="!!ticked[row.id]"
                @update:model-value="(v) => (ticked = { ...ticked, [row.id]: v })" />
            </span>
          </template>
          <template #speaker="{ row }">
            <span v-if="row.marker" class="jv-muted">—</span>
            <span v-else-if="!row.speakable" class="jv-muted">—</span>
            <span v-else @click.stop>
              <UiSelect :model-value="row.persona_id" width="name" :options="optionsFor(row)"
                placeholder="— no speaker —" :disabled="busy"
                @update:model-value="(v) => setOne(row, v)" />
            </span>
          </template>
          <template #by="{ row }">
            <span :class="{ 'studio-script-ch__ev': decidedBy(row, lines).quoted }" :title="decidedBy(row, lines).tip">{{ decidedBy(row, lines).text }}</span>
            <span v-if="row.source === 'corrected' && wasBefore(undoStack, row.id) !== undefined" class="jv-hint">
              · was {{ wasBefore(undoStack, row.id) ? nameOf(wasBefore(undoStack, row.id)) : "no one" }}</span>
            <div v-if="decidedBy(row, lines).sub" class="jv-hint">{{ decidedBy(row, lines).sub }}</div>
            <div v-if="row.changed">
              <UiTag intent="accent2" title="The last Analyze gave this line a different speaker">changed · was {{ row.prev_persona_id ? nameOf(row.prev_persona_id) : "no one" }}</UiTag>
            </div>
          </template>
          <template #text="{ row }">
            <span class="studio-script-ch__text"
              :title="row.spoken && row.persona_id && row.persona_id !== narratorId ? 'Right-click to rewrite this line in character' : ''"
              @contextmenu.prevent="emit('rewrite', row)">{{ row.text }}</span>
          </template>
          <template #conf="{ row }">
            <UiTag v-if="confidenceCell(row).intent" :intent="confidenceCell(row).intent">{{ confidenceCell(row).text }}</UiTag>
            <span v-else class="jv-muted">—</span>
          </template>
          <template #check="{ row }">
            <template v-if="toCheck(row)">
              <div class="studio-script-ch__q">{{ checkQuestion(row, groups, nameOf, word.singular) }}</div>
              <div v-if="flagged(row)" class="studio-script-ch__qacts" @click.stop>
                <UiButton intent="ghost" size="small" label="👁 Show the lines around"
                  title="Shows every line, with this one selected, so you can read the exchange" @click="showAround(row)" />
                <UiButton intent="secondary" size="small" label="✓ Looks right" :disabled="busy"
                  title="Optional. Removes the mark from every line that shares it and takes them out of To check — the lines render the same either way (Shift+Enter)"
                  @click="looksRight(row, true)" />
              </div>
            </template>
          </template>
          <template #empty>
            {{ loading ? "Loading…" : filter === "check" ? "Nothing to check." : filter === "none" ? "Every line has a speaker." : "No lines here." }}
          </template>
        </UiTable>

        <div class="jv-inline-row studio-script-ch__bar">
          <span class="jv-hint">{{ tickedIds.length ? `${tickedIds.length} ticked` : "Tick lines to change several at once." }}</span>
          <UiSelect v-model="bulkSpeaker" width="name" :disabled="!tickedIds.length || busy"
            placeholder="Set the speaker of ticked lines…" :options="speakerOptions(speakers, narratorId, null)"
            @update:model-value="setTicked" />
          <UiButton intent="secondary" size="small" label="⇄ Swap their two speakers"
            :disabled="!swapCheck.ok || busy"
            :title="swapCheck.ok ? 'For ticked lines spoken by exactly two personas: each line goes to the other one' : swapCheck.reason"
            @click="swapTicked" />
          <UiButton intent="secondary" size="small" label="✓ Looks right" :disabled="!tickedIds.length || busy"
            title="Removes the marks from the ticked lines and makes them yours" @click="confirmTicked" />
          <span class="jv-spacer" />
          <UiButton intent="ghost" size="small" label="↶ Undo" :disabled="!undoStack.length || busy"
            :title="undoStack.length ? `Undo your last change (Ctrl+Z)` : 'Nothing to undo since you opened this chapter'"
            @click="undo" />
          <UiButton intent="ghost" size="small" :label="around ? '👁 Only the lines filtered' : '👁 Show the lines around'"
            :disabled="filter === 'all' && speaker === 'all'"
            title="Shows the lines either side of each line in view" @click="around = !around" />
        </div>
        <p class="jv-hint studio-script-ch__foot">Changing the speaker of a rendered line makes it stale — it
          re-renders, and its old take is kept.</p>
        <div class="jv-inline-row studio-script-ch__bar">
          <UiButton intent="secondary" size="small" :label="`← Previous ${word.singular.toLowerCase()}`"
            :disabled="!prevChapter" :title="prevChapter ? chapterName(prevChapter) : `This is the first ${word.singular.toLowerCase()}`"
            @click="goChapter(-1)" />
          <span class="jv-spacer" />
          <span v-if="nextChapter" class="jv-hint">Next: {{ chapterName(nextChapter) }}{{ nextChapter.to_check ? ` · ${nextChapter.to_check} to check` : "" }}</span>
          <UiButton intent="primary" size="small" :label="`Next ${word.singular.toLowerCase()} ➜`"
            :disabled="!nextChapter" @click="goChapter(1)" />
        </div>
      </div>

      <div class="jv-card jv-card--soft">
        <div class="jv-card__header"><h3 class="jv-card__title">What the columns mean</h3></div>
        <div class="jv-card__body">
          <dl class="jv-deflist">
            <dt>Speaker</dt>
            <dd class="jv-muted">Who says the line. Change it here; a line you set is yours, and Analyze leaves it alone.</dd>
            <dt>Decided by</dt>
            <dd class="jv-muted">Why the line has its speaker. <strong>Narration</strong> — text outside quote marks, read
              by the Narrator. <strong>Words in quotes, like “said Marius”</strong> — the book names the speaker right
              there; you can check it against the text. <strong>AI, from the story around it</strong> — nothing names
              the speaker, so the AI worked it out; most spoken lines are decided this way.
              <strong>You</strong> — you set or confirmed it.</dd>
            <dt>Confidence</dt>
            <dd class="jv-muted">How sure the AI said it was. A low number is worth a look. A high one is not proof —
              the AI has been 100% sure and wrong.</dd>
            <dt>Check</dt>
            <dd class="jv-muted">Where the AI most often goes wrong, so you know where to read closely. Its most common
              mistake is losing track of turns in a back-and-forth — two people alternate, and it gives two lines in
              a row to one of them. So a line is marked when one person speaks three times with no reply, when it
              is a persona's only line in the {{ word.singular.toLowerCase() }}, or when the book and the AI name
              different speakers. The line may well be right: “👁 Show the lines
              around” lets you read the exchange, and “✓ Looks right” (optional) removes the mark — the line
              renders the same either way.</dd>
          </dl>
          <p class="jv-hint">Direction, takes and rendering are <strong>not</strong> on this page. Script decides who
            says what; how it is performed is <a href="#studio" @click.prevent="emit('go', 'render')">Render</a>.</p>
        </div>
      </div>
    </template>

    <AppModal v-if="keysOpen" eyebrow="Script" title="Shortcuts" :max-width="'520px'" dismissable @close="keysOpen = false">
      <p class="jv-hint">An extra — everything here is also a click. The keys act on the selected line
        (click a row to select it), and do nothing while you are typing or a dropdown is open.</p>
      <dl class="jv-deflist">
        <template v-for="[k, what] in KEYS" :key="k">
          <dt><span class="jv-mono">{{ k }}</span></dt>
          <dd class="jv-muted">{{ what }}</dd>
        </template>
      </dl>
      <template #footer>
        <UiButton intent="primary" label="Close" @click="keysOpen = false" />
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.studio-script-ch { display: flex; flex-direction: column; gap: 14px; }
.studio-script-ch__crumbs { gap: 8px; }
.studio-script-ch__verbs { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: flex-start; }
.studio-script-ch__verb { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 34ch; }
.studio-script-ch__banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 0; }
.studio-script-ch__lines { padding: 0; overflow: hidden; }
.studio-script-ch__bar { gap: 8px; flex-wrap: wrap; align-items: center; padding: 11px 14px; }
.studio-script-ch__foot { margin: 0; padding: 0 14px 11px; }
.studio-script-ch__text { display: block; max-width: 60ch; }
.studio-script-ch__ev { font-style: italic; color: var(--ink); }
.studio-script-ch__q { max-width: 40ch; color: var(--ink); }
.studio-script-ch__qacts { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.studio-script-ch__table :deep(.ui-table-row) { cursor: pointer; }
.studio-script-ch__table :deep(.studio-script-ch__narr) td { color: var(--ink-3, var(--ink-2)); }
</style>
