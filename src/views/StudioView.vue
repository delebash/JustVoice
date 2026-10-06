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
  Studio Slice 4 (2026-10-04) — Render is a chapter grid
  (components/StudioRender.vue) that opens one chapter's lines
  (components/StudioRenderChapter.vue); Rewrite as the speaker moved there.
-->
<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { usePageCrumbs } from "../composables/usePageCrumbs.js";
import { isStepFor, stepsFor } from "./studioSteps.js";
import { blockStats, projectState } from "./studioStatus.js";
import { useCopy } from "../services/copy.js";
import { chapterRunFor, onChapterDone } from "../services/chapterRun.js";
import { pushToast } from "@delebash/llm-ui";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";
import { useVoicesStore } from "../stores/voices.js";
import { useEnginesStore } from "../stores/engines.js";
import { UiButton, UiTag, UiSelect } from "@delebash/llm-ui";

import ExportPanel from "../components/ExportPanel.vue";
import StudioOverview from "../components/StudioOverview.vue";
import StudioDiscover from "../components/StudioDiscover.vue";
import StudioCast from "../components/StudioCast.vue";
import StudioScript from "../components/StudioScript.vue";
import StudioScriptChapter from "../components/StudioScriptChapter.vue";
import StudioRender from "../components/StudioRender.vue";
import StudioRenderChapter from "../components/StudioRenderChapter.vue";
import LinesView from "./LinesView.vue";

const api = useApi();
const activeProject = useActiveProject();
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

// Render (Studio Slice 4): the chapter grid, or one chapter's lines.
const renderSceneId = ref(null);     // the open chapter; null = the grid
const renderGrid = ref(null);        // StudioRender — ▶ Render all runs through it
const renderVersion = ref(0);        // bumped when Studio changed lines Render shows
// GET /v1/projects/{id}/render_state — every chapter's counts in §8.16's words:
// the grid, this strip's Render card and Overview's Render row.
const renderState = ref(null);
async function loadRenderState(projectId = selectedProjectId.value) {
  if (!projectId) {
    renderState.value = null;
    return;
  }
  const r = await api.safeRequest(`/v1/projects/${projectId}/render_state`, null);
  if (projectId === selectedProjectId.value) renderState.value = r;
}
function openRender({ sceneId = null } = {}) {
  renderSceneId.value = sceneId;
  tab.value = "render";
}
// Render changed lines (a take, a direction, a rewrite) — the counts follow,
// and so does Script when a line's words changed.
async function onRenderChanged() {
  await loadRenderState();
  scriptVersion.value += 1;
}
async function renderAllChapters() {
  renderSceneId.value = null;
  await nextTick();
  renderGrid.value?.renderAll();
}

// Render gate (queue item 13): the button says WHY it is disabled instead of
// failing later — no text → nothing to render; nobody played by a persona
// with a voice → the server would refuse every line.
const renderGate = computed(() => {
  if (!scenes.value.some((s) => sceneBlockCounts.value[s.id])) {
    return { ok: false, reason: `Nothing to render yet — no ${copy.value.chapter.singular.toLowerCase()} has text. Add it in Script first.` };
  }
  if (!speakers.value.some(speakerReady)) {
    return { ok: false, reason: "Nobody is cast yet — give a speaker a persona with a voice in Cast first." };
  }
  return { ok: true, reason: "" };
});
const sceneBlockCounts = ref({});  // {sceneId: count of blocks}
// {sceneId: blockStats(blocks)} — spoken lines, unplaced lines, lines per
// persona. Read from the same per-chapter block fetch as the two above; the
// Overview rolls it up (studioStatus.projectState).
const sceneStats = ref({});

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
// Audio Studio screenshots): honest counts only — no fake progress. A chapter
// is rendered when every line has a take, stale or not (Slice 4).
const renderedSceneCount = computed(() => (renderState.value?.chapters || [])
  .filter((c) => c.lines > 0 && c.rendered + c.stale === c.lines).length);
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
  render: renderState.value?.totals || null,
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
  render: "Every line's audio, and each chapter joined and mastered",
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
    loadRenderState();
    loadMasterTarget();
  }
  // Overview's Render row reads the same counts Render does, and its Script
  // row the grid's rows.
  if (tab.value === "overview" && selectedProject.value) {
    loadRenderState();
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
  renderState.value = null;
  renderSceneId.value = null;
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
  // A narrator added from Script or Discover: its pages re-read their lines.
  if (e?.moved) scriptVersion.value += 1;
}

// {sceneId: lines of narration} — read, not spoken — from Script's rows.
// Discover proposes the narrator from it (2026-10-05).
const narrationByScene = computed(() => Object.fromEntries(scriptChapters.value
  .map((c) => [c.scene_id, Math.max(0, (c.lines || 0) - (c.spoken || 0))])));

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
  } catch {
    scenes.value = [];
  }
}

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
    project: "set on this project",
    kind: "the default for this project kind",
    request: "asked for by this render",
  }[m.source] || "";
  return m.preset
    ? `Applied to every chapter render — ${where}. Change it on Overview.`
    : "Chapters render raw — no mastering target is set for this project.";
});

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
    if (renderSceneId.value === sceneId) renderSceneId.value = null;
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
  renderVersion.value += 1;
}

// Script's grid added, renamed, moved or deleted a chapter, or pasted its
// text (D7) — every count follows.
async function onChaptersChanged() {
  await loadScenesForProject(selectedProjectId.value);
  await loadRenderState();
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
          :disabled="!renderGate.ok"
          label="▶ Render all"
          :title="renderGate.ok ? `Render every ${copy.chapter.singular.toLowerCase()}: each line with no take gets one, then it is joined and mastered` : renderGate.reason"
          @click="renderAllChapters"
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
        :lines-by-scene="linesByScene" :narration-by-scene="narrationByScene"
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
        @go="(k) => (tab = k)" @changed="onScriptChanged" @cast-changed="onCastChanged" />
    </KeepAlive>
    <KeepAlive>
      <StudioScript v-if="tab === 'script' && selectedProject && !scriptSceneId"
        :project="selectedProject" :chapters="scriptChapters" :scenes="scenes"
        :cast="scriptCast" v-model:filter="scriptFilter"
        @open="(id, focus) => openScript({ sceneId: id, focus })" @go="(k) => (tab = k)"
        @changed="onChaptersChanged" @cast-changed="onCastChanged" />
    </KeepAlive>

    <!-- ── Render — the chapter grid, or one chapter's lines (Slice 4) ── -->
    <div v-if="tab === 'render' && !selectedProject" class="jv-banner">
      Pick a {{ copy.book.singular.toLowerCase() }} above to render its {{ copy.chapter.plural.toLowerCase() }}.
    </div>
    <!-- Kept alive like Script's pages: coming back finds the same page, filters,
         open line and scroll. -->
    <KeepAlive>
      <StudioRenderChapter v-if="tab === 'render' && selectedProject && renderSceneId"
        :project="selectedProject" :scene-id="renderSceneId" :scenes="scenes" :speakers="speakers"
        :personas="personas" :version="renderVersion"
        @back="openRender({ sceneId: null })" @open="(id) => openRender({ sceneId: id })"
        @go="goStep" @changed="onRenderChanged" />
    </KeepAlive>
    <KeepAlive>
      <StudioRender v-if="tab === 'render' && selectedProject && !renderSceneId" ref="renderGrid"
        :project="selectedProject" :scenes="scenes" :render-state="renderState" :speakers="speakers"
        :chapters="scriptChapters"
        @open="(id) => openRender({ sceneId: id })"
        @go="(k, arg) => (k === 'script' && arg?.sceneId ? openScript(arg) : goStep(k))"
        @changed="onRenderChanged" />
    </KeepAlive>

    <!-- ── Export tab — package + ACX checklist (mock export screen) ── -->
    <section v-if="tab === 'export'" class="studio__exportstep">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to package it.
      </div>
      <ExportPanel v-else :project="selectedProject" :scenes="scenes" />
    </section>

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
/* ── Script and Render — their pages style themselves (StudioScript*.vue,
   StudioRender*.vue) ─────────────────────────────────────────────── */

</style>
