<!-- SPDX-License-Identifier: MIT -->
<!--
  Studio · Render — one chapter's lines (Studio Slice 4, decided 2026-10-04;
  docs/plans/2026-10-04-slice-4-render.md, drawn first as the in-app mock
  src/components/mock/MockRenderChapter.vue).

  The line is the unit: Speaker · Model · Text · Can be directed · Status ·
  Audio, the status in §8.16's words (GET /v1/scenes/{id}/render_lines).
  Model and Can be directed are the Personas and Voices lists' own words
  (2026-10-06); the cell adds the line's direction on a words model and the
  persona's tags on a tag model. Opening a line
  shows who speaks it (read-only — Cast decides, D2), "Render overrides" —
  the persona page's controls that the line's model takes, and only those,
  for this line (2026-10-06, was D3's closed hatch; stored in the line's
  metadata), 📕 Pronunciation (the
  book's lexicon), ✏️ Rewrite as the speaker (moved here from Script), and its
  takes: every take is kept, and the one ★ In use is what the chapter plays and
  exports (D4). A change to the line or to what it is made from marks it
  stale; you choose when to render it again.

  Shapes: the page head and verbs are Script's chapter page
  (StudioScriptChapter.vue); the grid is the kit's UiTable in .jv-table-look
  with a full-width row for the open line (.jv-linepanel, .jv-takes).
-->
<script setup>
import { computed, nextTick, reactive, ref, watch } from "vue";
import {
  AppModal, UiButton, UiChip, UiField, UiSelect, UiTable, UiTag, UiTextarea,
  confirmDialog, promptDialog, pushToast, useAiTasksStore,
} from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";
import DeliveryKnobs from "./DeliveryKnobs.vue";
import { directionCell, tagCount, voiceKind } from "../services/personaFacts.js";
import { useVoicesStore } from "../stores/voices.js";
import { useCopy } from "../services/copy.js";
import { useKeptScroll } from "../composables/useKeptScroll.js";
import { loadingText, mediaUrl, renderChapter, renderLines, waitingText } from "../services/renderRun.js";
import { facetCounts, facetOptions, facetTotal, passesFilters } from "../services/facets.js";
import { CANT_RENDER_STATES as BLOCKED, lineStateWord } from "../services/lineStates.js";
import { speakerOptions as castChoices } from "../services/scriptReview.js";
import PageTaskStrips from "./PageTaskStrips.vue";
import PagePlayer from "./PagePlayer.vue";
import PlayTransport from "./PlayTransport.vue";
import { usePagePlayer } from "../composables/usePagePlayer.js";

const props = defineProps({
  project: { type: Object, required: true },
  sceneId: { type: String, required: true },
  scenes: { type: Array, default: () => [] },
  // The book's speakers (GET /v1/projects/{id}/speakers): name, persona_id, role_label.
  speakers: { type: Array, default: () => [] },
  // The persona library (PersonaView: model, model_name, directed_by, default_delivery).
  personas: { type: Array, default: () => [] },
  // Bumped by Studio when something it did changed these lines.
  version: { type: Number, default: 0 },
});
const emit = defineEmits(["back", "open", "go", "changed"]);

const api = useApi();
const copy = useCopy();
const word = computed(() => copy.value.chapter);
const PAUSE_SETTING_MS = ref(600);
// After a line that ends one of the book's scenes (`scene_end`, 2026-10-06).
const SCENE_BREAK_MS = ref(2000);
// Between two lines of one paragraph (`paragraph_next`, 2026-10-07).
const PARAGRAPH_MS = ref(250);

// ── The page ─────────────────────────────────────────────────────────
const page = ref(null);
const loadError = ref("");
async function load() {
  const id = props.sceneId;
  try {
    const r = await api.request(`/v1/scenes/${id}/render_lines`);
    if (id !== props.sceneId) return;
    page.value = r;
    loadError.value = "";
  } catch (e) {
    if (id === props.sceneId) loadError.value = String(e?.message || e);
  }
}
async function loadPause() {
  const s = await api.safeRequest("/v1/settings", null);
  const ms = s?.generation?.pause_between_lines_ms;
  if (Number.isFinite(ms)) PAUSE_SETTING_MS.value = ms;
  const brk = s?.generation?.pause_at_scene_break_ms;
  if (Number.isFinite(brk)) SCENE_BREAK_MS.value = brk;
  const para = s?.generation?.pause_within_paragraph_ms;
  if (Number.isFinite(para)) PARAGRAPH_MS.value = para;
}
// What each model takes — the persona page's own source (its knobs, its tag
// sets, the app's emotion words), read once.
const caps = ref({});
const emotionValues = ref([]);
async function loadCaps() {
  const r = await api.safeRequest("/v1/engines/capabilities", { engines: {} });
  caps.value = r?.engines || {};
  emotionValues.value = r?.emotion_values || [];
}

const lines = computed(() => page.value?.lines || []);
// How many of the book's scenes end inside this chapter — the pause words name the
// scene-break pause only when there is one.
const sceneBreaks = computed(() => lines.value.filter((l) => l.scene_end).length);
const paragraphJoins = computed(() => lines.value.filter((l) => l.paragraph_next).length);
// "(250 ms within a paragraph, 2000 ms at a scene break)" — only the joins this chapter has.
const otherPauses = computed(() => [
  paragraphJoins.value ? `${PARAGRAPH_MS.value} ms within a paragraph` : "",
  sceneBreaks.value ? `${SCENE_BREAK_MS.value} ms at a scene break` : "",
].filter(Boolean).join(", "));
const counts = computed(() => page.value?.counts || {});
const blocked = computed(() => (counts.value.needs_speaker || 0) + (counts.value.needs_voice || 0));
const scene = computed(() => props.scenes.find((s) => s.id === props.sceneId) || null);
const title = computed(() => {
  const s = scene.value;
  return s ? `${s.position + 1} · ${s.title || `${word.value.singular} ${s.position + 1}`}` : "";
});
const order = computed(() => [...props.scenes].sort((a, b) => a.position - b.position));
const at = computed(() => order.value.findIndex((s) => s.id === props.sceneId));
const prevChapter = computed(() => order.value[at.value - 1] || null);
const nextChapter = computed(() => order.value[at.value + 1] || null);
const chapterName = (s) => `${s.position + 1} · ${s.title || `${word.value.singular} ${s.position + 1}`}`;

const root = ref(null);
useKeptScroll(root);

// ── Who speaks, and how their model is directed ──────────────────────
const speakersById = computed(() => Object.fromEntries(props.speakers.map((s) => [s.id, s])));
const personasById = computed(() => Object.fromEntries(props.personas.map((p) => [p.id, p])));
const speakerOf = (l) => speakersById.value[l.speaker_id] || null;
const personaOf = (l) => personasById.value[speakerOf(l)?.persona_id] || null;
// A Designed voice is drawn from its description on every render, so a new seed
// can change who speaks (C6, 2026-10-06 — the hint keyed on written direction).
const voicesStore = useVoicesStore();
void voicesStore.ensureLoaded();
const designedVoice = (l) =>
  voiceKind(voicesStore.items.find((v) => v.id === personaOf(l)?.voice_id)) === "design";
const speakerName = (l) => speakerOf(l)?.name || "—";
const firstName = (l) => speakerName(l).split(" ")[0];

// ── Who says the line — the same picker as Script's (decided 2026-10-05) ──
// So a wrong speaker heard while rendering is fixed on the spot. It saves
// through Script's own request; the line then reads stale (its persona
// changed) until it is rendered again. The VOICE stays Cast's (D2, 2026-10-04).
const narratorId = computed(() => props.speakers.find((s) => s.role_label === "narrator")?.id || null);
const speakerChoices = computed(() => castChoices(props.speakers.map((s) => ({
  speaker_id: s.id, name: s.name, lines: lines.value.filter((l) => l.speaker_id === s.id).length,
})), narratorId.value));
const speakerBusy = reactive({});
async function changeSpeaker(l, speakerId) {
  if (!speakerId || speakerId === l.speaker_id) return;
  // Script's rule: on a chapter Analyze never ran on, a speaker you give is not
  // marked as yours — "corrected" would freeze it against every future Analyze.
  const analyzed = !!props.scenes.find((sc) => sc.id === props.sceneId)?.metadata?.analyzed_at;
  speakerBusy[l.block_id] = true;
  try {
    await api.request(`/v1/blocks/${l.block_id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(analyzed ? { speaker_id: speakerId, source: "corrected" } : { speaker_id: speakerId }),
    });
    await load();
    emit("changed", { sceneId: props.sceneId });
  } catch (e) {
    pushToast({ kind: "error", message: `The speaker didn't change: ${e?.message || e}`, duration: 7000 });
  } finally {
    speakerBusy[l.block_id] = false;
  }
}
function standingTags(l) {
  const p = personaOf(l);
  const m = p?.default_delivery?.models?.[p?.model] || {};
  return [m.emotion, m.register_tag].filter(Boolean).map((t) => `[${t}]`);
}
const AVATAR = ["#5b7a99", "#c98aa7", "#3a7d63", "#8a6d3b", "#6a5acd", "#b07a2a", "#b3552e", "#4f6f6f", "#7a7a7a"];
function avatarColor(id) {
  let h = 0;
  for (const ch of String(id || "")) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR[h % AVATAR.length];
}
const fmt = (s) => {
  const n = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};
const STATE_TAG = {
  rendered: "success", stale: "accent2", ready: "ghost", "needs a speaker": "danger", "needs a voice": "danger",
};

// ── Filters ──────────────────────────────────────────────────────────
const filter = ref("all");
const speakerFilter = ref("all");
// The chips and the speaker filter, each counted under the other (decided
// 2026-10-05, services/facets.js) — the chips were the chapter's totals, so
// "Stale 12" under one speaker showed 2, and "Can't render" + a speaker showed
// nothing.
const stateIs = (l, f) => (f === "blocked" ? BLOCKED.has(l.state) : l.state === f);
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
  { id: "ready", label: "Ready", n: chipN.value.ready, tip: "Lines with no take yet" },
  { id: "stale", label: "Stale", n: chipN.value.stale,
    tip: "Something the take was made from changed since — render it again when you choose" },
  { id: "rendered", label: "Rendered", n: chipN.value.rendered },
  { id: "blocked", label: "Can't render", n: chipN.value.blocked },
]);
const speakerOptions = computed(() => {
  const names = Object.fromEntries(lines.value.filter((l) => l.speaker_id).map((l) => [l.speaker_id, speakerName(l)]));
  return [{ value: "all", label: "Every speaker" },
    ...facetOptions(lines.value, lineFilters.value, "speaker", (l) => l.speaker_id, (id, n) => `${names[id] || "—"} · ${n}`)];
});
const inFilter = (l) => passesFilters(l, lineFilters.value);
const open = ref(null);   // the block whose panel is open
const rows = computed(() => {
  const out = [];
  for (const l of lines.value) {
    if (!inFilter(l)) continue;
    out.push(l);
    if (open.value === l.block_id) out.push({ block_id: `${l.block_id}__panel`, panel: true, line: l });
  }
  return out;
});
// A different chapter starts clean; the parent's version bump re-reads this one.
watch(() => props.sceneId, () => {
  page.value = null;
  open.value = null;
  filter.value = "all";
  speakerFilter.value = "all";
  load();
}, { immediate: true });
watch(() => props.version, load);
loadPause();
loadCaps();

const NARROW = { width: "1%", whiteSpace: "nowrap" };
const COLUMNS = [
  { id: "open", header: "", headerStyle: NARROW, cellStyle: NARROW },
  { id: "speaker", header: "Speaker", cellStyle: { whiteSpace: "nowrap" } },
  // The model and how it can be directed — the Personas and Voices lists' own
  // columns and words (decided 2026-10-06: one fact, the same words everywhere).
  { id: "model", header: "Model", cellStyle: { whiteSpace: "nowrap" } },
  { id: "text", header: "Text" },
  { id: "said", header: "Can be directed", headerStyle: { width: "26%" } },
  { id: "status", header: "Status", headerStyle: NARROW, cellStyle: NARROW },
  { id: "audio", header: "Audio", headerStyle: NARROW, cellStyle: { ...NARROW, textAlign: "right" } },
];

// ── Saving a line ────────────────────────────────────────────────────
async function patchBlock(l, body) {
  try {
    await api.request(`/v1/blocks/${l.block_id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    await load();
    emit("changed", { sceneId: props.sceneId });
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't save the line: ${e?.message || e}` });
  }
}
function setDirection(l, v) {
  const next = (v || "").trim();
  if (next === (l.direction || "")) return;
  patchBlock(l, { direction: next });
}
// The line's direction is the persona page's Style Instructions field, in the
// open line (decided 2026-10-06 — "render overrides should work look and act
// the same"), shown only when the line's model takes written direction: on
// Render the voice is fixed, so a control its model can't use is not shown
// ("i only want to show controls for that voice" — the persona page greys
// them instead, because there you are still choosing the voice).
const takesWords = (l) => personaOf(l)?.directed_by === "words";
// The persona page's own explanation, for a line.
const directionHint = () => "Added after its persona's Style Instructions.";
const paceNative = (l) => !!rowOf(l)?.speed_native;

// ── ✎ Edit words — the same save as Script's ✎ Edit… (decided 2026-10-06) ──
const editing = reactive({});   // block_id → the words being edited
const wordsChanged = (l) => {
  const w = (editing[l.block_id] || "").trim();
  return !!w && w !== l.text;
};
async function saveWords(l) {
  const words = (editing[l.block_id] || "").trim();
  delete editing[l.block_id];
  if (words && words !== l.text) await patchBlock(l, { text: words });
}

// ── Rendering ────────────────────────────────────────────────────────
const busy = reactive({});      // block_id → true while its render runs
async function renderOne(l, { newTake = false } = {}) {
  busy[l.block_id] = true;
  try {
    await api.request(`/v1/blocks/${l.block_id}/render`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ new_take: newTake }),
    });
    await load();
    if (open.value === l.block_id) await loadTakes(l.block_id);
    emit("changed", { sceneId: props.sceneId });
  } catch (e) {
    pushToast({ kind: "error", message: `Render failed: ${e?.message || e}`, duration: 7000 });
  } finally {
    busy[l.block_id] = false;
  }
}
// "ready" | "all" | "chapter" while a whole-chapter run goes — per chapter (decided
// 2026-10-07: chapter 1's run greyed out chapter 2's buttons when you opened it).
const runs = reactive({});      // scene id → its run
const running = computed(() => runs[props.sceneId] || "");

// A render of this chapter, wherever it was started — here or the chapter list
// (decided 2026-10-07): the page re-reads its lines as each one lands, lights the
// line rendering now, and says which lines wait in the run.
const aiTasks = useAiTasksStore();
const liveRun = computed(() => aiTasks.visibleTasks.find((t) => ["render-lines", "render-scene"].includes(t.feature)
  && t.meta?.sceneId === props.sceneId && aiTasks.isRunning(t.id)) || null);
const runState = (blockId) => liveRun.value?.render?.lines?.[blockId] || "";
// The three whole-chapter runs wait for any run of this chapter, wherever it
// started — one from the chapter list left them open (2026-10-07).
const runBusy = computed(() => !!running.value || !!liveRun.value);
watch(() => liveRun.value?.render?.done, (n, was) => { if (n && n !== was) load(); });
watch(() => !!liveRun.value, (on, was) => { if (was && !on) load(); });
const lineName = (c) => `line ${c.n}${c.speaker ? ` · ${c.speaker}` : ""}`;
// The strip names the line rendering now; clicking it brings that line into
// view (no following on its own — it would pull the page away while you read).
async function goToLine(blockId) {
  if (!rows.value.some((r) => r.block_id === blockId)) {
    filter.value = "all";
    speakerFilter.value = "all";
  }
  await nextTick();
  root.value?.querySelector("tr.jv-row--flag")?.scrollIntoView({ block: "center", behavior: "smooth" });
}

async function runLines(which) {
  const id = props.sceneId;
  runs[id] = which;
  try {
    await renderLines(api, { sceneId: id, title: title.value, which });
  } catch (e) {
    if (e?.name !== "AbortError") pushToast({ kind: "error", message: `Render failed: ${e?.message || e}`, duration: 7000 });
  } finally {
    delete runs[id];
    await load();
    emit("changed", { sceneId: props.sceneId });
  }
}
// One player for the page (decided 2026-10-07): every ▶ drives it, and its
// controls show where that ▶ is. Keys: "chapter", "row:<take>" (the grid),
// "take:<take>" (a line's Takes), "cmp:<take>" (Compare).
const player = usePagePlayer();
async function playChapter() {
  const id = props.sceneId;
  runs[id] = "chapter";
  try {
    const r = await renderChapter(api, {
      sceneId: id, projectId: props.project.id, title: title.value, onRetry: playChapter,
    });
    // Played only where it was asked for — another chapter may be open by now.
    if (r?.url && props.sceneId === id) player.play("chapter", r.url);
  } catch (e) {
    if (e?.name !== "AbortError") pushToast({ kind: "error", message: `${e?.message || e}`, duration: 9000 });
  } finally {
    delete runs[id];
    await load();
    emit("changed", { sceneId: props.sceneId });
  }
}
function play(key, path) {
  player.play(key, mediaUrl(api, path));
}

// ── Takes ────────────────────────────────────────────────────────────
const takes = reactive({});     // block_id → [TakeResponse], newest first
async function loadTakes(blockId) {
  const r = await api.safeRequest(`/v1/takes/by_block/${blockId}`, { takes: [] });
  takes[blockId] = r?.takes || [];
}
watch(open, (id) => {
  if (id) loadTakes(id);
  // A take played from the panel stops with it, as its own player did.
  if (String(player.key).startsWith("take:")) player.stop();
});
function takeName(list, t) {
    if (t.is_default) return "★ In use";
  return `take ${list.length - list.indexOf(t)}`;
}
async function makeLive(l, t) {
  try {
    await api.request(`/v1/takes/${t.id}/set_default`, { method: "POST" });
    await Promise.all([load(), loadTakes(l.block_id)]);
    emit("changed", { sceneId: props.sceneId });
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't choose that take: ${e?.message || e}` });
  }
}
// The take in use can go too (decided 2026-10-07): it asks first, and the
// server puts the newest take left in use — or the line goes back to Ready.
async function deleteTake(l, t) {
  if (t.is_default) {
    const list = takes[l.block_id] || [];
    const next = list.find((x) => x.id !== t.id);
    const unit = word.value.singular.toLowerCase();
    const ok = await confirmDialog(next
      ? {
          title: "Delete the take in use?",
          message: `${takeName(list, next).replace(/^t/, "T")} (${fmt(next.seconds)}) becomes the one the ${unit} plays. This take's audio is deleted.`,
          confirmLabel: "Delete take", danger: true,
        }
      : {
          title: "Delete this line's only take?",
          message: `The line goes back to Ready, and Play ${unit} renders it again.`,
          confirmLabel: "Delete take", danger: true,
        });
    if (!ok) return;
  }
  try {
    await api.request(`/v1/takes/${t.id}`, { method: "DELETE" });
    if (String(player.key).endsWith(`:${t.id}`)) player.stop();
    await Promise.all([load(), loadTakes(l.block_id)]);
    if (t.is_default) emit("changed", { sceneId: props.sceneId });
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't delete the take: ${e?.message || e}` });
  }
}

// Compare two takes of one line.
const compare = ref(null);   // { line, b }
function openCompare(l) {
  const other = (takes[l.block_id] || []).find((t) => !t.is_default);
  compare.value = { line: l, b: other?.id || "" };
}
const compareTakes = computed(() => (compare.value ? takes[compare.value.line.block_id] || [] : []));
const compareOptions = computed(() => compareTakes.value.filter((t) => !t.is_default)
  .map((t) => ({ value: t.id, label: `${takeName(compareTakes.value, t)} · ${fmt(t.seconds)}` })));
const compareA = computed(() => compareTakes.value.find((t) => t.is_default) || null);
const compareB = computed(() => compareTakes.value.find((t) => t.id === compare.value?.b) || null);
// Compare's takes stop when it closes or B changes, as its own player did.
watch(() => compare.value?.b, () => {
  if (String(player.key).startsWith("cmp:") && player.key !== `cmp:${compareA.value?.id}`) player.stop();
});
watch(compare, (c) => { if (!c && String(player.key).startsWith("cmp:")) player.stop(); });

// ── Render overrides — open, the persona page's controls (2026-10-06; was D3's
// closed hatch). A set value puts a dot on the row. The line stores
// `pause_after_ms`; the knobs say `pause_after`, as the persona does.
const overrideSet = (l) => Object.keys(l.override || {}).length > 0;
const OVERRIDE_KEY = { speed: "speed", pitch: "pitch", gain_db: "gain_db", pause_after: "pause_after_ms" };
function personaDefault(l, key) {
  const d = personaOf(l)?.default_delivery || {};
  if (key === "speed") return d.speed ?? 1;
  if (key === "pitch") return d.pitch ?? 0;
  if (key === "gain_db") return d.gain_db ?? 0;
  // A scene's last line is followed by the scene-break pause, a line whose next line is in
  // its paragraph by the paragraph's — whatever its persona says.
  if (l.scene_end) return SCENE_BREAK_MS.value;
  if (l.paragraph_next) return PARAGRAPH_MS.value;
  return d.pause_after ?? PAUSE_SETTING_MS.value;
}
// What the knobs show: the line's own values (by the knobs' keys) and, for an
// untouched one, the persona's.
const lineValues = (l) => Object.fromEntries(Object.entries(OVERRIDE_KEY).map(([k, o]) => [k, l.override?.[o] ?? null]));
const lineFallback = (l) => Object.fromEntries(Object.keys(OVERRIDE_KEY).map((k) => [k, personaDefault(l, k)]));
// Saved when a slider is let go or the pause box is left. A value equal to the
// persona's is saved as none, so an untouched line stays untouched.
function setNum(l, key, v) {
  let value = v === "" || v === null || v === undefined ? null : Number(v);
  if (value !== null && value === Number(personaDefault(l, key))) value = null;
  const field = OVERRIDE_KEY[key];
  if ((l.override?.[field] ?? null) === value) return;
  patchBlock(l, { line_override: { [field]: value } });
}
// ↺ Reset to default: everything the line sets for itself — the numbers, its
// settings for every model, its Style Instructions — so it speaks as its persona.
const lineChanged = (l) => overrideSet(l) || !!l.direction;
function resetOverrides(l) {
  const numbers = Object.keys(l.override || {}).filter((k) => k !== "models").map((k) => [k, null]);
  const body = { line_override: { ...Object.fromEntries(numbers), models: null } };
  if (l.direction) body.direction = "";
  patchBlock(l, body);
}

// ── What the line's model takes, and only that (decided 2026-10-06: Render
// works like the persona page, but hides what the model can't use) ──
const modelOf = (l) => personaOf(l)?.model || "";
const rowOf = (l) => caps.value[modelOf(l)] || null;
const tagSetOf = (l, category) => (rowOf(l)?.inline_tags || []).find((t) => t.category === category) || null;
function emotionChoices(l) {
  const tags = tagSetOf(l, "emotion");
  if (tags) return tags.tags;
  return takesWords(l) ? emotionValues.value : [];
}
// The persona's settings for the model, and the line's own on top.
const personaMs = (l) => personaOf(l)?.default_delivery?.models?.[modelOf(l)] || {};
const lineMs = (l) => l.override?.models?.[modelOf(l)] || {};
const lineHas = (l, key) => Object.hasOwn(lineMs(l), key);
const wordValue = (l, key) => (lineHas(l, key) ? lineMs(l)[key] : personaMs(l)[key]) || "";
// Emotion / register: the persona's value is saved as none; "" = none on this line.
function setWord(l, key, v) {
  const model = modelOf(l);
  if (!model) return;
  const value = (v || "") === (personaMs(l)[key] || "") ? null : v || "";
  if ((lineHas(l, key) ? lineMs(l)[key] : null) === value) return;
  patchBlock(l, { line_override: { models: { [model]: { [key]: value } } } });
}
// Sampling: the model's own knobs, as its capability row lists them — minus
// speed (Pace) and seed (↻ New take).
const modelKnobs = (l) => (rowOf(l)?.knobs || []).filter((k) => k.key !== "speed" && k.key !== "seed")
  .map((k) => ({ key: k.key, label: k.label, min: k.min, max: k.max, step: k.step, neutral: Number(k.default), unit: k.unit || "", hint: k.hint }));
const knobFallback = (l) => Object.fromEntries(modelKnobs(l).map((k) => [k.key, personaMs(l).knobs?.[k.key] ?? k.neutral]));
function setKnob(l, key, v) {
  const model = modelOf(l);
  if (!model) return;
  let value = v === null || v === undefined || v === "" ? null : Number(v);
  if (value !== null && value === Number(knobFallback(l)[key])) value = null;
  if ((lineMs(l).knobs?.[key] ?? null) === value) return;
  patchBlock(l, { line_override: { models: { [model]: { knobs: { [key]: value } } } } });
}
const KNOB_WORD = { speed: "pace", pitch: "pitch", gain_db: "gain", pause_after: "pause after" };
const personaWord = (l) => (personaOf(l)?.name ? `persona ${personaOf(l).name}'s` : "the persona's");

// ── Rewrite as the speaker (moved here from Script, decided 2026-09-29) ─
const rewrite = ref(null);   // { line, text, busy, error }
async function runRewrite() {
  const r = rewrite.value;
  if (!r) return;
  r.busy = true;
  r.error = "";
  r.text = "";
  try {
    const out = await api.request(`/v1/speakers/${r.line.speaker_id}/rewrite`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: r.line.text }),
    });
    r.text = out?.text || out?.rewritten || "";
    if (!r.text) r.error = "The model returned nothing — try again.";
  } catch (e) {
    r.error = `Rewrite failed: ${e?.message || e}`;
  } finally {
    r.busy = false;
  }
}
function openRewrite(l) {
  rewrite.value = { line: l, text: "", busy: true, error: "" };
  runRewrite();
}
async function acceptRewrite() {
  const { line, text } = rewrite.value;
  rewrite.value = null;
  await patchBlock(line, { text: text.trim() });
}
// Every line with a speaker, narration included (decided 2026-10-06, "your rec
// on all go": the narrator is an ordinary persona and can have a style).
function rewriteTitle(l) {
  if (!l.speaker_id) return "Give this line a speaker first.";
  return "Reads who they are on Cast, and offers the line in their words";
}

// ── 📕 Pronunciation — the book's lexicon, made if it has none ─────────
async function pronounce(l) {
  let word = "";
  const sel = String(window.getSelection?.() || "").trim();
  if (sel && sel.length <= 60 && (l.text || "").includes(sel)) word = sel;
  else {
    word = (await promptDialog({
      title: "Fix a pronunciation",
      message: "Which word or name is read wrong? Leave it empty to just open the book's lexicon.",
      placeholder: "e.g. Halvorn",
    }))?.trim() ?? null;
    if (word === null) return;
  }
  try {
    const lex = await api.request(`/v1/projects/${props.project.id}/lexicon`, { method: "POST" });
    try {
      window.sessionStorage?.setItem("jv.lexicon.prefill", JSON.stringify({ grapheme: word, lexiconId: lex.lexicon_id }));
    } catch { /* private mode — the page still opens */ }
    if (lex.created) pushToast({ kind: "info", message: `“${lex.name}” made — this book's lexicon (Overview → Pronunciation lexicon).` });
    window.location.hash = "#lexicons";
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't open the book's lexicon: ${e?.message || e}` });
  }
}

// ── What can't render, and where it is fixed ─────────────────────────
function goPersona(id) {
  window.location.hash = `#/personas/${id}`;
}
const blockedBanner = computed(() => {
  const parts = [];
  if (counts.value.needs_speaker) {
    const n = counts.value.needs_speaker;
    parts.push({ text: `${n} ${n === 1 ? "has" : "have"} no speaker`, link: "fix in Script", go: () => emit("go", "script") });
  }
  const seen = new Set();
  for (const l of lines.value) {
    if (l.state !== "needs a voice" || seen.has(l.speaker_id)) continue;
    seen.add(l.speaker_id);
    const p = personaOf(l);
    parts.push(p
      ? { text: `persona ${p.name} (who plays ${speakerName(l)}) has no voice`, link: "fix on Personas",
          go: () => goPersona(p.id) }
      : { text: `${speakerName(l)} has no persona`, link: "fix in Cast", go: () => emit("go", "cast") });
  }
  return parts;
});
const chapterBlockedWhy = computed(() => blockedBanner.value.map((p) => p.text).join("; "));
</script>

<template>
  <section ref="root" class="studio-render-ch">
    <PagePlayer :player="player" />
    <div class="jv-inline-row">
      <UiButton intent="ghost" size="small" :label="`← All ${word.plural.toLowerCase()}`" @click="emit('back')" />
    </div>

    <div v-if="loadError && !page" class="jv-banner jv-banner--danger">Couldn't load this {{ word.singular.toLowerCase() }}: {{ loadError }}</div>

    <template v-if="page">
      <div class="jv-card">
        <div class="jv-card__header">
          <h3 class="jv-card__title">{{ title }}</h3>
          <span class="jv-hint">{{ counts.lines }} lines · {{ counts.rendered }} rendered · {{ counts.stale }} stale ·
            {{ counts.ready }} ready{{ blocked ? ` · ${blocked} can't render` : "" }}</span>
        </div>
        <div class="jv-card__body">
          <p class="jv-lede">
            Render turns each line into audio. Every take is kept, and the one ★ In use is what the
            {{ word.singular.toLowerCase() }} plays and exports. Changing a line, or what it is made from, marks it
            stale — it plays its take in use until you render it again.
          </p>
          <div class="studio-render-ch__verbs">
            <span class="studio-render-ch__verb">
              <UiButton intent="primary" :disabled="!counts.ready || runBusy" :loading="running === 'ready'"
                :label="`⚡ Render ${counts.ready || 0} ready`" @click="runLines('ready')" />
              <span class="jv-hint">Each line gets a take. Lines that can't render are left for you to fix.</span>
            </span>
            <span class="studio-render-ch__verb">
              <UiButton intent="secondary" :disabled="!!blocked || runBusy" :loading="running === 'chapter'"
                :label="`▶ Play ${word.singular.toLowerCase()}`" @click="playChapter" />
              <span class="jv-hint">{{ blocked ? `Not until every line can render — ${chapterBlockedWhy}.`
                : `Every line's take in use, in order, ${PAUSE_SETTING_MS} ms apart${otherPauses ? ` (${otherPauses})` : ""}. A line with no take is rendered first.` }}</span>
            </span>
            <span class="jv-spacer" />
            <span class="studio-render-ch__verb">
              <UiButton intent="secondary" :disabled="!(counts.rendered + counts.stale) || runBusy"
                :loading="running === 'all'" label="↻ Re-render all" @click="runLines('all')" />
              <span class="jv-hint">A new take for every line that can render. Old takes are kept.</span>
            </span>
          </div>
          <PageTaskStrips :features="['render-lines', 'render-scene']" :meta="{ sceneId }">
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

      <div v-if="blockedBanner.length" class="jv-banner jv-banner--warn studio-render-ch__banner">
        <span><strong>{{ blocked }} line{{ blocked === 1 ? " can't" : "s can't" }} render.</strong>{{ " " }}<template
            v-for="(p, i) in blockedBanner" :key="i">{{ i ? " " : "" }}{{ p.text }} — <a href="#"
            @click.prevent="p.go()">{{ p.link }}</a>.</template>
        </span>
      </div>

      <div class="jv-card studio-render-ch__lines">
        <div class="jv-inline-row studio-render-ch__bar">
          <UiChip v-for="ch in CHIPS" :key="ch.id" :selected="filter === ch.id" :title="ch.tip || ''"
            @click="filter = ch.id">{{ ch.label }} {{ ch.n }}</UiChip>
          <UiSelect v-model="speakerFilter" width="name" :options="speakerOptions" />
        </div>

        <UiTable class="jv-table-look ui-table-top studio-render-ch__table" :data="rows" :columns="COLUMNS" data-key="block_id"
          :full-width-row="(r) => (r.panel ? 'studio-render-ch__panel-row' : false)"
          :row-class="(r) => ({ 'jv-row--selected': open === r.block_id, 'jv-row--flag': runState(r.block_id) === 'running' })"
          @row-click="({ data }) => { if (!data.panel) open = open === data.block_id ? null : data.block_id; }">
          <template #open="{ row }"><span class="jv-muted">{{ open === row.block_id ? "⌃" : "⌄" }}</span></template>
          <template #speaker="{ row }">
            <span v-if="row.speaker_id" class="studio-render-ch__who">
              <span class="studio-render-ch__av" :style="{ background: avatarColor(row.speaker_id) }">{{ speakerName(row)[0] }}</span>
              {{ speakerName(row) }}
              <span v-if="overrideSet(row)" class="studio-render-ch__dot" title="This line has render overrides" />
            </span>
            <span v-else class="jv-muted">— no speaker —</span>
          </template>
          <template #text="{ row }"><span class="studio-render-ch__text">{{ row.text }}</span></template>
          <template #model="{ row }">
            <span v-if="personaOf(row)?.model_name">{{ personaOf(row).model_name }}</span>
            <span v-else class="jv-muted">—</span>
          </template>
          <template #said="{ row }">
            <span v-if="personaOf(row)" class="studio-render-ch__said" @click.stop>
              <UiTag :intent="directionCell(personaOf(row).directed_by, tagCount(rowOf(row))).intent"
                :title="directionCell(personaOf(row).directed_by).title">{{
                  directionCell(personaOf(row).directed_by, tagCount(rowOf(row))).label }}</UiTag>
              <span v-if="personaOf(row).directed_by === 'words'" class="studio-render-ch__dir"
                title="Open the line to change its Style Instructions"
                @click="open = open === row.block_id ? null : row.block_id">
                <template v-if="row.direction">“{{ row.direction }}”</template>
                <span v-else class="jv-muted">as persona {{ personaOf(row).name }} always speaks</span>
              </span>
              <span v-else-if="personaOf(row).directed_by === 'tags'" class="studio-render-ch__tags">
                <UiTag v-for="t in standingTags(row)" :key="t" intent="ghost">{{ t }}</UiTag>
              </span>
            </span>
            <span v-else class="jv-muted">—</span>
          </template>
          <template #status="{ row }">
            <UiTag v-if="runState(row.block_id) === 'running'" intent="info">rendering…</UiTag>
            <UiTag v-else-if="runState(row.block_id) === 'pending'" intent="ghost" title="Waiting in this run">queued</UiTag>
            <UiTag v-else :intent="STATE_TAG[row.state]">{{ lineStateWord(row.state, { hasPersona: !!speakerOf(row)?.persona_id }) }}</UiTag>
          </template>
          <template #audio="{ row }">
            <span class="studio-render-ch__audio" @click.stop>
              <template v-if="row.live">
                <UiButton intent="ghost" size="small" :label="player.isPlaying(`row:${row.live.take_id}`) ? '⏸' : '▶'"
                  :disabled="!row.live.audio_url"
                  :title="!row.live.audio_url ? 'This take has no audio — render it again'
                    : player.isPlaying(`row:${row.live.take_id}`) ? 'Pause' : `Play the take in use (${fmt(row.live.seconds)})`"
                  @click="play(`row:${row.live.take_id}`, row.live.audio_url)" />
                <PlayTransport v-if="player.key === `row:${row.live.take_id}`" :player="player" />
                <span v-else class="jv-muted studio-render-ch__len">{{ fmt(row.live.seconds) }}</span>
                <UiButton v-if="row.state === 'stale'" intent="secondary" size="small" label="↻" :loading="busy[row.block_id]"
                  :disabled="!!running" title="Render it again — the old take is kept" @click="renderOne(row)" />
              </template>
              <UiButton v-else-if="row.state === 'ready'" intent="primary" size="small" label="▶ Gen"
                :loading="busy[row.block_id]" :disabled="!!running" @click="renderOne(row)" />
              <UiButton v-else-if="row.state === 'needs a speaker'" intent="secondary" size="small" label="Fix in Script"
                title="Opens Script" @click="emit('go', 'script')" />
              <UiButton v-else-if="!personaOf(row)" intent="secondary" size="small" :label="`Cast ${firstName(row)}`"
                @click="emit('go', 'cast')" />
              <UiButton v-else intent="secondary" size="small" :label="`Give persona ${personaOf(row).name} a voice`"
                @click="goPersona(personaOf(row).id)" />
            </span>
          </template>

          <template #full-row="{ row }">
            <div class="jv-linepanel" @click.stop>
              <div class="jv-linepanel__side">
                <div class="jv-linepanel__field">
                  <span class="jv-eyebrow">Speaker</span>
                  <span class="jv-inline-row">
                    <UiSelect :model-value="row.line.speaker_id" width="name" :options="speakerChoices"
                      placeholder="— no speaker —" :disabled="!!speakerBusy[row.line.block_id]"
                      title="Who says this line in the book — the same choice as Script's"
                      @update:model-value="(v) => changeSpeaker(row.line, v)" />
                    <span v-if="personaOf(row.line)">Cast: persona {{ personaOf(row.line).name }}<template
                      v-if="personaOf(row.line).model_name"> · {{ personaOf(row.line).model_name }}</template> ·
                      <a href="#" @click.prevent="emit('go', 'cast')">Change in Cast ➜</a></span>
                    <span v-else-if="row.line.speaker_id" class="jv-muted">no persona yet ·
                      <a href="#" @click.prevent="emit('go', 'cast')">Cast them ➜</a></span>
                  </span>
                </div>

                <div class="jv-card jv-linepanel__wide">
                  <div class="jv-card__header">
                    <h3 class="jv-card__title">Render overrides</h3>
                    <UiButton intent="ghost" size="small" label="↺ Reset to default" :disabled="!lineChanged(row.line)"
                      title="Every override back to its persona's" @click="resetOverrides(row.line)" />
                  </div>
                  <div class="jv-card__body jv-col">
                  <DeliveryKnobs class="jv-linepanel__wide" :values="lineValues(row.line)" :fallback="lineFallback(row.line)"
                    :pauses="['pause_after']" pause-reset
                    :reset-title="(key) => `Back to ${personaWord(row.line)} ${KNOB_WORD[key]}`"
                    @commit="(key, v) => setNum(row.line, key, v)" @reset="(key) => setNum(row.line, key, null)" />
                  <p v-if="personaOf(row.line) && !paceNative(row.line)" class="jv-hint">Pace is time-stretched after
                    {{ personaOf(row.line).model_name }} speaks — it doesn't pace itself.</p>

                  <UiField v-if="takesWords(row.line)" layout="block" class="jv-linepanel__wide" :hint="directionHint(row.line)">
                    <template #label>
                      <span class="jv-field-label-row">
                        <span>Style Instructions (optional)</span>
                        <span class="jv-inline-row">
                          <UiTag intent="success">✓ {{ personaOf(row.line).model_name }}</UiTag>
                          <UiButton intent="ghost" size="small" label="↺" :disabled="!row.line.direction"
                            title="Clear this line's Style Instructions" @click="setDirection(row.line, '')" />
                        </span>
                      </span>
                    </template>
                    <UiTextarea :model-value="row.line.direction" :rows="2"
                      :placeholder="`as persona ${personaOf(row.line).name} always speaks`"
                      @blur="(e) => setDirection(row.line, e.target.value)" />
                  </UiField>

                  <div v-if="emotionChoices(row.line).length || tagSetOf(row.line, 'register')" class="jv-field-row">
                    <UiField v-if="emotionChoices(row.line).length" layout="block">
                      <template #label>
                        <span class="jv-field-label-row">
                          <span>{{ tagSetOf(row.line, 'emotion') ? `Emotion — ${personaOf(row.line).model_name}'s own tags` : "Emotion" }}</span>
                          <UiButton intent="ghost" size="small" label="↺" :disabled="!lineHas(row.line, 'emotion')"
                            :title="`Back to ${personaWord(row.line)} emotion`" @click="setWord(row.line, 'emotion', personaMs(row.line).emotion || '')" />
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
                            :title="`Back to ${personaWord(row.line)} register`" @click="setWord(row.line, 'register_tag', personaMs(row.line).register_tag || '')" />
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
                      <strong>Sampling</strong><span class="jv-hint">{{ personaOf(row.line).model_name }}</span>
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
                    title="Opens the book's lexicon — select a word in the line first to add it" @click="pronounce(row.line)" />
                  <UiButton intent="secondary" size="small" :disabled="!row.line.speaker_id"
                    :label="row.line.speaker_id ? `✏️ Rewrite as ${firstName(row.line)}` : '✏️ Rewrite as the speaker'"
                    :title="rewriteTitle(row.line)" @click="openRewrite(row.line)" />
                  <UiButton intent="secondary" size="small" label="✎ Edit words"
                    :disabled="editing[row.line.block_id] !== undefined"
                    title="Change this line's words — split and merge are on Script" @click="editing[row.line.block_id] = row.line.text" />
                </div>
                <div v-if="editing[row.line.block_id] !== undefined" class="jv-linepanel__field jv-linepanel__field--wide">
                  <UiField label="Its words" layout="block" class="jv-linepanel__wide"
                    hint="Saving makes the line stale until you render it again — its takes are kept. Split and merge are on Script.">
                    <UiTextarea v-model="editing[row.line.block_id]" :rows="3" />
                  </UiField>
                  <span class="jv-linepanel__row">
                    <UiButton intent="primary" size="small" label="Save"
                      :disabled="!wordsChanged(row.line)" @click="saveWords(row.line)" />
                    <UiButton intent="ghost" size="small" label="Cancel" @click="delete editing[row.line.block_id]" />
                  </span>
                </div>
              </div>

              <div class="jv-card jv-takes">
                <div class="jv-takes__head"><strong>Takes</strong>
                  <span class="jv-hint">{{ (takes[row.line.block_id] || []).length }} · nothing is overwritten</span></div>
                <div v-for="t in takes[row.line.block_id] || []" :key="t.id" class="jv-takes__row">
                  <UiTag :intent="t.is_default ? 'success' : 'ghost'">{{ takeName(takes[row.line.block_id], t) }}</UiTag>
                  <PlayTransport v-if="player.key === `take:${t.id}`" :player="player" />
                  <span v-else class="jv-takes__len">{{ fmt(t.seconds) }}</span>
                  <span class="jv-takes__label">{{ t.new_seed ? "new seed" : "" }}{{ t.text && t.text !== row.line.text ? `${t.new_seed ? " · " : ""}earlier words` : "" }}</span>
                  <UiButton intent="ghost" size="small" :label="player.isPlaying(`take:${t.id}`) ? '⏸' : '▶'"
                    :disabled="!t.audio_url" :title="player.isPlaying(`take:${t.id}`) ? 'Pause' : 'Play'"
                    @click="play(`take:${t.id}`, t.audio_url)" />
                  <UiButton v-if="!t.is_default" intent="ghost" size="small" label="★ Use this take"
                    title="Make this the take the chapter plays" @click="makeLive(row.line, t)" />
                  <UiButton intent="ghost" size="small" label="🗑"
                    :title="t.is_default ? 'Delete this take — asks first; the newest take left goes in use' : 'Delete this take'"
                    @click="deleteTake(row.line, t)" />
                </div>
                <div v-if="!(takes[row.line.block_id] || []).length" class="jv-takes__row jv-muted">No takes yet.</div>
                <div class="jv-takes__foot">
                  <UiButton intent="secondary" size="small" label="↻ New take"
                    :disabled="BLOCKED.has(row.line.state) || !!running" :loading="busy[row.line.block_id]"
                    :title="designedVoice(row.line)
                      ? 'Reads the line again with a new seed — the takes you have are kept. On a voice made from a description, a new seed can change who speaks.'
                      : 'Reads the line again with a new seed — the takes you have are kept'"
                    @click="renderOne(row.line, { newTake: true })" />
                  <UiButton intent="secondary" size="small" label="⚖️ Compare two"
                    :disabled="(takes[row.line.block_id] || []).length < 2" @click="openCompare(row.line)" />
                  <span class="jv-spacer" />
                  <UiButton intent="ghost" size="small" label="✕ Close" @click="open = null" />
                </div>
              </div>
            </div>
          </template>
          <template #empty>No lines in this view.</template>
        </UiTable>

        <p class="jv-hint studio-render-ch__foot">Lines are joined with {{ PAUSE_SETTING_MS }} ms of silence<template
          v-if="paragraphJoins">, {{ PARAGRAPH_MS }} ms between lines of one paragraph</template><template
          v-if="sceneBreaks">, and {{ SCENE_BREAK_MS }} ms after the last line of each of the book's scenes</template> —
          Settings → Generation. Each take's own silence at its start and end is trimmed first, so these are the
          pauses you hear. A line's own pause (Render overrides) changes it after that line.</p>
        <div class="jv-inline-row studio-render-ch__bar">
          <UiButton intent="secondary" size="small" :label="`← Previous ${word.singular.toLowerCase()}`"
            :disabled="!prevChapter" :title="prevChapter ? chapterName(prevChapter) : `This is the first ${word.singular.toLowerCase()}`"
            @click="emit('open', prevChapter.id)" />
          <span class="jv-spacer" />
          <span v-if="nextChapter" class="jv-hint">Next: {{ chapterName(nextChapter) }}</span>
          <UiButton intent="primary" size="small" :label="`Next ${word.singular.toLowerCase()} ➜`"
            :disabled="!nextChapter" @click="emit('open', nextChapter.id)" />
        </div>
      </div>
    </template>

    <AppModal v-if="compare" :title="`Compare takes — line ${compare.line.n}`" max-width="560px" dismissable @close="compare = null">
      <div class="studio-render-ch__compare">
        <div class="jv-linepanel__field">
          <span class="jv-eyebrow">A — ★ In use</span>
          <span class="studio-render-ch__compare-take">{{ compareA ? `take ${compareTakes.length - compareTakes.indexOf(compareA)} · ${fmt(compareA.seconds)}` : "—" }}</span>
          <UiButton intent="secondary" size="small" :label="player.isPlaying(`cmp:${compareA?.id}`) ? '⏸ Pause A' : '▶ Play A'"
            :disabled="!compareA?.audio_url" @click="play(`cmp:${compareA.id}`, compareA.audio_url)" />
          <PlayTransport v-if="compareA && player.key === `cmp:${compareA.id}`" :player="player" />
        </div>
        <div class="jv-linepanel__field">
          <span class="jv-eyebrow">B</span>
          <UiSelect v-model="compare.b" width="name" :options="compareOptions" placeholder="Pick a take…" />
          <UiButton intent="secondary" size="small" :label="player.isPlaying(`cmp:${compareB?.id}`) ? '⏸ Pause B' : '▶ Play B'"
            :disabled="!compareB?.audio_url" @click="play(`cmp:${compareB.id}`, compareB.audio_url)" />
          <PlayTransport v-if="compareB && player.key === `cmp:${compareB.id}`" :player="player" />
        </div>
      </div>
      <template #footer>
        <UiButton intent="secondary" label="Close" @click="compare = null" />
        <UiButton intent="primary" label="★ Use take B" :disabled="!compareB"
          @click="makeLive(compare.line, compareB); compare = null" />
      </template>
    </AppModal>

    <AppModal v-if="rewrite" eyebrow="Rewrite as the speaker" :title="speakerName(rewrite.line)"
      max-width="720px" dismissable @close="rewrite = null">
      <div class="studio-render-ch__rewrite">
        <div class="studio-render-ch__rewrite-field">
          <span class="jv-eyebrow">Original</span>
          <p class="studio-render-ch__quote">{{ rewrite.line.text }}</p>
        </div>
        <div class="studio-render-ch__rewrite-field">
          <span class="jv-eyebrow">Rewritten</span>
          <p v-if="rewrite.busy" class="jv-muted">Generating rewrite…</p>
          <p v-else-if="rewrite.error" class="studio-render-ch__error">{{ rewrite.error }}</p>
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
.studio-render-ch { display: flex; flex-direction: column; gap: 14px; }
.studio-render-ch__dir { cursor: pointer; }
.studio-render-ch__verbs { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: flex-start; }
.studio-render-ch__verb { display: flex; flex-direction: column; align-items: flex-start; gap: 4px; max-width: 34ch; }
.studio-render-ch__banner { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 0; }
.studio-render-ch__lines { padding: 0; overflow: hidden; }
.studio-render-ch__bar { gap: 8px; flex-wrap: wrap; align-items: center; padding: 11px 14px; }
.studio-render-ch__foot { margin: 0; padding: 0 14px 11px; }
.studio-render-ch__text { display: block; max-width: 60ch; }
.studio-render-ch__who { display: inline-flex; align-items: center; gap: 7px; }
.studio-render-ch__av { width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center; flex: none; }
.studio-render-ch__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); display: inline-block; }
.studio-render-ch__tags { display: inline-flex; flex-wrap: wrap; gap: 4px; }
.studio-render-ch__said { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.studio-render-ch__audio { display: inline-flex; align-items: center; gap: 4px; }
.studio-render-ch__len { font-variant-numeric: tabular-nums; font-size: 12.5px; }
/* Take A and take B side by side, the same width each (2026-10-06: "compare take css is bad"). */
.studio-render-ch__compare { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; margin-bottom: 10px; }
.studio-render-ch__compare > .jv-linepanel__field { min-width: 0; }
.studio-render-ch__compare-take { min-height: 30px; display: flex; align-items: center; }
.studio-render-ch__rewrite { display: flex; flex-direction: column; gap: 14px; }
.studio-render-ch__rewrite-field { display: flex; flex-direction: column; gap: 4px; }
.studio-render-ch__quote { margin: 0; padding: 10px 12px; background: var(--surface-2); border-radius: 6px; line-height: 1.5; }
.studio-render-ch__error { margin: 0; color: var(--danger); }
.studio-render-ch__table :deep(.ui-table-row) { cursor: pointer; }
.studio-render-ch__table :deep(.studio-render-ch__panel-row) td { padding: 0; }
</style>
