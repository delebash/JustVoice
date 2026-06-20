<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  StudioView — multi-character production environment for the
  audiobook + podcast + game use cases. Three-tab Cast → Script →
  Render flow ported in shape from JustWrite's StudioView.vue.

  Terminology adapts via useCopy():
    audiobook → Cast / Chapter / Render
    podcast   → Hosts / Episode / Render
    game      → NPCs / Quest / Render

  Phase 4 / Slice 1 — shell + Cast tab + VoiceParamsModal.
  Phase 4 / Slice 2 — Script tab + analyze + Smart-assign.
  Phase 6      — Render tab (Studio Render slice).
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useAudioPlayer } from "../stores/audioPlayer.js";
import { usePageCrumbs } from "../composables/usePageCrumbs.js";
import { useCopy } from "../services/copy.js";
import { readPref, writePref } from "../services/prefs.js";
import { pushToast } from "../services/toastBridge.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";
import { useVoicesStore } from "../stores/voices.js";
import { useEnginesStore } from "../stores/engines.js";
import JvButton from "../components/ui/JvButton.vue";
import VoiceParamsModal from "../components/VoiceParamsModal.vue";
import EmptyState from "../components/EmptyState.vue";
import ExportPanel from "../components/ExportPanel.vue";
import { confirmDialog } from "../services/dialog.js";

const api = useApi();
const activeProject = useActiveProject();
const tasks = useRenderTasks();
const audioPlayer = useAudioPlayer();
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
const tab = ref("cast");
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

// Per-block right-click Rewrite (plan Q1 / LD3). When the user
// right-clicks a Script tab row, we open a preview modal where the LLM
// rewrites that block's text in the persona's voice. User accepts →
// row.text replaces; rejects → original stays.
const rewriteModalOpen = ref(false);
const rewriteRowIndex = ref(null);
const rewriteOriginal = ref("");
const rewritePreview = ref("");
const rewriteBusy = ref(false);
const rewriteError = ref("");

function rewriteRow(idx) {
  if (!analyzeRows.value[idx]) return;
  const row = analyzeRows.value[idx];
  // Only dialogue/character rows have a persona to rewrite against.
  if (row.kind !== "dialogue") {
    pushToast({ message: "Rewrite only applies to dialogue rows.", kind: "info" });
    return;
  }
  if (!row.speaker || row.speaker === "narrator" || row.speaker === "unknown") {
    pushToast({ message: "Assign a persona to this row first.", kind: "info" });
    return;
  }
  rewriteRowIndex.value = idx;
  rewriteOriginal.value = row.text;
  rewritePreview.value = "";
  rewriteError.value = "";
  rewriteModalOpen.value = true;
  runRewrite();
}

async function runRewrite() {
  const idx = rewriteRowIndex.value;
  if (idx == null || !analyzeRows.value[idx]) return;
  const row = analyzeRows.value[idx];
  const personaId = row.speaker;
  rewriteBusy.value = true;
  try {
    const r = await api.request(`/v1/personas/${personaId}/rewrite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: row.text }),
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

function acceptRewrite() {
  const idx = rewriteRowIndex.value;
  if (idx == null || !analyzeRows.value[idx] || !rewritePreview.value) {
    rewriteModalOpen.value = false;
    return;
  }
  analyzeRows.value[idx] = {
    ...analyzeRows.value[idx],
    text: rewritePreview.value,
    rewritten: true,
  };
  rewriteModalOpen.value = false;
  pushToast({ message: "Block rewritten. Apply to save.", kind: "success" });
}

// Script tab state (Phase 4 / Slice 2)
const scenes = ref([]);
const selectedSceneId = ref(null);
const sceneText = ref("");
const analyzeBusy = ref(false);
// Discovered speakers — identification results awaiting promotion (CONCEPTS §3).
const discovered = ref([]);   // [{name, role_hint, approx_lines}]
const promoting = ref(false);
const analyzeRows = ref([]);
const analyzeTierUsed = ref(null);
const analyzeFloor = ref(null);
const editedFlags = ref({});  // {rowIdx: true} for rows the user changed

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

// Per-scene task lookup so the render row can show a progress strip
// driven by the renderTasks store.
function taskForScene(sceneId) {
  return tasks.running.find(
    (t) => t.feature === "render-scene" && t.meta?.sceneId === sceneId,
  ) || null;
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

const visibleTabs = computed(() => {
  const isGame = selectedProject.value?.project_type === "game_voicelines";
  const keys = isGame ? ["cast", "render", "export"] : ["cast", "script", "render", "export"];
  const names = { cast: "Cast", script: "Script", render: "Render", export: "Export" };
  return keys.map((key, i) => ({ key, label: `${i + 1} · ${names[key]}` }));
});

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
const stepCards = computed(() => visibleTabs.value.map((t) => {
  let sub = "";
  if (t.key === "cast") {
    sub = projectPersonas.value.length
      ? `${voicedCount.value}/${projectPersonas.value.length} voiced`
      : "no cast yet";
  } else if (t.key === "script") {
    sub = "speaker analysis";
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
  if (tab.value === "script" && !visibleTabs.value.some((t) => t.key === "script")) {
    tab.value = "cast";
  }
  if (tab.value === "render") {
    qcByScene.value = {};
    loadCacheStats();
  }
});

const projectOptions = computed(() => {
  if (!projects.value.length) return [{ label: "— no projects —", value: null }];
  return projects.value.map((p) => ({ label: p.name, value: p.id }));
});

// Personas bound to the selected project via ProjectPersona m2m.
const projectPersonas = ref([]);

const narratorPersona = computed(() =>
  projectPersonas.value.find((p) => /^narrator$/i.test(p.name || "")) || null,
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
// Voices hidden on the Voices page stay hidden here too (consistency,
// user ask 2026-06-12) — EXCEPT voices already cast in this project,
// which must stay visible or the cast state becomes unreadable.
const hiddenVoiceIds = computed(() => {
  const h = readPref("hiddenVoices", []);
  return new Set(Array.isArray(h) ? h : []);
});
const engineMetaById = computed(() => {
  const m = {};
  for (const e of engines.value || []) m[e.id] = e;
  return m;
});
const filteredVoices = computed(() => {
  const q = voiceSearchQuery.value.trim().toLowerCase();
  return voices.value
    .filter((v) => {
      // Voices of not-installed isolated engines can't audition — keep
      // them out of the cast library entirely (they live on Voices with
      // a NEEDS INSTALL tag).
      const e = engineMetaById.value[v.engine];
      return !(e && e.isolation === "venv" && e.status === "not_installed");
    })
    .filter((v) => !hiddenVoiceIds.value.has(v.id) || castAsByVoiceId.value[v.id])
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

// First meaningful bio line doubles as the card's role line. Demo +
// imported bios often carry a "Voice hint:" block — skip it.
function personaRole(p) {
  for (const line of (p?.bio || "").split("\n")) {
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

// Idempotent backend call — creates a builtin Narrator persona for
// this project + adds it to the cast. Used by the empty-state slot in
// the Narrator section so pre-feature projects don't need a server
// restart for the init-time backfill to land.
const creatingNarrator = ref(false);
async function createBuiltinNarrator() {
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
// routes the resulting Blob into the global audio player. JustWrite
// affordance J. Per-voice preview state stops the button being
// re-clicked while in flight.
// Engines whose manifest declares instruct_field — these consume the
// persona's Personality text as a style prompt at render time. Drives
// the "instruct" chip in the voice library (user ask: "how do I know
// what TTS takes input from the bio and personality").
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
      const url = URL.createObjectURL(blob);
      audioPlayer.play({
        url,
        title: `Preview · ${voice.name}`,
        subtitle: voice.engine || "",
      });
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
  } catch {
    projectPersonas.value = [];
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
  if (project) segments.push({ label: project.name, href: "#books" });
  if (tab.value) segments.push({ label: TAB_LABELS.value[tab.value] || tab.value });
  return segments;
});
watch([() => selectedProject.value?.name, tab, TAB_LABELS], publishCrumbs, { immediate: true });

async function loadScenesForProject(projectId) {
  if (!projectId) {
    scenes.value = [];
    selectedSceneId.value = null;
    return;
  }
  try {
    const r = await api.safeRequest(`/v1/projects/${projectId}/scenes`, []);
    // Endpoint returns a bare array (block_count included per scene).
    scenes.value = Array.isArray(r) ? r : r?.scenes || [];
    // Reset the scene selection whenever it doesn't belong to THIS
    // project — keeping the old id froze Script/Render on the previous
    // book's chapter (user-hit: "book dropdown doesn't change anything").
    if (!scenes.value.some((s) => s.id === selectedSceneId.value)) {
      selectedSceneId.value = scenes.value[0]?.id ?? null;
    }
    // Eager-fetch per-scene block counts for the Render tab's
    // "Select all unrendered" affordance.
    sceneBlockCounts.value = {};
    await Promise.all(
      scenes.value.map(async (s) => {
        try {
          const blocks = await api.safeRequest(`/v1/scenes/${s.id}/blocks`, []);
          const list = Array.isArray(blocks) ? blocks : blocks?.blocks ?? [];
          sceneBlockCounts.value = { ...sceneBlockCounts.value, [s.id]: list.length };
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
    const r = await api.request(`/v1/llm/preset-suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene_id: scene.id }),
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
    pushToast({
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

async function renderScene(scene) {
  if (!sceneBlockCounts.value[scene.id]) {
    pushToast({ message: "Scene has no blocks to render. Analyze + Apply first.", kind: "info" });
    return;
  }
  renderBusyScene.value = scene.id;

  // Standing rule (memory feedback_long_running_process_rule): every
  // long-running operation registers a task with cancel + retry handles
  // so the global TaskStrip + StatusPanel can surface progress.
  const abortController = new AbortController();
  const task = tasks.start({
    kind: "chapter",
    feature: "render-scene",
    label: `${scene.title || copy.value.chapter.singular} → ${copy.value.chapter.singular.toLowerCase()} render`,
    onCancel: () => {
      abortController.abort();
      tasks.cancel(task.id);
    },
    onRetry: () => renderScene(scene),
    meta: { sceneId: scene.id, projectId: selectedProjectId.value },
  });

  try {
    const body = {
      scene_id: scene.id,
      preset_id: scenePresetSelections.value[scene.id] || null,
    };
    const audio = await api.request("/v1/render_chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
    // /v1/render_chapter returns audio/wav (a Blob via api.request). Drop
    // it into the GlobalAudioPlayer so the user can hear the result
    // immediately, and store the URL on the task so the strip can
    // expose download + play actions per scene.
    if (audio instanceof Blob) {
      const blobUrl = URL.createObjectURL(audio);
      const label = scene.title || `${copy.value.chapter.singular} ${scene.position + 1}`;
      tasks.finish(task.id, { result: { url: blobUrl, filename: `${label.replace(/[^a-z0-9_-]+/gi, "_")}.wav` } });
      audioPlayer.play({
        url: blobUrl,
        title: `${label} — rendered`,
        subtitle: selectedProject.value?.name || "",
      });
      pushToast({ message: `${label} render complete. Now playing.`, kind: "success" });
    } else {
      tasks.finish(task.id, { result: audio });
      pushToast({ message: `${scene.title || "Scene"} render complete.`, kind: "success" });
    }
  } catch (e) {
    if (abortController.signal.aborted) {
      // Already marked cancelled in onCancel handler.
      pushToast({ message: `${scene.title || "Scene"} render cancelled.`, kind: "info" });
    } else {
      tasks.fail(task.id, e?.message || String(e));
      pushToast({ message: `Render failed: ${e?.message || e}`, kind: "error", duration: 7000 });
    }
  } finally {
    renderBusyScene.value = null;
    loadCacheStats();
  }
}

// ── Render-tab cache stats + ACX QC (journeys Render contract) ───────
const cacheStats = ref(null);   // {total, cached, scenes:[{scene_id,total,cached}]}
const qcByScene = ref({});      // scene_id -> {ok, rms_ok, peak_ok, duration_s}
const qcBusy = ref(false);

async function loadCacheStats() {
  cacheStats.value = null;
  if (!selectedProjectId.value) return;
  try {
    cacheStats.value = await api.request(`/v1/render/cache-stats?project_id=${selectedProjectId.value}`);
  } catch { /* no scenes yet — banner just hides */ }
}
const sceneCacheById = computed(() => {
  const out = {};
  for (const sc of cacheStats.value?.scenes || []) out[sc.scene_id] = sc;
  return out;
});

const masterPill = computed(() => {
  const m = selectedProject.value?.mastering_preset;
  if (m === "acx" || (!m && selectedProject.value?.project_type === "audiobook")) {
    return "ACX target · −20 LUFS · peak −3 dB · noise floor −60 dB";
  }
  return m ? `master · ${m}` : "no master target";
});

async function runQC() {
  if (!selectedProjectId.value || qcBusy.value) return;
  qcBusy.value = true;
  const task = tasks.start({
    kind: "qc",
    feature: "acx-qc",
    label: `ACX QC · ${selectedProject.value?.name || ""}`,
    meta: { projectId: selectedProjectId.value },
  });
  try {
    const r = await api.request(`/v1/projects/${selectedProjectId.value}/qc`);
    const map = {};
    for (const c of r?.chapters || []) map[c.scene_id] = c;
    qcByScene.value = map;
    tasks.finish(task.id);
    pushToast({
      message: r?.all_ok ? "ACX QC: every chapter passes." : "ACX QC: some chapters are out of spec — see the Check column.",
      kind: r?.all_ok ? "success" : "info",
      duration: 6000,
    });
    await loadCacheStats();
  } catch (e) {
    tasks.fail(task.id, e?.message || String(e));
    pushToast({ message: `QC failed: ${e?.message || e}`, kind: "error", duration: 7000 });
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
  if (t?.status === "running") return { cls: "jv-pill--accent", label: "rendering…" };
  const qc = qcByScene.value[sceneId];
  if (qc) return qc.ok
    ? { cls: "jv-pill--green", label: "✓ ACX pass" }
    : { cls: "jv-pill--danger", label: `✗ ${!qc.rms_ok ? "RMS" : "peak"} out of spec` };
  if (t?.status === "completed") return { cls: "jv-pill--green", label: "rendered" };
  if (sceneSelectedForRender.value[sceneId]) return { cls: "jv-pill--ghost", label: "queued" };
  return { cls: "jv-pill--ghost", label: "—" };
}

async function renderSelected() {
  const queue = scenes.value.filter((s) => sceneSelectedForRender.value[s.id]);
  if (!queue.length) {
    pushToast({ message: "Select at least one scene to render.", kind: "info" });
    return;
  }
  for (const s of queue) {
    await renderScene(s);
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

async function loadSceneText(sceneId) {
  if (!sceneId) {
    sceneText.value = "";
    return;
  }
  try {
    const r = await api.safeRequest(`/v1/scenes/${sceneId}/blocks`, []);
    const blocks = Array.isArray(r) ? r : (r?.blocks ?? []);
    sceneText.value = blocks.map((b) => b.text).join("\n\n");
  } catch {
    sceneText.value = "";
  }
}

watch(selectedSceneId, (id) => {
  loadSceneText(id);
  analyzeRows.value = [];
  editedFlags.value = {};
}, { immediate: true });

const analyzeCtrl = ref(null);
function cancelAnalyze() {
  analyzeCtrl.value?.abort();
}

async function runAnalyze() {
  if (!selectedSceneId.value || !sceneText.value.trim()) {
    pushToast({ message: "Pick a scene with text to analyze.", kind: "info" });
    return;
  }
  analyzeBusy.value = true;
  const ctrl = new AbortController();
  analyzeCtrl.value = ctrl;
  const sceneTitle = scenes.value.find((sc) => sc.id === selectedSceneId.value)?.title || "scene";
  const wordCount = sceneText.value.trim().split(/\s+/).length;
  const task = tasks.start({
    kind: "extract",
    feature: "speaker_attribution",
    label: `Speaker extraction · ${sceneTitle}`,
    onCancel: () => ctrl.abort(),
    onRetry: () => runAnalyze(),
    statsFn: (t) => {
      const out = [`${wordCount} words in`];
      if (t.meta?.rows != null) out.push(`${t.meta.rows} segments`);
      if (t.meta?.tier) out.push(`${t.meta.tier} tier`);
      return out;
    },
  });
  try {
    const r = await api.request(`/v1/scenes/${selectedSceneId.value}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sceneText.value }),
      signal: ctrl.signal,
    });
    analyzeRows.value = r.rows || [];
    analyzeTierUsed.value = r.tier_used;
    analyzeFloor.value = r.confidence_floor;
    editedFlags.value = {};
    tasks.update(task.id, { meta: { rows: analyzeRows.value.length, tier: r.tier_used } });
    tasks.finish(task.id);
    runDiscoverSpeakers(); // fire-and-forget — banner appears if it finds anyone
    pushToast({
      message: `Analyzed ${analyzeRows.value.length} segment${analyzeRows.value.length === 1 ? "" : "s"} using ${r.tier_used} tier.`,
      kind: "success",
      duration: 3500,
    });
  } catch (e) {
    if (ctrl.signal.aborted) {
      // tasks.cancel already marked it; nothing else to do.
    } else {
      tasks.fail(task.id, e?.message || String(e));
    }
    pushToast({
      message: ctrl.signal.aborted
        ? "Analyze cancelled."
        : e?.message?.includes("501") || e?.status === 501
          ? "Analyze unavailable — wire an LLM provider in Engines → LLM tab."
          : `Analyze failed: ${e?.message || e}`,
      kind: "warning",
      duration: 6000,
    });
  } finally {
    analyzeBusy.value = false;
    analyzeCtrl.value = null;
  }
}

async function runDiscoverSpeakers() {
  discovered.value = [];
  if (!selectedSceneId.value || !sceneText.value.trim()) return;
  const ctrl = new AbortController();
  const t = tasks.start({
    kind: "extract",
    feature: "speaker_identification",
    label: "Speaker identification",
    onCancel: () => ctrl.abort(),
    statsFn: (x) => (x.meta?.found != null ? [`${x.meta.found} new speaker${x.meta.found === 1 ? "" : "s"}`] : []),
  });
  try {
    const r = await api.request(`/v1/scenes/${selectedSceneId.value}/discover-speakers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sceneText.value }),
      signal: ctrl.signal,
    });
    discovered.value = r?.candidates || [];
    tasks.update(t.id, { meta: { found: discovered.value.length } });
    tasks.finish(t.id);
  } catch (e) {
    // Identification is best-effort sugar on top of analyze — a 501
    // (no LLM) just means no banner; don't leave a sticky failed task.
    tasks.dismiss(t.id);
  }
}

function ignoreCandidate(name) {
  discovered.value = discovered.value.filter((c) => c.name !== name);
}

async function promoteDiscovered() {
  if (!discovered.value.length || !selectedProjectId.value) return;
  promoting.value = true;
  try {
    const r = await api.request(`/v1/projects/${selectedProjectId.value}/personas/promote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates: discovered.value.map((c) => ({ name: c.name, bio: c.role_hint || null })),
      }),
    });
    const made = (r?.created || []).length;
    pushToast({
      message: made
        ? `Added ${made} persona${made === 1 ? "" : "s"} to the cast — assign voices in Characters.`
        : "Those speakers already existed — linked to this project.",
      kind: "success",
    });
    discovered.value = [];
    await loadAll();
  } catch (e) {
    pushToast({ message: `Promote failed: ${e?.message || e}`, kind: "error" });
  } finally {
    promoting.value = false;
  }
}

function setRowSpeaker(idx, speaker) {
  if (!analyzeRows.value[idx]) return;
  analyzeRows.value[idx] = { ...analyzeRows.value[idx], speaker, source: "manual" };
  editedFlags.value = { ...editedFlags.value, [idx]: true };
}

async function applyAnalyzed() {
  if (!selectedSceneId.value || !analyzeRows.value.length) return;
  // Bulk-create blocks from the attribution rows. We assume the
  // scene is empty before Apply (caller can confirm in a follow-up).
  let created = 0;
  let failed = 0;
  for (let i = 0; i < analyzeRows.value.length; i += 1) {
    const row = analyzeRows.value[i];
    const persona_id = row.speaker !== "narrator" && row.speaker !== "unknown" ? row.speaker : null;
    try {
      await api.request(`/v1/scenes/${selectedSceneId.value}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: i,
          text: row.text,
          persona_id,
          metadata: {},
          extraction_confidence: row.confidence,
          source: row.source || "llm",
        }),
      });
      created += 1;
    } catch (_) {
      failed += 1;
    }
  }
  pushToast({
    message: failed
      ? `Applied ${created}, failed ${failed}.`
      : `Applied ${created} blocks.`,
    kind: failed ? "warning" : "success",
    duration: 5000,
  });
}

function speakerLabel(spk) {
  if (!spk || spk === "unknown") return "unknown";
  if (spk === "narrator") return narratorPersona.value?.name || "Narrator";
  const persona = projectPersonas.value.find((p) => p.id === spk);
  return persona?.name || spk;
}

function speakerOptions() {
  const opts = [
    { label: "— narrator —", value: "narrator" },
    { label: "— unknown —", value: "unknown" },
  ];
  for (const p of projectPersonas.value) {
    if (p.id !== narratorPersona.value?.id) {
      opts.push({ label: p.name, value: p.id });
    }
  }
  return opts;
}

function sourceChipClass(source) {
  return {
    tag: "studio__source-chip studio__source-chip--tag",
    propagated: "studio__source-chip studio__source-chip--propagated",
    llm: "studio__source-chip studio__source-chip--llm",
    floored: "studio__source-chip studio__source-chip--floored",
    narration: "studio__source-chip studio__source-chip--narration",
    manual: "studio__source-chip studio__source-chip--manual",
  }[source] || "studio__source-chip";
}

function voiceById(voiceId) {
  return voices.value.find((v) => v.id === voiceId) || null;
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
      bio: persona.bio,
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
    bio: persona.bio,
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
  const saCtrl = new AbortController();
  const saTask = tasks.start({
    kind: "extract",
    feature: "smart_assign",
    label: `Smart-assign · ${characterPersonas.value.length} characters`,
    onCancel: () => saCtrl.abort(),
    onRetry: () => smartAssignCast(),
    statsFn: (t) => {
      const out = [`${characterPersonas.value.length} characters`, `${voices.value.length} voices`];
      if (t.meta?.applied != null) out.push(`${t.meta.applied} applied`);
      return out;
    },
  });
  try {
    const r = await api.request("/v1/llm/smart-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: saCtrl.signal,
      body: JSON.stringify({
        characters: characterPersonas.value.map((p) => ({
          id: p.id,
          name: p.name,
          bio: p.bio,
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
    let applied = 0;
    for (const [characterId, voiceId] of Object.entries(proposed)) {
      const persona = characterPersonas.value.find((p) => p.id === characterId);
      const voice = voices.value.find((v) => v.id === voiceId);
      if (persona && voice) {
        await assignVoice(characterId, voiceId);
        applied += 1;
      }
    }
    tasks.update(saTask.id, { meta: { applied } });
    tasks.finish(saTask.id);
    pushToast({
      message: applied
        ? `Smart-assign applied ${applied} assignment${applied === 1 ? "" : "s"}.`
        : "Smart-assign returned no matches.",
      kind: applied ? "success" : "warning",
      duration: 4500,
    });
  } catch (e) {
    if (!saCtrl.signal.aborted) tasks.fail(saTask.id, e?.message || String(e));
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

onMounted(() => {
  // Chapters workflow strip hands the target tab over (Cast/Script/Render).
  try {
    const t = window.sessionStorage?.getItem("jv.studio.tab");
    if (t) {
      window.sessionStorage.removeItem("jv.studio.tab");
      if (["cast", "script", "render", "export"].includes(t)) tab.value = t;
    }
  } catch { /* ignore */ }
  loadAll();
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
    <p class="studio__pagelede jv-muted">
      <strong>Studio</strong> turns your written manuscript into a narrated
      audiobook in three sequential steps — choose voices in
      <strong>Cast</strong>, let the AI work out who speaks each line in
      <strong>Script</strong>, then generate the audio chapter by chapter in
      <strong>Render</strong>, package in <strong>Export</strong>. You can
      write a whole novel without touching it; it exists for writers who want
      to produce their own audiobook or hear their prose read aloud as a
      revision tool.
    </p>

    <!-- ── Project picker ───────────────────────────────────────────── -->
    <div class="jv-section studio__project-bar">
      <label class="studio__project-label">{{ copy.book.singular }}:</label>
      <select v-model="selectedProjectId" class="jv-input jv-w-name">
        <option v-for="o in projectOptions" :key="o.value || 'none'" :value="o.value">{{ o.label }}</option>
      </select>
      <span class="jv-spacer" />
      <!-- Which engines power this work (JustWrite reference chips). -->
      <a class="jv-pill" :class="headerTts ? 'jv-pill--green' : 'jv-pill--ghost'" href="#engines"
         :title="headerTts ? `${headerTts.name || headerTts.id} is loaded — renders use it. Manage in Engines.` : 'No TTS engine loaded — the first render sets one up. Manage in Engines.'">
        TTS · {{ headerTts ? (headerTts.name || headerTts.id) : "none" }}
      </a>
      <a class="jv-pill" :class="headerLlm ? 'jv-pill--green' : 'jv-pill--ghost'" href="#settings"
         :title="headerLlm ? `${headerLlm.name || headerLlm.id} answers Script/Smart-assign. Routing in Settings → AI features.` : 'No local LLM loaded — Script/Smart-assign route per Settings → AI features.'">
        Script · {{ headerLlm ? (headerLlm.name || headerLlm.id) : "AI features" }}
      </a>
    </div>

    <!-- ── Production steps (1 · Cast → 2 · Script → 3 · Render) ────── -->
    <div class="studio__steps">
      <!-- Big step cards w/ live subtitles (JustWrite reference; new
           canonical .jv-stepcard in styles.css — no app precedent existed). -->
      <button
        v-for="t in stepCards"
        :key="t.key"
        type="button"
        class="jv-stepcard"
        :class="{ 'jv-stepcard--active': tab === t.key }"
        :title="t.key === 'cast' ? 'Map people to voices' : t.key === 'script' ? 'Who speaks each line' : t.key === 'render' ? 'Batch render + mastering' : 'Package + ACX checklist'"
        @click="tab = t.key"
      >
        <span class="jv-stepcard__title">{{ t.label }}</span>
        <span class="jv-stepcard__sub">{{ t.sub }}</span>
      </button>
      <template v-if="tab === 'script' && selectedProject">
        <span class="jv-spacer" />
        <select v-model="selectedSceneId" class="jv-input jv-input--sm studio__script-select">
          <option v-if="!scenes.length" :value="null">— no {{ copy.chapter.plural.toLowerCase() }} —</option>
          <option v-for="sc in scenes" :key="sc.id" :value="sc.id">{{ sc.title || `${copy.chapter.singular} ${sc.position + 1}` }}</option>
        </select>
        <JvButton
          variant="primary"
          size="sm"
          :loading="analyzeBusy"
          :disabled="analyzeBusy || !sceneText.trim()"
          label="✨ Analyze chapter"
          title="LLM works out who speaks each line"
          @click="runAnalyze"
        />
        <JvButton
          v-if="analyzeRows.length"
          variant="secondary"
          size="sm"
          label="✓ Apply"
          title="Write the attribution onto this chapter's blocks"
          @click="applyAnalyzed"
        />
      </template>
      <template v-if="tab === 'render' && selectedProject">
        <span class="jv-spacer" />
        <span class="jv-pill jv-pill--green" :title="`Applied on render — set per project in Projects`">{{ masterPill }}</span>
        <JvButton
          variant="secondary"
          size="sm"
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

    <!-- ── Cast tab ─────────────────────────────────────────────────── -->
    <section v-if="tab === 'cast'" class="studio__cast">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to manage its {{ copy.cast.plural.toLowerCase() }}.
      </div>

      <template v-else>
        <div class="studio__cast-cols jv-card">
        <div class="studio__cast-card">

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
            <!-- Builtin Narrator (project-lifecycle owned) — the project
                 always has one, so we hide the remove ✕. Rename + voice
                 reassignment still work as normal. -->
            <button
              v-if="!narratorPersona.is_builtin"
              type="button"
              class="studio__char-x"
              title="Remove from this cast — persona stays in the library"
              @click.stop="removeFromCast(narratorPersona)"
            >✕</button>
            <span class="studio__char-portrait" :style="{ background: colorFor(narratorPersona.name) }">N</span>
            <div class="studio__char-main">
              <div class="studio__char-name-row">
                <strong class="studio__char-name">{{ narratorPersona.name }}</strong>
                <span class="jv-pill jv-pill--green">main</span>
              </div>
              <div class="studio__char-role jv-muted">{{ personaRole(narratorPersona) || "carries the narration" }}</div>
              <div v-if="narratorPersona.voice_id" class="studio__char-voice">
                <span class="studio__char-glyph" :style="{ background: colorFor(voiceById(narratorPersona.voice_id)?.name), color: '#fff' }">{{ (voiceById(narratorPersona.voice_id)?.name || "?").slice(0, 2) }}</span>
                {{ voiceById(narratorPersona.voice_id)?.name || narratorPersona.voice_id }}
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
            title="Create the project's builtin Narrator persona and add it to the cast"
            @click="createBuiltinNarrator"
          >
            <span class="studio__char-portrait" :style="{ background: 'var(--surface-3)' }">N</span>
            <span class="studio__narrator-empty-text">
              <strong>{{ creatingNarrator ? "Adding Narrator…" : "Add Narrator" }}</strong>
              <span class="jv-muted">Creates the project's builtin Narrator persona — voice is assigned below.</span>
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
          <JvButton
            variant="secondary"
            size="sm"
            label="＋ Add persona"
            title="Add an existing library persona to this cast"
            @click="addPersonaOpen = true"
          />
          <JvButton
            variant="secondary"
            size="sm"
            label="✕ Clear cast"
            :loading="clearCastBusy"
            :disabled="clearCastBusy || !projectPersonas.some((p) => p.voice_id)"
            title="Unassign every voice — personas stay"
            @click="clearCast"
          />
          <JvButton
            variant="primary"
            size="sm"
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
          <p class="jv-muted">
            Two ways in: run <a href="#studio" @click.prevent="tab = 'script'">2 · Script</a> on a
            {{ copy.chapter.singular.toLowerCase() }} — discovered speakers arrive here as personas —
            or <a href="#studio" @click.prevent="addPersonaOpen = true">add existing personas</a>
            to this {{ copy.book.singular.toLowerCase() }}.
          </p>
        </div>
        <table v-else-if="isGameProject" class="jv-table studio__npc-table">
          <thead><tr><th></th><th>NPC</th><th>Role</th><th>Voice</th><th></th></tr></thead>
          <tbody>
            <tr
              v-for="p in projectPersonas"
              :key="p.id"
              class="studio__npc-row"
              :class="{ 'studio__npc-row--selected': selectedCharacterId === p.id }"
              :title="`Select, then click a voice in the library to cast ${p.name}`"
              @click="selectedCharacterId = p.id"
            >
              <td><span class="studio__char-portrait studio__char-portrait--sm" :style="{ background: colorFor(p.name) }">{{ (p.name || "?").charAt(0).toUpperCase() }}</span></td>
              <td><strong>{{ p.name }}</strong></td>
              <td class="jv-muted" style="font-size:12px">{{ personaRole(p) }}</td>
              <td>
                <template v-if="p.voice_id">
                  <span class="studio__char-glyph" :style="{ background: colorFor(voiceById(p.voice_id)?.name), color: '#fff' }">{{ (voiceById(p.voice_id)?.name || "?").slice(0, 2) }}</span>
                  {{ voiceById(p.voice_id)?.name || p.voice_id }}
                  <span class="jv-muted">· {{ voiceById(p.voice_id)?.engine || "" }}</span>
                </template>
                <span v-else class="studio__char-unassigned">⚠ no voice</span>
              </td>
              <td style="text-align:right;white-space:nowrap">
                <button v-if="p.voice_id" type="button" class="jv-rowact" title="Audition" :disabled="previewingVoiceId" @click.stop="previewVoice(voiceById(p.voice_id))">▶</button>
                <button v-if="p.voice_id" type="button" class="jv-rowact" title="Tune voice parameters" @click.stop="openVoiceTuner(p)">⚙</button>
                <button type="button" class="jv-rowact jv-rowact--danger" title="Remove from this cast — persona stays in the library" @click.stop="removeFromCast(p)">✕</button>
              </td>
            </tr>
          </tbody>
        </table>
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
                {{ voiceById(p.voice_id)?.name || p.voice_id }}
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
            <select v-model="voiceEngineFilter" class="jv-input jv-input--sm" style="max-width: 180px" title="Show only voices from one engine">
              <option v-for="opt in voiceEngineOptions" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
            </select>
          </div>

          <template v-if="!voices.length">
            <EmptyState
              icon="Sparkle"
              title="No voices loaded yet"
              message="Load a TTS engine to populate the voice library. JustVoice ships with 54 Kokoro voices that run on CPU."
              action-label="Open Engines"
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
              <input
                v-model="voiceSearchQuery"
                type="search"
                class="jv-input jv-input--sm studio__voice-search-input"
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
              <button
                type="button"
                class="jv-pill jv-pill--ghost studio__voice-gender"
                :title="displayedGender(v) ? `Cycle gender hint (now ${displayedGender(v)})` : 'Click to set gender hint'"
                @click.stop="cycleGender(v)"
              >
                {{ displayedGender(v) || "?" }}
              </button>

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

    <!-- ── Script tab — Phase 4 / Slice 2 ───────────────────────────── -->
    <section v-if="tab === 'script'" class="studio__script">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to attribute its script.
      </div>
      <template v-else>
        <!-- Discovered speakers — promotion banner (mock #audiobook/5) -->
        <div v-if="discovered.length" class="jv-banner jv-banner--warn studio__discovered">
          <strong>{{ discovered.length }} speaker{{ discovered.length === 1 ? "" : "s" }} found that {{ discovered.length === 1 ? "isn't" : "aren't" }} in your cast:</strong>
          <span v-for="c in discovered" :key="c.name" class="jv-pill studio__discovered-chip" :title="c.role_hint || ''">
            {{ c.name }}<template v-if="c.approx_lines"> · {{ c.approx_lines }} lines</template>
            <button type="button" class="studio__discovered-x" title="Ignore — assign rows manually instead" @click="ignoreCandidate(c.name)">✕</button>
          </span>
          <JvButton size="sm" :loading="promoting" label="＋ Create personas & add to cast" @click="promoteDiscovered" />
        </div>

        <p v-if="analyzeTierUsed" class="jv-muted studio__script-meta">
          Routed to <strong>{{ analyzeTierUsed }}</strong> tier · confidence floor {{ analyzeFloor }} · {{ analyzeRows.length }} segments
        </p>

        <!-- Inline analyze progress — the global task strip sits above the
             fold; this one is impossible to miss next to the content
             (user ask: "no ai progress bar when i clicked analyze"). -->
        <div v-if="analyzeBusy" class="jv-banner studio__analyze-progress">
          <span class="jv-boot-banner__spinner" />
          <span>
            <strong>Analyzing…</strong> the LLM is reading the
            {{ copy.chapter.singular.toLowerCase() }} and attributing speakers —
            long {{ copy.chapter.plural.toLowerCase() }} can take a minute or two.
          </span>
          <span class="jv-spacer" />
          <JvButton variant="ghost" size="sm" label="Cancel" @click="cancelAnalyze" />
        </div>

        <textarea
          v-if="!analyzeRows.length"
          class="jv-input jv-input--full studio__script-text"
          v-model="sceneText"
          :placeholder="`Paste the ${copy.chapter.singular.toLowerCase()} text here, then click Analyze.`"
        />

        <table v-else class="jv-table studio__script-table">
          <thead>
            <tr>
              <th>Speaker</th>
              <th>Kind</th>
              <th>Source</th>
              <th>Text</th>
              <th>Confidence</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in analyzeRows"
              :key="i"
              @contextmenu.prevent="rewriteRow(i)"
              :title="row.kind === 'dialogue' ? 'Right-click to rewrite this line in character' : ''"
            >
              <td>
                <select
                  v-if="row.kind === 'dialogue'"
                  :value="row.speaker"
                  class="jv-input jv-input--sm jv-w-id"
                  @change="setRowSpeaker(i, $event.target.value)"
                >
                  <option
                    v-for="o in speakerOptions()"
                    :key="o.value"
                    :value="o.value"
                  >{{ o.label }}</option>
                </select>
                <span v-else>{{ speakerLabel(row.speaker) }}</span>
                <span v-if="editedFlags[i]" class="studio__edited">✎</span>
                <span v-if="row.rewritten" class="studio__edited" title="LLM-rewritten">✨</span>
              </td>
              <td><span class="jv-pill jv-pill--ghost">{{ row.kind }}</span></td>
              <td>
                <span :class="sourceChipClass(row.source)">{{ row.source }}</span>
                <span v-if="row.source === 'floored' && row.floored_from" class="jv-muted">
                  from {{ speakerLabel(row.floored_from) }}
                </span>
              </td>
              <td class="studio__script-text-cell">{{ row.text }}</td>
              <td>
                <span class="jv-pill" :class="row.confidence > 0.9 ? 'jv-pill--green' : row.confidence > 0.8 ? '' : 'jv-pill--warn'">{{ (row.confidence * 100).toFixed(0) }}%</span>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <!-- ── Render tab — Phase 6 / Slice 1 ───────────────────────────── -->
    <section v-if="tab === 'render'" class="studio__render">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to render its {{ copy.chapter.plural.toLowerCase() }}.
      </div>
      <template v-else>
        <header class="studio__render-toolbar">
          <JvButton variant="secondary" size="sm" label="Select unrendered" title="Select chapters the render cache doesn't fully cover" @click="selectAllUnrendered" />
          <JvButton variant="ghost" size="sm" label="Select all" title="Every chapter with text — rendered ones re-serve from cache" @click="selectAllRenderable" />
          <span class="jv-muted">{{ selectedSceneCount() }} selected</span>
          <span class="jv-spacer" />
          <JvButton
            variant="secondary"
            size="sm"
            :loading="qcBusy"
            :disabled="qcBusy"
            label="🎧 Run ACX QC"
            title="Render every chapter (cache-served when unchanged) and measure RMS + peak against the ACX limits"
            @click="runQC"
          />
          <JvButton
            variant="primary"
            size="sm"
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
                  <input
                    type="checkbox" class="jv-check"
                    :checked="!!sceneSelectedForRender[s.id]"
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
                  <select
                    :value="scenePresetSelections[s.id] || ''"
                    class="jv-input jv-input--sm jv-w-id"
                    @change="scenePresetSelections = { ...scenePresetSelections, [s.id]: $event.target.value }"
                  >
                    <option v-for="o in presetOptions()" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
                </td>
                <td>
                  <span class="jv-pill" :class="checkState(s.id).cls" :title="qcByScene[s.id] ? `RMS ${qcByScene[s.id].rms_dbfs?.toFixed?.(1)} dB · peak ${qcByScene[s.id].peak_dbfs?.toFixed?.(1)} dB · ${Math.round(qcByScene[s.id].duration_s || 0)}s` : ''">{{ checkState(s.id).label }}</span>
                </td>
                <td class="studio__render-actions">
                  <JvButton
                    variant="ghost"
                    size="sm"
                    :loading="suggestBusyScene === s.id"
                    :disabled="suggestBusyScene === s.id"
                    label="💡 Suggest"
                    @click="suggestPresetFor(s)"
                  />
                  <JvButton
                    variant="secondary"
                    size="sm"
                    :loading="renderBusyScene === s.id"
                    :disabled="renderBusyScene !== null && renderBusyScene !== s.id"
                    label="▶ Render"
                    @click="renderScene(s)"
                  />
                </td>
              </tr>
              <!-- Per-scene progress strip — appears below the row when
                   a render task is in flight or finished-but-still-visible. -->
              <tr v-if="taskForScene(s.id)" class="studio__render-progress-row">
                <td colspan="8" class="studio__render-progress-cell">
                  <div class="studio__render-progress">
                    <span
                      class="jv-pill"
                      :class="{
                        'jv-pill--solid': taskForScene(s.id).status === 'running',
                        'jv-pill--green': taskForScene(s.id).status === 'completed',
                        'jv-pill--danger': taskForScene(s.id).status === 'failed',
                        'jv-pill--warn': taskForScene(s.id).status === 'cancelled',
                      }"
                    >{{ taskForScene(s.id).status }}</span>
                    <div class="studio__render-bar">
                      <div
                        class="studio__render-bar-fill"
                        :class="{ 'studio__render-bar-fill--indeterminate': taskForScene(s.id).percent == null && taskForScene(s.id).status === 'running' }"
                        :style="taskForScene(s.id).percent != null ? { width: (taskForScene(s.id).percent * 100) + '%' } : {}"
                      />
                    </div>
                    <span v-if="taskForScene(s.id).error" class="jv-muted" style="color: var(--danger); font-size: 11.5px;">
                      {{ taskForScene(s.id).error }}
                    </span>
                    <JvButton
                      v-if="taskForScene(s.id).status === 'running'"
                      variant="danger-outline" size="sm" label="Cancel"
                      @click="taskForScene(s.id).onCancel?.()"
                    />
                    <JvButton
                      v-if="taskForScene(s.id).status === 'failed' || taskForScene(s.id).status === 'cancelled'"
                      variant="secondary" size="sm" label="↻ Retry"
                      @click="renderScene(s)"
                    />
                    <JvButton
                      v-if="taskForScene(s.id).status === 'completed' && taskForScene(s.id).result?.url"
                      variant="ghost" size="sm" label="▶ Play"
                      title="Play in global audio player"
                      @click="audioPlayer.play({ url: taskForScene(s.id).result.url, title: s.title || 'Scene', subtitle: selectedProject?.name || '' })"
                    />
                    <a
                      v-if="taskForScene(s.id).status === 'completed' && taskForScene(s.id).result?.url"
                      :href="taskForScene(s.id).result.url"
                      :download="taskForScene(s.id).result.filename || 'scene.wav'"
                      class="jv-btn jv-btn--ghost jv-btn--sm"
                      title="Download WAV"
                    >⬇ Download</a>
                    <JvButton
                      v-if="taskForScene(s.id).status !== 'running'"
                      variant="ghost" size="sm" label="✕"
                      @click="tasks.dismiss(taskForScene(s.id).id)"
                    />
                  </div>
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
    <div v-if="addPersonaOpen" class="jv-overlay" @click.self="addPersonaOpen = false">
      <div class="jv-modal" style="width: min(520px, calc(100vw - 32px));">
        <header class="jv-modal__header">
          <div class="jv-modal__titleblock">
            <span class="jv-modal__eyebrow">Cast</span>
            <h3 class="jv-modal__title">Add a persona to this {{ copy.book.singular.toLowerCase() }}</h3>
          </div>
          <button type="button" class="jv-modal__close" title="Close" @click="addPersonaOpen = false">✕</button>
        </header>
        <div class="jv-modal__body">
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
              <JvButton
                variant="secondary"
                size="sm"
                label="Add"
                :loading="addPersonaBusy === p.id"
                :disabled="addPersonaBusy !== null"
                @click="addPersonaToCast(p)"
              />
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Per-block Rewrite preview (right-click on Script tab). -->
    <div v-if="rewriteModalOpen" class="jv-overlay" @click.self="rewriteModalOpen = false">
      <div class="jv-modal" style="width: min(720px, calc(100vw - 32px));">
        <header class="jv-modal__header">
          <div class="jv-modal__titleblock">
            <span class="jv-modal__eyebrow">Rewrite in character</span>
            <h3 class="jv-modal__title">
              {{ rewriteRowIndex != null && analyzeRows[rewriteRowIndex] ? speakerLabel(analyzeRows[rewriteRowIndex].speaker) : "Block" }}
            </h3>
          </div>
          <button type="button" class="jv-modal__close" @click="rewriteModalOpen = false">✕</button>
        </header>
        <div class="jv-modal__body" style="padding: 16px 22px; display: flex; flex-direction: column; gap: 14px;">
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
            <textarea
              v-else
              v-model="rewritePreview"
              class="jv-textarea jv-textarea--full"
              style="min-height: 100px;"
              placeholder="Rewrite will appear here…"
            />
          </div>
        </div>
        <footer class="jv-modal__footer">
          <JvButton
            variant="secondary"
            size="sm"
            :disabled="rewriteBusy"
            label="↻ Try again"
            @click="runRewrite"
          />
          <span class="jv-spacer" />
          <JvButton variant="secondary" label="Discard" @click="rewriteModalOpen = false" />
          <JvButton
            variant="primary"
            :disabled="rewriteBusy || !rewritePreview.trim()"
            label="Accept"
            @click="acceptRewrite"
          />
        </footer>
      </div>
    </div>
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
.studio__pagelede { font-size: 12.5px; margin: 6px 0 10px; }
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


/* ── Script tab ───────────────────────────────────────────────────── */
.studio__script-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.studio__script-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.studio__script-select { flex: 1 1 240px; max-width: var(--w-url); }

.studio__script-meta {
  font-size: 11.5px;
  margin: 0 0 8px;
}

.studio__script-text {
  width: 100%;
  min-height: 240px;
  font-family: var(--font-serif, Georgia, serif);
  font-size: 13.5px;
  line-height: 1.55;
  resize: vertical;
  padding: 12px 14px;
}

.studio__script-table { font-size: 12px; width: 100%; }
.studio__script-table th { white-space: nowrap; }
.studio__script-text-cell {
  max-width: 480px;
  white-space: pre-wrap;
  word-break: break-word;
}

.studio__edited { color: var(--accent); margin-left: 6px; font-size: 11px; }

.studio__source-chip {
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--ink-2);
  border: 1px solid var(--border-soft);
}
.studio__source-chip--tag         { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.studio__source-chip--propagated  { background: var(--accent-soft); color: var(--ink-2); }
.studio__source-chip--llm         { color: var(--ink-3); }
.studio__source-chip--floored     { background: var(--warn-bg, var(--surface-2)); color: var(--warn, var(--ink-2)); border-color: var(--warn, var(--border-soft)); }
.studio__source-chip--narration   { color: var(--muted); border-style: dashed; }
.studio__source-chip--manual      { background: var(--surface); }

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
.studio__discovered { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.studio__discovered-chip { display: inline-flex; align-items: center; gap: 5px; }
.studio__discovered-x { border: 0; background: transparent; cursor: pointer; color: var(--ink-3); font-size: 11px; padding: 0; }
.studio__discovered-x:hover { color: var(--danger); }

.studio__npc-table { margin: 0; }
.studio__npc-row { cursor: pointer; }
.studio__npc-row:hover td { background: var(--surface-2); }
.studio__npc-row--selected td { background: var(--accent-soft); }
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

.studio__analyze-progress { display: flex; align-items: center; gap: 10px; }

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
</style>
