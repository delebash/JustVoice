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
import { useUiContext } from "../stores/uiContext.js";
import { useCopy } from "../services/copy.js";
import { useOnboarding } from "../stores/onboarding.js";
import { pushToast } from "../services/toastBridge.js";
import { withEngineSwap } from "../services/engineSwap.js";
import { promptDialog } from "../services/dialog.js";
import { projectsService } from "../services/projects.js";
import JvButton from "../components/jv/JvButton.vue";
import ChapterView from "./ChapterView.vue";
import ImportModal from "./ImportModal.vue";
import VoiceParamsModal from "../components/VoiceParamsModal.vue";
import EmptyState from "../components/EmptyState.vue";

const api = useApi();
const tasks = useRenderTasks();
const audioPlayer = useAudioPlayer();
const uiContext = useUiContext();
const copy = useCopy();

const projects = ref([]);
const selectedProjectId = ref(null);
const personas = ref([]);
const voices = ref([]);
const engines = ref([]);
const tab = ref("cast");

// Characters-first is wrong for some use cases (user feedback
// 2026-06-10): podcasters open into the episode content, not a cast
// grid. Applied once on mount; the user's manual tab clicks always win
// afterwards.
const onboardingStore = useOnboarding();
const STUDIO_START_TAB_BY_USE_CASE = {
  podcast: "script",
  dictation: "script",
};
onMounted(() => {
  const start = STUDIO_START_TAB_BY_USE_CASE[onboardingStore.primaryUseCase];
  if (start && tab.value === "cast") tab.value = start;
});
const loading = ref(false);

const selectedCharacterId = ref(null);
const voiceParamsModalOpen = ref(false);
const tuningVoice = ref(null);  // {voiceId, name, params}
const smartAssignBusy = ref(false);

// JustWrite-style voice library filter: engine selector + name search.
// "" = all engines. Defaults to the currently-loaded TTS engine when one
// is up (set by the engines load below). Persists in localStorage so the
// user's pick survives reloads.
const VOICE_ENGINE_KEY = "jv.studio.cast.engineFilter";
const voiceEngineFilter = ref(
  (typeof window !== "undefined" && window.localStorage?.getItem(VOICE_ENGINE_KEY)) || "",
);
watch(voiceEngineFilter, (v) => {
  try { window.localStorage?.setItem(VOICE_ENGINE_KEY, v || ""); } catch { /* ignore */ }
});
const voiceSearchQuery = ref("");

// Gender overrides — local-only per-voice gender hint that the user
// click-cycles (engine label → female → male → neutral → engine label).
// Smart-assign reads from voice.gender; this overlay lets the user fix
// the hint without editing the engine's manifest. Persists in
// localStorage so the override survives reloads.
const GENDER_OVERRIDE_KEY = "jv.studio.voiceGenderOverrides";
const GENDER_CYCLE = ["female", "male", "neutral", ""];
const voiceGenderOverrides = ref({});
try {
  const raw = typeof window !== "undefined" ? window.localStorage?.getItem(GENDER_OVERRIDE_KEY) : null;
  if (raw) voiceGenderOverrides.value = JSON.parse(raw);
} catch { /* ignore */ }
watch(voiceGenderOverrides, (v) => {
  try { window.localStorage?.setItem(GENDER_OVERRIDE_KEY, JSON.stringify(v)); } catch { /* ignore */ }
}, { deep: true });

function displayedGender(voice) {
  if (Object.prototype.hasOwnProperty.call(voiceGenderOverrides.value, voice.id)) {
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
const analyzeRows = ref([]);
const analyzeTierUsed = ref(null);
const analyzeFloor = ref(null);
const editedFlags = ref({});  // {rowIdx: true} for rows the user changed

// Render tab state (Phase 6 / Slice 1)
const renderPresets = ref([]);
const scenePresetSelections = ref({});  // {sceneId: presetId}
const sceneSelectedForRender = ref({});  // {sceneId: bool}
const renderBusyScene = ref(null);
const suggestBusyScene = ref(null);
const sceneBlockCounts = ref({});  // {sceneId: count of blocks}

// Per-scene task lookup so the render row can show a progress strip
// driven by the renderTasks store.
function taskForScene(sceneId) {
  return tasks.running.find(
    (t) => t.feature === "render-scene" && t.meta?.sceneId === sceneId,
  ) || null;
}

// Adapt the tab labels to the project's use case via useCopy. The Cast
// tab uses the cast.plural; the Script tab takes the chapter terminology
// (Chapter/Quest/Episode); Render is universal (a render is a render).
const TAB_LABELS = computed(() => ({
  cast:   copy.value.cast.plural || "Cast",
  script: copy.value.chapter.singular || "Script",
  render: "Render",
  // Chapter's block/take editor, absorbed as Studio's fourth tab
  // (plan D2). Shares this view's project switcher via the projectId prop.
  takes:  "Takes",
}));

const selectedProject = computed(() =>
  projects.value.find((p) => p.id === selectedProjectId.value) || null,
);

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
    (out[k] = out[k] || []).push(v);
  }
  return out;
});

// Engine options for the Cast tab voice-list filter dropdown. Each entry
// shows the engine label + voice count to make picking easier.
const voiceEngineOptions = computed(() => {
  const opts = Object.entries(voiceLibraryByEngine.value)
    .map(([id, group]) => ({ value: id, label: `${id} (${group.length})` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return [{ value: "", label: `All engines (${voices.value.length})` }, ...opts];
});

// Filtered + flattened voice list driving the Cast tab sidebar. Honors
// engine filter + name search. Empty list → "no voices match" placeholder.
const filteredVoices = computed(() => {
  const q = voiceSearchQuery.value.trim().toLowerCase();
  return voices.value
    .filter((v) => !voiceEngineFilter.value || v.engine === voiceEngineFilter.value)
    .filter((v) => !q || (v.name || "").toLowerCase().includes(q) || (v.id || "").toLowerCase().includes(q) || (v.tone || "").toLowerCase().includes(q));
});

// Distinct engines across the project's cast. >1 means batch renders
// will swap engines (once per engine, server-side grouping) — surfaced
// as a warning chip in the Cast toolbar so the cost is visible while
// casting, not discovered mid-render.
const castEngines = computed(() => {
  const set = new Set();
  for (const p of projectPersonas.value) {
    if (!p.voice_id) continue;
    const v = voices.value.find((x) => x.id === p.voice_id);
    if (v?.engine) set.add(v.engine);
  }
  return [...set];
});

// Map persona_id → voice_id, so the voice library can show ✓ next to
// voices already cast to the selected character. JustWrite affordance G
// from the source-of-truth read this turn.
function isVoiceAssignedToSelected(voiceId) {
  if (!selectedCharacter.value) return false;
  return selectedCharacter.value.voice_id === voiceId;
}

// Preview a voice — calls /v1/generate with a short sample sentence,
// routes the resulting Blob into the global audio player. JustWrite
// affordance J. Per-voice preview state stops the button being
// re-clicked while in flight.
const previewingVoiceId = ref(null);
async function previewVoice(voice) {
  if (previewingVoiceId.value) return;
  previewingVoiceId.value = voice.id;
  try {
    const blob = await withEngineSwap((allowSwap) =>
      api.request("/v1/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice: voice.id,
          text: "This is a quick preview of how this voice sounds when reading a sentence.",
          allow_engine_swap: allowSwap,
        }),
      })
    );
    if (blob === null) return;  // user declined the engine swap
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

// ── Project-workspace actions (plan D2: Studio header = workspace) ──
// Import + New project live here so Projects/BooksView is reachable
// FROM Studio rather than being a sibling concept; BooksView stays the
// management surface (metadata, QC, M4B, export) via "Manage projects".

const showImport = ref(false);

function goScratchpad() {
  window.location.hash = "#generate";
}

async function onImportCreated(created) {
  showImport.value = false;
  await loadAll();
  if (created?.project_id) selectedProjectId.value = created.project_id;
}

async function createBlankProject() {
  const values = await promptDialog({
    title: "New project",
    confirmLabel: "Create",
    fields: [
      { key: "name", label: "Project name" },
      {
        key: "project_type", label: "Project type", type: "select",
        defaultValue: "audiobook",
        options: [
          { value: "audiobook", label: "Audiobook" },
          { value: "game_voicelines", label: "Game voicelines" },
          { value: "podcast", label: "Podcast" },
          { value: "custom", label: "Custom" },
        ],
      },
    ],
  });
  if (!values || !values.name) return;
  try {
    const created = await projectsService.create({
      name: values.name,
      project_type: values.project_type || "audiobook",
      metadata: {},
    });
    await loadAll();
    selectedProjectId.value = created.id;
  } catch (e) {
    pushToast({ kind: "error", title: "Create failed", description: String(e?.message ?? e) });
  }
}

async function loadAll() {
  loading.value = true;
  try {
    const [pr, p, v, e] = await Promise.all([
      api.safeRequest("/v1/projects", { projects: [] }),
      api.safeRequest("/v1/personas", { personas: [] }),
      api.safeRequest("/v1/voices", { voices: [] }),
      api.safeRequest("/v1/engines", { engines: [] }),
    ]);
    projects.value = pr?.projects ?? [];
    personas.value = p?.personas ?? [];
    voices.value = v?.voices ?? [];
    engines.value = e?.engines ?? [];
    // Projects → "Open in Studio" hands the picked project over via
    // localStorage; honor it before any default.
    let pending = null;
    try {
      pending = window.localStorage?.getItem("jv.studio.pendingProjectId");
      if (pending) window.localStorage?.removeItem("jv.studio.pendingProjectId");
    } catch { /* ignore */ }
    if (pending && projects.value.some((p) => p.id === pending)) {
      selectedProjectId.value = pending;
    } else if (!selectedProjectId.value && projects.value.length) {
      // Default to the first audiobook/game/podcast project.
      const first = projects.value.find(
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

// Publish breadcrumb segments to the topbar (plan Q7 Slice 1):
//   Studio › [Project name] › [Tab label]
// Cleared automatically by App.vue when the user switches top-level
// views. Updates as the project picker / tab changes.
function publishCrumbs() {
  const segments = [];
  const project = selectedProject.value;
  if (project) {
    segments.push({ label: project.name, href: "#books" });
  }
  if (tab.value) {
    segments.push({ label: TAB_LABELS.value[tab.value] || tab.value });
  }
  uiContext.set(segments);
}
watch([() => selectedProject.value?.name, tab, TAB_LABELS], publishCrumbs, { immediate: true });

async function loadScenesForProject(projectId) {
  if (!projectId) {
    scenes.value = [];
    selectedSceneId.value = null;
    return;
  }
  try {
    const r = await api.safeRequest(`/v1/projects/${projectId}/scenes`, { scenes: [] });
    scenes.value = r?.scenes || [];
    if (!selectedSceneId.value && scenes.value.length) {
      selectedSceneId.value = scenes.value[0].id;
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
    // Swap-at-render: a cast voice on a cold engine 409s; the shared
    // helper prompts once and retries. The server groups blocks by
    // engine, so a multi-engine cast costs one swap per engine.
    const audio = await withEngineSwap((allowSwap) =>
      api.request("/v1/render_chapter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, allow_engine_swap: allowSwap }),
        signal: abortController.signal,
      })
    );
    if (audio === null) {
      // User declined the engine swap.
      tasks.cancel(task.id);
      return;
    }
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
  }
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

function selectAllUnrendered() {
  // Mark every scene with blocks as selected. (No "rendered" status
  // surfaced via API yet — Render tab counts blocks as the proxy.)
  const next = {};
  for (const s of scenes.value) {
    if (sceneBlockCounts.value[s.id]) next[s.id] = true;
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

async function runAnalyze() {
  if (!selectedSceneId.value || !sceneText.value.trim()) {
    pushToast({ message: "Pick a scene with text to analyze.", kind: "info" });
    return;
  }
  analyzeBusy.value = true;
  try {
    const r = await api.request(`/v1/scenes/${selectedSceneId.value}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sceneText.value }),
    });
    analyzeRows.value = r.rows || [];
    analyzeTierUsed.value = r.tier_used;
    analyzeFloor.value = r.confidence_floor;
    editedFlags.value = {};
    pushToast({
      message: `Analyzed ${analyzeRows.value.length} segment${analyzeRows.value.length === 1 ? "" : "s"} using ${r.tier_used} tier.`,
      kind: "success",
      duration: 3500,
    });
  } catch (e) {
    pushToast({
      message: e?.message?.includes("501") || e?.status === 501
        ? "Analyze unavailable — wire an LLM provider in Engines → LLM tab."
        : `Analyze failed: ${e?.message || e}`,
      kind: "warning",
      duration: 6000,
    });
  } finally {
    analyzeBusy.value = false;
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
    pushToast({ message: `Assigned ${voiceById(voiceId)?.name || voiceId} to ${persona.name}.`, kind: "success", duration: 3000 });
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
  try {
    const r = await api.request("/v1/llm/smart-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

onMounted(loadAll);
</script>

<template>
  <div class="studio">
    <!-- ── Project workspace header (plan D2) ───────────────────────── -->
    <div class="jv-section studio__project-bar">
      <label class="studio__project-label">{{ copy.book.singular }}:</label>
      <select v-model="selectedProjectId" class="jv-input studio__project-select">
        <option v-for="o in projectOptions" :key="o.value || 'none'" :value="o.value">{{ o.label }}</option>
      </select>
      <JvButton variant="ghost" size="sm" label="＋ New" title="Create a blank project" @click="createBlankProject" />
      <JvButton variant="ghost" size="sm" label="📥 Import" title="Import a manuscript (JustWrite / CSV / SRT / Audacity labels / JustVoice JSON)" @click="showImport = true" />
      <span class="jv-spacer" />
      <span v-if="selectedProject" class="jv-pill jv-pill--ghost">{{ selectedProject.project_type }}</span>
      <a href="#books" class="jv-muted studio__manage-link" title="Project metadata, QC, M4B export">Manage {{ copy.book.plural.toLowerCase() }} ›</a>
    </div>

    <!-- ── No-projects empty state — the app's landing surface ──────── -->
    <EmptyState
      v-if="!loading && !projects.length"
      icon="Sparkle"
      title="Start a production"
      message="Import a manuscript to cast voices and render it, create a blank project, or just try a line in the Scratchpad. Voices are browsable before any engine is installed — rendering offers to load what's needed."
    >
      <template #actions>
        <div class="studio__empty-actions">
          <JvButton variant="primary" label="📥 Import manuscript" @click="showImport = true" />
          <JvButton variant="secondary" label="＋ New project" @click="createBlankProject" />
          <JvButton variant="ghost" label="✏️ Just try a line" @click="goScratchpad" />
        </div>
      </template>
    </EmptyState>

    <!-- ── Tabs ─────────────────────────────────────────────────────── -->
    <div v-if="projects.length" class="studio__tabs">
      <button
        v-for="(label, key) in TAB_LABELS"
        :key="key"
        type="button"
        class="studio__tab"
        :class="{ 'studio__tab--active': tab === key }"
        @click="tab = key"
      >{{ label }}</button>
    </div>

    <!-- ── Cast tab ─────────────────────────────────────────────────── -->
    <section v-if="projects.length && tab === 'cast'" class="studio__cast">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to manage its {{ copy.cast.plural.toLowerCase() }}.
      </div>

      <template v-else>
        <header class="studio__cast-toolbar">
          <h3 class="jv-section__title" style="margin: 0">
            {{ copy.cast.plural }} — {{ characterPersonas.length }}
          </h3>
          <span
            v-if="castEngines.length > 1"
            class="jv-pill jv-pill--warn"
            :title="`Engines: ${castEngines.join(', ')}. The server renders grouped by engine, so a batch render swaps ${castEngines.length - 1} time(s) total — not per line.`"
          >
            ⇄ {{ copy.cast.plural }} spans {{ castEngines.length }} engines
          </span>
          <span class="jv-spacer" />
          <JvButton
            variant="secondary"
            size="sm"
            label="🪄 Smart-assign"
            :loading="smartAssignBusy"
            :disabled="smartAssignBusy"
            @click="smartAssignCast"
          />
        </header>

        <div class="studio__cast-grid">
          <!-- Narrator card -->
          <article v-if="narratorPersona" class="jv-card studio__char-card studio__char-card--narrator">
            <div class="studio__char-h">
              <div class="studio__char-portrait studio__char-portrait--narrator">📖</div>
              <div class="studio__char-name">{{ narratorPersona.name }}</div>
              <span class="jv-pill jv-pill--ghost">Narrator</span>
            </div>
            <div v-if="!narratorPersona.voice_id" class="jv-banner jv-banner--warn studio__char-warn">
              No voice assigned.
            </div>
            <div v-else class="studio__char-voice">
              <strong>{{ voiceById(narratorPersona.voice_id)?.name || narratorPersona.voice_id }}</strong>
              <span class="jv-muted">{{ voiceById(narratorPersona.voice_id)?.engine || "" }}</span>
            </div>
            <footer class="studio__char-actions">
              <JvButton variant="ghost" size="sm" label="⚙ Tune" @click="openVoiceTuner(narratorPersona)" />
            </footer>
          </article>

          <!-- Character cards -->
          <article
            v-for="p in characterPersonas"
            :key="p.id"
            class="jv-card studio__char-card"
            :class="{ 'studio__char-card--selected': selectedCharacterId === p.id }"
            @click="selectedCharacterId = p.id"
          >
            <div class="studio__char-h">
              <div class="studio__char-portrait">{{ (p.name || "?").charAt(0).toUpperCase() }}</div>
              <div class="studio__char-name">{{ p.name }}</div>
            </div>
            <div v-if="!p.voice_id" class="jv-banner jv-banner--warn studio__char-warn">
              No voice assigned.
            </div>
            <div v-else class="studio__char-voice">
              <strong>{{ voiceById(p.voice_id)?.name || p.voice_id }}</strong>
              <span class="jv-muted">{{ voiceById(p.voice_id)?.engine || "" }}</span>
            </div>
            <footer class="studio__char-actions">
              <JvButton variant="ghost" size="sm" label="⚙ Tune" @click.stop="openVoiceTuner(p)" />
            </footer>
          </article>
        </div>

        <!-- Voice library sidebar — JustWrite-pattern table per
             SettingsProviderForm.vue:965-1100. Read line-by-line this
             turn to ensure all 13 affordances ship instead of the prior
             5: provider-status, "picking voice for X" status line,
             search with icon + count, voice table with name + tone +
             ✓ if assigned + gender chip + tune + preview, loading,
             empty-engine, empty-filter states. -->
        <aside class="studio__voice-library">
          <h4 class="studio__voice-library-h">Voice library</h4>

          <!-- Engine selector — the JustVoice equivalent of JustWrite's
               TTS provider picker (#A). Empty state when no engines
               loaded yet (#B). -->
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
            <div class="studio__voice-filter">
              <select
                v-model="voiceEngineFilter"
                class="jv-input jv-input--sm jv-w-id"
                title="Filter by engine"
              >
                <option v-for="opt in voiceEngineOptions" :key="opt.value" :value="opt.value">
                  {{ opt.label }}
                </option>
              </select>
            </div>

            <!-- Picking-for status line (#D) — tells the user which
                 character will receive the voice on click. -->
            <div class="studio__voice-picking" v-if="characterPersonas.length">
              <template v-if="selectedCharacter">
                Picking voice for <strong>{{ selectedCharacter.name }}</strong>
              </template>
              <template v-else>
                <span class="jv-muted">Select a character to assign a voice.</span>
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

            <!-- Empty-filter state (#L). -->
            <div v-if="!filteredVoices.length" class="jv-muted studio__voice-empty">
              No voices match this filter.
            </div>

            <!-- Voice row — name + tone + assigned ✓ + gender chip +
                 tune ⚙ + preview ▶. JustWrite affordances G/H/I/J. -->
            <div
              v-for="v in filteredVoices"
              :key="v.id"
              class="studio__voice-row"
              :class="{ 'studio__voice-row--disabled': !selectedCharacter }"
            >
              <!-- Name + tone + assigned-check — primary click target -->
              <button
                type="button"
                class="studio__voice-row-name-btn"
                :disabled="!selectedCharacter"
                :title="selectedCharacter ? `Assign ${v.name} to ${selectedCharacter.name}` : 'Pick a character first'"
                @click="selectedCharacter && assignVoice(selectedCharacter.id, v.id)"
              >
                <span class="studio__voice-row-name-row">
                  <strong class="studio__voice-row-name">{{ v.name }}</strong>
                  <span
                    class="jv-muted"
                    :title="v.engine_loaded ? 'Engine loaded — renders immediately' : 'Engine not loaded — rendering will swap (prompted once)'"
                  >{{ v.engine_loaded ? "●" : "⇄" }}</span>
                  <span
                    v-if="isVoiceAssignedToSelected(v.id)"
                    class="studio__voice-row-assigned"
                    title="Currently assigned to this character"
                  >✓</span>
                </span>
                <span v-if="v.tone" class="studio__voice-row-tone">{{ v.tone }}</span>
                <span v-else class="studio__voice-row-tone jv-muted">{{ v.engine || "" }}</span>
              </button>

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
                class="studio__voice-action"
                title="Tune voice parameters (speed, exaggeration, …)"
                @click.stop="openVoiceTunerForLibraryVoice(v)"
              >⚙</button>

              <!-- Preview button (#J) — calls /v1/generate with sample text -->
              <button
                type="button"
                class="studio__voice-action"
                :disabled="previewingVoiceId === v.id"
                :title="previewingVoiceId === v.id ? 'Generating preview…' : 'Preview this voice with a sample sentence'"
                @click.stop="previewVoice(v)"
              >{{ previewingVoiceId === v.id ? "⏳" : "▶" }}</button>
            </div>
          </template>
        </aside>
      </template>
    </section>

    <!-- ── Script tab — Phase 4 / Slice 2 ───────────────────────────── -->
    <section v-if="projects.length && tab === 'script'" class="studio__script">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to attribute its script.
      </div>
      <template v-else>
        <header class="studio__script-toolbar">
          <label class="studio__script-label">{{ copy.chapter.singular }}:</label>
          <select v-model="selectedSceneId" class="jv-input studio__script-select">
            <option v-if="!scenes.length" :value="null">— no {{ copy.chapter.plural.toLowerCase() }} —</option>
            <option v-for="s in scenes" :key="s.id" :value="s.id">{{ s.title || `${copy.chapter.singular} ${s.position + 1}` }}</option>
          </select>
          <span class="jv-spacer" />
          <JvButton
            variant="primary"
            size="sm"
            :loading="analyzeBusy"
            :disabled="analyzeBusy || !sceneText.trim()"
            label="🔍 Analyze"
            @click="runAnalyze"
          />
          <JvButton
            v-if="analyzeRows.length"
            variant="secondary"
            size="sm"
            label="✓ Apply"
            @click="applyAnalyzed"
          />
        </header>

        <p v-if="analyzeTierUsed" class="jv-muted studio__script-meta">
          Routed to <strong>{{ analyzeTierUsed }}</strong> tier · confidence floor {{ analyzeFloor }} · {{ analyzeRows.length }} segments
        </p>

        <textarea
          v-if="!analyzeRows.length"
          class="jv-input jv-input--full studio__script-text"
          v-model="sceneText"
          :placeholder="`Paste the ${copy.chapter.singular.toLowerCase()} text here, then click Analyze.`"
        />

        <table v-else class="jv-table studio__script-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Kind</th>
              <th>Speaker</th>
              <th>Source</th>
              <th>Confidence</th>
              <th>Text</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, i) in analyzeRows"
              :key="i"
              @contextmenu.prevent="rewriteRow(i)"
              :title="row.kind === 'dialogue' ? 'Right-click to rewrite this line in character' : ''"
            >
              <td class="jv-muted">{{ i + 1 }}</td>
              <td><span class="jv-pill jv-pill--ghost">{{ row.kind }}</span></td>
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
              <td>
                <span :class="sourceChipClass(row.source)">{{ row.source }}</span>
                <span v-if="row.source === 'floored' && row.floored_from" class="jv-muted">
                  from {{ speakerLabel(row.floored_from) }}
                </span>
              </td>
              <td class="jv-mono">{{ (row.confidence * 100).toFixed(0) }}%</td>
              <td class="studio__script-text-cell">{{ row.text }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <!-- ── Render tab — Phase 6 / Slice 1 ───────────────────────────── -->
    <section v-if="projects.length && tab === 'render'" class="studio__render">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to render its {{ copy.chapter.plural.toLowerCase() }}.
      </div>
      <template v-else>
        <header class="studio__render-toolbar">
          <JvButton variant="secondary" size="sm" label="Select all with blocks" @click="selectAllUnrendered" />
          <span class="jv-muted">{{ selectedSceneCount() }} selected</span>
          <span class="jv-spacer" />
          <JvButton
            variant="primary"
            size="sm"
            :disabled="!selectedSceneCount() || renderBusyScene !== null"
            :label="`▶ Render selected (${selectedSceneCount()})`"
            @click="renderSelected"
          />
        </header>

        <table class="jv-table studio__render-table">
          <thead>
            <tr>
              <th class="studio__render-check"></th>
              <th>#</th>
              <th>{{ copy.chapter.singular }}</th>
              <th>{{ copy.line.plural }}</th>
              <th>Render preset</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <template v-for="(s, i) in scenes" :key="s.id">
              <tr>
                <td class="studio__render-check">
                  <input
                    type="checkbox"
                    :checked="!!sceneSelectedForRender[s.id]"
                    @change="sceneSelectedForRender = { ...sceneSelectedForRender, [s.id]: $event.target.checked }"
                  />
                </td>
                <td class="jv-muted">{{ i + 1 }}</td>
                <td>
                  <strong>{{ s.title || `${copy.chapter.singular} ${s.position + 1}` }}</strong>
                </td>
                <td class="jv-mono">{{ sceneBlockCounts[s.id] || 0 }}</td>
                <td>
                  <select
                    :value="scenePresetSelections[s.id] || ''"
                    class="jv-input jv-input--sm jv-w-id"
                    @change="scenePresetSelections = { ...scenePresetSelections, [s.id]: $event.target.value }"
                  >
                    <option v-for="o in presetOptions()" :key="o.value" :value="o.value">{{ o.label }}</option>
                  </select>
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
                <td colspan="6" class="studio__render-progress-cell">
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
                    <button
                      v-if="taskForScene(s.id).status === 'running'"
                      type="button"
                      class="jv-btn jv-btn--danger-outline jv-btn--sm"
                      @click="taskForScene(s.id).onCancel?.()"
                    >Cancel</button>
                    <button
                      v-if="taskForScene(s.id).status === 'failed' || taskForScene(s.id).status === 'cancelled'"
                      type="button"
                      class="jv-btn jv-btn--secondary jv-btn--sm"
                      @click="renderScene(s)"
                    >↻ Retry</button>
                    <button
                      v-if="taskForScene(s.id).status === 'completed' && taskForScene(s.id).result?.url"
                      type="button"
                      class="jv-btn jv-btn--ghost jv-btn--sm"
                      title="Play in global audio player"
                      @click="audioPlayer.play({ url: taskForScene(s.id).result.url, title: s.title || 'Scene', subtitle: selectedProject?.name || '' })"
                    >▶ Play</button>
                    <a
                      v-if="taskForScene(s.id).status === 'completed' && taskForScene(s.id).result?.url"
                      :href="taskForScene(s.id).result.url"
                      :download="taskForScene(s.id).result.filename || 'scene.wav'"
                      class="jv-btn jv-btn--ghost jv-btn--sm"
                      title="Download WAV"
                    >⬇ Download</a>
                    <button
                      v-if="taskForScene(s.id).status !== 'running'"
                      type="button"
                      class="jv-btn jv-btn--ghost jv-btn--sm"
                      @click="tasks.dismiss(taskForScene(s.id).id)"
                    >✕</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>
    </section>

    <!-- ── Takes tab — Chapter's block/take editor, absorbed (plan D2).
         Project selection comes from the workspace header above. ───── -->
    <section v-if="projects.length && tab === 'takes'" class="studio__takes">
      <ChapterView :project-id="selectedProjectId" />
    </section>

    <!-- Import manuscript — same modal BooksView uses. -->
    <ImportModal v-if="showImport" @close="showImport = false" @created="onImportCreated" />

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
.studio__project-select { flex: 1 1 260px; max-width: 480px; }
.studio__manage-link { font-size: 12px; text-decoration: none; }
.studio__manage-link:hover { text-decoration: underline; }
.studio__empty-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }

.studio__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-soft);
}
.studio__tab {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 10px 18px;
  font: inherit;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.studio__tab:hover { color: var(--ink); }
.studio__tab--active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.studio__cast {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 18px;
}
@media (max-width: 900px) { .studio__cast { grid-template-columns: 1fr; } }

.studio__cast-toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.studio__cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.studio__char-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.studio__char-card:hover { border-color: var(--border-strong, var(--accent-line, var(--accent))); }
.studio__char-card--narrator { background: var(--accent-soft); }
.studio__char-card--selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }

.studio__char-h { display: flex; align-items: center; gap: 10px; }
.studio__char-portrait {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
}
.studio__char-portrait--narrator { background: var(--accent); color: var(--surface); }
.studio__char-name { font-weight: 600; font-size: 14px; flex: 1; }

.studio__char-warn { padding: 6px 8px; font-size: 11.5px; margin: 0; }
.studio__char-voice { display: flex; flex-direction: column; font-size: 12.5px; }

.studio__char-actions { display: flex; gap: 6px; padding-top: 6px; border-top: 1px solid var(--border-soft); }

.studio__voice-library {
  padding: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  max-height: 70vh;
  overflow-y: auto;
}
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
  font-size: 11.5px;
  padding: 6px 10px;
  margin-bottom: 8px;
  background: var(--accent-soft);
  border: 1px solid var(--accent-line);
  border-radius: 4px;
  color: var(--accent-ink);
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

.studio__voice-action {
  appearance: none;
  background: transparent;
  border: 1px solid var(--line);
  border-radius: 4px;
  color: var(--ink-2);
  cursor: pointer;
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  padding: 0;
  flex-shrink: 0;
}
.studio__voice-action:hover:not(:disabled) {
  background: var(--surface-2);
  color: var(--ink);
}
.studio__voice-action:disabled { opacity: 0.5; cursor: not-allowed; }

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
.studio__script-select { flex: 1 1 240px; max-width: 360px; }

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
</style>
