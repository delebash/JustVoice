<!-- SPDX-License-Identifier: MIT -->
<!--
  StudioView — the project's home (ruled 2026-09-27: "studio stays as
  container", "open project always lands on overview"). Overview first, then
  Discover → Script → Cast → Render → Export for prose kinds and
  Lines → Cast → Render → Export for game — the order lives in studioSteps.js
  and is pinned by its test. Overview is components/StudioOverview.vue,
  Discover components/StudioDiscover.vue, Cast components/StudioCast.vue,
  Lines the LinesView grid embedded.
  Ported in shape from JustWrite's StudioView.vue.

  Terminology adapts via useCopy():
    audiobook → Cast / Chapter / Render
    podcast   → Hosts / Episode / Render
    game      → NPCs / Quest / Render

  Phase 4 / Slice 1 — shell + Cast tab.
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
import { pushToast } from "@delebash/llm-ui";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";
import { useVoicesStore } from "../stores/voices.js";
import { useEnginesStore } from "../stores/engines.js";
import { UiButton, UiTextarea, UiCheckbox, UiTag, UiSelect, AppModal } from "@delebash/llm-ui";

import ExportPanel from "../components/ExportPanel.vue";
import StudioOverview from "../components/StudioOverview.vue";
import StudioDiscover from "../components/StudioDiscover.vue";
import StudioCast from "../components/StudioCast.vue";
import StudioScript from "../components/StudioScript.vue";
import StudioScriptChapter from "../components/StudioScriptChapter.vue";
import LinesView from "./LinesView.vue";

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

// Per-line right-click Rewrite (plan Q1 / LD3). Right-clicking a line's text
// on Script's chapter page opens a preview modal where the LLM rewrites it in
// character — from the speaker's "who they are" (2026-09-29). Accept → the
// line's text is replaced; reject → nothing changes. It stays a right-click,
// with no visible control, until Slice 4 moves it to Render's line panel and
// deletes it here (§8.25).
const rewriteModalOpen = ref(false);
const rewriteLine = ref(null);     // {id, text, speaker_id} — the script line
const rewriteOriginal = ref("");
const rewritePreview = ref("");
const rewriteBusy = ref(false);
const rewriteError = ref("");

function rewriteRow(line) {
  if (!line) return;
  // Only speech has a speaker to rewrite against.
  if (!line.spoken) {
    pushToast({ message: "Rewrite only applies to spoken lines.", kind: "info" });
    return;
  }
  if (!line.speaker_id || line.speaker_id === narratorSpeaker.value?.id) {
    pushToast({ message: "Give this line a speaker first.", kind: "info" });
    return;
  }
  rewriteLine.value = { id: line.id, text: line.text, speaker_id: line.speaker_id };
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
    const r = await api.request(`/v1/speakers/${line.speaker_id}/rewrite`, {
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
// instead of failing later — no text → nothing to render; nobody played by a
// persona with a voice → the server would refuse every line.
const renderGate = computed(() => {
  if (!scenes.value.some((s) => sceneBlockCounts.value[s.id])) {
    return { ok: false, reason: "Nothing to render yet — chapters have no text. Import or paste in Chapters first." };
  }
  if (!speakers.value.some(speakerReady)) {
    return { ok: false, reason: "Nobody is cast yet — give a speaker a persona with a voice in Cast first." };
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
const renderedSceneCount = computed(() =>
  (cacheStats.value?.scenes || []).filter((sc) => sc.total > 0 && sc.cached === sc.total).length);
// The Script card's live count — the thing the user went looking for and
// found hardcoded ("the heading is in studio like render 0/4 rendered, the
// script used to show this and now doesn't"). Same shape as Render's, on the
// one "analyzed" rule the grid uses.
const analyzedSceneCount = computed(() => scriptChapters.value.filter((c) => c.analyzed).length);
// The Overview's rollup (studioStatus.js). The cast is the book's speakers,
// each with a narrator flag (so Discover can tell "only the Narrator so far"
// from a populated cast) and whether a persona with a voice plays them.
const overviewState = computed(() => projectState({
  scenes: scenes.value,
  stats: sceneStats.value,
  script: scriptChapters.value,
  running: chapterRunFor(selectedProjectId.value)?.current?.kind === "analyze" ? 1 : 0,
  cast: speakers.value.map((sp) => ({
    id: sp.id, name: sp.name, aliases: sp.aliases || [], ready: speakerReady(sp),
    narrator: sp.id === narratorSpeaker.value?.id,
  })),
  ignored: selectedProject.value?.discover_ignored || [],
  personas: personas.value,
  cache: cacheStats.value ? { total: cacheStats.value.total, cached: cacheStats.value.cached } : null,
}));

// The book's speakers as Script's and Discover's pages read them — a cast of
// only the Narrator blocks Analyze; the aliases let Discover tell who is In
// the cast; the line counts let Discover's Remove say what it takes.
const scriptCast = computed(() => speakers.value.map((sp) => ({
  id: sp.id, name: sp.name, aliases: sp.aliases || [], narrator: sp.id === narratorSpeaker.value?.id,
  lines: sp.lines || 0,
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

// A finished scan ({sceneId: discover}) folded into the chapter rows — the
// server already holds it, so this only spares a re-fetch, and Overview's
// Discover row moves the moment a chapter finishes.
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
  cast: "Give each speaker a persona",
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
    sub = overviewState.value.castTotal
      ? `${overviewState.value.castReady}/${overviewState.value.castTotal} cast`
      : "no speakers yet";
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

// The book's speakers (2026-09-29) — the people in it, each cast by giving it
// a persona (GET /v1/projects/{id}/speakers, most lines first). Cast is
// components/StudioCast.vue.
const speakers = ref([]);
const narratorSpeaker = computed(() => speakers.value.find((sp) => sp.role_label === "narrator") || null);
const personaById = computed(() => Object.fromEntries(personas.value.map((p) => [p.id, p])));
// Heard at render: played by a persona that has a voice.
function speakerReady(sp) {
  return !!personaById.value[sp.persona_id]?.voice_id;
}

// Per-scene inline playback for finished renders (the ruling 2026-08-15: the
// global bottom bar died; playback is compact and in place).
const scenePlay = ref(null); // { id, url } | null

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

async function loadSpeakers(projectId = selectedProjectId.value) {
  if (!projectId) {
    speakers.value = [];
    return;
  }
  const r = await api.safeRequest(`/v1/projects/${projectId}/speakers`, { speakers: [] });
  if (projectId !== selectedProjectId.value) return;   // switched away mid-load
  speakers.value = r?.speakers || [];
}

// Cast or Discover changed the speakers. `moved` > 0 when lines changed
// speaker with it (a new narrator, a removed speaker): the chapters' counts
// follow.
async function onCastChanged(e) {
  await loadSpeakers();
  if (e?.moved) await loadScenesForProject(selectedProjectId.value);
}

watch(selectedProjectId, (id) => {
  loadSpeakers(id);
  loadScenesForProject(id);
}, { immediate: true });
// A persona deleted or renamed elsewhere changes who plays whom.
watch(personas, () => loadSpeakers());

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
// A block with no speaker renders to nothing. The server used to drop those
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
  const narratorId = narratorSpeaker.value?.id;
  if (!narratorId) {
    pushToast({ message: "This book has no narrator to assign to — add one on Cast.", kind: "warning" });
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
                ? { speaker_id: narratorId, source: "corrected" }
                : { speaker_id: narratorId },
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
      ? `Assigned those lines to ${narratorSpeaker.value.name}; ${failed} failed.`
      : `Those lines now read as ${narratorSpeaker.value.name}. Render again.`,
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
    applyScans({ [sceneId]: {
      scanned_at: new Date().toISOString(),
      candidates: result.candidates || [],
      named_cast: result.named_cast || [],
    } });
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
      <!-- What is loaded — voice engine, language model — is the main
           header's to show (2026-09-29); the chips that repeated it here died. -->
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
      <!-- Cast's actions live in its own Speakers head (StudioCast.vue), on
           the surface they affect. -->
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
        :cast="scriptCast" :personas="personas"
        @cast-changed="onCastChanged" @go="goStep" />
    </KeepAlive>

    <!-- ── Lines — a game project's step 1 (the writers' sheet) ────── -->
    <LinesView v-if="tab === 'lines' && selectedProject" :project-id="selectedProject.id" />

    <!-- ── Cast — give each speaker a persona (2026-09-29) ──────────── -->
    <section v-if="tab === 'cast'" class="studio__cast">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to cast its speakers.
      </div>
      <StudioCast v-else :project="selectedProject" :speakers="speakers" :personas="personas"
        :voices="voices" :engines="engines" @changed="onCastChanged" @go="goStep" />
    </section>

    <!-- ── Script — the chapter grid, or one chapter (Slice 3, §8.24) ── -->
    <div v-if="tab === 'script' && !selectedProject" class="jv-banner">
      Pick a {{ copy.book.singular.toLowerCase() }} above to attribute its script.
    </div>
    <!-- Kept alive across step switches (2026-09-29, "navigating in a spa
         shouldnt reset the state"): coming back to Script finds the same page,
         ticks, filters, selected line and scroll. The chapter page still
         clears its Undo when a DIFFERENT chapter opens. -->
    <KeepAlive>
      <StudioScriptChapter v-if="tab === 'script' && selectedProject && scriptSceneId"
        :project="selectedProject" :scene-id="scriptSceneId"
        :chapters="scriptChapters" :scenes="scenes" :cast="scriptCast" :focus="scriptFocus"
        :version="scriptVersion"
        @back="openScript({ sceneId: null })"
        @open="(id, focus) => openScript({ sceneId: id, focus })"
        @go="(k) => (tab = k)" @changed="onScriptChanged"
        @rewrite="rewriteRow" />
    </KeepAlive>
    <KeepAlive>
      <StudioScript v-if="tab === 'script' && selectedProject && !scriptSceneId"
        :project="selectedProject" :chapters="scriptChapters" :scenes="scenes"
        :cast="scriptCast" v-model:filter="scriptFilter"
        @open="(id, focus) => openScript({ sceneId: id, focus })" @go="(k) => (tab = k)" />
    </KeepAlive>

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
        have a speaker. Send them all to the narrator, or fix them in Script.
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
          :disabled="unplacedFixing || !narratorSpeaker"
          :label="`Assign all to ${narratorSpeaker ? narratorSpeaker.name : 'Narrator'}`"
          :title="narratorSpeaker ? '' : 'This book has no narrator — add one on Cast'"
          @click="assignUnplacedToNarrator"
        />
      </template>
    </AppModal>

    <!-- Per-block Rewrite preview (right-click on Script tab). -->
    <AppModal
      v-if="rewriteModalOpen"
      eyebrow="Rewrite in character"
      :title="rewriteLine ? (speakers.find((sp) => sp.id === rewriteLine.speaker_id)?.name || 'Line') : 'Line'"
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

</style>
