<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Render — one chapter's lines (the mock, dev only: #/mock/render/:id). Slice 4,
  decided 2026-10-04 (TASKS "Studio Slice 4"; research docs/plans/2026-09-30-mock-vs-app-and-
  slice-4.md §3). Made from the kit's components on `renderMock.js` — The Ninth Facet, played by
  the persona mock's personas.

  The line is the unit: Speaker · Model · Text · Can be directed · Status · Audio — Model and
  Can be directed in the Personas and Voices lists' own words (2026-10-06), with the line's
  direction on a words model and the persona's tags on a tag model. Opening a line shows who speaks it (read-only — Cast decides, D2), the numbers
  override behind its closed hatch (D3), Pronunciation, Rewrite as the speaker, and its takes:
  every take is kept, and the one ★ In use is what the chapter plays and exports (D4). A change to the
  line or to what it is made from marks it stale; you choose when to render it again. A run is the
  app's kit task (2026-10-07): the strip names the line rendering now, that row is lit, the lines
  still to come say queued, and the three whole-chapter verbs wait for it.
-->
<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  AppModal, UiButton, UiChip, UiField, UiInput, UiSelect, UiTable, UiTag, UiTextarea, confirmDialog, pushToast,
  useAiTasksStore,
} from "@delebash/llm-ui";
import PagePlayer from "../components/PagePlayer.vue";
import PageTaskStrips from "../components/PageTaskStrips.vue";
import PlayTransport from "../components/PlayTransport.vue";
import { usePagePlayer } from "../composables/usePagePlayer.js";
import { facetCounts, facetOptions, facetTotal, passesFilters } from "../services/facets.js";
import { lineStateWord } from "../services/lineStates.js";
import { loadingText, waitingText } from "../services/renderRun.js";
import DeliveryKnobs from "../components/DeliveryKnobs.vue";
import { capabilities, emotionValues, silentWav, wait } from "./personaMock.js";
import { directionCell, tagCount } from "../services/personaFacts.js";
import {
  BOOK_LEXICON, PARAGRAPH_MS, PAUSE_BETWEEN_LINES_MS, SCENE_BREAK_MS, SPEAKERS, addTake, avatarColor, counts,
  directedBy, lineState, notReady, personaOfSpeaker, render, renderChapter, renderLines, speakerOf, standingTags,
  voiceless,
} from "./renderMock.js";

const emit = defineEmits(["go"]);

const route = useRoute();
const router = useRouter();
const chapter = computed(() => render.chapters.find((c) => c.id === route.params.id) || render.chapters[0]);
const lines = computed(() => chapter.value.lines);
const c = computed(() => counts(lines.value));
const title = computed(() => `${chapter.value.n} · ${chapter.value.title}`);
const idx = computed(() => render.chapters.indexOf(chapter.value));
const prev = computed(() => render.chapters[idx.value - 1] || null);
const next = computed(() => render.chapters[idx.value + 1] || null);
// The pauses this chapter's joins use besides the setting's — named only when it has them.
const sceneBreaks = computed(() => lines.value.filter((l) => l.scene_end).length);
const paragraphJoins = computed(() => lines.value.filter((l) => l.paragraph_next).length);
const otherPauses = computed(() => [
  paragraphJoins.value ? `${PARAGRAPH_MS} ms within a paragraph` : "",
  sceneBreaks.value ? `${SCENE_BREAK_MS} ms at a scene break` : "",
].filter(Boolean).join(", "));

// ── Filters ────────────────────────────────────────────────────────────
const filter = ref("all");
const speakerFilter = ref("all");
watch(() => route.params.id, () => { filter.value = "all"; speakerFilter.value = "all"; open.value = null; });
// The chips and the speaker filter, each counted under the other, as the page.
const stateIs = (l, f) => {
  const s = lineState(l);
  return f === "blocked" ? s === "needs a speaker" || s === "needs a voice" : s === f;
};
const lineFilters = computed(() => [
  { key: "chip", value: filter.value, empty: "all", test: stateIs },
  { key: "speaker", value: speakerFilter.value, empty: "all", test: (l, s) => l.speaker_id === s },
]);
const chipN = computed(() => ({
  all: facetTotal(lines.value, lineFilters.value, "chip"),
  ...facetCounts(lines.value, lineFilters.value, "chip", ["ready", "stale", "rendered", "blocked"], stateIs),
}));
const CHIPS = computed(() => [
  { id: "all", label: "All", n: chipN.value.all },
  { id: "ready", label: "Ready", n: chipN.value.ready },
  { id: "stale", label: "Stale", n: chipN.value.stale, tip: "Something the take was made from changed since — render it again when you choose" },
  { id: "rendered", label: "Rendered", n: chipN.value.rendered },
  { id: "blocked", label: "Can't render", n: chipN.value.blocked },
]);
const speakerOptions = computed(() => {
  const names = Object.fromEntries(SPEAKERS.map((s) => [s.id, s.name]));
  return [{ value: "all", label: "Every speaker" },
    ...facetOptions(lines.value, lineFilters.value, "speaker", (l) => l.speaker_id, (id, n) => `${names[id] || "—"} · ${n}`)];
});
const inFilter = (l) => passesFilters(l, lineFilters.value);
const open = ref(null);   // the line whose panel is open
const rows = computed(() => {
  const out = [];
  for (const l of lines.value) {
    if (!inFilter(l)) continue;
    out.push(l);
    if (open.value === l.id) out.push({ id: `${l.id}__panel`, panel: true, line: l });
  }
  return out;
});

const NARROW = { width: "1%", whiteSpace: "nowrap" };
const COLUMNS = [
  { id: "open", header: "", headerStyle: NARROW, cellStyle: NARROW },
  { id: "speaker", header: "Speaker", cellStyle: { whiteSpace: "nowrap" } },
  { id: "model", header: "Model", cellStyle: { whiteSpace: "nowrap" } },
  { id: "text", header: "Text" },
  { id: "said", header: "Can be directed", headerStyle: { width: "26%" } },
  { id: "status", header: "Status", headerStyle: NARROW, cellStyle: NARROW },
  { id: "audio", header: "Audio", headerStyle: NARROW, cellStyle: { ...NARROW, textAlign: "right" } },
];

// ── A line's facts ─────────────────────────────────────────────────────
const STATE_TAG = {
  rendered: "success", stale: "accent2", ready: "ghost", "needs a speaker": "danger", "needs a voice": "danger",
};
const personaName = (l) => personaOfSpeaker(l.speaker_id)?.name || "";
const modelName = (l) => personaOfSpeaker(l.speaker_id)?.model_name || "";
const liveTake = (l) => l.takes.find((t) => t.live) || null;
const fmt = (s) => `0:${String(s).padStart(2, "0")}`;
function setDirection(l, v) {
  const next = (v || "").trim();
  if (next === (l.direction || "")) return;
  l.direction = next;
  if (l.takes.length) l.madeFrom = "old";      // a change makes its take stale (D4)
}
// The line's direction: the persona page's Style Instructions field, in the open line
// (2026-10-06) — only when the line's model takes written direction.
const takesWords = (l) => directedBy(l) === "words";
// The persona page's own explanation, for a line.
const directionHint = () => "Added after its persona's Style Instructions.";
// ✎ Edit words — the same change as Script's ✎ Edit… (2026-10-06).
const editing = reactive({});
const wordsChanged = (l) => {
  const w = (editing[l.id] || "").trim();
  return !!w && w !== l.text;
};
function saveWords(l) {
  const w = (editing[l.id] || "").trim();
  delete editing[l.id];
  if (!w || w === l.text) return;
  l.text = w;
  if (l.takes.length) l.madeFrom = "old";
}

// ── Doing things ───────────────────────────────────────────────────────
const busy = reactive({});
async function gen(l, label = "") {
  busy[l.id] = true;
  await wait(500);
  addTake(l, label);
  busy[l.id] = false;
}
// "ready" | "all" | "chapter" while a whole-chapter run goes — per chapter, as the app's.
const runs = reactive({});      // chapter id → its run
const running = computed(() => runs[chapter.value.id] || "");
// A run of this chapter, wherever it was started — here or the chapter list, as the app's.
const aiTasks = useAiTasksStore();
const liveRun = computed(() => aiTasks.visibleTasks.find((t) => ["render-lines", "render-scene"].includes(t.feature)
  && t.meta?.sceneId === chapter.value.id && aiTasks.isRunning(t.id)) || null);
const runState = (id) => liveRun.value?.render?.lines?.[id] || "";
const runBusy = computed(() => !!running.value || !!liveRun.value);
const lineName = (x) => `line ${x.n}${x.speaker ? ` · ${x.speaker}` : ""}`;
// The strip names the line rendering now; clicking it brings that line into view.
const root = ref(null);
async function goToLine(id) {
  if (!rows.value.some((r) => r.id === id)) {
    filter.value = "all";
    speakerFilter.value = "all";
  }
  await nextTick();
  root.value?.querySelector("tr.jv-row--flag")?.scrollIntoView({ block: "center", behavior: "smooth" });
}
async function runLines(which) {
  const ch = chapter.value;
  runs[ch.id] = which;
  try {
    await renderLines(ch, which);
  } catch (e) {
    if (e?.name !== "AbortError") pushToast({ kind: "error", message: `Render failed: ${e?.message || e}`, duration: 7000 });
  } finally {
    delete runs[ch.id];
  }
}
// One player for the page, as the app's (2026-10-07). Keys: "chapter", "row:<take>",
// "take:<take>", "cmp:<take>". A take keeps one silent clip, so its ▶ pauses and replays.
const player = usePagePlayer();
const takeUrls = {};
const takeUrl = (t) => (takeUrls[t.id] ||= URL.createObjectURL(silentWav(t.seconds)));
// The chapter is every line's take in use joined — a line with no take is rendered first, so this is
// Render's ▶ Render for one chapter, played here. Lines that can't render stop it.
async function playChapter() {
  const ch = chapter.value;
  runs[ch.id] = "chapter";
  try {
    const r = await renderChapter(ch, { onRetry: playChapter });
    if (r?.url && chapter.value === ch) player.play("chapter", r.url);
  } catch (e) {
    if (e?.name !== "AbortError") pushToast({ kind: "error", message: `${e?.message || e}`, duration: 9000 });
  } finally {
    delete runs[ch.id];
  }
}
const chapterBlockedWhy = computed(() => (c.value.noSpeaker
  ? `${c.value.noSpeaker} line${c.value.noSpeaker === 1 ? " has" : "s have"} no speaker.`
  : notReady(chapter.value)));
function playTake(where, t) {
  if (t) player.play(`${where}:${t.id}`, takeUrl(t));
}
function makeLive(l, t) {
  for (const x of l.takes) x.live = x.id === t.id;
}
async function deleteTake(l, t) {
  const next = l.takes.find((x) => x.id !== t.id);
  if (t.live) {
    const ok = await confirmDialog(next
      ? { title: "Delete the take in use?", confirmLabel: "Delete take", danger: true,
          message: `${takeName(l, next).replace(/^t/, "T")} (${fmt(next.seconds)}) becomes the one the chapter plays. This take's audio is deleted.` }
      : { title: "Delete this line's only take?", confirmLabel: "Delete take", danger: true,
          message: "The line goes back to Ready, and Play chapter renders it again." });
    if (!ok) return;
  }
  if (String(player.key).endsWith(`:${t.id}`)) player.stop();
  l.takes = l.takes.filter((x) => x.id !== t.id);
  if (t.live && next) next.live = true;
  pushToast({ kind: "info", message: "Take deleted." });
}
function goCast() { emit("go", "cast"); }
function goScript() { router.push({ name: "mock-script" }); }
function goPersona(personaId) { router.push({ name: "mock-persona", params: { id: personaId } }); }

// Render overrides — open, the persona page's controls (2026-10-06; was D3's closed hatch).
// An untouched knob shows the persona's value; a set value puts a dot on the row.
function overrideSet(l) {
  return !!l.override && Object.values(l.override).some((v) => v !== null && v !== "" && v !== undefined);
}
function setNum(l, key, v) {
  const o = { ...(l.override || {}) };
  if (v === null || v === "" || Number(v) === Number(personaDefault(l, key))) delete o[key];
  else o[key] = Number(v);
  l.override = Object.keys(o).length ? o : null;
  if (l.takes.length) l.madeFrom = "old";
}
function clearOverride(l) {
  l.override = null;
  l.direction = "";
  if (l.takes.length) l.madeFrom = "old";
}
const lineChanged = (l) => overrideSet(l) || !!l.direction;
// What the line's model takes, and only that (2026-10-06) — the app's own capability rows.
const modelOfLine = (l) => personaOfSpeaker(l.speaker_id)?.model || "";
const rowOfLine = (l) => capabilities[modelOfLine(l)] || null;
const tagSetOf = (l, category) => (rowOfLine(l)?.inline_tags || []).find((t) => t.category === category) || null;
const paceNative = (l) => !!rowOfLine(l)?.speed_native;
function emotionChoices(l) {
  const tags = tagSetOf(l, "emotion");
  if (tags) return tags.tags;
  return takesWords(l) ? emotionValues : [];
}
const personaMs = (l) => personaOfSpeaker(l.speaker_id)?.default_delivery?.models?.[modelOfLine(l)] || {};
const lineMs = (l) => l.override?.models?.[modelOfLine(l)] || {};
const lineHas = (l, key) => Object.hasOwn(lineMs(l), key);
const wordValue = (l, key) => (lineHas(l, key) ? lineMs(l)[key] : personaMs(l)[key]) || "";
function setLineModel(l, change) {
  const model = modelOfLine(l);
  if (!model) return;
  const o = { ...(l.override || {}) };
  const models = { ...(o.models || {}) };
  const entry = change({ ...(models[model] || {}) });
  if (Object.keys(entry).length) models[model] = entry;
  else delete models[model];
  if (Object.keys(models).length) o.models = models;
  else delete o.models;
  l.override = Object.keys(o).length ? o : null;
  if (l.takes.length) l.madeFrom = "old";
}
function setWord(l, key, v) {
  const value = v === null || (v || "") === (personaMs(l)[key] || "") ? null : v || "";
  setLineModel(l, (e) => {
    if (value === null) delete e[key];
    else e[key] = value;
    return e;
  });
}
const modelKnobs = (l) => (rowOfLine(l)?.knobs || []).filter((k) => k.key !== "speed" && k.key !== "seed")
  .map((k) => ({ key: k.key, label: k.label, min: k.min, max: k.max, step: k.step, neutral: Number(k.default), unit: k.unit || "", hint: k.hint }));
const knobFallback = (l) => Object.fromEntries(modelKnobs(l).map((k) => [k.key, personaMs(l).knobs?.[k.key] ?? k.neutral]));
function setKnob(l, key, v) {
  let value = v === null || v === undefined || v === "" ? null : Number(v);
  if (value !== null && value === Number(knobFallback(l)[key])) value = null;
  setLineModel(l, (e) => {
    const knobs = { ...(e.knobs || {}) };
    if (value === null) delete knobs[key];
    else knobs[key] = value;
    if (Object.keys(knobs).length) e.knobs = knobs;
    else delete e.knobs;
    return e;
  });
}
function personaDefault(l, key) {
  const d = personaOfSpeaker(l.speaker_id)?.default_delivery || {};
  if (key === "speed") return d.speed ?? 1;
  if (key === "pitch") return d.pitch ?? 0;
  if (key === "gain_db") return d.gain_db ?? 0;
  // A scene's last line is followed by the scene-break pause, a line whose next line is in its
  // paragraph by the paragraph's — whatever its persona says.
  if (l.scene_end) return SCENE_BREAK_MS;
  if (l.paragraph_next) return PARAGRAPH_MS;
  return PAUSE_BETWEEN_LINES_MS;
}
const lineFallback = (l) => Object.fromEntries(["speed", "pitch", "gain_db", "pause_after"].map((k) => [k, personaDefault(l, k)]));
const KNOB_WORD = { speed: "pace", pitch: "pitch", gain_db: "gain", pause_after: "pause after" };
const personaWord = (l) => (personaName(l) ? `persona ${personaName(l)}'s` : "the persona's");

// Compare two takes.
const compare = ref(null);   // { line, b }
function openCompare(l) {
  const other = l.takes.find((t) => !t.live);
  compare.value = { line: l, b: other?.id || "" };
}
const compareOptions = computed(() => (compare.value?.line.takes || [])
  .filter((t) => !t.live).map((t) => ({ value: t.id, label: takeName(compare.value.line, t) })));
// A take played from the panel or Compare stops when it closes (or B changes), as the app's does.
watch(open, () => { if (String(player.key).startsWith("take:")) player.stop(); });
watch(() => compare.value?.b, () => {
  if (String(player.key).startsWith("cmp:") && player.key !== `cmp:${liveTake(compare.value?.line || { takes: [] })?.id}`) player.stop();
});
watch(compare, (v) => { if (!v && String(player.key).startsWith("cmp:")) player.stop(); });
function takeName(l, t) {
    if (t.live) return "★ In use";
  const i = l.takes.length - l.takes.indexOf(t);
  return `take ${i}`;
}

// Rewrite as the speaker (moved here from Script, decided 2026-09-29) — what the model offers for
// a line, read against who the speaker is on Cast.
const REWRITES = {
  '"You flicker in company,"': '"You only flicker when someone\'s watching,"',
  '"and you\'re steady when you\'re alone. So it isn\'t the cell."': '"and alone you\'re steady as a bell. So it\'s not the cell."',
  '"There,"': '"There now,"',
  '"Now you\'ll get on."': '"You\'ll behave now."',
  '"Why\'s it still on the board at eleven weeks if it\'s straightforward?"': '"If it\'s so straightforward, why\'s it sat on the board eleven weeks?"',
  '"It\'s cold in the Hall."': '"The Hall\'s cold, that\'s all."',
  '"It is not a matter of pride,"': '"Pride has nothing to do with it,"',
  '"We\'re brass,"': '"We\'re brass, Iven,"',
};
const rewrite = ref(null);   // { line, text, busy }
async function runRewrite() {
  const r = rewrite.value;
  r.busy = true;
  r.text = "";
  await wait(700);
  r.text = REWRITES[r.line.text] || r.line.text.replace(/^"/, '"Look — ');
  r.busy = false;
}
function openRewrite(l) {
  rewrite.value = { line: l, text: "", busy: true };
  runRewrite();
}
function acceptRewrite() {
  const l = rewrite.value.line;
  l.text = rewrite.value.text;
  if (l.takes.length) l.madeFrom = "old";
  rewrite.value = null;
}

function pronounce(l) {
  const word = (l.text.match(/\b[A-Z][a-z]{3,}\b/g) || []).find((w) => !/^(The|She|He|They|Her|His|But|And|You|That|This)$/.test(w));
  pushToast({ kind: "info", message: `Opens ${BOOK_LEXICON} on Lexicons${word ? ` with “${word}” ready to add` : ""}.` });
}

const blockedBanner = computed(() => {
  const parts = [];
  if (c.value.noSpeaker) parts.push({ text: `${c.value.noSpeaker} ${c.value.noSpeaker === 1 ? "has" : "have"} no speaker`, link: "fix in Script", go: goScript });
  for (const v of voiceless(lines.value)) {
    parts.push(v.persona
      ? { text: `persona ${v.persona} (who plays ${v.speaker}) has no voice`, link: "fix on Personas", go: () => goPersona(v.personaId) }
      : { text: `${v.speaker} has no persona`, link: "fix in Cast", go: goCast });
  }
  return parts;
});
</script>

<template>
  <section ref="root" class="mock-render-ch">
    <PagePlayer :player="player" />
    <div class="jv-inline-row">
      <UiButton intent="ghost" size="small" label="← All chapters" @click="router.push({ name: 'mock-render' })" />
    </div>

    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">{{ title }}</h3>
        <span class="jv-hint">{{ c.all }} lines · {{ c.rendered }} rendered · {{ c.stale }} stale · {{ c.ready }} ready{{ c.blocked ? ` · ${c.blocked} can't render` : "" }}</span>
      </div>
      <div class="jv-card__body">
        <p class="jv-lede">
          Render turns each line into audio. Every take is kept, and the one ★ In use is what the chapter plays and
          exports. Changing a line, or what it is made from, marks it stale — it plays its take in use until you
          render it again.
        </p>
        <div class="mock-render-ch__verbs">
          <span class="mock-render-ch__verb">
            <UiButton intent="primary" :disabled="!c.ready || runBusy" :loading="running === 'ready'"
              :label="`⚡ Render ${c.ready} ready`" @click="runLines('ready')" />
            <span class="jv-hint">Each line gets a take. Lines that can't render are left for you to fix.</span>
          </span>
          <span class="mock-render-ch__verb">
            <UiButton intent="secondary" :disabled="!!c.blocked || runBusy" :loading="running === 'chapter'"
              label="▶ Play chapter" @click="playChapter" />
            <span class="jv-hint">{{ c.blocked ? `Not until every line can render — ${chapterBlockedWhy}`
              : `Every line's take in use, in order, ${PAUSE_BETWEEN_LINES_MS} ms apart${otherPauses ? ` (${otherPauses})` : ""}. A line with no take is rendered first.` }}</span>
          </span>
          <span class="jv-spacer" />
          <span class="mock-render-ch__verb">
            <UiButton intent="secondary" :disabled="!(c.rendered + c.stale) || runBusy" :loading="running === 'all'"
              label="↻ Re-render all" @click="runLines('all')" />
            <span class="jv-hint">A new take for every line that can render. Old takes are kept.</span>
          </span>
        </div>
        <PageTaskStrips :features="['render-lines', 'render-scene']" :meta="{ sceneId: chapter.id }">
          <template #extra-stats="{ task }">
            <span v-if="loadingText(task.render?.loading)" class="sts-stat">{{ loadingText(task.render.loading) }}</span>
            <UiButton v-else-if="task.render?.current" intent="ghost" size="small" class="sts-stat"
              :label="lineName(task.render.current)" title="Show this line" @click="goToLine(task.render.current.block_id)" />
            <span v-else-if="waitingText(task.render?.waiting)" class="sts-stat">{{ waitingText(task.render.waiting) }}</span>
          </template>
        </PageTaskStrips>
        <PlayTransport v-if="player.key === 'chapter'" :player="player" width="long" toggle />
      </div>
    </div>

    <div v-if="blockedBanner.length" class="jv-banner jv-banner--warn mock-render-ch__banner">
      <span><strong>{{ c.blocked }} line{{ c.blocked === 1 ? " can't" : "s can't" }} render.</strong>{{ " " }}<template
          v-for="(p, i) in blockedBanner" :key="i">{{ i ? " " : "" }}{{ p.text }} — <a href="#"
          @click.prevent="p.go()">{{ p.link }}</a>.</template>
      </span>
    </div>

    <div class="jv-card mock-render-ch__lines">
      <div class="jv-inline-row mock-render-ch__bar">
        <UiChip v-for="ch in CHIPS" :key="ch.id" :selected="filter === ch.id" :title="ch.tip || ''"
          @click="filter = ch.id">{{ ch.label }} {{ ch.n }}</UiChip>
        <UiSelect v-model="speakerFilter" width="name" :options="speakerOptions" />
      </div>

      <UiTable class="jv-table-look ui-table-top mock-render-ch__table" :data="rows" :columns="COLUMNS" data-key="id"
        :full-width-row="(r) => (r.panel ? 'mock-render-ch__panel-row' : false)"
        :row-class="(r) => ({ 'jv-row--selected': open === r.id, 'jv-row--flag': runState(r.id) === 'running' })"
        @row-click="({ data }) => { if (!data.panel) open = open === data.id ? null : data.id; }">
        <template #open="{ row }">
          <span class="jv-muted">{{ open === row.id ? "⌃" : "⌄" }}</span>
        </template>
        <template #speaker="{ row }">
          <span v-if="row.speaker_id" class="mock-render-ch__who">
            <span class="mock-render-ch__av" :style="{ background: avatarColor(row.speaker_id) }">{{ speakerOf(row.speaker_id).name[0] }}</span>
            {{ speakerOf(row.speaker_id).name }}
            <span v-if="overrideSet(row)" class="mock-render-ch__dot" title="This line has render overrides" />
          </span>
          <span v-else class="jv-muted">— no speaker —</span>
        </template>
        <template #text="{ row }"><span class="mock-render-ch__text">{{ row.text }}</span></template>
        <template #model="{ row }">
          <span v-if="personaOfSpeaker(row.speaker_id)">{{ modelName(row) }}</span>
          <span v-else class="jv-muted">—</span>
        </template>
        <template #said="{ row }">
          <span v-if="personaOfSpeaker(row.speaker_id)" class="mock-render-ch__said" @click.stop>
            <UiTag :intent="directionCell(directedBy(row), tagCount(rowOfLine(row))).intent"
              :title="directionCell(directedBy(row)).title">{{ directionCell(directedBy(row), tagCount(rowOfLine(row))).label }}</UiTag>
            <span v-if="directedBy(row) === 'words'" class="mock-render-ch__dir"
              title="Open the line to change its Style Instructions" @click="open = open === row.id ? null : row.id">
              <template v-if="row.direction">“{{ row.direction }}”</template>
              <span v-else class="jv-muted">as persona {{ personaName(row) }} always speaks</span>
            </span>
            <span v-else-if="directedBy(row) === 'tags'" class="mock-render-ch__tags">
              <UiTag v-for="t in standingTags(row)" :key="t" intent="ghost">{{ t }}</UiTag>
            </span>
          </span>
          <span v-else class="jv-muted">—</span>
        </template>
        <template #status="{ row }">
          <UiTag v-if="runState(row.id) === 'running'" intent="info">rendering…</UiTag>
          <UiTag v-else-if="runState(row.id) === 'pending'" intent="ghost" title="Waiting in this run">queued</UiTag>
          <UiTag v-else :intent="STATE_TAG[lineState(row)]">{{ lineStateWord(lineState(row), { hasPersona: !!personaOfSpeaker(row.speaker_id) }) }}</UiTag>
        </template>
        <template #audio="{ row }">
          <span class="mock-render-ch__audio" @click.stop>
            <template v-if="lineState(row) === 'rendered' || lineState(row) === 'stale'">
              <UiButton intent="ghost" size="small" :label="player.isPlaying(`row:${liveTake(row).id}`) ? '⏸' : '▶'"
                :title="player.isPlaying(`row:${liveTake(row).id}`) ? 'Pause' : `Play the take in use (${fmt(liveTake(row).seconds)})`"
                @click="playTake('row', liveTake(row))" />
              <PlayTransport v-if="player.key === `row:${liveTake(row).id}`" :player="player" />
              <span v-else class="jv-muted mock-render-ch__len">{{ fmt(liveTake(row).seconds) }}</span>
              <UiButton v-if="lineState(row) === 'stale'" intent="secondary" size="small" label="↻"
                :loading="busy[row.id]" title="Render it again — the old take is kept" @click="gen(row)" />
            </template>
            <UiButton v-else-if="lineState(row) === 'ready'" intent="primary" size="small" label="▶ Gen"
              :loading="busy[row.id]" @click="gen(row)" />
            <UiButton v-else-if="lineState(row) === 'needs a speaker'" intent="secondary" size="small"
              label="Fix in Script" title="Opens Script at this line" @click="goScript" />
            <UiButton v-else-if="!personaOfSpeaker(row.speaker_id)" intent="secondary" size="small"
              :label="`Cast ${speakerOf(row.speaker_id).name.split(' ')[0]}`" @click="goCast" />
            <UiButton v-else intent="secondary" size="small" :label="`Give persona ${personaName(row)} a voice`"
              @click="goPersona(speakerOf(row.speaker_id).persona_id)" />
          </span>
        </template>

        <template #full-row="{ row }">
          <div class="jv-linepanel" @click.stop>
            <div class="jv-linepanel__side">
              <div class="jv-linepanel__field">
                <span class="jv-eyebrow">Speaker</span>
                <span v-if="personaOfSpeaker(row.line.speaker_id)">
                  <strong>{{ speakerOf(row.line.speaker_id).name }}</strong> — Cast: persona {{ personaName(row.line) }} ·
                  {{ modelName(row.line) }} · <a href="#" @click.prevent="goCast">Change in Cast ➜</a>
                </span>
                <span v-else-if="row.line.speaker_id">{{ speakerOf(row.line.speaker_id).name }} — no persona yet ·
                  <a href="#" @click.prevent="goCast">Cast them ➜</a></span>
                <span v-else class="jv-muted">Nobody — <a href="#" @click.prevent="goScript">give it a speaker in Script ➜</a></span>
              </div>

              <div class="jv-card jv-linepanel__wide">
                <div class="jv-card__header">
                  <h3 class="jv-card__title">Render overrides</h3>
                  <UiButton intent="ghost" size="small" label="↺ Reset to default" :disabled="!lineChanged(row.line)"
                    title="Every override back to its persona's" @click="clearOverride(row.line)" />
                </div>
                <div class="jv-card__body jv-col">
                <DeliveryKnobs class="jv-linepanel__wide" :values="row.line.override || {}" :fallback="lineFallback(row.line)"
                  :pauses="['pause_after']" pause-reset
                  :reset-title="(key) => `Back to ${personaWord(row.line)} ${KNOB_WORD[key]}`"
                  @commit="(key, v) => setNum(row.line, key, v)" @reset="(key) => setNum(row.line, key, null)" />
                <p v-if="personaOfSpeaker(row.line.speaker_id) && !paceNative(row.line)" class="jv-hint">Pace is time-stretched
                  after {{ modelName(row.line) }} speaks — it doesn't pace itself.</p>

                <UiField v-if="takesWords(row.line)" layout="block" class="jv-linepanel__wide" :hint="directionHint(row.line)">
                  <template #label>
                    <span class="jv-field-label-row">
                      <span>Style Instructions (optional)</span>
                      <span class="jv-inline-row">
                        <UiTag intent="success">✓ {{ modelName(row.line) }}</UiTag>
                        <UiButton intent="ghost" size="small" label="↺" :disabled="!row.line.direction"
                          title="Clear this line's Style Instructions" @click="setDirection(row.line, '')" />
                      </span>
                    </span>
                  </template>
                  <UiTextarea :model-value="row.line.direction" :rows="2"
                    :placeholder="`as persona ${personaName(row.line)} always speaks`"
                    @blur="(e) => setDirection(row.line, e.target.value)" />
                </UiField>

                <div v-if="emotionChoices(row.line).length || tagSetOf(row.line, 'register')" class="jv-field-row">
                  <UiField v-if="emotionChoices(row.line).length" layout="block">
                    <template #label>
                      <span class="jv-field-label-row">
                        <span>{{ tagSetOf(row.line, 'emotion') ? `Emotion — ${modelName(row.line)}'s own tags` : "Emotion" }}</span>
                        <UiButton intent="ghost" size="small" label="↺" :disabled="!lineHas(row.line, 'emotion')"
                          :title="`Back to ${personaWord(row.line)} emotion`" @click="setWord(row.line, 'emotion', null)" />
                      </span>
                    </template>
                    <UiSelect :model-value="wordValue(row.line, 'emotion')" width="id"
                      :options="[{ value: '', label: '— none —' }, ...emotionChoices(row.line).map((e) => ({ value: e, label: tagSetOf(row.line, 'emotion') ? `[${e}]` : e }))]"
                      @update:model-value="(v) => setWord(row.line, 'emotion', v)" />
                  </UiField>
                  <UiField v-if="tagSetOf(row.line, 'register')" layout="block">
                    <template #label>
                      <span class="jv-field-label-row">
                        <span>Register</span>
                        <UiButton intent="ghost" size="small" label="↺" :disabled="!lineHas(row.line, 'register_tag')"
                          :title="`Back to ${personaWord(row.line)} register`" @click="setWord(row.line, 'register_tag', null)" />
                      </span>
                    </template>
                    <UiSelect :model-value="wordValue(row.line, 'register_tag')" width="id"
                      :options="[{ value: '', label: '— none —' }, ...tagSetOf(row.line, 'register').tags.map((t) => ({ value: t, label: `[${t}]` }))]"
                      @update:model-value="(v) => setWord(row.line, 'register_tag', v)" />
                  </UiField>
                </div>
                <p v-if="tagSetOf(row.line, 'emotion')" class="jv-hint">
                  Put at the start of the line. Sounds like [sigh] or [laugh] go inside it — type them in its words.
                </p>

                <template v-if="modelKnobs(row.line).length">
                  <span class="jv-inline-row">
                    <strong>Sampling</strong><span class="jv-hint">{{ modelName(row.line) }}</span>
                  </span>
                  <DeliveryKnobs class="jv-linepanel__wide" :knobs="modelKnobs(row.line)" :pauses="[]"
                    :values="lineMs(row.line).knobs || {}" :fallback="knobFallback(row.line)"
                    :reset-title="(key, k) => `Back to ${personaWord(row.line)} ${(k?.label || key).toLowerCase()}`"
                    @commit="(key, v) => setKnob(row.line, key, v)" @reset="(key) => setKnob(row.line, key, null)" />
                </template>
                </div>
              </div>

              <div class="jv-linepanel__row">
                <UiButton intent="secondary" size="small" label="📕 Pronunciation"
                  :title="`Opens ${BOOK_LEXICON}, the book's lexicon`" @click="pronounce(row.line)" />
                <UiButton intent="secondary" size="small" :disabled="!row.line.speaker_id"
                  :label="row.line.speaker_id ? `✏️ Rewrite as ${speakerOf(row.line.speaker_id).name.split(' ')[0]}` : '✏️ Rewrite as the speaker'"
                  :title="!row.line.speaker_id ? 'Give this line a speaker first.'
                    : 'Reads who they are on Cast, and offers the line in their words'" @click="openRewrite(row.line)" />
                <UiButton intent="secondary" size="small" label="✎ Edit words" :disabled="editing[row.line.id] !== undefined"
                  title="Change this line's words — split and merge are on Script" @click="editing[row.line.id] = row.line.text" />
              </div>
              <div v-if="editing[row.line.id] !== undefined" class="jv-linepanel__field jv-linepanel__field--wide">
                <UiField label="Its words" layout="block" class="jv-linepanel__wide"
                  hint="Saving makes the line stale until you render it again — its takes are kept. Split and merge are on Script.">
                  <UiTextarea v-model="editing[row.line.id]" :rows="3" />
                </UiField>
                <span class="jv-linepanel__row">
                  <UiButton intent="primary" size="small" label="Save" :disabled="!wordsChanged(row.line)" @click="saveWords(row.line)" />
                  <UiButton intent="ghost" size="small" label="Cancel" @click="delete editing[row.line.id]" />
                </span>
              </div>
            </div>

            <div class="jv-card jv-takes">
              <div class="jv-takes__head"><strong>Takes</strong>
                <span class="jv-hint">{{ row.line.takes.length }} · nothing is overwritten</span></div>
              <div v-for="t in row.line.takes" :key="t.id" class="jv-takes__row">
                <UiTag :intent="t.live ? 'success' : 'ghost'">{{ takeName(row.line, t) }}</UiTag>
                <PlayTransport v-if="player.key === `take:${t.id}`" :player="player" />
                <span v-else class="jv-takes__len">{{ fmt(t.seconds) }}</span>
                <span class="jv-takes__label">{{ t.label }}</span>
                <UiButton intent="ghost" size="small" :label="player.isPlaying(`take:${t.id}`) ? '⏸' : '▶'"
                  :title="player.isPlaying(`take:${t.id}`) ? 'Pause' : 'Play'" @click="playTake('take', t)" />
                <UiButton v-if="!t.live" intent="ghost" size="small" label="★ Use this take" title="Make this the take the chapter plays" @click="makeLive(row.line, t)" />
                <UiButton intent="ghost" size="small" label="🗑"
                  :title="t.live ? 'Delete this take — asks first; the newest take left goes in use' : 'Delete this take'"
                  @click="deleteTake(row.line, t)" />
              </div>
              <div v-if="!row.line.takes.length" class="jv-takes__row jv-muted">No takes yet.</div>
              <div class="jv-takes__foot">
                <UiButton intent="secondary" size="small" label="↻ New take"
                  :disabled="['needs a speaker', 'needs a voice'].includes(lineState(row.line))" :loading="busy[row.line.id]"
                  title="Renders the line again with a new seed — the takes you have are kept" @click="gen(row.line, 'new seed')" />
                <UiButton intent="secondary" size="small" label="⚖️ Compare two" :disabled="row.line.takes.length < 2" @click="openCompare(row.line)" />
                <span class="jv-spacer" />
                <UiButton intent="ghost" size="small" label="✕ Close" @click="open = null" />
              </div>
            </div>
          </div>
        </template>
        <template #empty>No lines in this view.</template>
      </UiTable>

      <p class="jv-hint mock-render-ch__foot">Lines are joined with {{ PAUSE_BETWEEN_LINES_MS }} ms of silence<template
        v-if="paragraphJoins">, {{ PARAGRAPH_MS }} ms between lines of one paragraph</template><template
        v-if="sceneBreaks">, and {{ SCENE_BREAK_MS }} ms after the last line of each of the book's scenes</template> —
        Settings → Generation. Each take's own silence at its start and end is trimmed first, so these are the
        pauses you hear. A line's own pause (Render overrides) changes it after that line.</p>
      <div class="jv-inline-row mock-render-ch__bar">
        <UiButton intent="secondary" size="small" label="← Previous chapter" :disabled="!prev"
          @click="router.push({ name: 'mock-render-chapter', params: { id: prev.id } })" />
        <span class="jv-spacer" />
        <span v-if="next" class="jv-hint">Next: {{ next.n }} · {{ next.title }}</span>
        <UiButton intent="primary" size="small" label="Next chapter ➜" :disabled="!next"
          @click="router.push({ name: 'mock-render-chapter', params: { id: next.id } })" />
      </div>
    </div>

    <AppModal v-if="compare" :title="`Compare takes — line ${compare.line.n}`" @close="compare = null">
      <div class="mock-render-ch__compare">
        <div class="jv-linepanel__field">
          <span class="jv-eyebrow">A — ★ In use</span>
          <span class="mock-render-ch__compare-take">take {{ compare.line.takes.length - compare.line.takes.indexOf(liveTake(compare.line)) }}</span>
          <UiButton intent="secondary" size="small" :label="player.isPlaying(`cmp:${liveTake(compare.line)?.id}`) ? '⏸ Pause A' : '▶ Play A'"
            @click="playTake('cmp', liveTake(compare.line))" />
          <PlayTransport v-if="player.key === `cmp:${liveTake(compare.line)?.id}`" :player="player" />
        </div>
        <div class="jv-linepanel__field">
          <span class="jv-eyebrow">B</span>
          <UiSelect v-model="compare.b" width="id" :options="compareOptions" placeholder="Pick a take…" />
          <UiButton intent="secondary" size="small" :label="player.isPlaying(`cmp:${compare.b}`) ? '⏸ Pause B' : '▶ Play B'"
            :disabled="!compare.b" @click="playTake('cmp', compare.line.takes.find((t) => t.id === compare.b))" />
          <PlayTransport v-if="compare.b && player.key === `cmp:${compare.b}`" :player="player" />
        </div>
      </div>
      <template #footer>
        <UiButton intent="ghost" label="Close" @click="compare = null" />
        <UiButton intent="primary" label="★ Use take B" :disabled="!compare.b"
          @click="makeLive(compare.line, compare.line.takes.find((t) => t.id === compare.b)); compare = null" />
      </template>
    </AppModal>

    <AppModal v-if="rewrite" eyebrow="Rewrite as the speaker" :title="speakerOf(rewrite.line.speaker_id)?.name || 'Line'"
      max-width="720px" dismissable @close="rewrite = null">
      <div class="mock-render-ch__rewrite">
        <div class="mock-render-ch__rewrite-field">
          <span class="jv-eyebrow">Original</span>
          <p class="mock-render-ch__quote">{{ rewrite.line.text }}</p>
        </div>
        <div class="mock-render-ch__rewrite-field">
          <span class="jv-eyebrow">Rewritten</span>
          <p v-if="rewrite.busy" class="jv-muted">Generating rewrite…</p>
          <UiTextarea v-else v-model="rewrite.text" :rows="3" placeholder="Rewrite will appear here…" />
        </div>
        <span class="jv-hint">Accepting replaces the line's text. Its takes are kept, and it is stale until you render it again.</span>
      </div>
      <template #footer>
        <UiButton intent="secondary" size="small" :disabled="rewrite.busy" label="↻ Try again" @click="runRewrite" />
        <span class="jv-spacer" />
        <UiButton intent="secondary" label="Discard" @click="rewrite = null" />
        <UiButton intent="primary" label="Accept" :disabled="rewrite.busy || !rewrite.text.trim()" @click="acceptRewrite" />
      </template>
    </AppModal>
  </section>
</template>

<style scoped>
.mock-render-ch { display: flex; flex-direction: column; gap: 14px; }
.mock-render-ch__verbs { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: flex-start; }
.mock-render-ch__verb { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 34ch; }
.mock-render-ch__banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 0; }
.mock-render-ch__lines { padding: 0; overflow: hidden; }
.mock-render-ch__bar { gap: 8px; flex-wrap: wrap; align-items: center; padding: 11px 14px; }
.mock-render-ch__foot { margin: 0; padding: 0 14px 11px; }
.mock-render-ch__text { display: block; max-width: 60ch; margin: 0; }
.mock-render-ch__who { display: inline-flex; align-items: center; gap: 7px; }
.mock-render-ch__av { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; flex: none; }
.mock-render-ch__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); display: inline-block; }
.mock-render-ch__tags { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.mock-render-ch__said { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.mock-render-ch__dir { cursor: pointer; }
.mock-render-ch__audio { display: inline-flex; align-items: center; gap: 4px; }
.mock-render-ch__len { font-variant-numeric: tabular-nums; font-size: 12px; }
.mock-render-ch__compare { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; margin-bottom: 10px; }
.mock-render-ch__compare > .jv-linepanel__field { min-width: 0; }
.mock-render-ch__compare-take { min-height: 30px; display: flex; align-items: center; }
.mock-render-ch__rewrite { display: flex; flex-direction: column; gap: 14px; }
.mock-render-ch__rewrite-field { display: flex; flex-direction: column; gap: 4px; }
.mock-render-ch__quote { margin: 0; padding: 10px 12px; background: var(--surface-2); border-radius: 6px; line-height: 1.5; }
.mock-render-ch__table :deep(.ui-table-row) { cursor: pointer; }
.mock-render-ch__table :deep(.mock-render-ch__panel-row) td { padding: 0; }
</style>
