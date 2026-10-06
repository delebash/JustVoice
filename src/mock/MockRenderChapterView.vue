<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Render — one chapter's lines (the mock, dev only: #/mock/render/:id). Slice 4,
  decided 2026-10-04 (TASKS "Studio Slice 4"; research docs/plans/2026-09-30-mock-vs-app-and-
  slice-4.md §3). Made from the kit's components on `renderMock.js` — The Ninth Facet, played by
  the persona mock's personas.

  The line is the unit: Speaker · Text · How it's said · Status · Audio. "How it's said" is
  words on a model that takes direction, the persona's own tags on a tag model, and nothing on
  the rest. Opening a line shows who speaks it (read-only — Cast decides, D2), the numbers
  override behind its closed hatch (D3), Pronunciation, Rewrite in character, and its takes:
  every take is kept, and the ★ one is what the chapter plays and exports (D4). A change to the
  line or to what it is made from marks it stale; you choose when to render it again.
-->
<script setup>
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  AppModal, UiButton, UiChip, UiField, UiInput, UiSelect, UiTable, UiTag, UiTextarea, pushToast,
} from "@delebash/llm-ui";
import { facetCounts, facetOptions, facetTotal, passesFilters } from "../services/facets.js";
import DeliveryKnobs from "../components/DeliveryKnobs.vue";
import { silentWav, wait } from "./personaMock.js";
import {
  BOOK_LEXICON, PAUSE_BETWEEN_LINES_MS, SPEAKERS, addTake, avatarColor, counts, directedBy,
  lineState, notReady, personaOfSpeaker, render, speakerOf, standingTags, voiceless,
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
  { id: "text", header: "Text" },
  { id: "said", header: "How it's said", headerStyle: { width: "26%" } },
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
function saidPlaceholder(l) {
  const s = lineState(l);
  if (s === "needs a speaker" || s === "needs a voice") return "—";
  return `${modelName(l)} takes no direction`;
}
function setDirection(l, v) {
  const next = (v || "").trim();
  if (next === (l.direction || "")) return;
  l.direction = next;
  if (l.takes.length) l.madeFrom = "old";      // a change makes its take stale (D4)
}
// The line's direction: the persona page's Style Instructions field, in the open line
// (2026-10-06) — only when the line's model takes written direction.
const takesWords = (l) => directedBy(l) === "words";
function directionHint(l) {
  const p = personaOfSpeaker(l.speaker_id);
  const own = (p?.voice_instruct || "").trim();
  return `For this line only — added after ${p.name}'s own${own ? `: “${own}”` : " (none yet)."}`;
}
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
async function renderReady() {
  const todo = lines.value.filter((l) => lineState(l) === "ready");
  pushToast({ kind: "info", message: `Rendering ${todo.length} lines — each gets a take.` });
  for (const l of todo) addTake(l);
}
async function renderAllAgain() {
  const todo = lines.value.filter((l) => ["ready", "rendered", "stale"].includes(lineState(l)));
  pushToast({ kind: "info", message: `Rendering all ${todo.length} lines again — every old take is kept.` });
  for (const l of todo) addTake(l);
}
const playing = ref(null);
const chapterBusy = ref(false);
// The chapter is every line's ★ take joined — a line with no take is rendered first, so this is
// Render's ▶ Render for one chapter, played here. Lines that can't render stop it.
async function playChapter() {
  chapterBusy.value = true;
  await wait(600);
  for (const l of lines.value) if (lineState(l) === "ready") addTake(l);
  chapterBusy.value = false;
  const talk = lines.value.reduce((s, l) => s + (liveTake(l)?.seconds || 0), 0);
  playing.value = { key: "chapter", url: URL.createObjectURL(silentWav(Math.min(talk, 30))) };
}
const chapterBlockedWhy = computed(() => (c.value.noSpeaker
  ? `${c.value.noSpeaker} line${c.value.noSpeaker === 1 ? " has" : "s have"} no speaker.`
  : notReady(chapter.value)));
function playTake(t) {
  playing.value = { key: t.id, url: URL.createObjectURL(silentWav(t.seconds)) };
}
function makeLive(l, t) {
  for (const x of l.takes) x.live = x.id === t.id;
}
function deleteTake(l, t) {
  l.takes = l.takes.filter((x) => x.id !== t.id);
  pushToast({ kind: "info", message: "Take deleted." });
}
function goCast() { emit("go", "cast"); }
function goScript() { router.push({ name: "mock-script" }); }
function goPersona(personaId) { router.push({ name: "mock-persona", params: { id: personaId } }); }

// This line only — open, the persona page's controls (2026-10-06; was D3's closed hatch).
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
  if (l.takes.length) l.madeFrom = "old";
}
function personaDefault(l, key) {
  const d = personaOfSpeaker(l.speaker_id)?.default_delivery || {};
  if (key === "speed") return d.speed ?? 1;
  if (key === "pitch") return d.pitch ?? 0;
  if (key === "gain_db") return d.gain_db ?? 0;
  return PAUSE_BETWEEN_LINES_MS;
}
const lineFallback = (l) => Object.fromEntries(["speed", "pitch", "gain_db", "pause_after"].map((k) => [k, personaDefault(l, k)]));
const KNOB_WORD = { speed: "pace", pitch: "pitch", gain_db: "gain", pause_after: "pause after" };
const personaWord = (l) => (personaName(l) ? `${personaName(l)}'s` : "the persona's");

// Compare two takes.
const compare = ref(null);   // { line, b }
function openCompare(l) {
  const other = l.takes.find((t) => !t.live);
  compare.value = { line: l, b: other?.id || "" };
}
const compareOptions = computed(() => (compare.value?.line.takes || [])
  .filter((t) => !t.live).map((t) => ({ value: t.id, label: takeName(compare.value.line, t) })));
function takeName(l, t) {
  if (t.live) return "★ live";
  const i = l.takes.length - l.takes.indexOf(t);
  return `take ${i}`;
}

// Rewrite in character (moved here from Script, decided 2026-09-29) — what the model offers for
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
      ? { text: `${v.persona} (who plays ${v.speaker}) has no voice`, link: "fix on Personas", go: () => goPersona(v.personaId) }
      : { text: `${v.speaker} has no persona`, link: "fix in Cast", go: goCast });
  }
  return parts;
});
</script>

<template>
  <section class="mock-render-ch">
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
          Render turns each line into audio. Every take is kept, and the ★ one is what the chapter plays and
          exports. Changing a line, or what it is made from, marks it stale — it plays its ★ take until you
          render it again.
        </p>
        <div class="mock-render-ch__verbs">
          <span class="mock-render-ch__verb">
            <UiButton intent="primary" :disabled="!c.ready" :label="`⚡ Render ${c.ready} ready`" @click="renderReady" />
            <span class="jv-hint">Each line gets a take. Lines that can't render are left for you to fix.</span>
          </span>
          <span class="mock-render-ch__verb">
            <UiButton intent="secondary" :disabled="!!c.blocked" :loading="chapterBusy" label="▶ Play chapter" @click="playChapter" />
            <span class="jv-hint">{{ c.blocked ? `Not until every line can render — ${chapterBlockedWhy}`
              : `Every line's ★ take in order, ${PAUSE_BETWEEN_LINES_MS} ms apart. A line with no take is rendered first.` }}</span>
          </span>
          <span class="jv-spacer" />
          <span class="mock-render-ch__verb">
            <UiButton intent="secondary" :disabled="!(c.rendered + c.stale)" label="↻ Re-render all" @click="renderAllAgain" />
            <span class="jv-hint">A new take for every line that can render. Old takes are kept.</span>
          </span>
        </div>
        <audio v-if="playing?.key === 'chapter'" :src="playing.url" controls autoplay class="jv-audio-inline" />
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
        :row-class="(r) => ({ 'mock-render-ch__row--open': open === r.id })"
        @row-click="({ data }) => { if (!data.panel) open = open === data.id ? null : data.id; }">
        <template #open="{ row }">
          <span class="jv-muted">{{ open === row.id ? "⌃" : "⌄" }}</span>
        </template>
        <template #speaker="{ row }">
          <span v-if="row.speaker_id" class="mock-render-ch__who">
            <span class="mock-render-ch__av" :style="{ background: avatarColor(row.speaker_id) }">{{ speakerOf(row.speaker_id).name[0] }}</span>
            {{ speakerOf(row.speaker_id).name }}
            <span v-if="overrideSet(row)" class="mock-render-ch__dot" title="This line has its own pace, pitch, gain or pause (This line only)" />
          </span>
          <span v-else class="jv-muted">— nobody —</span>
        </template>
        <template #text="{ row }"><span class="mock-render-ch__text">{{ row.text }}</span></template>
        <template #said="{ row }">
          <span @click.stop>
            <span v-if="directedBy(row) === 'words' && !['needs a speaker', 'needs a voice'].includes(lineState(row))"
              class="mock-render-ch__dir" title="Open the line to change its Style Instructions"
              @click="open = open === row.id ? null : row.id">
              <template v-if="row.direction">“{{ row.direction }}”</template>
              <span v-else class="jv-muted">as {{ personaName(row) }} always speaks</span>
            </span>
            <span v-else-if="directedBy(row) === 'tags' && lineState(row) !== 'needs a voice'"
              class="mock-render-ch__tags" :title="`${modelName(row)} takes tags, not words — ${personaName(row)}'s own, set on the persona`">
              <UiTag v-for="t in standingTags(row)" :key="t" intent="ghost">{{ t }}</UiTag>
              <span v-if="!standingTags(row).length" class="jv-muted">no tags</span>
            </span>
            <span v-else class="jv-muted">{{ saidPlaceholder(row) }}</span>
          </span>
        </template>
        <template #status="{ row }">
          <UiTag :intent="STATE_TAG[lineState(row)]">{{ lineState(row) }}</UiTag>
        </template>
        <template #audio="{ row }">
          <span class="mock-render-ch__audio" @click.stop>
            <template v-if="lineState(row) === 'rendered' || lineState(row) === 'stale'">
              <UiButton intent="ghost" size="small" label="▶" :title="`Play the ★ take (${fmt(liveTake(row).seconds)})`"
                @click="playTake(liveTake(row))" />
              <span class="jv-muted mock-render-ch__len">{{ fmt(liveTake(row).seconds) }}</span>
              <UiButton v-if="lineState(row) === 'stale'" intent="secondary" size="small" label="↻"
                :loading="busy[row.id]" title="Render it again — the old take is kept" @click="gen(row)" />
            </template>
            <UiButton v-else-if="lineState(row) === 'ready'" intent="primary" size="small" label="▶ Gen"
              :loading="busy[row.id]" @click="gen(row)" />
            <UiButton v-else-if="lineState(row) === 'needs a speaker'" intent="secondary" size="small"
              label="Fix in Script" title="Opens Script at this line" @click="goScript" />
            <UiButton v-else-if="!personaOfSpeaker(row.speaker_id)" intent="secondary" size="small"
              :label="`Cast ${speakerOf(row.speaker_id).name.split(' ')[0]}`" @click="goCast" />
            <UiButton v-else intent="secondary" size="small" :label="`Give ${personaName(row)} a voice`"
              @click="goPersona(speakerOf(row.speaker_id).persona_id)" />
          </span>
          <audio v-if="playing && playing.key === liveTake(row)?.id" :src="playing.url" autoplay class="mock-render-ch__hidden" />
        </template>

        <template #full-row="{ row }">
          <div class="jv-linepanel" @click.stop>
            <div class="jv-linepanel__side">
              <div class="jv-linepanel__field">
                <span class="jv-eyebrow">Spoken by</span>
                <span v-if="personaOfSpeaker(row.line.speaker_id)">
                  <strong>{{ speakerOf(row.line.speaker_id).name }}</strong> — played by {{ personaName(row.line) }} ·
                  {{ modelName(row.line) }} · <a href="#" @click.prevent="goCast">Change in Cast ➜</a>
                </span>
                <span v-else-if="row.line.speaker_id">{{ speakerOf(row.line.speaker_id).name }} — nobody plays them yet ·
                  <a href="#" @click.prevent="goCast">Cast them ➜</a></span>
                <span v-else class="jv-muted">Nobody — <a href="#" @click.prevent="goScript">give it a speaker in Script ➜</a></span>
              </div>

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
                  :placeholder="`as ${personaName(row.line)} always speaks`"
                  @blur="(e) => setDirection(row.line, e.target.value)" />
              </UiField>

              <div class="jv-linepanel__field jv-linepanel__field--wide">
                <span class="jv-field-label-row jv-linepanel__wide">
                  <span class="jv-eyebrow">This line only</span>
                  <UiButton intent="ghost" size="small" label="↺ Reset to default" :disabled="!overrideSet(row.line)"
                    :title="`Back to ${personaWord(row.line)} pace, pitch, gain and pause`" @click="clearOverride(row.line)" />
                </span>
                <span class="jv-hint">Pace, pitch, gain and the pause after, for this line alone. The persona's own
                  settings don't change.</span>
                <DeliveryKnobs class="jv-linepanel__wide" :values="row.line.override || {}" :fallback="lineFallback(row.line)"
                  :pauses="['pause_after']" pause-reset
                  :reset-title="(key) => `Back to ${personaWord(row.line)} ${KNOB_WORD[key]}`"
                  @commit="(key, v) => setNum(row.line, key, v)" @reset="(key) => setNum(row.line, key, null)" />
              </div>

              <div class="jv-linepanel__row">
                <UiButton intent="secondary" size="small" label="📕 Pronunciation"
                  :title="`Opens ${BOOK_LEXICON}, the book's lexicon`" @click="pronounce(row.line)" />
                <UiButton intent="secondary" size="small" :disabled="!row.line.speaker_id"
                  :label="row.line.speaker_id ? `✏️ Rewrite as ${speakerOf(row.line.speaker_id).name.split(' ')[0]}` : '✏️ Rewrite in character'"
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
                <span class="jv-takes__len">{{ fmt(t.seconds) }}</span>
                <span class="jv-takes__label">{{ t.label }}</span>
                <UiButton intent="ghost" size="small" label="▶" title="Play" @click="playTake(t)" />
                <UiButton v-if="!t.live" intent="ghost" size="small" label="★" title="Make this the take the chapter plays" @click="makeLive(row.line, t)" />
                <UiButton v-if="!t.live" intent="ghost" size="small" label="🗑" title="Delete this take" @click="deleteTake(row.line, t)" />
              </div>
              <div v-if="!row.line.takes.length" class="jv-takes__row jv-muted">No takes yet.</div>
              <audio v-if="playing && row.line.takes.some((t) => t.id === playing.key)" :src="playing.url" controls autoplay class="jv-audio-inline" />
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

      <p class="jv-hint mock-render-ch__foot">Lines are joined with {{ PAUSE_BETWEEN_LINES_MS }} ms of silence — Settings →
        Generation. A line's own pause (This line only) changes it after that line.</p>
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
          <span class="jv-eyebrow">A — ★ live</span>
          <UiButton intent="secondary" size="small" label="▶ Play A" @click="playTake(liveTake(compare.line))" />
        </div>
        <div class="jv-linepanel__field">
          <span class="jv-eyebrow">B</span>
          <UiSelect v-model="compare.b" width="id" :options="compareOptions" placeholder="Pick a take…" />
          <UiButton intent="secondary" size="small" label="▶ Play B" :disabled="!compare.b"
            @click="playTake(compare.line.takes.find((t) => t.id === compare.b))" />
        </div>
      </div>
      <audio v-if="playing" :src="playing.url" controls autoplay class="jv-audio-inline" />
      <template #footer>
        <UiButton intent="ghost" label="Close" @click="compare = null" />
        <UiButton intent="primary" label="Make B the ★ take" :disabled="!compare.b"
          @click="makeLive(compare.line, compare.line.takes.find((t) => t.id === compare.b)); compare = null" />
      </template>
    </AppModal>

    <AppModal v-if="rewrite" eyebrow="Rewrite in character" :title="speakerOf(rewrite.line.speaker_id)?.name || 'Line'"
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
.mock-render-ch__audio { display: inline-flex; align-items: center; gap: 4px; }
.mock-render-ch__len { font-variant-numeric: tabular-nums; font-size: 12px; }
.mock-render-ch__hidden { display: none; }
.mock-render-ch__compare { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 10px; }
.mock-render-ch__rewrite { display: flex; flex-direction: column; gap: 14px; }
.mock-render-ch__rewrite-field { display: flex; flex-direction: column; gap: 4px; }
.mock-render-ch__quote { margin: 0; padding: 10px 12px; background: var(--surface-2); border-radius: 6px; line-height: 1.5; }
.mock-render-ch__table :deep(.ui-table-row) { cursor: pointer; }
.mock-render-ch__table :deep(.mock-render-ch__row--open) td { background: var(--accent-soft, var(--surface-2)); }
.mock-render-ch__table :deep(.mock-render-ch__panel-row) td { padding: 0; }
</style>
