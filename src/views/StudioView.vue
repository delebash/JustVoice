<!-- SPDX-License-Identifier: MIT -->
<!--
  StudioView — the project's home (ruled 2026-09-27: "studio stays as
  container", "open project always lands on overview"). Overview first, then
  Discover → Script → Cast → Render → Export for prose kinds and
  Lines → Cast → Render → Export for game — the order lives in studioSteps.js
  and is pinned by its test. Overview is components/StudioOverview.vue,
  Discover components/StudioDiscover.vue, Lines the LinesView grid embedded.
  Ported in shape from JustWrite's StudioView.vue.

  Terminology adapts via useCopy():
    audiobook → Cast / Chapter / Render
    podcast   → Hosts / Episode / Render
    game      → NPCs / Quest / Render

  Phase 4 / Slice 1 — shell + Cast tab + VoiceParamsModal.
  Phase 4 / Slice 2 — Script tab + analyze + Smart-assign.
  Phase 6      — Render tab (Studio Render slice).
-->
<script setup>
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
// Task lifecycles ride the kit runners (AI-call convention, app-structure §8);
// the store import remains for READS only (per-scene bars, taskForScene).
import { runAiEndpoint, useAiTasksStore, withAiTask } from "@delebash/llm-ui";
import { usePageCrumbs } from "../composables/usePageCrumbs.js";
import { isStepFor, stepsFor } from "./studioSteps.js";
import { blockStats, projectState } from "./studioStatus.js";
import { useCopy } from "../services/copy.js";
import { unplacedBlocks } from "../services/attribution.js";
import { chapterRunFor, onChapterDone } from "../services/chapterRun.js";
import { readPref, writePref } from "../services/prefs.js";
import { pushToast } from "@delebash/llm-ui";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";
import { useVoicesStore } from "../stores/voices.js";
import { useEnginesStore } from "../stores/engines.js";
import { UiButton, UiInput, UiTextarea, UiCheckbox, UiTag, UiChip, UiSelect, AppModal, UiTable } from "@delebash/llm-ui";

// Kit grids in the JustVoice look (`jv-table-look`). `row-hover` carries the
// pointer cursor and the row tint; selection is a `:row-class`.
const RIGHT = { textAlign: "right", width: "1%", whiteSpace: "nowrap" };
const NPC_COLUMNS = [
  { id: "portrait", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%" } },
  { id: "name", accessorKey: "name", header: "NPC", sortable: true },
  { id: "role", header: "Role" },
  { id: "voice", header: "Voice" },
  { id: "actions", header: "", headerStyle: RIGHT, cellStyle: RIGHT },
];
import VoiceParamsModal from "../components/VoiceParamsModal.vue";
import { EmptyState } from "@delebash/llm-ui";
import ExportPanel from "../components/ExportPanel.vue";
import StudioOverview from "../components/StudioOverview.vue";
import StudioDiscover from "../components/StudioDiscover.vue";
import StudioScript from "../components/StudioScript.vue";
import StudioScriptChapter from "../components/StudioScriptChapter.vue";
import LinesView from "./LinesView.vue";
import { confirmDialog } from "@delebash/llm-ui";

const api = useApi();
const activeProject = useActiveProject();
const tasks = useAiTasksStore();
const copy = useCopy();

// Shared lists from stores (single source of truth). loadAll() reloads
// them; a mutation in any other view that reload()s a store updates
// this view too (it reads the same store object).
const projectsStore = useProjectsStore();
const personasStore = usePersonasStore();
const voicesStore = useVoicesStore();
const enginesStore = useEnginesStore();
const projects = computed(() => projectsStore.items);
const personas = computed(() => personasStore.items);
const voices = computed(() => voicesStore.items);
const engines = computed(() => enginesStore.items);
const selectedProjectId = ref(null);
// Every project opens on Overview (ruled 2026-09-27). Seeded empty so the
// resolve watch below picks the step once the project — and so its kind's
// strip — is known.
const tab = ref("");
// A step someone asked for (the jv.studio.tab hand-off) that must survive the
// project switch it arrived with — the project watcher would otherwise reset
// it to Overview a tick later.
let requestedTab = null;
const loading = ref(false);

const selectedCharacterId = ref(null);
const voiceParamsModalOpen = ref(false);
const tuningVoice = ref(null);  // {voiceId, name, params}
const smartAssignBusy = ref(false);

// JustWrite-style voice library filter: engine selector + name search.
// "" = all engines. Defaults to the currently-loaded TTS engine when one
// is up (set by the engines load below). Server-backed renderer pref so the
// user's pick survives reloads.
const voiceEngineFilter = ref(readPref("studioVoiceEngineFilter", ""));
watch(voiceEngineFilter, (v) => { writePref("studioVoiceEngineFilter", v || ""); });
const voiceSearchQuery = ref("");

// Gender overrides — local-only per-voice gender hint that the user
// click-cycles (engine label → female → male → neutral → engine label).
// Smart-assign reads from voice.gender; this overlay lets the user fix
// the hint without editing the engine's manifest. Server-backed renderer pref
// so the override survives reloads.
const GENDER_CYCLE = ["female", "male", "neutral", ""];
const _loadedGenderOverrides = readPref("voiceGenderOverrides", {});
const voiceGenderOverrides = ref(
  _loadedGenderOverrides && typeof _loadedGenderOverrides === "object" ? _loadedGenderOverrides : {},
);
watch(voiceGenderOverrides, (v) => { writePref("voiceGenderOverrides", v); }, { deep: true });

function displayedGender(voice) {
  if (Object.hasOwn(voiceGenderOverrides.value, voice.id)) {
    return voiceGenderOverrides.value[voice.id];
  }
  return voice.gender || "";
}
function cycleGender(voice) {
  const current = displayedGender(voice);
  const idx = GENDER_CYCLE.indexOf(current);
  const next = GENDER_CYCLE[(idx + 1) % GENDER_CYCLE.length];
  if (next === (voice.gender || "")) {
    // Cycled back to the engine's value — drop the override.
    const copy = { ...voiceGenderOverrides.value };
    delete copy[voice.id];
    voiceGenderOverrides.value = copy;
  } else {
    voiceGenderOverrides.value = { ...voiceGenderOverrides.value, [voice.id]: next };
  }
}

// Per-line right-click Rewrite (plan Q1 / LD3). Right-clicking a line's text
// on Script's chapter page opens a preview modal where the LLM rewrites it in
// the persona's voice. Accept → the line's text is replaced; reject → nothing
// changes. It stays a right-click, with no visible control, until Slice 4
// moves it to Render's line panel and deletes it here (§8.25).
const rewriteModalOpen = ref(false);
const rewriteLine = ref(null);     // {id, text, persona_id} — the script line
const rewriteOriginal = ref("");
const rewritePreview = ref("");
const rewriteBusy = ref(false);
const rewriteError = ref("");

function rewriteRow(line) {
  if (!line) return;
  // Only speech has a persona to rewrite against.
  if (!line.spoken) {
    pushToast({ message: "Rewrite only applies to spoken lines.", kind: "info" });
    return;
  }
  if (!line.persona_id || line.persona_id === narratorPersona.value?.id) {
    pushToast({ message: "Give this line a speaker first.", kind: "info" });
    return;
  }
  rewriteLine.value = { id: line.id, text: line.text, persona_id: line.persona_id };
  rewriteOriginal.value = line.text;
  rewritePreview.value = "";
  rewriteError.value = "";
  rewriteModalOpen.value = true;
  runRewrite();
}

async function runRewrite() {
  const line = rewriteLine.value;
  if (!line) return;
  rewriteBusy.value = true;
  try {
    const r = await api.request(`/v1/personas/${line.persona_id}/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: line.text }),
    });
    rewritePreview.value = r?.text || r?.rewritten || "";
    if (!rewritePreview.value) {
      rewriteError.value = "LLM returned an empty rewrite.";
    }
  } catch (e) {
    rewriteError.value = e?.message || String(e);
  } finally {
    rewriteBusy.value = false;
  }
}

async function acceptRewrite() {
  const line = rewriteLine.value;
  rewriteModalOpen.value = false;
  if (!line || !rewritePreview.value) return;
  try {
    // Straight onto the block — the chapter page re-reads it.
    await api.request(`/v1/blocks/${line.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: rewritePreview.value }),
    });
    pushToast({ message: "Line rewritten.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Couldn't save the rewrite: ${e?.message || e}`, kind: "error" });
  }
  scriptVersion.value += 1;
}

// Script (Slice 3, §8.24): the chapter grid, or one chapter's page.
const scenes = ref([]);
// GET /v1/projects/{id}/script — one row per chapter, the grid's and
// Overview's numbers on the one "analyzed" rule.
const scriptChapters = ref([]);
const scriptSceneId = ref(null);     // the open chapter; null = the grid
const scriptFocus = ref(null);       // "check" | "none" — where the page lands
const scriptFilter = ref("all");     // the grid's chip
const scriptVersion = ref(0);        // bumped when Studio changed a line itself

async function loadProjectScript(projectId = selectedProjectId.value) {
  if (!projectId) {
    scriptChapters.value = [];
    return;
  }
  const r = await api.safeRequest(`/v1/projects/${projectId}/script`, null);
  if (projectId !== selectedProjectId.value) return;
  scriptChapters.value = r?.chapters || [];
}
function scriptRow(sceneId) {
  return scriptChapters.value.find((c) => c.scene_id === sceneId) || null;
}
// Open Script: the grid (optionally on a chip), or a chapter (optionally
// landing on its first line to check / with no speaker).
function openScript({ sceneId = null, focus = null, filter = null } = {}) {
  scriptSceneId.value = sceneId;
  scriptFocus.value = focus;
  if (filter) scriptFilter.value = filter;
  tab.value = "script";
}

// Render tab state (Phase 6 / Slice 1)
const renderPresets = ref([]);
const scenePresetSelections = ref({});  // {sceneId: presetId}
const sceneSelectedForRender = ref({});  // {sceneId: bool}
const renderBusyScene = ref(null);

// Render gate (queue item 13): the buttons say WHY they're disabled
// instead of failing later — no text → nothing to render; no voiced
// cast → server would skip every block.
const renderGate = computed(() => {
  if (!scenes.value.some((s) => sceneBlockCounts.value[s.id])) {
    return { ok: false, reason: "Nothing to render yet — chapters have no text. Import or paste in Chapters first." };
  }
  if (!projectPersonas.value.some((p) => p.voice_id)) {
    return { ok: false, reason: "No voices assigned — cast at least one voice in 1 · Cast first." };
  }
  return { ok: true, reason: "" };
});
const suggestBusyScene = ref(null);
const sceneBlockCounts = ref({});  // {sceneId: count of blocks}
// {sceneId: blockStats(blocks)} — spoken lines, unplaced lines, lines per
// persona. Read from the same per-chapter block fetch as the two above; the
// Overview rolls it up (studioStatus.projectState).
const sceneStats = ref({});

// Per-scene task lookup so the render row can show a progress strip
// driven by the shared kit task queue. visibleTasks keeps a finished
// task in reach for its linger window (failed: until dismissed).
function taskForScene(sceneId) {
  return tasks.visibleTasks.find(
    (t) => t.feature === "render-scene" && t.meta?.sceneId === sceneId,
  ) || null;
}
function sceneTaskRunning(sceneId) {
  const t = taskForScene(sceneId);
  return !!t && tasks.isRunning(t.id);
}
// Kit statuses → the row's badge (the kit's "connecting" would read wrong
// on a render — a single HTTP call streams nothing, so it never leaves
// that phase while working).
function sceneTaskBadge(sceneId) {
  const t = taskForScene(sceneId);
  if (!t) return null;
  if (tasks.isRunning(t.id)) return { text: "rendering", intent: "solid" };
  return {
    done: { text: "done", intent: "success" },
    error: { text: "failed", intent: "danger" },
    cancelled: { text: "cancelled", intent: "accent2" },
  }[t.status] || { text: t.status, intent: "ghost" };
}

// Numbered production steps (journeys contract): 1 · Cast → 2 · Script →
// 3 · Render. Game projects skip Script — the CSV already says who
// speaks — so the steps renumber to 1 · Cast → 2 · Render.
const TAB_LABELS = computed(() => {
  const out = {};
  for (const t of visibleTabs.value) out[t.key] = t.label;
  return out;
});
const isGameProject = computed(() => selectedProject.value?.project_type === "game_voicelines");

const visibleTabs = computed(() => stepsFor(selectedProject.value?.project_type));

const selectedProject = computed(() =>
  projects.value.find((p) => p.id === selectedProjectId.value) || null,
);

const stepIndex = computed(() => visibleTabs.value.findIndex((t) => t.key === tab.value));
function stepBy(delta) {
  const next = visibleTabs.value[stepIndex.value + delta];
  if (next) tab.value = next.key;
}

// Live step-card subtitles (item 2; design contract = the JustWrite
// Audio Studio screenshots): honest counts only — no fake progress.
const voicedCount = computed(() => projectPersonas.value.filter((p) => p.voice_id).length);
// Counts shown in the Characters / NPCs section head — narrator is
// surfaced separately above, so we count characterPersonas for
// non-game projects and projectPersonas for game projects (no narrator).
const charactersListLength = computed(() =>
  isGameProject.value ? projectPersonas.value.length : characterPersonas.value.length,
);
const charactersUnassigned = computed(() => {
  const list = isGameProject.value ? projectPersonas.value : characterPersonas.value;
  return list.filter((p) => !p.voice_id).length;
});

// Cast-level engine notice (item 6 — closes the user's voices-and-
// engine-loading concern at ASSIGN time, not just at preview): says
// when the cast spans engines (render-time swapping) or uses metered
// online voices.
const castEngineNotice = computed(() => {
  const assigned = projectPersonas.value
    .filter((p) => p.voice_id)
    .map((p) => voiceById(p.voice_id))
    .filter(Boolean);
  if (!assigned.length) return "";
  const engines_ = [...new Set(assigned.map((v) => v.engine))];
  const metered = assigned.filter((v) => voiceLocality(v) === "online").length;
  const bits = [];
  if (engines_.length > 1) {
    bits.push(`this cast spans ${engines_.length} engines (${engines_.join(", ")}) — chapters will swap engines while rendering`);
  }
  if (metered) {
    bits.push(`${metered} voice${metered === 1 ? "" : "s"} use${metered === 1 ? "s" : ""} an online provider — billed per use, text leaves this machine`);
  }
  return bits.join(" · ");
});
const renderedSceneCount = computed(() =>
  (cacheStats.value?.scenes || []).filter((sc) => sc.total > 0 && sc.cached === sc.total).length);
// The Script card's live count — the thing the user went looking for and
// found hardcoded ("the heading is in studio like render 0/4 rendered, the
// script used to show this and now doesn't"). Same shape as Render's, on the
// one "analyzed" rule the grid uses.
const analyzedSceneCount = computed(() => scriptChapters.value.filter((c) => c.analyzed).length);
// The Overview's rollup (studioStatus.js). The cast carries a narrator flag
// so Discover can tell "only the Narrator so far" from a populated cast.
const overviewState = computed(() => projectState({
  scenes: scenes.value,
  stats: sceneStats.value,
  script: scriptChapters.value,
  running: chapterRunFor(selectedProjectId.value)?.current?.kind === "analyze" ? 1 : 0,
  cast: projectPersonas.value.map((p) => ({
    id: p.id, name: p.name, voice_id: p.voice_id, narrator: p.id === narratorPersona.value?.id,
  })),
  cache: cacheStats.value ? { total: cacheStats.value.total, cached: cacheStats.value.cached } : null,
}));

// The cast as Script's pages read it — a cast of only the Narrator blocks Analyze.
const scriptCast = computed(() => projectPersonas.value.map((p) => ({
  id: p.id, name: p.name, narrator: p.id === narratorPersona.value?.id,
})));
// A step, and where in it to land: Overview's Script numbers open the grid on
// To check.
function goStep(k, arg = null) {
  if (k === "script") openScript({ sceneId: null, filter: arg || "all" });
  else tab.value = k;
}

// Spoken lines per chapter, for Discover's grid.
const linesByScene = computed(() =>
  Object.fromEntries(Object.entries(sceneStats.value).map(([k, v]) => [k, v.speakable])));

// Discover's saved-scan changes ({sceneId: discover}) folded into the chapter
// rows — the server already holds them, so this only spares a re-fetch, and
// Overview's Discover row moves the moment a chapter finishes.
function applyScans(patch) {
  scenes.value = scenes.value.map((s) => (s.id in patch
    ? { ...s, metadata: { ...(s.metadata || {}), discover: patch[s.id] } }
    : s));
}

const STEP_TITLES = {
  overview: "Settings, and where each step stands",
  discover: "Find the speakers the text names",
  script: "Who speaks each line",
  lines: "The writers' sheet, line by line",
  cast: "Give each persona a voice",
  render: "Batch render + mastering",
  export: "Package + ACX checklist",
};

const stepCards = computed(() => visibleTabs.value.map((t) => {
  let sub = "";
  if (t.key === "overview") {
    sub = selectedProject.value ? copy.value.book.singular.toLowerCase() : "";
  } else if (t.key === "discover") {
    sub = scenes.value.length
      ? `${overviewState.value.scanned}/${scenes.value.length} scanned${overviewState.value.proposed ? ` · ${overviewState.value.proposed} to review` : ""}`
      : "find speakers";
  } else if (t.key === "lines") {
    sub = overviewState.value.lines ? `${overviewState.value.lines} lines` : "no lines yet";
  } else if (t.key === "cast") {
    sub = projectPersonas.value.length
      ? `${voicedCount.value}/${projectPersonas.value.length} voiced`
      : "no cast yet";
  } else if (t.key === "script") {
    sub = scenes.value.length
      ? `${analyzedSceneCount.value}/${scenes.value.length} analyzed`
      : "speaker analysis";
  } else if (t.key === "render") {
    sub = scenes.value.length
      ? `${renderedSceneCount.value}/${scenes.value.length} rendered`
      : `${copy.value.chapter.singular.toLowerCase()} audio`;
  } else if (t.key === "export") {
    sub = "M4B · WAVs · ACX";
  }
  return { ...t, sub };
}));

// Header engine chips (JustWrite reference): which engines power this
// work, visible where you work. TTS = loaded tts engine; Script = the
// loaded LLM. Both link out.
const headerTts = computed(() =>
  (engines.value || []).find((e) => e.status === "loaded" && (e.kind === "tts" || !e.kind)) || null);
const headerLlm = computed(() =>
  (engines.value || []).find((e) => e.status === "loaded" && e.kind === "llm") || null);

watch([selectedProject, () => tab.value], () => {
  // Resolve the step: whatever isn't a stop of THIS kind (the empty seed,
  // "script" on a game project, "lines" on a book) falls to Overview.
  // Immediate, so a project that is already selected on mount still resolves.
  if (!visibleTabs.value.some((t) => t.key === tab.value)) {
    tab.value = "overview";
    return; // the assignment re-enters this watcher with a valid step
  }
  if (tab.value === "render") {
    qcByScene.value = {};
    loadCacheStats();
    loadMasterTarget();
  }
  // Overview's Render row reads the same cache probe Render does, and its
  // Script row the grid's rows.
  if (tab.value === "overview" && selectedProject.value) {
    loadCacheStats();
    loadProjectScript();
  }
}, { immediate: true });

// Opening a project lands on its Overview — whichever door it came through
// (ruled 2026-09-27). A step handed over with the switch (Chapters' workflow
// strip → Cast, say) wins over that, once.
watch(selectedProjectId, (id, old) => {
  if (!id || id === old) return;
  tab.value = requestedTab && isStepFor(selectedProject.value?.project_type, requestedTab)
    ? requestedTab : "overview";
  requestedTab = null;
  cacheStats.value = null;
});

// The title-bar switcher (and anything else) changes the app-wide active
// project while Studio may be the view on screen — follow it, so the
// switch lands here on the new project's Overview instead of leaving the
// old project open under the new project's name.
watch(() => activeProject.id, (id) => {
  if (id && id !== selectedProjectId.value && projects.value.some((p) => p.id === id)) {
    selectedProjectId.value = id;
  }
});

const projectOptions = computed(() => {
  if (!projects.value.length) return [{ label: "— no projects —", value: null }];
  return projects.value.map((p) => ({ label: p.name, value: p.id }));
});

// Personas bound to the selected project via ProjectPersona m2m.
const projectPersonas = ref([]);

// {personaId: role_label} from the cast — the "narrator" role survives a
// rename, the name does not.
const castRoles = ref({});

const narratorPersona = computed(() =>
  projectPersonas.value.find((p) => castRoles.value[p.id] === "narrator")
  || projectPersonas.value.find((p) => /^narrator$/i.test(p.name || ""))
  || null,
);
const characterPersonas = computed(() =>
  projectPersonas.value.filter((p) => p.id !== narratorPersona.value?.id),
);

const selectedCharacter = computed(() =>
  characterPersonas.value.find((p) => p.id === selectedCharacterId.value) || null,
);

const voiceLibraryByEngine = computed(() => {
  const out = {};
  for (const v of voices.value) {
    const k = v.engine || "other";
    out[k] = out[k] || [];
    out[k].push(v);
  }
  return out;
});

// Engine options for the Cast tab voice-list filter dropdown. Each entry
// shows the engine label + voice count to make picking easier.
const voiceEngineOptions = computed(() => {
  const opts = Object.entries(voiceLibraryByEngine.value)
    .map(([id, group]) => ({ value: id, label: `${id} (${group.length})`, pill: `${id} · ${group.length}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "", label: `All engines (${voices.value.length})`, pill: `All · ${voices.value.length}` }, ...opts];
});

// Filtered + flattened voice list driving the Cast tab sidebar. Honors
// engine filter + name search. Empty list → "no voices match" placeholder.
// (Voice hiding died 2026-08-21 with the Voices-page feature — this was
// its mirror, and a mirror of nothing filters nothing.)
const engineMetaById = computed(() => {
  const m = {};
  for (const e of engines.value || []) m[e.id] = e;
  return m;
});
const filteredVoices = computed(() => {
  const q = voiceSearchQuery.value.trim().toLowerCase();
  return voices.value
    .filter((v) => {
      // Voices of a not-installed engine can't audition — keep them out
      // of the cast library entirely (they live on Voices with a NEEDS
      // INSTALL tag). The isolation test this used to also carry went
      // 2026-08-22: every engine has its own environment now, so
      // "isolated" no longer narrows anything.
      const e = engineMetaById.value[v.engine];
      return !(e && e.status === "not_installed");
    })
    .filter((v) => !voiceEngineFilter.value || v.engine === voiceEngineFilter.value)
    .filter((v) => !q || (v.name || "").toLowerCase().includes(q) || (v.id || "").toLowerCase().includes(q) || (v.tone || "").toLowerCase().includes(q));
});

// Map persona_id → voice_id, so the voice library can show ✓ next to
// voices already cast to the selected character. JustWrite affordance G
// from the source-of-truth read this turn.
function isVoiceAssignedToSelected(voiceId) {
  if (!selectedCharacter.value) return false;
  return selectedCharacter.value.voice_id === voiceId;
}

// voice_id → persona name across the whole project cast — the library
// rows show "✓ <name>" so one glance covers the full casting state.
const castAsByVoiceId = computed(() => {
  const out = {};
  for (const p of projectPersonas.value) {
    if (p.voice_id) out[p.voice_id] = out[p.voice_id] ? `${out[p.voice_id]}, ${p.name}` : p.name;
  }
  return out;
});

// Deterministic avatar colors (mock gives every character its own hue).
const AVATAR_COLORS = ["#3a7d63", "#7c5cbf", "#b3552e", "#2e7d8a", "#a8763e", "#947b2f", "#c98aa7", "#5b7a99", "#b04a3e"];
function colorFor(name) {
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// First meaningful line of the character sheet doubles as the card's role
// line. Demo + imported sheets often carry a "Voice hint:" block — skip it.
function personaRole(p) {
  for (const line of (p?.personality || "").split("\n")) {
    const t = line.trim();
    if (t && !/^voice hint:?$/i.test(t)) return t;
  }
  return "";
}

// ── Add an existing library persona to this project's cast (user ask:
// "cast i have no way to add a persona i have created"). The POST
// endpoint existed; only the affordance was missing.
const addPersonaOpen = ref(false);
const addPersonaBusy = ref(null);
const addablePersonas = computed(() => {
  const inCast = new Set(projectPersonas.value.map((p) => p.id));
  return personas.value.filter((p) => !inCast.has(p.id));
});
async function addPersonaToCast(p) {
  if (!selectedProjectId.value || addPersonaBusy.value) return;
  addPersonaBusy.value = p.id;
  try {
    await api.request(`/v1/projects/${selectedProjectId.value}/cast`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ persona_id: p.id }),
    });
    await loadProjectPersonas(selectedProjectId.value);
    pushToast({ kind: "success", message: `${p.name} added to the cast.` });
  } catch (e) {
    pushToast({ kind: "error", message: `Add failed: ${e?.message || e}` });
  } finally {
    addPersonaBusy.value = null;
  }
}

// Idempotent backend call — creates a Narrator persona for this project
// and adds it to the cast in the "narrator" role. The empty-state slot in
// the Narrator section calls it: the one way back after the Narrator was
// deleted or left the cast.
const creatingNarrator = ref(false);
async function createNarrator() {
  if (!selectedProjectId.value || creatingNarrator.value) return;
  creatingNarrator.value = true;
  try {
    await api.request(`/v1/projects/${selectedProjectId.value}/narrator`, {
      method: "POST",
    });
    await loadProjectPersonas(selectedProjectId.value);
    pushToast({ kind: "success", message: "Narrator added to the cast." });
  } catch (e) {
    pushToast({ kind: "error", message: `Add Narrator failed: ${e?.message || e}` });
  } finally {
    creatingNarrator.value = false;
  }
}

// Remove one persona from this project's cast (item 2 / user-hit: add
// existed, remove didn't). DELETE endpoint pre-existed; persona stays
// in the library.
async function removeFromCast(p) {
  const ok = await confirmDialog({
    title: `Remove ${p.name} from this cast?`,
    message: "Only the project link is removed — the persona stays in your library.",
    confirmLabel: "Remove",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/projects/${selectedProjectId.value}/cast/${p.id}`, { method: "DELETE" });
    if (selectedCharacterId.value === p.id) selectedCharacterId.value = null;
    await loadProjectPersonas(selectedProjectId.value);
    pushToast({ kind: "success", message: `${p.name} removed from the cast.` });
  } catch (e) {
    pushToast({ kind: "error", message: `Remove failed: ${e?.message || e}` });
  }
}

const clearCastBusy = ref(false);
async function clearCast() {
  const cast = projectPersonas.value.filter((p) => p.voice_id);
  if (!cast.length) return;
  const ok = await confirmDialog({
    title: "Clear cast?",
    message: `Unassign voices from all ${cast.length} cast member${cast.length === 1 ? "" : "s"}. The personas stay — only the voice links go.`,
    confirmLabel: "Clear cast",
    danger: true,
  });
  if (!ok) return;
  clearCastBusy.value = true;
  try {
    for (const p of cast) await assignVoice(p.id, "");
  } finally {
    clearCastBusy.value = false;
  }
}

// Preview a voice — calls /v1/generate with a short sample sentence,
// plays it in the cast card's compact audition player. JustWrite
// affordance J. Per-voice preview state stops the button being
// re-clicked while in flight.
// Engines whose manifest declares instruct_field — these consume the
// persona's spoken-delivery text as a style prompt at render time. Drives
// the "instruct" chip in the voice library (user ask: "how do I know
// what TTS takes input from these fields").
const instructEngineIds = computed(() => new Set(
  (engines.value || [])
    .filter((e) => (e.capabilities || []).includes("instruct_field"))
    .map((e) => e.id),
));

// LOCAL vs ONLINE — same badge logic as the Voices page, so the cast
// flow shows whether a voice bills an online API before it's assigned.
const engineBackends = computed(() => {
  const m = {};
  for (const e of engines.value || []) m[e.id] = e.backend || "";
  return m;
});
function voiceLocality(v) {
  const e = engineMetaById.value[v.engine];
  if (e?.self_hosted) return "self-hosted";
  const backend = engineBackends.value[v.engine];
  if (backend === undefined) return null;
  return backend === "managed" ? "local" : "online";
}

const previewingVoiceId = ref(null);
// The casting rail's compact audition player (the ruling 2026-08-15: the
// global bottom bar died; playback is compact and in place). One player
// atop the cast card serves every ▶ audition button.
const voicePreviewNow = ref(null); // { url, name, engine } | null
// Per-scene inline playback for finished renders — same ruling.
const scenePlay = ref(null); // { id, url } | null
// Same ask-before-load contract as the Voices page (user-hit: Studio
// play silently switched/loaded engines). Shares the Voices opt-in pref
// so "Always auto-load" applies app-wide.
async function previewVoice(voice) {
  if (!voice || previewingVoiceId.value) return;
  previewingVoiceId.value = voice.id;
  try {
    const always = readPref("autoLoadEngine") === "always";
    let blob;
    try {
      blob = await api.request(`/v1/voices/${voice.id}/preview?auto_load=${always}`, { method: "POST" });
    } catch (e) {
      const m = String(e?.message || "").match(/engine_not_loaded:([\w.-]+)/);
      if (!m) throw e;
      const engineId = m[1];
      const ok = await confirmDialog({
        title: `Load ${engineId}?`,
        message: `"${voice.name}" needs the ${engineId} engine, which isn't loaded. Load it now to preview? The first load can take ~25–55 s; after that previews are instant.`,
        confirmLabel: "Load & preview",
      });
      if (!ok) return;
      pushToast({ message: `Loading ${engineId}… this can take up to a minute.`, kind: "info" });
      blob = await api.request(`/v1/voices/${voice.id}/preview?auto_load=true`, { method: "POST" });
      pushToast({
        message: `${engineId} loaded.`,
        kind: "success",
        action: { label: "Always auto-load", fn: () => writePref("autoLoadEngine", "always") },
      });
      // Topbar pill + Engines page track loads from anywhere.
      window.dispatchEvent(new Event("jv:health-refresh"));
    }
    if (blob instanceof Blob) {
      if (voicePreviewNow.value?.url) URL.revokeObjectURL(voicePreviewNow.value.url);
      voicePreviewNow.value = {
        url: URL.createObjectURL(blob),
        name: voice.name,
        engine: voice.engine || "",
      };
    }
  } catch (e) {
    pushToast({
      message: `Preview failed: ${e?.message || e}`,
      kind: "error",
      duration: 6000,
    });
  } finally {
    previewingVoiceId.value = null;
  }
}

// Open the VoiceParamsModal for a voice in the library (independent of
// the persona). Lets the user dial in tier-2 overrides before assigning.
// JustWrite affordance I.
function openVoiceTunerForLibraryVoice(voice) {
  tuningVoice.value = {
    voiceId: voice.id,
    name: voice.name,
    params: { /* fresh — library tuning starts blank */ },
    personaId: null,  // null → not bound; modal save handler skips persistence
  };
  voiceParamsModalOpen.value = true;
}

async function loadAll() {
  loading.value = true;
  try {
    await Promise.all([
      projectsStore.reload(),
      personasStore.reload(),
      voicesStore.reload(),
      enginesStore.reload(),
    ]);
    // Default to the first audiobook/game/podcast project.
    if (!selectedProjectId.value && projects.value.length) {
      const prefer = projects.value.find((p) => p.id === activeProject.id);
      const first = prefer || projects.value.find(
        (p) => ["audiobook", "game_voicelines", "podcast"].includes(p.project_type),
      ) || projects.value[0];
      selectedProjectId.value = first.id;
    }
  } finally {
    loading.value = false;
  }
}

async function loadProjectPersonas(projectId) {
  if (!projectId) {
    projectPersonas.value = [];
    return;
  }
  try {
    const r = await api.safeRequest(`/v1/projects/${projectId}/cast`, { cast: [] });
    const castEntries = r?.cast || [];
    const ids = new Set(castEntries.map((c) => c.persona_id));
    projectPersonas.value = personas.value.filter((p) => ids.has(p.id));
    castRoles.value = Object.fromEntries(
      castEntries.filter((c) => c.role_label).map((c) => [c.persona_id, c.role_label]),
    );
  } catch {
    projectPersonas.value = [];
    castRoles.value = {};
  }
}

watch(selectedProjectId, (id) => {
  loadProjectPersonas(id);
  loadScenesForProject(id);
}, { immediate: true });
watch(personas, () => loadProjectPersonas(selectedProjectId.value));

// Breadcrumb: Studio › [Project] › [Tab]. Owned only while this view is
// active (X-1: KeepAlive-cached views must not re-publish a stale crumb
// when a shared store reloads elsewhere).
const { publish: publishCrumbs } = usePageCrumbs(() => {
  const segments = [];
  const project = selectedProject.value;
  if (project) segments.push({ label: project.name, href: "#projects" });
  if (tab.value) segments.push({ label: TAB_LABELS.value[tab.value] || tab.value });
  return segments;
});
watch([() => selectedProject.value?.name, tab, TAB_LABELS], publishCrumbs, { immediate: true });

async function loadScenesForProject(projectId) {
  if (!projectId) {
    scenes.value = [];
    scriptSceneId.value = null;
    scriptChapters.value = [];
    return;
  }
  try {
    const r = await api.safeRequest(`/v1/projects/${projectId}/scenes`, []);
    // Endpoint returns a bare array (block_count included per scene).
    scenes.value = Array.isArray(r) ? r : r?.scenes || [];
    // A chapter open in Script that isn't in THIS project closes back to the
    // grid — keeping the old id froze Script on the previous book's chapter
    // (user-hit: "book dropdown doesn't change anything").
    if (!scenes.value.some((s) => s.id === scriptSceneId.value)) scriptSceneId.value = null;
    loadProjectScript(projectId);
    // Eager-fetch per-scene block counts for the Render tab's
    // "Select all unrendered" affordance.
    sceneBlockCounts.value = {};
    sceneStats.value = {};
    await Promise.all(
      scenes.value.map(async (s) => {
        try {
          const blocks = await api.safeRequest(`/v1/scenes/${s.id}/blocks`, []);
          const list = Array.isArray(blocks) ? blocks : blocks?.blocks ?? [];
          if (selectedProjectId.value !== projectId) return;   // switched away mid-load
          sceneBlockCounts.value = { ...sceneBlockCounts.value, [s.id]: list.length };
          sceneStats.value = { ...sceneStats.value, [s.id]: blockStats(list, s) };
        } catch { /* tolerated */ }
      }),
    );
    // Load render presets — global + project-scoped.
    const presets = await api.safeRequest(`/v1/presets`, { presets: [] });
    renderPresets.value = (presets?.presets || []).filter(
      (p) => !p.project_id || p.project_id === projectId,
    );
  } catch {
    scenes.value = [];
  }
}

function presetOptions() {
  return [
    { label: "— none —", value: "" },
    ...renderPresets.value.map((p) => ({ label: p.name, value: p.id })),
  ];
}

async function suggestPresetFor(scene) {
  suggestBusyScene.value = scene.id;
  try {
    // The kit runner owns the task (row + seconds + tokens + cancel).
    const r = await runAiEndpoint({
      request: (p, o) => api.request(p, o),
      path: `/v1/llm/preset-suggest`,
      body: { scene_id: scene.id },
      task: {
        feature: "preset-suggest",
        label: `Preset suggest · ${scene.title || "chapter"}`,
        onRetry: () => suggestPresetFor(scene),
      },
    });
    if (r?.preset_id) {
      scenePresetSelections.value = { ...scenePresetSelections.value, [scene.id]: r.preset_id };
      pushToast({
        message: `Suggested "${r.preset_name}" — ${r.reason || "no reason given"}`,
        kind: "success",
        duration: 4500,
      });
    } else if (r?.note) {
      pushToast({ message: r.note, kind: "warning", duration: 5000 });
    }
  } catch (e) {
    if (!/abort/i.test(String(e?.message || ""))) pushToast({
      message: e?.message?.includes("501") || e?.status === 501
        ? "Suggest unavailable — wire an LLM provider in Engines → LLM tab."
        : `Suggest failed: ${e?.message || e}`,
      kind: "warning",
      duration: 6000,
    });
  } finally {
    suggestBusyScene.value = null;
  }
}

// ── The unplaced-lines blocker (restore decision 5) ──────────────────
// A block with no persona renders to nothing. The server used to drop those
// in silence, so a line just went missing from the audiobook; it now refuses
// the chapter. This is the same refusal one step earlier, where the fix is:
// the offending lines, named, with the one-click way out.
const unplacedModalOpen = ref(false);
const unplacedFound = ref([]);   // [{scene, blocks:[block]}]
const unplacedFixing = ref(false);
const unplacedTotal = computed(() =>
  unplacedFound.value.reduce((n, g) => n + g.blocks.length, 0));

const unplacedUnanalyzed = computed(() =>
  unplacedFound.value.filter((g) => !g.analyzed).map((g) => g.scene));

/** True when every selected chapter can render. Otherwise opens the blocker. */
async function passesSpeakerCheck(queue) {
  await loadProjectScript();
  const found = [];
  for (const s of queue) {
    const blocks = await sceneBlocks(s.id);
    const missing = unplacedBlocks(blocks);
    if (missing.length) {
      found.push({ scene: s, blocks: missing, analyzed: !!scriptRow(s.id)?.analyzed });
    }
  }
  if (!found.length) return true;
  unplacedFound.value = found;
  unplacedModalOpen.value = true;
  return false;
}

async function assignUnplacedToNarrator() {
  const narratorId = narratorPersona.value?.id;
  if (!narratorId) {
    pushToast({ message: "This project has no Narrator persona to assign to.", kind: "warning" });
    return;
  }
  unplacedFixing.value = true;
  let failed = 0;
  try {
    for (const group of unplacedFound.value) {
      for (const block of group.blocks) {
        try {
          await api.request(`/v1/blocks/${block.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            // `corrected` freezes a row against every future re-analyze, so
            // it is only honest where a run actually decided something and
            // the user is overruling it. On a chapter that was never
            // analyzed this button just means "one voice reads all of it" —
            // writing `corrected` there would silently make attribution
            // impossible for the whole chapter, forever, in one click.
            body: JSON.stringify(
              group.analyzed
                ? { persona_id: narratorId, source: "corrected" }
                : { persona_id: narratorId },
            ),
          });
        } catch { failed += 1; }
      }
    }
  } finally {
    unplacedFixing.value = false;
  }
  unplacedModalOpen.value = false;
  // Every chapter the fix touched, so the Overview's counts follow.
  for (const group of unplacedFound.value) await refreshSceneMeta(group.scene.id);
  await loadProjectScript();
  pushToast({
    message: failed
      ? `Assigned those lines to ${narratorPersona.value.name}; ${failed} failed.`
      : `Those lines now read as ${narratorPersona.value.name}. Render again.`,
    kind: failed ? "warning" : "success",
  });
}

async function renderScene(scene, { check = true } = {}) {
  if (!sceneBlockCounts.value[scene.id]) {
    pushToast({
      message: `Nothing to render — this ${copy.value.chapter.singular.toLowerCase()} has no text. Add it in ${copy.value.chapter.plural}, then analyze it in Script.`,
      kind: "info",
    });
    return;
  }
  if (check && !(await passesSpeakerCheck([scene]))) return;
  renderBusyScene.value = scene.id;

  // Standing rule (memory feedback_long_running_process_rule): every
  // long-running operation surfaces as a task with cancel + retry. The kit
  // runner owns the lifecycle; the callback keeps the blob/domain work.
  let aborted = false;
  try {
    await withAiTask({
      feature: "render-scene",
      label: `${scene.title || copy.value.chapter.singular} → ${copy.value.chapter.singular.toLowerCase()} render`,
      onRetry: () => renderScene(scene),
      meta: { sceneId: scene.id, projectId: selectedProjectId.value },
    }, async (task) => {
      const body = {
        scene_id: scene.id,
        preset_id: scenePresetSelections.value[scene.id] || null,
      };
      let audio;
      try {
        audio = await api.request("/v1/render_chapter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: task.signal,
        });
      } catch (e) {
        aborted = task.signal.aborted;
        throw e;
      }
      // /v1/render_chapter returns audio/wav (a Blob via api.request).
      // Store the URL on the task and open the scene row's compact inline
      // player (the ruling 2026-08-15: no global bottom bar — playback is
      // compact and in place).
      if (audio instanceof Blob) {
        const blobUrl = URL.createObjectURL(audio);
        const label = scene.title || `${copy.value.chapter.singular} ${scene.position + 1}`;
        task.update({ result: { url: blobUrl, filename: `${label.replace(/[^a-z0-9_-]+/gi, "_")}.wav` } });
        scenePlay.value = { id: scene.id, url: blobUrl };
        pushToast({ message: `${label} render complete. Now playing.`, kind: "success" });
      } else {
        task.update({ result: audio });
        pushToast({ message: `${scene.title || "Scene"} render complete.`, kind: "success" });
      }
    });
  } catch (e) {
    if (aborted) {
      // The store's cancel() already marked the task.
      pushToast({ message: `${scene.title || "Scene"} render cancelled.`, kind: "info" });
    } else {
      pushToast({ message: `Render failed: ${e?.message || e}`, kind: "error", duration: 7000 });
    }
  } finally {
    renderBusyScene.value = null;
    loadCacheStats();
  }
}

// ── Render-tab cache stats + ACX QC (journeys Render contract) ───────
const cacheStats = ref(null);   // {total, cached, scenes:[{scene_id,total,cached}]}
// scene_id -> {ok, note, rms_ok, peak_ok, rms_dbfs, peak_dbfs, duration_s}.
// `note` says why a chapter failed for a reason the numbers can't carry —
// today, that it has lines with no speaker, so what was measured is not the
// whole chapter.
const qcByScene = ref({});
const qcBusy = ref(false);

async function loadCacheStats() {
  cacheStats.value = null;
  const pid = selectedProjectId.value;
  if (!pid) return;
  try {
    const r = await api.request(`/v1/render/cache-stats?project_id=${pid}`);
    // Switching project mid-probe must not land the old project's numbers.
    if (selectedProjectId.value === pid) cacheStats.value = r;
  } catch { /* no scenes yet — banner just hides */ }
}
const sceneCacheById = computed(() => {
  const out = {};
  for (const sc of cacheStats.value?.scenes || []) out[sc.scene_id] = sc;
  return out;
});

// What the server will actually apply, from the server — {preset, source,
// ffmpeg, targets}. This pill used to hard-code "ACX target · −20 LUFS ·
// peak −3 dB · noise floor −60 dB" for every audiobook, three numbers typed
// into a template next to a render that applied none of them (the render
// path only mastered when a caller named a preset, and Studio never did).
const masterTarget = ref(null);

async function loadMasterTarget() {
  masterTarget.value = null;
  if (!selectedProjectId.value) return;
  masterTarget.value = await api.safeRequest(
    `/v1/render/master-target?project_id=${selectedProjectId.value}`,
    null,
  );
}

const masterPill = computed(() => {
  const m = masterTarget.value;
  if (!m) return "no master target";
  if (!m.preset) return "no master target · raw audio";
  if (!m.ffmpeg) return `${m.preset} target · ffmpeg missing — renders stay raw`;
  const t = m.targets || {};
  const numbers = t.loudness_target_lufs
    ? ` · ${t.loudness_target_lufs} LUFS · peak ${t.true_peak_dbfs} dB`
    : "";
  return `${m.preset} target${numbers}`;
});

const masterPillIntent = computed(() => {
  const m = masterTarget.value;
  if (m?.preset && !m.ffmpeg) return "warning";
  return m?.preset ? "success" : "secondary";
});

const masterPillTitle = computed(() => {
  const m = masterTarget.value;
  if (!m) return "";
  if (m.preset && !m.ffmpeg) {
    return "ffmpeg is not installed, so chapters render without mastering. Install ffmpeg and restart the server.";
  }
  const where = {
    preset: "from the render preset",
    project: "set on this project",
    kind: "the default for this project kind",
    request: "asked for by this render",
  }[m.source] || "";
  return m.preset
    ? `Applied to every chapter render — ${where}. Change it on Overview.`
    : "Chapters render raw — no mastering target is set for this project.";
});

async function runQC() {
  if (!selectedProjectId.value || qcBusy.value) return;
  qcBusy.value = true;
  let aborted = false;
  try {
    const r = await withAiTask({
      feature: "acx-qc",
      label: `ACX QC · ${selectedProject.value?.name || ""}`,
      meta: { projectId: selectedProjectId.value },
    }, async (task) => {
      try {
        return await api.request(`/v1/projects/${selectedProjectId.value}/qc`, { signal: task.signal });
      } catch (e) {
        aborted = task.signal.aborted;
        throw e;
      }
    });
    const map = {};
    for (const c of r?.chapters || []) map[c.scene_id] = c;
    qcByScene.value = map;
    // QC now measures the MASTERED chapter — what the export ships. When it
    // couldn't (no ffmpeg), it says so, and the pass/fail is about raw audio.
    if (r?.note) {
      pushToast({ message: r.note, kind: "warning", duration: 9000 });
    } else {
      pushToast({
        message: r?.all_ok
          ? `ACX QC: every chapter passes${r?.master_preset ? ` (measured after the ${r.master_preset} master)` : ""}.`
          : "ACX QC: some chapters are out of spec — see the Check column.",
        kind: r?.all_ok ? "success" : "info",
        duration: 6000,
      });
    }
    await loadCacheStats();
  } catch (e) {
    if (!aborted) {
      pushToast({ message: `QC failed: ${e?.message || e}`, kind: "error", duration: 7000 });
    }
  } finally {
    qcBusy.value = false;
  }
}

async function renderAll() {
  selectAllRenderable();
  await renderSelected();
}

function checkState(sceneId) {
  const t = taskForScene(sceneId);
  if (t && tasks.isRunning(t.id)) return { intent: "info", label: "rendering…" };
  const qc = qcByScene.value[sceneId];
  if (qc) {
    const numbers = `RMS ${qc.rms_dbfs?.toFixed?.(1)} dB · peak ${qc.peak_dbfs?.toFixed?.(1)} dB · ${Math.round(qc.duration_s || 0)}s`;
    if (qc.ok) return { intent: "success", label: "✓ ACX pass", title: numbers };
    // A chapter that isn't render-ready failed for a reason the loudness
    // numbers don't carry — blaming "peak" for it would be a lie.
    // Chapters' badge already calls this state "unassigned speakers" — one
    // condition, one word, wherever it surfaces.
    if (qc.note) return { intent: "danger", label: "✗ unassigned speakers", title: qc.note };
    return { intent: "danger", label: `✗ ${!qc.rms_ok ? "RMS" : "peak"} out of spec`, title: numbers };
  }
  if (t?.status === "completed") return { intent: "success", label: "rendered" };
  if (sceneSelectedForRender.value[sceneId]) return { intent: "ghost", label: "queued" };
  return { intent: "ghost", label: "—" };
}

async function renderSelected() {
  const queue = scenes.value.filter((s) => sceneSelectedForRender.value[s.id]);
  if (!queue.length) {
    pushToast({ message: "Select at least one scene to render.", kind: "info" });
    return;
  }
  // One check for the whole queue, so the blocker opens once with every
  // offending line in it instead of once per chapter.
  if (!(await passesSpeakerCheck(queue))) return;
  for (const s of queue) {
    await renderScene(s, { check: false });
  }
}

function selectAllRenderable() {
  // Every scene with blocks — including rendered ones (those re-serve
  // from cache). Used by ▶ Render all.
  const next = {};
  for (const s of scenes.value) {
    if (sceneBlockCounts.value[s.id]) next[s.id] = true;
  }
  sceneSelectedForRender.value = next;
}

function selectAllUnrendered() {
  // Scenes with blocks that the render cache does NOT fully cover —
  // the everyday selection (user ask: 'do you mean select all
  // unrendered?' — yes, now it does).
  const next = {};
  for (const s of scenes.value) {
    if (!sceneBlockCounts.value[s.id]) continue;
    const cs = sceneCacheById.value[s.id];
    const fullyRendered = cs && cs.total > 0 && cs.cached === cs.total;
    if (!fullyRendered) next[s.id] = true;
  }
  sceneSelectedForRender.value = next;
}

function selectedSceneCount() {
  return Object.values(sceneSelectedForRender.value).filter(Boolean).length;
}

async function sceneBlocks(sceneId) {
  const r = await api.safeRequest(`/v1/scenes/${sceneId}/blocks`, []);
  return Array.isArray(r) ? r : (r?.blocks ?? []);
}

// Re-read ONE chapter's derived state after it changes: its block count, its
// counts for the Overview, and the scene rows (Analyze stores the prose that
// produced the split in scene metadata).
async function refreshSceneMeta(sceneId) {
  if (!sceneId || !selectedProjectId.value) return;
  const [rows, blocks] = await Promise.all([
    api.safeRequest(`/v1/projects/${selectedProjectId.value}/scenes`, []),
    sceneBlocks(sceneId),
  ]);
  const list = Array.isArray(rows) ? rows : rows?.scenes || [];
  if (list.length) scenes.value = list;
  // The chapter can have been DELETED since we last looked.
  if (!scenes.value.some((s) => s.id === sceneId)) {
    if (scriptSceneId.value === sceneId) scriptSceneId.value = null;
    return;
  }
  sceneBlockCounts.value = { ...sceneBlockCounts.value, [sceneId]: blocks.length };
  sceneStats.value = { ...sceneStats.value, [sceneId]: blockStats(blocks, scenes.value.find((s) => s.id === sceneId)) };
}

// A finished chapter of the project's run (services/chapterRun.js — Discover
// and Analyze share it): a scan folds into the chapter rows, an Analyze
// re-reads that chapter's counts and the grid's rows.
const offChapterDone = onChapterDone(async ({ projectId, sceneId, kind, result }) => {
  if (projectId !== selectedProjectId.value) return;
  if (kind === "discover" && result) {
    applyScans({ [sceneId]: { scanned_at: new Date().toISOString(), candidates: result.candidates || [] } });
  } else if (kind === "analyze") {
    await refreshSceneMeta(sceneId);
    await loadProjectScript();
  }
});
onBeforeUnmount(offChapterDone);

// Script's chapter page changed lines — the counts Overview and the grid
// show follow.
async function onScriptChanged() {
  if (scriptSceneId.value) await refreshSceneMeta(scriptSceneId.value);
  await loadProjectScript();
}

function voiceById(voiceId) {
  return voices.value.find((v) => v.id === voiceId) || null;
}

// Never fall back to the id (user ruling 2026-08-15): a cloned voice is minted
// `voice_<32 hex>` (storage/voices.py:76), and printing that in a cast card
// names nothing. A lookup that misses means the voice is gone — say so.
function voiceName(voiceId) {
  return voiceById(voiceId)?.name || "(voice unavailable)";
}

async function assignVoice(personaId, voiceId) {
  try {
    // PUT persona with updated voice_id. Personas API takes the same shape
    // as CreatePersonaRequest — fetch the existing persona, change voice_id,
    // PUT it back.
    const persona = personas.value.find((p) => p.id === personaId);
    if (!persona) return;
    const body = {
      name: persona.name,
      voice_id: voiceId,
      language: persona.language,
      avatar_path: persona.avatar_path,
      voice_instruct: persona.voice_instruct,
      personality: persona.personality,
      default_delivery: persona.default_delivery || {},
      effects_chain: persona.effects_chain || [],
      lexicon_id: persona.lexicon_id,
      engine_override: persona.engine_override,
      llm_rewrite_enabled: persona.llm_rewrite_enabled,
      llm_model: persona.llm_model,
    };
    await api.request(`/v1/personas/${personaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await loadAll();
    pushToast({
      message: voiceId
        ? `Assigned ${voiceById(voiceId)?.name || voiceId} to ${persona.name}.`
        : `Unassigned voice from ${persona.name}.`,
      kind: "success",
      duration: 3000,
    });
  } catch (e) {
    pushToast({ message: `Assign failed: ${e?.message || e}`, kind: "error" });
  }
}

function openVoiceTuner(persona) {
  if (!persona?.voice_id) {
    pushToast({ message: "Assign a voice first.", kind: "info" });
    return;
  }
  tuningVoice.value = {
    voiceId: persona.voice_id,
    name: voiceById(persona.voice_id)?.name || persona.voice_id,
    params: { ...(persona.default_delivery || {}) },
    personaId: persona.id,
  };
  voiceParamsModalOpen.value = true;
}

async function onVoiceParamsSaved(newParams) {
  const t = tuningVoice.value;
  if (!t) return;
  // Library-mode tuning (no personaId): the user tuned a voice from the
  // sidebar without picking a character. Nothing to persist — the
  // session-only params are discarded. A future iteration could cache
  // them keyed by voiceId so subsequent assignments pre-populate.
  if (!t.personaId) {
    voiceParamsModalOpen.value = false;
    tuningVoice.value = null;
    pushToast({ message: "Library-mode tune dismissed. Assign to a character first to persist parameters.", kind: "info", duration: 4000 });
    return;
  }
  const persona = personas.value.find((p) => p.id === t.personaId);
  if (!persona) return;
  const body = {
    name: persona.name,
    voice_id: persona.voice_id,
    language: persona.language,
    avatar_path: persona.avatar_path,
    voice_instruct: persona.voice_instruct,
    personality: persona.personality,
    default_delivery: newParams,
    effects_chain: persona.effects_chain || [],
    lexicon_id: persona.lexicon_id,
    engine_override: persona.engine_override,
    llm_rewrite_enabled: persona.llm_rewrite_enabled,
    llm_model: persona.llm_model,
  };
  try {
    await api.request(`/v1/personas/${t.personaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    voiceParamsModalOpen.value = false;
    tuningVoice.value = null;
    await loadAll();
    pushToast({ message: `Voice params saved.`, kind: "success", duration: 2500 });
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error" });
  }
}

async function smartAssignCast() {
  if (!characterPersonas.value.length) {
    pushToast({ message: "No characters in this project to assign.", kind: "info" });
    return;
  }
  if (!voices.value.length) {
    pushToast({ message: "No voices available to assign from.", kind: "info" });
    return;
  }
  smartAssignBusy.value = true;
  const saStats = [`${characterPersonas.value.length} characters`, `${voices.value.length} voices`];
  try {
    const applied = await withAiTask({
      feature: "smart_assign",
      label: `Smart-assign · ${characterPersonas.value.length} characters`,
      stats: saStats,
      onRetry: () => smartAssignCast(),
    }, async (saTask) => {
      const r = await api.request("/v1/llm/smart-assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: saTask.signal,
        body: JSON.stringify({
          characters: characterPersonas.value.map((p) => ({
            id: p.id,
            name: p.name,
            personality: p.personality,
          })),
          voices: voices.value.map((v) => ({
            id: v.id,
            name: v.name,
            gender: v.gender,
            language: v.language,
          })),
        }),
      });
      const proposed = r?.assignments || {};
      let count = 0;
      for (const [characterId, voiceId] of Object.entries(proposed)) {
        const persona = characterPersonas.value.find((p) => p.id === characterId);
        const voice = voices.value.find((v) => v.id === voiceId);
        if (persona && voice) {
          await assignVoice(characterId, voiceId);
          count += 1;
        }
      }
      saTask.setStats([...saStats, `${count} applied`]);
      return { result: count, usage: r?.usage };
    });
    pushToast({
      message: applied
        ? `Smart-assign applied ${applied} assignment${applied === 1 ? "" : "s"}.`
        : "Smart-assign returned no matches.",
      kind: applied ? "success" : "warning",
      duration: 4500,
    });
  } catch (e) {
    pushToast({
      message: e?.message?.includes("501") || e?.status === 501
        ? "Smart-assign unavailable — wire an LLM provider in Engines → LLM tab."
        : `Smart-assign failed: ${e?.message || e}`,
      kind: "warning",
      duration: 6000,
    });
  } finally {
    smartAssignBusy.value = false;
  }
}

// Chapters workflow strip hands the target tab over (Cast/Script/Render/
// Export). Consumed on EVERY entry: App.vue keeps views alive (KeepAlive),
// so mounted fires once per session — the handoff must ride onActivated
// (which also fires after the initial mount) or it works at most once.
// Returns the step asked for, or null. openProjectInStudio (services/
// openProject.js) sends "overview"; Chapters' strip sends script/cast/…
// A step may carry where to land after a colon: "script:check" opens Script's
// grid on To check (Home's and Overview's Script numbers).
function consumeTabHandoff() {
  try {
    const t = window.sessionStorage?.getItem("jv.studio.tab");
    if (t) {
      window.sessionStorage.removeItem("jv.studio.tab");
      const [step, arg] = t.split(":");
      if (step === "script") {
        scriptSceneId.value = null;
        scriptFilter.value = arg || "all";
      }
      return step;
    }
  } catch { /* ignore */ }
  return null;
}

onMounted(loadAll);

onActivated(async () => {
  const asked = consumeTabHandoff();
  // The project follows too: the app-wide active project is the source of
  // truth on entry (Chapters pushes its selection there before navigating) —
  // without this pull, Cast-from-Chapters can land on another project's
  // cast, because this view keeps its own kept-alive selection.
  const p = projects.value.find((x) => x.id === activeProject.id);
  if (p && selectedProjectId.value !== p.id) {
    requestedTab = asked;             // applied by the project watcher
    selectedProjectId.value = p.id;   // the watcher reloads everything
    return;
  }
  if (asked && isStepFor(selectedProject.value?.project_type, asked)) tab.value = asked;
  // First entry: loadAll has not picked a project yet — hold the step for the
  // project watcher.
  if (!selectedProjectId.value) requestedTab = asked;
  // SAME project: nothing above reloads, and this view is KeepAlive'd, so it
  // re-reads what Script and Overview show — one request.
  await loadProjectScript();
});

// Keep the app-wide active project (sidebar vocabulary, topbar chips,
// Home resume card) in sync with this view's selection.
watch(selectedProjectId, (id) => {
  const p = projects.value.find((x) => x.id === id);
  if (p) activeProject.open(p);
});
</script>

<template>
  <div class="studio jv-fill">

    <!-- ── Project picker ───────────────────────────────────────────── -->
    <div class="jv-section studio__project-bar">
      <label class="studio__project-label">{{ copy.book.singular }}:</label>
      <UiSelect v-model="selectedProjectId" width="name" :options="projectOptions" />
      <span class="jv-spacer" />
      <!-- Which engines power this work (JustWrite reference chips). -->
      <UiChip as="a" :selected="!!headerTts" href="#engines"
         :title="headerTts ? `${headerTts.name || headerTts.id} is loaded — renders use it. Manage on the Speech engines tab.` : 'No TTS engine loaded — the first render sets one up. Manage on the Speech engines tab.'">
        TTS · {{ headerTts ? (headerTts.name || headerTts.id) : "none" }}
      </UiChip>
      <UiChip as="a" :selected="!!headerLlm" href="#settings"
         :title="headerLlm ? `${headerLlm.name || headerLlm.id} answers Script/Smart-assign. Routing in Settings → AI features.` : 'No local LLM loaded — Script/Smart-assign route per Settings → AI features.'">
        Script · {{ headerLlm ? (headerLlm.name || headerLlm.id) : "AI features" }}
      </UiChip>
    </div>

    <!-- ── Overview, then the numbered steps (studioSteps.js) ─────────── -->
    <div class="studio__steps">
      <!-- Big step cards w/ live subtitles (JustWrite reference; new
           canonical .jv-stepcard in styles.css — no app precedent existed). -->
      <button
        v-for="t in stepCards"
        :key="t.key"
        type="button"
        class="jv-stepcard"
        :class="{ 'jv-stepcard--active': tab === t.key }"
        :title="STEP_TITLES[t.key]"
        @click="tab = t.key"
      >
        <span class="jv-stepcard__title">{{ t.label }}</span>
        <span class="jv-stepcard__sub">{{ t.sub }}</span>
      </button>
      <template v-if="tab === 'render' && selectedProject">
        <span class="jv-spacer" />
        <UiTag :intent="masterPillIntent" :title="masterPillTitle">{{ masterPill }}</UiTag>
        <UiButton
          intent="secondary"
          size="small"
          :disabled="renderBusyScene !== null || !renderGate.ok"
          label="▶ Render all"
          :title="renderGate.ok ? 'Queue every chapter that has blocks' : renderGate.reason"
          @click="renderAll"
        />
      </template>
      <!-- Cast-tab actions moved inside the Characters card head (S1) so
           they act on the same surface they affect, matching the
           JustWrite Audio Studio reference. -->
    </div>

    <!-- ── Overview — the project's own page ───────────────────────── -->
    <template v-if="tab === 'overview'">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above, or create one in <a href="#projects">Projects</a>.
      </div>
      <StudioOverview v-else :project="selectedProject" :steps="visibleTabs" :state="overviewState"
        @go="goStep" @reimported="loadScenesForProject(selectedProjectId)" />
    </template>

    <!-- ── Discover — its own step (prose kinds) ───────────────────── -->
    <div v-if="tab === 'discover' && !selectedProject" class="jv-banner">
      Pick a {{ copy.book.singular.toLowerCase() }} above to find its speakers.
    </div>
    <!-- Kept alive across step switches (2026-09-27): a scan in flight keeps
         running while you look at Script, and the page is as you left it. -->
    <KeepAlive>
      <StudioDiscover v-if="tab === 'discover' && selectedProject" :project="selectedProject" :scenes="scenes"
        :lines-by-scene="linesByScene"
        :cast="scriptCast"
        @cast-changed="loadAll" @go="goStep" @scans="applyScans" />
    </KeepAlive>

    <!-- ── Lines — a game project's step 1 (the writers' sheet) ────── -->
    <LinesView v-if="tab === 'lines' && selectedProject" :project-id="selectedProject.id" />

    <!-- ── Cast tab ─────────────────────────────────────────────────── -->
    <section v-if="tab === 'cast'" class="studio__cast">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to manage its {{ copy.cast.plural.toLowerCase() }}.
      </div>

      <template v-else>
        <div class="studio__cast-cols jv-card">
        <div class="studio__cast-card">

        <!-- Compact audition player — ONE in-flow player atop the cast card
             serves every ▶ button (the ruling 2026-08-15: the global bottom
             bar died; playback is compact and in place). -->
        <div v-if="voicePreviewNow" class="studio__audition">
          <span class="jv-muted">Audition · <strong>{{ voicePreviewNow.name }}</strong><template v-if="voicePreviewNow.engine"> · {{ voicePreviewNow.engine }}</template></span>
          <audio :src="voicePreviewNow.url" controls autoplay class="jv-audio-inline" />
        </div>

        <!-- NARRATOR section (JustWrite Audio Studio reference): eyebrow,
             headline, intent paragraph (smart-assign + cast-maps guidance
             combined), then the narrator persona row. Shows for any
             non-game project — when there's no narrator persona yet a
             placeholder slot invites the user to add one. -->
        <section v-if="!isGameProject" class="studio__narrator-section">
          <span class="jv-eyebrow">NARRATOR</span>
          <h3 class="studio__narrator-h">The voice of everything that isn't spoken</h3>
          <p class="studio__narrator-desc jv-muted">
            <strong>Smart-assign</strong> asks your LLM to match each character's
            name and role against the available voices and propose an initial
            cast. <strong>Cast</strong> maps people to voices: select a card →
            click a voice in the library; click the assigned voice again to
            unassign. ▶ auditions any voice in place.
          </p>
          <article
            v-if="narratorPersona"
            class="jv-card studio__char-card studio__char-card--narrator"
            :class="{ 'studio__char-card--selected': selectedCharacterId === narratorPersona.id }"
            @click="selectedCharacterId = narratorPersona.id"
            title="The narrator carries the prose between quotes — pick your steadiest voice"
          >
            <!-- The Narrator is an ordinary persona (2026-09-29): it can
                 leave the cast like anyone else, and "Add Narrator"
                 below brings one back. -->
            <button
              type="button"
              class="studio__char-x"
              title="Remove from this cast — persona stays in the library"
              @click.stop="removeFromCast(narratorPersona)"
            >✕</button>
            <span class="studio__char-portrait" :style="{ background: colorFor(narratorPersona.name) }">N</span>
            <div class="studio__char-main">
              <div class="studio__char-name-row">
                <strong class="studio__char-name">{{ narratorPersona.name }}</strong>
                <UiTag intent="success">main</UiTag>
              </div>
              <div class="studio__char-role jv-muted">{{ personaRole(narratorPersona) || "carries the narration" }}</div>
              <div v-if="narratorPersona.voice_id" class="studio__char-voice">
                <span class="studio__char-glyph" :style="{ background: colorFor(voiceById(narratorPersona.voice_id)?.name), color: '#fff' }">{{ (voiceById(narratorPersona.voice_id)?.name || "?").slice(0, 2) }}</span>
                {{ voiceName(narratorPersona.voice_id) }}
                <span class="jv-muted">· {{ voiceById(narratorPersona.voice_id)?.engine || "" }}</span>
                <button type="button" class="jv-rowact" title="Audition" :disabled="previewingVoiceId" @click.stop="previewVoice(voiceById(narratorPersona.voice_id))">▶</button>
                <button type="button" class="jv-rowact" title="Tune voice parameters" @click.stop="openVoiceTuner(narratorPersona)">⚙</button>
              </div>
              <span v-else class="studio__char-unassigned">⚠ no voice assigned</span>
            </div>
          </article>
          <button
            v-else
            type="button"
            class="studio__narrator-empty"
            :disabled="creatingNarrator"
            title="Create a Narrator persona for this project and add it to the cast"
            @click="createNarrator"
          >
            <span class="studio__char-portrait" :style="{ background: 'var(--surface-3)' }">N</span>
            <span class="studio__narrator-empty-text">
              <strong>{{ creatingNarrator ? "Adding Narrator…" : "Add Narrator" }}</strong>
              <span class="jv-muted">Creates a Narrator persona for this project — voice is assigned below.</span>
            </span>
          </button>
        </section>

        <div class="studio__cast-card-head">
          <span class="jv-eyebrow">{{ isGameProject ? "NPCS" : "CHARACTERS" }}</span>
          <span class="jv-muted" v-if="charactersListLength">
            {{ charactersListLength }} {{ isGameProject ? "NPC" : "character" }}{{ charactersListLength === 1 ? "" : "s" }} ·
            {{ charactersUnassigned }} unassigned
          </span>
          <span class="jv-spacer" />
          <!-- S1: Cast actions live inside the card they act on
               (JustWrite Audio Studio reference). -->
          <UiButton
            intent="secondary"
            size="small"
            label="＋ Add persona"
            title="Add an existing library persona to this cast"
            @click="addPersonaOpen = true"
          />
          <UiButton
            intent="secondary"
            size="small"
            label="✕ Clear cast"
            :loading="clearCastBusy"
            :disabled="clearCastBusy || !projectPersonas.some((p) => p.voice_id)"
            title="Unassign every voice — personas stay"
            @click="clearCast"
          />
          <UiButton
            intent="primary"
            size="small"
            label="✨ Smart-assign"
            :loading="smartAssignBusy"
            :disabled="smartAssignBusy"
            title="LLM proposes a voice per character from bios + gender hints"
            @click="smartAssignCast"
          />
        </div>
        <div v-if="castEngineNotice" class="jv-banner jv-banner--warn" style="font-size:12px; margin-bottom:10px">
          {{ castEngineNotice }}
        </div>
        <div class="studio__cast-scroll">
        <div v-if="!charactersListLength" class="studio__cast-empty">
          <h4>{{ isGameProject ? "No NPCs yet" : "No characters yet" }}</h4>
          <p v-if="isGameProject" class="jv-muted">
            <a href="#studio" @click.prevent="addPersonaOpen = true">Add existing personas</a>
            to this {{ copy.book.singular.toLowerCase() }}, or re-import the sheet — its speakers
            arrive as personas.
          </p>
          <p v-else class="jv-muted">
            Two ways in: run <a href="#studio" @click.prevent="tab = 'discover'">{{ TAB_LABELS.discover }}</a>
            — the speakers it finds arrive here as personas — or
            <a href="#studio" @click.prevent="addPersonaOpen = true">add existing personas</a>
            to this {{ copy.book.singular.toLowerCase() }}.
          </p>
        </div>
        <UiTable v-else-if="isGameProject" class="jv-table-look studio__npc-table"
          :data="projectPersonas" :columns="NPC_COLUMNS" data-key="id" row-hover
          :row-class="(row) => (selectedCharacterId === row.id ? 'studio__npc-row--selected' : '')"
          @row-click="({ data }) => (selectedCharacterId = data.id)">
          <template #portrait="{ row }">
            <span class="studio__char-portrait studio__char-portrait--sm" :style="{ background: colorFor(row.name) }">{{ (row.name || "?").charAt(0).toUpperCase() }}</span>
          </template>
          <template #name="{ row }"><strong>{{ row.name }}</strong></template>
          <template #role="{ row }"><span class="jv-muted studio__npc-role">{{ personaRole(row) }}</span></template>
          <template #voice="{ row }">
            <template v-if="row.voice_id">
              <span class="studio__char-glyph" :style="{ background: colorFor(voiceById(row.voice_id)?.name), color: '#fff' }">{{ (voiceById(row.voice_id)?.name || "?").slice(0, 2) }}</span>
              {{ voiceName(row.voice_id) }}
              <span class="jv-muted">· {{ voiceById(row.voice_id)?.engine || "" }}</span>
            </template>
            <span v-else class="studio__char-unassigned">⚠ no voice</span>
          </template>
          <template #actions="{ row }">
            <button v-if="row.voice_id" type="button" class="jv-rowact" title="Audition" :disabled="previewingVoiceId" @click.stop="previewVoice(voiceById(row.voice_id))">▶</button>
            <button v-if="row.voice_id" type="button" class="jv-rowact" title="Tune voice parameters" @click.stop="openVoiceTuner(row)">⚙</button>
            <button type="button" class="jv-rowact jv-rowact--danger" title="Remove from this cast — persona stays in the library" @click.stop="removeFromCast(row)">✕</button>
          </template>
        </UiTable>
        <div v-else class="studio__cast-grid">
          <!-- Character cards — narrator now lives in its own
               .studio__narrator-section above (JustWrite reference). -->
          <article
            v-for="p in characterPersonas"
            :key="p.id"
            class="jv-card studio__char-card"
            :class="{ 'studio__char-card--selected': selectedCharacterId === p.id, 'studio__char-card--unassigned': !p.voice_id }"
            :title="`Select, then click a voice in the library to cast ${p.name}`"
            @click="selectedCharacterId = p.id"
          >
            <button type="button" class="studio__char-x" title="Remove from this cast — persona stays in the library" @click.stop="removeFromCast(p)">✕</button>
            <span class="studio__char-portrait" :style="{ background: colorFor(p.name) }">{{ (p.name || "?").charAt(0).toUpperCase() }}</span>
            <div class="studio__char-main">
              <strong class="studio__char-name">{{ p.name }}</strong>
              <div class="studio__char-role jv-muted">{{ personaRole(p) }}</div>
              <div v-if="p.voice_id" class="studio__char-voice">
                <span class="studio__char-glyph" :style="{ background: colorFor(voiceById(p.voice_id)?.name), color: '#fff' }">{{ (voiceById(p.voice_id)?.name || "?").slice(0, 2) }}</span>
                {{ voiceName(p.voice_id) }}
                <span class="jv-muted">· {{ voiceById(p.voice_id)?.engine || "" }}</span>
                <button type="button" class="jv-rowact" title="Audition" :disabled="previewingVoiceId" @click.stop="previewVoice(voiceById(p.voice_id))">▶</button>
                <button type="button" class="jv-rowact" title="Tune voice parameters" @click.stop="openVoiceTuner(p)">⚙</button>
              </div>
              <span v-else class="studio__char-unassigned">⚠ no voice assigned</span>
            </div>
          </article>
        </div>
        </div>
        </div>

        <!-- Voice library sidebar — JustWrite-pattern table per
             SettingsProviderForm.vue:965-1100. Read line-by-line this
             turn to ensure all 13 affordances ship instead of the prior
             5: provider-status, "picking voice for X" status line,
             search with icon + count, voice table with name + tone +
             ✓ if assigned + gender chip + tune + preview, loading,
             empty-engine, empty-filter states. -->
        <aside class="studio__voice-library">
          <div class="studio__voice-library-head">
            <h4 class="studio__voice-library-h">Voice library</h4>
            <span class="jv-spacer" />
            <!-- Same control as the Voices page toolbar (item 6 —
                 consistency): engine DROPDOWN, not pills. -->
            <UiSelect v-model="voiceEngineFilter" style="max-width: 180px" title="Show only voices from one engine" :options="voiceEngineOptions" />
          </div>

          <template v-if="!voices.length">
            <EmptyState
              icon="Sparkle"
              title="No voices loaded yet"
              message="Load a TTS engine to populate the voice library. JustVoice ships with 54 Kokoro voices that run on CPU."
              action-label="Open Speech engines"
              compact
              @action="(typeof window !== 'undefined') && (window.location.hash = '#engines')"
            />
          </template>
          <template v-else>
            <!-- Picking-for banner (mock: amber strip). -->
            <div class="studio__voice-picking" v-if="projectPersonas.length">
              <template v-if="selectedCharacter">
                Picking voice for <strong>{{ selectedCharacter.name }}</strong> — click a voice to assign
              </template>
              <template v-else>
                Select a character card, then click a voice to assign it.
              </template>
            </div>

            <!-- Search with icon + count (#E). -->
            <div class="studio__voice-search">
              <span class="studio__voice-search-icon">🔍</span>
              <UiInput
                v-model="voiceSearchQuery"
                type="search"
                size="small"
                class="studio__voice-search-input"
                placeholder="Search by name or tone…"
              />
              <span class="studio__voice-search-count jv-muted">{{ filteredVoices.length }}</span>
            </div>

            <!-- V2: only the voice rows scroll — header/picking/search
                 stay pinned at the top of the aside. -->
            <div class="studio__voice-rows">
            <!-- Empty-filter state (#L). -->
            <div v-if="!filteredVoices.length" class="jv-muted studio__voice-empty">
              No voices match this filter.
            </div>

            <!-- Voice row — name + tone + assigned ✓ + gender chip +
                 tune ⚙ + preview ▶. JustWrite affordances G/H/I/J. -->
            <div
              v-for="v in filteredVoices"
              :key="v.id"
              class="studio__vrow"
              :class="{ 'studio__vrow--assigned': !!castAsByVoiceId[v.id], 'studio__vrow--disabled': !selectedCharacter }"
            >
              <!-- Avatar + name + tone — primary click target (assign/unassign) -->
              <button
                type="button"
                class="studio__vrow-main"
                :disabled="!selectedCharacter"
                :title="!selectedCharacter ? 'Pick a character first' : isVoiceAssignedToSelected(v.id) ? `Unassign ${v.name} from ${selectedCharacter.name}` : `Assign ${v.name} to ${selectedCharacter.name}`"
                @click="selectedCharacter && assignVoice(selectedCharacter.id, isVoiceAssignedToSelected(v.id) ? '' : v.id)"
              >
                <span class="studio__vrow-avatar" :style="{ background: colorFor(v.name) }">{{ (v.name || "?").charAt(0).toUpperCase() }}</span>
                <span class="studio__vrow-text">
                  <strong class="studio__vrow-name">{{ v.name }}</strong>
                  <i class="studio__vrow-tone">
                    {{ v.tone || v.engine || "" }}
                    <span
                      v-if="instructEngineIds.has(v.engine)"
                      class="studio__vrow-instruct"
                      title="This engine performs direction — it reads the persona's Personality text and per-line ＋ direction notes when rendering"
                    >takes direction</span>
                    <span
                      v-if="voiceLocality(v) === 'local'"
                      class="jv-locality jv-locality--local"
                      title="Runs on this machine — no usage cost; loads the engine into RAM/VRAM on first use"
                    >local</span>
                    <span
                      v-else-if="voiceLocality(v) === 'self-hosted'"
                      class="jv-locality jv-locality--local"
                      title="An OpenAI-compatible server you run yourself — free and private"
                    >self-hosted</span>
                    <span
                      v-else-if="voiceLocality(v) === 'online'"
                      class="jv-locality jv-locality--online"
                      title="External provider — needs network and may bill per character/minute"
                    >online · metered</span>
                  </i>
                </span>
              </button>
              <span
                v-if="castAsByVoiceId[v.id]"
                class="studio__vrow-cast"
                :title="`Cast as ${castAsByVoiceId[v.id]}`"
              >✓ {{ castAsByVoiceId[v.id] }}</span>

              <!-- Gender chip click-cycle (#H) -->
              <UiChip
                class="studio__voice-gender"
                :title="displayedGender(v) ? `Cycle gender hint (now ${displayedGender(v)})` : 'Click to set gender hint'"
                @click.stop="cycleGender(v)"
              >
                {{ displayedGender(v) || "?" }}
              </UiChip>

              <!-- Tune button (#I) — opens VoiceParamsModal for this voice -->
              <button
                type="button"
                class="jv-rowact"
                title="Tune voice parameters (speed, exaggeration, …)"
                @click.stop="openVoiceTunerForLibraryVoice(v)"
              >⚙</button>

              <!-- Preview button (#J) — calls /v1/generate with sample text -->
              <button
                type="button"
                class="jv-rowact"
                :disabled="previewingVoiceId === v.id"
                :title="previewingVoiceId === v.id ? 'Generating preview…' : 'Preview this voice with a sample sentence'"
                @click.stop="previewVoice(v)"
              >{{ previewingVoiceId === v.id ? "⏳" : "▶" }}</button>
            </div>
            <p class="studio__voice-foot jv-muted">
              Assigned voices show who they're cast as. One voice can play multiple minor characters.
            </p>
            </div><!-- /.studio__voice-rows -->
          </template>
        </aside>
        </div>
      </template>
    </section>

    <!-- ── Script — the chapter grid, or one chapter (Slice 3, §8.24) ── -->
    <section v-if="tab === 'script'" class="studio__script">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to attribute its script.
      </div>
      <StudioScriptChapter v-else-if="scriptSceneId" :project="selectedProject" :scene-id="scriptSceneId"
        :chapters="scriptChapters" :scenes="scenes" :cast="scriptCast" :focus="scriptFocus"
        :version="scriptVersion"
        @back="openScript({ sceneId: null })"
        @open="(id, focus) => openScript({ sceneId: id, focus })"
        @go="(k) => (tab = k)" @changed="onScriptChanged" @cast-changed="loadAll"
        @rewrite="rewriteRow" />
      <StudioScript v-else :project="selectedProject" :chapters="scriptChapters" :scenes="scenes"
        :cast="scriptCast" v-model:filter="scriptFilter"
        @open="(id, focus) => openScript({ sceneId: id, focus })" @go="(k) => (tab = k)" />
    </section>

    <!-- ── Render tab — Phase 6 / Slice 1 ───────────────────────────── -->
    <section v-if="tab === 'render'" class="studio__render">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to render its {{ copy.chapter.plural.toLowerCase() }}.
      </div>
      <template v-else>
        <header class="studio__render-toolbar">
          <UiButton intent="secondary" size="small" label="Select unrendered" title="Select chapters the render cache doesn't fully cover" @click="selectAllUnrendered" />
          <UiButton intent="ghost" size="small" label="Select all" title="Every chapter with text — rendered ones re-serve from cache" @click="selectAllRenderable" />
          <span class="jv-muted">{{ selectedSceneCount() }} selected</span>
          <span class="jv-spacer" />
          <UiButton
            intent="secondary"
            size="small"
            :loading="qcBusy"
            :disabled="qcBusy"
            label="🎧 Run ACX QC"
            title="Render every chapter (cache-served when unchanged) and measure RMS + peak against the ACX limits"
            @click="runQC"
          />
          <UiButton
            intent="primary"
            size="small"
            :disabled="!selectedSceneCount() || renderBusyScene !== null || !renderGate.ok"
            :label="`▶ Render selected (${selectedSceneCount()})`"
            :title="renderGate.ok ? '' : renderGate.reason"
            @click="renderSelected"
          />
          <span v-if="!renderGate.ok" class="jv-muted" style="font-size:11.5px">{{ renderGate.reason }}</span>
        </header>

        <!-- Cache banner — how much of the next render is free. -->
        <div v-if="cacheStats && cacheStats.total" class="jv-banner studio__cache-banner" :class="cacheStats.cached ? 'jv-banner--info' : ''">
          Cache: <strong>{{ cacheStats.cached }} of {{ cacheStats.total }}</strong>
          {{ copy.line.plural.toLowerCase() }} unchanged since last render —
          {{ cacheStats.cached ? `only ${cacheStats.total - cacheStats.cached} hit the engine` : "everything hits the engine on first render" }}.
        </div>

        <table class="jv-table studio__render-table">
          <thead>
            <tr>
              <th class="studio__render-check"></th>
              <th>#</th>
              <th>{{ copy.chapter.singular }}</th>
              <th>{{ copy.line.plural }}</th>
              <th title="Lines served from the render cache — unchanged since last render">Cached</th>
              <th>Render preset</th>
              <th>Check</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(s, i) in scenes" :key="s.id">
              <tr>
                <td class="studio__render-check">
                  <UiCheckbox
                    :model-value="!!sceneSelectedForRender[s.id]"
                    @change="sceneSelectedForRender = { ...sceneSelectedForRender, [s.id]: $event.target.checked }"
                  />
                </td>
                <td class="jv-muted">{{ i + 1 }}</td>
                <td>
                  <strong>{{ s.title || `${copy.chapter.singular} ${s.position + 1}` }}</strong>
                </td>
                <td class="jv-mono">{{ sceneBlockCounts[s.id] || 0 }}</td>
                <td class="jv-mono jv-muted">
                  <template v-if="sceneCacheById[s.id]?.total">{{ sceneCacheById[s.id].cached }}/{{ sceneCacheById[s.id].total }}</template>
                  <template v-else>—</template>
                </td>
                <td>
                  <UiSelect
                    :model-value="scenePresetSelections[s.id] || ''"
                    width="id"
                    :options="presetOptions()"
                    @update:model-value="(v) => scenePresetSelections = { ...scenePresetSelections, [s.id]: v }"
                  />
                </td>
                <td>
                  <UiTag :intent="checkState(s.id).intent" :title="checkState(s.id).title || ''">{{ checkState(s.id).label }}</UiTag>
                </td>
                <td class="studio__render-actions">
                  <UiButton
                    intent="ghost"
                    size="small"
                    :loading="suggestBusyScene === s.id"
                    :disabled="suggestBusyScene === s.id"
                    label="💡 Suggest"
                    @click="suggestPresetFor(s)"
                  />
                  <UiButton
                    intent="secondary"
                    size="small"
                    :loading="renderBusyScene === s.id"
                    :disabled="renderBusyScene !== null && renderBusyScene !== s.id"
                    label="▶ Render"
                    @click="renderScene(s)"
                  />
                </td>
              </tr>
              <!-- Per-scene progress strip — appears below the row when
                   a render task is in flight or lingering after its finish
                   (kit queue; failed rows stay until dismissed). -->
              <tr v-if="taskForScene(s.id)" class="studio__render-progress-row">
                <td colspan="8" class="studio__render-progress-cell">
                  <div class="studio__render-progress">
                    <UiTag :intent="sceneTaskBadge(s.id).intent">{{ sceneTaskBadge(s.id).text }}</UiTag>
                    <div class="studio__render-bar">
                      <div
                        class="studio__render-bar-fill"
                        :class="{ 'studio__render-bar-fill--indeterminate': !taskForScene(s.id).progress && sceneTaskRunning(s.id) }"
                        :style="taskForScene(s.id).progress?.total ? { width: ((taskForScene(s.id).progress.done / taskForScene(s.id).progress.total) * 100) + '%' } : {}"
                      />
                    </div>
                    <span v-if="taskForScene(s.id).error" class="jv-muted" style="color: var(--danger); font-size: 11.5px;">
                      {{ taskForScene(s.id).error }}
                    </span>
                    <UiButton
                      v-if="sceneTaskRunning(s.id)"
                      intent="danger-outline" size="small" label="Cancel"
                      @click="tasks.cancel(taskForScene(s.id).id)"
                    />
                    <UiButton
                      v-if="taskForScene(s.id).status === 'error' || taskForScene(s.id).status === 'cancelled'"
                      intent="secondary" size="small" label="↻ Retry"
                      @click="renderScene(s)"
                    />
                    <UiButton
                      v-if="taskForScene(s.id).status === 'done' && taskForScene(s.id).result?.url"
                      intent="ghost" size="small" label="▶ Play"
                      title="Play here in the row"
                      @click="scenePlay = { id: s.id, url: taskForScene(s.id).result.url }"
                    />
                    <UiButton
                      as="a"
                      v-if="taskForScene(s.id).status === 'done' && taskForScene(s.id).result?.url"
                      :href="taskForScene(s.id).result.url"
                      :download="taskForScene(s.id).result.filename || 'scene.wav'"
                      intent="ghost" size="small"
                      title="Download WAV"
                    >⬇ Download</UiButton>
                    <UiButton
                      v-if="!sceneTaskRunning(s.id)"
                      intent="ghost" size="small" label="✕"
                      @click="tasks.dismiss(taskForScene(s.id).id)"
                    />
                  </div>
                  <!-- Compact inline playback for the finished render (the
                       ruling 2026-08-15: no global bottom bar). -->
                  <audio v-if="scenePlay?.id === s.id" :src="scenePlay.url" controls autoplay class="jv-audio-inline" style="margin-top: 6px" />
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>
    </section>

    <!-- ── Export tab — package + ACX checklist (mock export screen) ── -->
    <section v-if="tab === 'export'" class="studio__exportstep">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to package it.
      </div>
      <ExportPanel v-else :project="selectedProject" :scenes="scenes" />
    </section>

    <!-- Voice params modal — Tier-2 voice tuning. -->
    <VoiceParamsModal
      v-if="tuningVoice"
      :open="voiceParamsModalOpen"
      :voice-id="tuningVoice.voiceId"
      :voice-name="tuningVoice.name"
      :model-value="tuningVoice.params"
      @save="onVoiceParamsSaved"
      @cancel="voiceParamsModalOpen = false; tuningVoice = null"
    />

    <!-- Add an existing library persona to the cast. -->
    <AppModal v-if="addPersonaOpen" eyebrow="Cast" :title="`Add a persona to this ${copy.book.singular.toLowerCase()}`" :max-width="'520px'" dismissable @close="addPersonaOpen = false">
          <p v-if="!addablePersonas.length" class="jv-muted" style="margin: 4px 0 8px">
            Every library persona is already in this cast.
            <a href="#personas">Create a new persona</a> and it'll appear here.
          </p>
          <ul v-else class="studio__addpersona-list">
            <li v-for="p in addablePersonas" :key="p.id" class="studio__addpersona-row">
              <span class="studio__char-portrait studio__char-portrait--sm" :style="{ background: colorFor(p.name) }">{{ (p.name || "?").charAt(0).toUpperCase() }}</span>
              <div class="studio__addpersona-meta">
                <strong>{{ p.name }}</strong>
                <span class="jv-muted">{{ voiceById(p.voice_id)?.name || (p.voice_id || "no voice yet") }}</span>
              </div>
              <UiButton
                intent="secondary"
                size="small"
                label="Add"
                :loading="addPersonaBusy === p.id"
                :disabled="addPersonaBusy !== null"
                @click="addPersonaToCast(p)"
              />
            </li>
          </ul>
    </AppModal>

    <!-- The render blocker (restore decision 5). A line nobody speaks used
         to be dropped from the audio without a word; now the render stops
         here and offers the one-click way out. -->
    <AppModal
      v-if="unplacedModalOpen"
      eyebrow="Render stopped"
      :title="`${unplacedTotal} line${unplacedTotal === 1 ? '' : 's'} have no speaker`"
      :max-width="'720px'"
      dismissable
      @close="unplacedModalOpen = false"
    >
      <p class="jv-muted" style="margin: 0 0 12px">
        These would be missing from the audio, so nothing is rendered until they
        have a voice. Send them all to the narrator, or fix them in Script.
      </p>
      <div v-for="group in unplacedFound" :key="group.scene.id" class="studio__unplaced-group">
        <strong>{{ group.scene.title || `${copy.chapter.singular} ${group.scene.position + 1}` }}</strong>
        <span class="jv-muted"> — {{ group.blocks.length }}</span>
        <UiButton intent="ghost" size="small" label="Fix in Script ➜"
          :title="`Opens this ${copy.chapter.singular.toLowerCase()} on its lines with no speaker, the first one selected`"
          @click="unplacedModalOpen = false; openScript({ sceneId: group.scene.id, focus: 'none' })" />
        <ul class="studio__unplaced-list">
          <li v-for="b in group.blocks.slice(0, 8)" :key="b.id" class="jv-muted">{{ b.text }}</li>
          <li v-if="group.blocks.length > 8" class="jv-muted">…and {{ group.blocks.length - 8 }} more</li>
        </ul>
      </div>
      <template #footer>
        <UiButton intent="secondary" label="Not now" @click="unplacedModalOpen = false" />
        <UiButton
          intent="primary"
          :loading="unplacedFixing"
          :disabled="unplacedFixing || !narratorPersona"
          :label="`Assign all to ${narratorPersona ? narratorPersona.name : 'Narrator'}`"
          :title="narratorPersona ? '' : 'This project has no Narrator persona'"
          @click="assignUnplacedToNarrator"
        />
      </template>
    </AppModal>

    <!-- Per-block Rewrite preview (right-click on Script tab). -->
    <AppModal
      v-if="rewriteModalOpen"
      eyebrow="Rewrite in character"
      :title="rewriteLine ? (projectPersonas.find((p) => p.id === rewriteLine.persona_id)?.name || 'Line') : 'Line'"
      :max-width="'720px'"
      dismissable
      @close="rewriteModalOpen = false"
    >
        <div style="display: flex; flex-direction: column; gap: 14px;">
          <div>
            <div class="jv-form-row__label" style="margin-bottom: 4px">Original</div>
            <div style="padding: 10px 12px; background: var(--surface-2); border-radius: 6px; font-size: 13px; line-height: 1.5;">
              {{ rewriteOriginal }}
            </div>
          </div>
          <div>
            <div class="jv-form-row__label" style="margin-bottom: 4px">Rewritten</div>
            <div v-if="rewriteBusy" class="jv-muted" style="padding: 10px 12px;">Generating rewrite…</div>
            <div v-else-if="rewriteError" class="jv-muted" style="padding: 10px 12px; color: var(--danger);">
              {{ rewriteError }}
            </div>
            <UiTextarea
              v-else
              v-model="rewritePreview"
              style="min-height: 100px;"
              placeholder="Rewrite will appear here…"
            />
          </div>
        </div>
        <template #footer>
          <UiButton
            intent="secondary"
            size="small"
            :disabled="rewriteBusy"
            label="↻ Try again"
            @click="runRewrite"
          />
          <span class="jv-spacer" />
          <UiButton intent="secondary" label="Discard" @click="rewriteModalOpen = false" />
          <UiButton
            intent="primary"
            :disabled="rewriteBusy || !rewritePreview.trim()"
            label="Accept"
            @click="acceptRewrite"
          />
        </template>
    </AppModal>
  </div>
</template>

<style scoped>
.studio { padding: 0; display: flex; flex-direction: column; gap: 16px; }

.studio__project-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--surface-2);
  border-radius: 6px;
  border: 1px solid var(--border-soft);
}
.studio__project-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}

.studio__steps { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
/* V3: cast-card is now a column INSIDE the shared outer jv-card —
   no border, no background, no own card chrome. */
.studio__cast-card {
  padding: 14px 16px;
  margin: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: transparent;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
.studio__cast-card-head { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
.studio__cast-card-head strong { font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-2); }
.studio__cast-card-head .jv-muted { font-size: 12px; }

/* Narrator section (JustWrite Audio Studio reference): eyebrow,
   headline, intent paragraph, narrator persona row. Sits above the
   Characters head inside the shared cast card's left column. */
.studio__narrator-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-bottom: 14px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--line);
}
.studio__narrator-h {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--ink);
  line-height: 1.3;
}
.studio__narrator-desc {
  margin: 0;
  font-size: 13px;
  line-height: 1.55;
}
.studio__narrator-desc strong { color: var(--ink); font-weight: 600; }
.studio__narrator-empty {
  display: flex;
  align-items: center;
  gap: 11px;
  padding: 12px 14px;
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  background: var(--surface);
  cursor: pointer;
  font: inherit;
  text-align: left;
  width: 100%;
}
.studio__narrator-empty:hover { border-color: var(--accent); background: var(--accent-soft); }
.studio__narrator-empty-text { display: flex; flex-direction: column; gap: 2px; }
.studio__narrator-empty-text strong { font-size: 13.5px; font-weight: 600; }
.studio__narrator-empty-text .jv-muted { font-size: 12px; }
.studio__cast-scroll { overflow-y: auto; min-height: 0; flex: 1 1 0; }
.studio__char-x {
  position: absolute;
  top: 8px;
  right: 8px;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  opacity: 0;
}
.studio__char-card:hover .studio__char-x { opacity: 1; }
.studio__char-x:hover { color: var(--danger, #b04a3e); }
.studio__step {
  appearance: none;
  font: inherit;
  cursor: pointer;
}
.studio__step:hover { border-color: var(--accent); color: var(--accent-ink); }
.studio__step--active {
  background: var(--accent);
  border-color: var(--accent);
  color: #fff;
  font-weight: 600;
}

.studio__cast {
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* F4: cast section is the tab's "grow" child within .studio.jv-fill,
     so only the inner cards scroll — the page itself doesn't. */
  flex: 1 1 0;
  min-height: 0;
}
.studio__cast-cols {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(300px, 1fr);
  /* V3: shared outer .jv-card — the two columns sit inside it with a
     hairline divider, no per-column card chrome. */
  gap: 0;
  padding: 0;
  /* S2 + F4: row fills the .studio__cast leftover height, and grid's
     default align-items:stretch makes Characters and Voice library
     panes always match — even when one is empty. */
  grid-template-rows: minmax(0, 1fr);
  flex: 1 1 0;
  min-height: 0;
  overflow: hidden;
}
/* Hairline between the two panes inside the shared card. */
.studio__cast-cols > .studio__voice-library { border-left: 1px solid var(--line); }
@media (max-width: 900px) {
  .studio__cast-cols {
    grid-template-columns: 1fr;
    grid-template-rows: auto auto;
  }
}
.studio__cast-empty {
  border: 1px dashed var(--line-strong);
  border-radius: 10px;
  padding: 22px 24px;
  background: var(--surface);
}
.studio__cast-empty h4 { margin: 0 0 6px; font-size: 14px; }
.studio__cast-empty p { margin: 0; font-size: 12.5px; line-height: 1.6; }
.studio__cast-empty a { color: var(--accent-ink); text-decoration: underline; }

.studio__cast-toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.studio__lede { font-size: 13px; color: var(--ink-2); margin: 0 0 4px; max-width: 880px; }

.studio__cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 10px;
  align-content: start;
}

/* Compact horizontal card (mock .cast-card): portrait left, name/role/
   voice line right. Selected = accent ring; unassigned = dashed edge. */
.studio__char-card {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 12px 14px;
  margin: 0;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.studio__char-card:hover { border-color: var(--accent-line, var(--accent)); }
.studio__char-card--narrator { background: var(--accent-soft); grid-column: 1 / -1; }
.studio__char-card--selected { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.studio__char-card--unassigned { border-style: dashed; }

.studio__char-portrait {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--accent);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 15px;
  flex: none;
}
.studio__char-main { min-width: 0; flex: 1; }
.studio__char-name-row { display: flex; align-items: center; gap: 6px; }
.studio__char-name { font-weight: 600; font-size: 13.5px; }
.studio__char-role { font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio__char-voice { display: flex; align-items: center; gap: 6px; font-size: 12px; margin-top: 4px; }
.studio__char-glyph {
  width: 20px; height: 20px; border-radius: 50%;
  background: var(--surface-3); color: var(--ink-2);
  font-size: 9px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  flex: none;
}
.studio__char-unassigned { font-size: 11.5px; color: var(--warn-ink); display: inline-block; margin-top: 4px; }

.studio__voice-library {
  /* V3: pane inside the shared .studio__cast-cols.jv-card — no own
     card chrome (border / bg / radius set on the wrapper).
     V5: tint the voice-library pane (surface-2) so it reads distinct
     from the white Cast pane on the left — JustWrite-style contrast. */
  padding: 14px;
  background: var(--surface-2);
  border: 0;
  border-radius: 0;
  /* S2: fills the cast-cols row track so it always matches the
     Characters pane height.
     V2: aside is a flex column — head + picking banner + search stay
     pinned; only the inner .studio__voice-rows scroller moves. */
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.studio__voice-rows {
  flex: 1 1 0;
  min-height: 0;
  overflow-y: auto;
}
/* V3: seamless scroll — hide the scrollbars on both inner scrollers
   so the panes look like one continuous card. Mouse-wheel /
   touch-pad / keyboard scrolling all still work. */
.studio__cast-scroll,
.studio__voice-rows { scrollbar-width: none; }
.studio__cast-scroll::-webkit-scrollbar,
.studio__voice-rows::-webkit-scrollbar { width: 0; height: 0; }
.studio__voice-library-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.studio__voice-library-head .studio__voice-library-h { margin: 0 6px 0 0; }
.studio__engine-pill { cursor: pointer; font-size: 11px; }
.studio__engine-pill:hover { border-color: var(--accent); }

/* Mock voice row: avatar · name + italic tone · ✓ cast-as · actions.
   Assigned rows tint green. */
.studio__vrow {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 7px 10px;
  margin-bottom: 6px;
  background: var(--surface);
}
.studio__vrow--assigned {
  background: var(--accent-soft);
  border-color: var(--accent-line, #b8d2c3);
}
.studio__vrow--disabled { opacity: 0.75; }
.studio__vrow-main {
  appearance: none; border: 0; background: transparent;
  display: flex; align-items: center; gap: 10px;
  flex: 1; min-width: 0;
  font: inherit; text-align: left; cursor: pointer; padding: 0;
}
.studio__vrow-main:disabled { cursor: not-allowed; }
.studio__vrow-avatar {
  width: 26px; height: 26px; border-radius: 50%;
  color: #fff; font-size: 11px; font-weight: 700;
  display: inline-flex; align-items: center; justify-content: center;
  flex: none;
}
.studio__vrow-text { min-width: 0; display: flex; flex-direction: column; }
.studio__vrow-name { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio__vrow-tone { font-size: 11px; color: var(--ink-3); font-style: italic; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.studio__vrow-cast { flex: none; font-size: 11.5px; font-weight: 600; color: var(--accent-ink); }
.studio__voice-foot { font-size: 11.5px; margin: 10px 0 0; }
.studio__voice-library-h {
  margin: 0 0 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.studio__voice-group { margin-bottom: 12px; }
.studio__voice-group-h {
  font-size: 10.5px;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 4px;
  font-family: var(--font-mono);
}
.studio__voice-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 8px 10px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px;
  margin-bottom: 4px;
  font-size: 12px;
  color: var(--ink);
  transition: background 0.12s, border-color 0.12s;
}
.studio__voice-row:hover { background: var(--surface-2); border-color: var(--line-strong); }
.studio__voice-row--disabled { opacity: 0.55; }
.studio__voice-row-name-btn {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0;
  margin: 0;
  flex: 1;
  min-width: 0;
  cursor: pointer;
  text-align: left;
  font: inherit;
  color: inherit;
  display: flex;
  flex-direction: column;
  gap: 0;
}
.studio__voice-row-name-btn:hover:not(:disabled) .studio__voice-row-name {
  color: var(--accent);
}
.studio__voice-row-name-btn:disabled { cursor: not-allowed; }
.studio__voice-row-name {
  display: inline-block;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
}
.studio__voice-gender {
  appearance: none;
  border: 1px solid var(--line-strong);
  background: var(--surface);
  color: var(--ink-2);
  cursor: pointer;
  padding: 1px 8px;
  font-size: 10.5px;
  border-radius: var(--r-pill);
}
.studio__voice-gender:hover { background: var(--surface-2); }
.studio__voice-row-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.studio__voice-row-meta {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  font-size: 10.5px;
}
.studio__voice-filter {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}
.studio__voice-filter .jv-input { flex: 1; min-width: 0; }

.studio__voice-picking {
  background: var(--warn-bg);
  border: 1px solid var(--warn-line);
  color: var(--warn-ink);
  border-radius: 7px;
  padding: 8px 11px;
  font-size: 12px;
  margin-bottom: 8px;
}

.studio__voice-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}
.studio__voice-search-icon {
  position: absolute;
  left: 8px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11px;
  pointer-events: none;
  color: var(--ink-3);
}
.studio__voice-search-input {
  flex: 1;
  padding-left: 26px !important;
}
.studio__voice-search-count {
  font-size: 11px;
  min-width: 24px;
  text-align: right;
}

.studio__voice-empty {
  font-size: 12px;
  padding: 8px 0;
  text-align: center;
}

.studio__voice-row-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.studio__voice-row-assigned {
  color: var(--accent);
  font-weight: 700;
  font-size: 12px;
}
.studio__voice-row-tone {
  display: block;
  font-size: 10.5px;
  font-style: italic;
  color: var(--ink-3);
  margin-top: 1px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}


/* ── Script — its pages style themselves (StudioScript*.vue) ─────── */

.studio__unplaced-group { margin-bottom: 12px; font-size: 13px; }
.studio__unplaced-list {
  margin: 6px 0 0;
  padding-left: 18px;
  font-size: 12.5px;
  line-height: 1.5;
}
.studio__unplaced-list li {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Render tab ───────────────────────────────────────────────────── */
.studio__render-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.studio__render-table { font-size: 12.5px; }
.studio__render-check { width: 32px; }
.studio__render-actions {
  display: flex;
  gap: 6px;
  white-space: nowrap;
}

/* Per-scene progress strip under the row when a render task is in flight. */
.studio__render-progress-row { background: var(--surface-2); }
.studio__render-progress-cell { padding: 6px 12px 8px; }
.studio__render-progress {
  display: flex;
  align-items: center;
  gap: 10px;
}
.studio__render-bar {
  flex: 1;
  height: 4px;
  background: var(--surface);
  border-radius: 2px;
  overflow: hidden;
  position: relative;
}
.studio__render-bar-fill {
  height: 100%;
  background: var(--accent);
  border-radius: 2px;
  transition: width 0.18s ease-out;
}
.studio__render-bar-fill--indeterminate {
  width: 36%;
  position: absolute;
  left: 0;
  animation: studio-progress-indeterminate 1.4s ease-in-out infinite;
}
@keyframes studio-progress-indeterminate {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(280%); }
}

.studio__npc-table { margin: 0; }
.studio__npc-role { font-size: 12.5px; }
/* The row's cursor and hover tint come from `row-hover`; selection is a
   `:row-class`, and the rule reaches INTO the component (audit §19.1). */
.studio__npc-table :deep(.ui-table-row.studio__npc-row--selected) td { background: var(--accent-soft); }
.studio__char-portrait--sm { width: 28px; height: 28px; font-size: 12px; }

.studio__addpersona-list { list-style: none; margin: 0; padding: 0; max-height: 50vh; overflow-y: auto; }
.studio__addpersona-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 4px;
  border-bottom: 1px dashed var(--line);
}
.studio__addpersona-row:last-child { border-bottom: 0; }
.studio__addpersona-meta { display: flex; flex-direction: column; flex: 1; min-width: 0; }
.studio__addpersona-meta .jv-muted { font-size: 11.5px; }


.studio__vrow-instruct {
  font-size: 9px;
  font-weight: 800;
  font-style: normal;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--accent-ink);
  background: var(--accent-soft);
  border-radius: 4px;
  padding: 1px 5px;
  margin-left: 5px;
  vertical-align: 1px;
}
.studio__vrow-online {
  color: var(--warn-ink);
  background: var(--warn-bg);
}

/* The compact audition player atop the cast card (2026-08-15: the global
   bottom bar died — playback is compact and in place). */
.studio__audition {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
  font-size: 12px;
}
</style>
