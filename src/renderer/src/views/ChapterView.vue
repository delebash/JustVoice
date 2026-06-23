<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useTakesStore } from "../stores/takes.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";
import { projectsService } from "../services/projects.js";
import { useCopy } from "../services/copy.js";
import { usePageCrumbs } from "../composables/usePageCrumbs.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";
import { useVoicesStore } from "../stores/voices.js";
import { UiButton, UiInput, UiTextarea, UiTag, UiChip } from "@delebash/llm-ui";
import LineageViewer from "../components/LineageViewer.vue";
import EmptyState from "../components/EmptyState.vue";
import JvSelect from "../components/ui/JvSelect.vue";

const api = useApi();
const activeProject = useActiveProject();
const tasks = useRenderTasks();
const takesStore = useTakesStore();
// Per-use-case terminology (plan locked decision #7 / Slice 5). Audiobook
// users see "Chapter / Line"; game devs see "Scene / Voiceline"; podcasters
// see "Segment / Block"; etc. Driven by the onboarding primary use case.
const copy = useCopy();

// ── Project / scene / block selection ──────────────────────────────────────

// Projects, personas and voices come from shared stores (the single
// source of truth). This view holds NO private copy — when an import
// or any other view mutates the list and calls store.reload(), this
// view's reactive bindings update even while KeepAlive-cached.
const projectsStore = useProjectsStore();
const personasStore = usePersonasStore();
const voicesStore = useVoicesStore();
const projects = computed(() => projectsStore.items);
const scenes = ref([]);
// Full persona records — regen resolves the block's cast voice from here.
const personaRecords = computed(() => personasStore.items);
const personasById = computed(() =>
  Object.fromEntries(personasStore.items.map((p) => [p.id, p.name])),
);
async function editDirection(block) {
  const value = await promptDialog({
    title: "Performance note",
    message: "Direction for this line — instruct-capable engines (Qwen3, LuxTTS) perform it; others ignore it.",
    placeholder: "e.g. weary, almost whispering",
    initial: block.direction || "",
  });
  if (value === null || value === undefined) return;
  try {
    await api.request(`/v1/blocks/${block.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ direction: value.trim() || null }),
    });
    block.direction = value.trim() || null;
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error" });
  }
}

function personaName(id) {
  return personasById.value[id] || id.slice(0, 8);
}
// [laughs]-style paralinguistic tags render as pills; capable engines
// perform them (CONCEPTS §17), so they stay visible, not buried in prose.
function tagParts(text) {
  const out = [];
  let last = 0;
  const re = /\[(\w[\w -]{0,24})\]/g;
  let m = re.exec(text || "");
  while (m !== null) {
    if (m.index > last) out.push({ tag: false, text: text.slice(last, m.index) });
    out.push({ tag: true, text: m[0] });
    last = m.index + m[0].length;
    m = re.exec(text || "");
  }
  if (last < (text || "").length) out.push({ tag: false, text: text.slice(last) });
  return out.length ? out : [{ tag: false, text: text || "" }];
}
const blocks = ref([]);
const selectedProjectId = ref(null);
const selectedSceneId = ref(null);

// Scene hand-off from ProjectsView's chapters-subtable "Open" — read once at
// setup so it's available when loadScenes() runs (after the store loads).
let _pendingSceneId = null;
try {
  _pendingSceneId = window.sessionStorage?.getItem("jv.chapter.sceneId") || null;
  if (_pendingSceneId) window.sessionStorage.removeItem("jv.chapter.sceneId");
} catch { /* ignore */ }

const projectOptions = computed(() =>
  projects.value.length === 0
    ? [{ label: "— no projects —", value: null }]
    : projects.value.map((p) => ({ label: p.name, value: p.id }))
);

const sceneOptions = computed(() =>
  scenes.value.length === 0
    ? [{ label: `— no ${copy.value.chapter.plural.toLowerCase()} —`, value: null }]
    : scenes.value.map((s) => ({
        label: s.title || `${copy.value.chapter.singular} ${s.position + 1}`,
        value: s.id,
      }))
);

async function loadScenes(projectId) {
  scenes.value = [];
  blocks.value = [];
  selectedSceneId.value = null;
  if (!projectId) return;
  try {
    const res = await projectsService.listScenes(projectId);
    // Endpoint returns a bare array (same shape fix as StudioView).
    scenes.value = Array.isArray(res) ? res : res?.scenes || [];
    if (scenes.value.length) {
      // Prefer a scene handed off from Books' "Open"; else the first.
      const pending = _pendingSceneId && scenes.value.some((s) => s.id === _pendingSceneId);
      selectedSceneId.value = pending ? _pendingSceneId : scenes.value[0].id;
      _pendingSceneId = null;
    }
  } catch (e) {
    pushToast({ message: `Failed to load scenes: ${e.message || e}`, kind: "error" });
  }
}

async function loadBlocks(sceneId) {
  blocks.value = [];
  if (!sceneId) return;
  try {
    const res = await projectsService.listBlocks(sceneId);
    // Bare-array endpoint (same family as the scenes shape fix).
    const list = Array.isArray(res) ? res : res?.blocks || [];
    blocks.value = [...list].sort((a, b) => a.position - b.position);
    // Pre-fetch takes for every block (parallel).
    for (const b of blocks.value) {
      takesStore.fetchTakes(b.id);
    }
  } catch (e) {
    pushToast({ message: `Failed to load blocks: ${e.message || e}`, kind: "error" });
  }
}

watch(selectedProjectId, (id) => loadScenes(id));
watch(selectedSceneId, (id) => loadBlocks(id));

// Auto-select the active or first project. Registered AFTER the
// selectedProjectId→loadScenes watch above so that when this sets
// selectedProjectId (including the immediate fire for an already-warm
// store), the scenes watcher is live and loads scenes. `immediate`
// covers both timings: store already loaded (fires now) and store
// loads later via ensureLoaded (fires on the change).
watch(projects, (list) => {
  if (list.length && !selectedProjectId.value) {
    const prefer = list.find((p) => p.id === activeProject.id);
    selectedProjectId.value = (prefer || list[0]).id;
  }
}, { immediate: true });

// Breadcrumb publishing — Chapter › [Project] › [Scene]. Owned only
// while this view is active (X-1: KeepAlive-cached views must not
// re-publish a stale crumb when a shared store reloads elsewhere).
const { publish: publishCrumbs } = usePageCrumbs(() => {
  const segments = [];
  const project = projects.value.find((p) => p.id === selectedProjectId.value);
  if (project) segments.push({ label: project.name, href: "#projects" });
  const scene = scenes.value.find((s) => s.id === selectedSceneId.value);
  if (scene) segments.push({ label: scene.title || `Chapter ${scene.position + 1}` });
  return segments;
});
watch([selectedProjectId, selectedSceneId, projects, scenes], publishCrumbs);

// Warm the shared stores (idempotent — first view to need each loads
// it once, the rest are no-ops). Reads above are reactive against the
// store, so a later load or a cross-view mutation+reload updates this
// view even while KeepAlive-cached.
onMounted(() => {
  projectsStore.ensureLoaded();
  personasStore.ensureLoaded();
  voicesStore.ensureLoaded();
  refreshCurrentEngine();
});

// ── Voices (for re-generation) ─────────────────────────────────────────────

const voices = computed(() => voicesStore.items);
const currentEngine = ref(null);

// currentEngine is a single record (not a list), so it stays a small
// per-view fetch. Refreshed on engine load/unload via jv:health-refresh.
async function refreshCurrentEngine() {
  try {
    const cur = await api.safeRequest("/v1/engines/current", { engine: null });
    currentEngine.value = cur?.engine || null;
  } catch { /* tolerated */ }
}
window.addEventListener("jv:health-refresh", refreshCurrentEngine);

const availableVoices = computed(() => {
  if (!currentEngine.value) return [];
  return voices.value.filter((v) => v.engine === currentEngine.value.id);
});

const voiceOptions = computed(() =>
  availableVoices.value.length === 0
    ? [{ label: "— no voices loaded —", value: "" }]
    : availableVoices.value.map((v) => ({ label: `${v.name} — ${v.id}`, value: v.id }))
);

// Default voice for re-generation.
const regenVoice = ref("");
watch(availableVoices, (list) => {
  if (!regenVoice.value && list.length) regenVoice.value = list[0].id;
});

// ── Per-block state helpers ────────────────────────────────────────────────

// Tracks which block has the "compare" panel open.
const compareBlockId = ref(null);
// Tracks which take is selected as "B-side" for comparison.
const compareSecondaryIds = ref(new Map());

function getBlockTakes(blockId) {
  return takesStore.getTakes(blockId);
}

function getActiveTake(blockId) {
  return takesStore.getActiveTake(blockId);
}

function getActiveTakeIndex(blockId) {
  const list = getBlockTakes(blockId);
  const id = takesStore.getActiveTakeId(blockId);
  const idx = list.findIndex((t) => t.id === id);
  return idx < 0 ? 0 : idx;
}

function takeLabel(take, index, total) {
  if (take?.label) return take.label;
  return `Take ${total - index}`;
}

function formatTs(isoStr) {
  if (!isoStr) return "";
  return new Date(isoStr).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Build option list for the take dropdown (newest first = index 0 = highest number).
function takeDropdownOptions(blockId) {
  const list = getBlockTakes(blockId);
  return list.map((t, i) => ({
    label: `${takeLabel(t, i, list.length)} · ${formatTs(t.created_at)}${t.is_default ? " ★ default" : ""}`,
    value: t.id,
  }));
}

// ── Source lineage pill ────────────────────────────────────────────────────

// Clicking the pill opens the LineageViewer modal (task #98) for the
// active take — walks source_take_id back to the original.
const lineageTakeId = ref(null);

function sourceTakeLabel(take, blockId) {
  if (!take?.source_take_id) return null;
  const list = getBlockTakes(blockId);
  const srcIdx = list.findIndex((t) => t.id === take.source_take_id);
  if (srcIdx < 0) return "← from earlier take";
  return `← from ${takeLabel(list[srcIdx], srcIdx, list.length)}`;
}

// ── Audio URL helper ───────────────────────────────────────────────────────

function audioUrl(take) {
  if (!take?.generation_id) return null;
  return `${api.serverUrl.replace(/\/$/, "")}/v1/generations/${take.generation_id}/audio`;
}

// ── Re-generation (creates a new take) ────────────────────────────────────

const regenBusy = ref(new Map());

async function regenerateBlock(block) {
  // Voice resolution (regen demote, user decision 2026-06-12): the
  // block's cast persona voice wins; only an uncast block asks. The
  // old top-bar "Voice for re-generate" select silently overrode the
  // cast and confused everyone.
  let voice = null;
  if (block.persona_id) {
    voice = personaRecords.value.find((p) => p.id === block.persona_id)?.voice_id || null;
  }
  if (!voice) {
    if (!availableVoices.value.length) {
      pushToast({ message: "No voices available — add one in Voices first.", kind: "warn" });
      return;
    }
    const picked = await promptDialog({
      title: "Regenerate with which voice?",
      message: block.persona_id
        ? `${personaName(block.persona_id)} has no voice cast yet — pick one for this take.`
        : "This line has no speaker cast — pick a voice for this take.",
      fields: [{
        key: "voice",
        label: "Voice",
        type: "select",
        defaultValue: regenVoice.value || availableVoices.value[0].id,
        options: availableVoices.value.map((v) => ({ value: v.id, label: `${v.name} — ${v.id}` })),
      }],
      confirmLabel: "Regenerate",
    });
    voice = picked?.voice;
    if (!voice) return;
    regenVoice.value = voice; // remember as the session fallback
  }
  regenBusy.value.set(block.id, true);
  const task = tasks.start({
    label: `Regen block · ${block.text.slice(0, 40)}…`,
    kind: "chapter",
    statsFn: () => ["1 block"],
    onCancel: () => {},
  });
  try {
    // Regen inherits the project's default lexicon so pronunciation
    // overrides for this chapter don't silently drop on a re-roll.
    // preset_id is NOT inherited automatically — project.metadata
    // .render_preset is a UI enum, not a render_presets.id, and the
    // last-used preset isn't persisted on the block or scene. If
    // preset inheritance becomes a need, plumb it from the block's
    // most recent Generation.preset_id (server-side join, since
    // TakeResponse currently only exposes generation_id).
    const body = {
      lines: [{ voice, text: block.text }],
      between_lines: { silence_ms: 0 },
    };
    const project = selectedProjectRec.value;
    if (project?.default_lexicon_id) {
      body.lexicons = [project.default_lexicon_id];
    }
    const blob = await api.request("/v1/render_chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    tasks.update(task.id, { meta: { bytesOut: blob.size } });
    tasks.finish(task.id);
    // After regen succeeds, refresh the takes for this block so the new take
    // appears.  (A future endpoint may auto-create the Take row server-side;
    // for now we just refresh so any server-created takes show up.)
    takesStore.invalidate(block.id);
    await takesStore.fetchTakes(block.id);
    pushToast({ message: `${copy.value.line.singular} regenerated.`, kind: "success" });
  } catch (e) {
    tasks.fail(task.id, String(e.message || e));
    pushToast({ message: `Regen failed: ${e.message || e}`, kind: "error", duration: 6000 });
  } finally {
    regenBusy.value.set(block.id, false);
  }
}

function goTimeline() {
  window.location.hash = "#stories";
}

// ── Inline block text editing (user ask 2026-06-12: edit the chapter
// in place — open/edit was read-only). PATCH /v1/blocks/{id} carries
// text; the render cache keys on text, so only the edited line
// re-renders next time. Existing takes keep the OLD text's audio.
const editingBlockId = ref(null);
const editingText = ref("");
const editSaveBusy = ref(false);

function startEditBlock(block) {
  editingBlockId.value = block.id;
  editingText.value = block.text;
}

async function saveBlockText(block) {
  const text = editingText.value.trim();
  if (!text || text === block.text) {
    editingBlockId.value = null;
    return;
  }
  editSaveBusy.value = true;
  try {
    await api.request(`/v1/blocks/${block.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    editingBlockId.value = null;
    await loadBlocks(selectedSceneId.value);
    pushToast({ message: "Line updated — the next render regenerates just this line; everything else stays cached.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error", duration: 6000 });
  } finally {
    editSaveBusy.value = false;
  }
}

// ── Delete take ────────────────────────────────────────────────────────────

const deleteBusy = ref(new Map());
const deletePending = ref(new Set()); // take IDs awaiting confirm

function requestDeleteTake(takeId) {
  deletePending.value.add(takeId);
}

function cancelDeleteTake(takeId) {
  deletePending.value.delete(takeId);
}

async function confirmDeleteTake(takeId, blockId) {
  deletePending.value.delete(takeId);
  deleteBusy.value.set(takeId, true);
  try {
    await takesStore.removeTake(takeId, blockId);
    pushToast({ message: "Take deleted.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  } finally {
    deleteBusy.value.delete(takeId);
  }
}

// ── Promote to default ─────────────────────────────────────────────────────

const promoteBusy = ref(new Map());

async function promoteToDefault(takeId, blockId) {
  promoteBusy.value.set(takeId, true);
  try {
    await takesStore.promoteToDefault(takeId, blockId);
    pushToast({ message: "Take set as default.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Promote failed: ${e.message || e}`, kind: "error" });
  } finally {
    promoteBusy.value.delete(takeId);
  }
}

// ── Compare panel ──────────────────────────────────────────────────────────

function toggleCompare(blockId) {
  if (compareBlockId.value === blockId) {
    compareBlockId.value = null;
  } else {
    compareBlockId.value = blockId;
    // Default B-side to the second take if available.
    const list = getBlockTakes(blockId);
    const activeId = takesStore.getActiveTakeId(blockId);
    const other = list.find((t) => t.id !== activeId);
    if (other) compareSecondaryIds.value.set(blockId, other.id);
  }
}

function compareTakeB(blockId) {
  const id = compareSecondaryIds.value.get(blockId);
  if (!id) return null;
  return getBlockTakes(blockId).find((t) => t.id === id) || null;
}

function compareDropdownOptions(blockId) {
  const list = getBlockTakes(blockId);
  const activeId = takesStore.getActiveTakeId(blockId);
  return list
    .filter((t) => t.id !== activeId)
    .map((t, i) => ({
      label: `${takeLabel(t, i, list.length)} · ${formatTs(t.created_at)}`,
      value: t.id,
    }));
}

// Keep the app-wide active project (sidebar vocabulary, topbar chips,
// Home resume card) in sync with this view's selection.
watch(selectedProjectId, (id) => {
  const p = projects.value.find((x) => x.id === id);
  if (p) activeProject.open(p);
});

// ── Export panel (journeys "Export — <project>" screen, Chapters nav) ─
// Package card + ACX checklist. The checklist shows only what the
// server actually measures (/v1/projects/{id}/qc: per-chapter RMS +
// peak); unmeasured spec items render as "not checked" — no fake ✓.

const selectedProjectRec = computed(() =>
  projects.value.find((p) => p.id === selectedProjectId.value) || null,
);

function goStudioExport() {
  try { window.sessionStorage?.setItem("jv.studio.tab", "export"); } catch { /* ignore */ }
  window.location.hash = "#studio";
}

// Empty-state CTA. Must live in script — `window` in a template
// expression resolves to `_ctx.window` (undefined), which is how the
// old inline handler silently did nothing.
function goProjects() {
  window.location.hash = "#projects";
}

// ── Fix-it loop entry (journeys fixit journey) ────────────────────────
// Flag a misread word on the line → Lexicons opens with it prefilled.
// Uses the user's text selection when it's inside this block; otherwise
// asks. Lexicon hashes are part of the render-cache key, so saving the
// entry re-renders exactly the lines that contain the word.
async function flagPronunciation(block) {
  let word = "";
  const sel = typeof window !== "undefined" ? String(window.getSelection() || "").trim() : "";
  if (sel && sel.length <= 60 && (block.text || "").includes(sel)) {
    word = sel;
  } else {
    word = (await promptDialog({
      title: "Fix a pronunciation",
      message: "Which word or name did the engine misread?",
      placeholder: "e.g. Hecate",
    }))?.trim() || "";
  }
  if (!word) return;
  try {
    window.sessionStorage?.setItem("jv.lexicon.prefill", JSON.stringify({ grapheme: word, sceneId: selectedSceneId.value }));
  } catch { /* private mode — link still works */ }
  window.location.hash = "#lexicons";
}

// ── Chapters home base (journeys audiobook step 3): per-chapter status
// table — "just text" → attributed → rendered. Open drills into the
// block editor below; the whole-book actions sit on the toolbar. ──────
const viewMode = ref("list");           // "list" | "detail"
const chapterFilter = ref("");
const chapterChip = ref("all");         // all | needs-script | ready | rendered
const sceneStats = ref({});             // scene_id -> {words, blocks, attributed}
const sceneCache = ref({});             // scene_id -> {total, cached}

async function loadChapterList() {
  if (!selectedProjectId.value) return;
  // blocks per scene, in parallel — words + attribution state
  const entries = await Promise.all(scenes.value.map(async (sc) => {
    try {
      const res = await projectsService.listBlocks(sc.id);
      const blocks = res?.blocks || res || [];
      const words = blocks.reduce((n, b) => n + String(b.text || "").split(/\s+/).filter(Boolean).length, 0);
      // Marker blocks (podcast music/ad direction lines) are
      // legitimately speaker-less — attribution only judges speech.
      const speech = blocks.filter((b) => !b.metadata?.marker);
      const attributed = speech.length > 0 && speech.every((b) => !!b.persona_id);
      return [sc.id, { words, blocks: blocks.length, attributed }];
    } catch { return [sc.id, { words: 0, blocks: 0, attributed: false }]; }
  }));
  sceneStats.value = Object.fromEntries(entries);
  try {
    const r = await api.request(`/v1/render/cache-stats?project_id=${selectedProjectId.value}`);
    sceneCache.value = Object.fromEntries((r?.scenes || []).map((sc) => [sc.scene_id, sc]));
  } catch { sceneCache.value = {}; }
}

function estAudio(words) {
  if (!words) return "—";
  const min = words / 155;  // ~155 wpm narration pace
  if (min < 1) return `${Math.round(min * 60)} s`;
  const h = Math.floor(min / 60);
  return h ? `${h} h ${String(Math.round(min % 60)).padStart(2, "0")} m` : `${Math.round(min)} m`;
}
function scriptState(id) {
  const st = sceneStats.value[id];
  if (!st?.blocks) return { intent: "ghost", label: "not analyzed" };
  return st.attributed
    ? { intent: "success", label: "attributed" }
    : { intent: "accent2", label: "unassigned speakers" };
}
function renderState(id) {
  const c = sceneCache.value[id];
  if (!c?.total) return { intent: "ghost", label: "—" };
  if (c.cached === c.total) return { intent: "success", label: "✓ cached" };
  if (c.cached > 0) return { intent: "info", label: `${c.cached}/${c.total} cached` };
  return { intent: "ghost", label: "—" };
}
const filteredScenes = computed(() => scenes.value.filter((sc) => {
  const q = chapterFilter.value.trim().toLowerCase();
  if (q && !(sc.title || "").toLowerCase().includes(q)) return false;
  const st = sceneStats.value[sc.id];
  if (chapterChip.value === "needs-script") return !st?.attributed;
  if (chapterChip.value === "ready") return !!st?.attributed && renderState(sc.id).label !== "✓ cached";
  if (chapterChip.value === "rendered") return renderState(sc.id).label === "✓ cached";
  return true;
}));
function openChapter(sc) {
  selectedSceneId.value = sc.id;
  viewMode.value = "detail";
}
function backToList() {
  viewMode.value = "list";
  loadChapterList();
}
async function addChapter() {
  const title = (await promptDialog({
    title: `New ${copy.value.chapter.singular.toLowerCase()}`,
    message: "Title:",
    placeholder: `${copy.value.chapter.singular} ${scenes.value.length + 1}`,
  }))?.trim();
  if (!title) return;
  try {
    await projectsService.createScene(selectedProjectId.value, { title, position: scenes.value.length });
    await loadScenes(selectedProjectId.value);
    await loadChapterList();
    pushToast({ kind: "success", title: `${copy.value.chapter.singular} added` });
  } catch (e) {
    pushToast({ kind: "error", title: "Add failed", description: String(e?.message ?? e) });
  }
}
function openInStudio() {
  window.location.hash = "#studio";
}
watch([scenes, selectedProjectId], () => { if (viewMode.value === "list") loadChapterList(); });

// ── Workflow strip (journeys audiobook arc): Import → Cast → Script →
// Render → Export, with live status per step so the whole flow can be
// walked and verified in order. ───────────────────────────────────────
const castStats = ref({ total: 0, voiced: 0 });
async function loadCastStats() {
  castStats.value = { total: 0, voiced: 0 };
  if (!selectedProjectId.value) return;
  try {
    const r = await api.request(`/v1/projects/${selectedProjectId.value}/cast`);
    const cast = r?.cast || [];
    const personas = await Promise.all(cast.map(async (c) => {
      try { return await api.request(`/v1/personas/${c.persona_id}`); } catch { return null; }
    }));
    castStats.value = {
      total: cast.length,
      voiced: personas.filter((p) => p?.voice_id).length,
    };
  } catch { /* cast endpoint empty — strip shows 0 */ }
}
watch([selectedProjectId, viewMode], () => { if (viewMode.value === "list") loadCastStats(); });

const workflowSteps = computed(() => {
  const n = scenes.value.length;
  const attributed = scenes.value.filter((sc) => sceneStats.value[sc.id]?.attributed).length;
  const cachedAll = scenes.value.filter((sc) => {
    const c = sceneCache.value[sc.id];
    return c?.total && c.cached === c.total;
  }).length;
  return [
    { label: "1 Import", sub: n ? `${n} ${copy.value.chapter.plural.toLowerCase()}` : "no text yet", done: n > 0, act: startImport },
    { label: "2 Cast", sub: castStats.value.total ? `${castStats.value.voiced}/${castStats.value.total} voiced` : "no cast yet", done: castStats.value.total > 0 && castStats.value.voiced === castStats.value.total, act: () => goStudio("cast") },
    { label: "3 Script", sub: n ? `${attributed}/${n} attributed` : "—", done: n > 0 && attributed === n, act: () => goStudio("script") },
    { label: "4 Render", sub: n ? `${cachedAll}/${n} rendered` : "—", done: n > 0 && cachedAll === n, act: () => goStudio("render") },
    { label: "5 Export", sub: "M4B · WAVs · ACX", done: false, act: () => { exportOpen.value = true; runExportQc(); } },
  ];
});
function startImport() {
  try { window.sessionStorage?.setItem("jv.projects.openImport", "1"); } catch { /* ignore */ }
  window.location.hash = "#projects";
}
function goStudio(tab) {
  try { if (tab) window.sessionStorage?.setItem("jv.studio.tab", tab); } catch { /* ignore */ }
  window.location.hash = "#studio";
}

// ── Chapter management (rename / delete / reorder / paste-text) ──────
async function renameChapter(sc) {
  const title = (await promptDialog({
    title: "Rename chapter", message: "New title:", placeholder: sc.title || "",
  }))?.trim();
  if (!title || title === sc.title) return;
  try {
    await api.request(`/v1/scenes/${sc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });
    await loadScenes(selectedProjectId.value); await loadChapterList();
  } catch (e) { pushToast({ kind: "error", title: "Rename failed", description: String(e?.message ?? e) }); }
}
async function deleteChapter(sc) {
  const ok = await confirmDialog({
    title: `Delete “${sc.title || "chapter"}”?`,
    message: "Its text blocks and rendered takes go with it — permanently.",
    danger: true, confirmLabel: "Delete chapter",
  });
  if (!ok) return;
  const before = scenes.value;
  scenes.value = before.filter((x) => x.id !== sc.id);  // optimistic
  try {
    await api.request(`/v1/scenes/${sc.id}`, { method: "DELETE" });
    loadChapterList();  // stats refresh quietly, no row clearing
  } catch (e) {
    scenes.value = before;
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}
async function moveChapter(sc, dir) {
  const target = sc.position + dir;
  if (target < 0 || target >= scenes.value.length) return;
  // Optimistic swap — rows trade places instantly; the server PATCH
  // confirms in the background (user-hit: refetch caused a flash).
  const before = scenes.value;
  const other = before.find((x) => x.position === target);
  scenes.value = before.map((x) =>
    x.id === sc.id ? { ...x, position: target }
    : other && x.id === other.id ? { ...x, position: sc.position }
    : x
  ).sort((a, b) => a.position - b.position);
  try {
    await api.request(`/v1/scenes/${sc.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ position: target }) });
  } catch (e) {
    scenes.value = before;  // revert
    pushToast({ kind: "error", title: "Reorder failed", description: String(e?.message ?? e) });
  }
}

// Paste-text for an empty chapter: paragraphs → narrator-implied blocks.
// NO speaker attribution — Studio · Script owns that.
const pasteText = ref("");
const pasteBusy = ref(false);
async function savePastedText() {
  const paras = pasteText.value.split(/\n\s*\n/).map((t) => t.trim()).filter(Boolean);
  if (!paras.length || !selectedSceneId.value) return;
  pasteBusy.value = true;
  try {
    for (let i = 0; i < paras.length; i++) {
      await api.request(`/v1/scenes/${selectedSceneId.value}/blocks`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ position: i, text: paras[i] }),
      });
    }
    pasteText.value = "";
    await loadBlocks(selectedSceneId.value);
    pushToast({ kind: "success", title: `${paras.length} blocks added`, description: "Assign speakers in Studio · Script when ready." });
  } catch (e) { pushToast({ kind: "error", title: "Save failed", description: String(e?.message ?? e) }); }
  finally { pasteBusy.value = false; }
}
</script>

<template>
  <div class="chapter-view">

    <!-- ── Project / scene pickers — canonical .jv-lib-toolbar (RULE #1
         precedent: PersonasView's toolbar — data dropdowns inline,
         spacer, actions rightmost). Replaces the old full-width
         three-column selector card + duplicate "view" heading. -->
    <div class="jv-lib-toolbar">
      <JvSelect
        v-model="selectedProjectId"
        :options="projectOptions"
        :placeholder="`Select a ${copy.book.singular.toLowerCase()}…`"
        width="name"
        :title="copy.book.singular"
      />
      <JvSelect
        v-model="selectedSceneId"
        :options="sceneOptions"
        :disabled="!selectedProjectId || !scenes.length"
        :placeholder="`Select a ${copy.chapter.singular.toLowerCase()}…`"
        width="name"
        :title="copy.chapter.singular"
      />
      <!-- "Voice for re-generate" demoted (2026-06-12): regen uses the
           block's cast persona voice; uncast blocks ask inline. -->
      <span class="jv-spacer" />
      <UiButton
        v-if="selectedProjectId"
        intent="secondary"
        size="small"
        label="⬇ Export"
        title="Package the whole project — opens Studio · 4 Export (M4B, chapter audio, ACX checklist)"
        @click="goStudioExport"
      />
    </div>

    <!-- ── Chapters home base — per-chapter status table (mock step 3) ── -->
    <template v-if="viewMode === 'list' && selectedProjectId">
      <div class="chapter-view__flow">
        <button
          v-for="(st, i) in workflowSteps"
          :key="st.label"
          type="button"
          class="chapter-view__flow-step"
          :class="{ 'chapter-view__flow-step--done': st.done }"
          :title="`Open step — ${st.sub}`"
          @click="st.act()"
        >
          <span class="chapter-view__flow-label">{{ st.done ? "✓" : "" }} {{ st.label }}</span>
          <span class="chapter-view__flow-sub">{{ st.sub }}</span>
        </button>
      </div>
      <p class="chapter-view__lede jv-muted">
        Each {{ copy.chapter.singular.toLowerCase() }} moves independently through
        <strong>cast → script → render</strong>. Open one to read it, or send the whole
        {{ copy.book.singular.toLowerCase() }} to Studio.
      </p>
      <div class="chapter-view__list-toolbar">
        <UiInput v-model="chapterFilter" size="small" style="max-width:260px" :placeholder="`Filter ${copy.chapter.plural.toLowerCase()}…`" />
        <UiChip v-for="c in [['all','All'],['needs-script','Needs script'],['ready','Ready'],['rendered','Rendered']]" :key="c[0]"
          :selected="chapterChip === c[0]"
          :title="c[0]==='needs-script' ? 'Chapters with unattributed or missing blocks' : c[0]==='rendered' ? 'Fully cached — re-render is free' : ''"
          @click="chapterChip = c[0]">{{ c[1] }}</UiChip>
        <span class="jv-spacer" />
        <UiButton intent="secondary" size="small" :label="`＋ Add ${copy.chapter.singular.toLowerCase()}`" @click="addChapter" />
        <UiButton intent="primary" size="small" label="Open in Studio ➜" title="Cast → Script → Render for the whole project" @click="openInStudio" />
      </div>
      <table class="jv-table chapter-view__list">
        <thead><tr>
          <th>{{ copy.chapter.singular }}</th>
          <th class="chapter-view__num">Words</th>
          <th class="chapter-view__num">Est. audio</th>
          <th>Script</th>
          <th>Render</th>
          <th></th>
        </tr></thead>
        <tbody>
          <tr v-for="sc in filteredScenes" :key="sc.id" class="chapter-view__list-row" @click="openChapter(sc)">
            <td><strong>{{ sc.title || `${copy.chapter.singular} ${sc.position + 1}` }}</strong></td>
            <td class="chapter-view__num jv-mono">{{ (sceneStats[sc.id]?.words ?? 0).toLocaleString() }}</td>
            <td class="chapter-view__num jv-mono">{{ estAudio(sceneStats[sc.id]?.words) }}</td>
            <td><UiTag :intent="scriptState(sc.id).intent">{{ scriptState(sc.id).label }}</UiTag></td>
            <td><UiTag :intent="renderState(sc.id).intent">{{ renderState(sc.id).label }}</UiTag></td>
            <td style="text-align:right;white-space:nowrap">
              <button type="button" class="jv-rowact" title="Move up" @click.stop="moveChapter(sc, -1)">↑</button>
              <button type="button" class="jv-rowact" title="Move down" @click.stop="moveChapter(sc, 1)">↓</button>
              <button type="button" class="jv-rowact" title="Rename" @click.stop="renameChapter(sc)">✎</button>
              <button type="button" class="jv-rowact jv-rowact--danger" title="Delete chapter" @click.stop="deleteChapter(sc)">✕</button>
              <UiButton intent="ghost" size="small" label="Open" @click.stop="openChapter(sc)" />
            </td>
          </tr>
          <tr v-if="!filteredScenes.length && scenes.length"><td colspan="6" class="jv-muted" style="padding:14px">No {{ copy.chapter.plural.toLowerCase() }} match.</td></tr>
        </tbody>
      </table>
      <div v-if="!scenes.length" class="chapter-view__no-chapters">
        <h4>No {{ copy.chapter.plural.toLowerCase() }} yet</h4>
        <p class="jv-muted">
          Drop in a manuscript — EPUB, DOCX, Markdown, or plain text — and it splits into
          {{ copy.chapter.plural.toLowerCase() }} with a preview before anything imports.
          Or add an empty {{ copy.chapter.singular.toLowerCase() }} and paste prose in Studio · Script.
        </p>
        <div style="display:flex; gap:8px; margin-top:12px">
          <UiButton intent="primary" label="⬆ Import a manuscript…" @click="startImport" />
          <UiButton intent="secondary" :label="`＋ Add ${copy.chapter.singular.toLowerCase()}`" @click="addChapter" />
        </div>
      </div>
    </template>

    <!-- ── No project banner ───────────────────────────────────────────── -->
    <EmptyState
      v-if="!selectedProjectId"
      icon="Sparkle"
      :title="`No ${copy.book.singular.toLowerCase()} selected`"
      :message="`Import a manuscript (JustWrite / CSV / SRT / Audacity labels / JustVoice JSON) or create a blank one to start.`"
      :action-label="`Open ${copy.book.plural}`"
      compact
      @action="goProjects"
    />

    <!-- ── Back to the chapter list (detail mode) ─────────────────────── -->
    <div v-if="viewMode === 'detail' && selectedProjectId" class="chapter-view__backbar">
      <UiButton intent="ghost" size="small" :label="`← All ${copy.chapter.plural.toLowerCase()}`" @click="backToList" />
      <span class="jv-spacer" />
      <!-- Podcast journey (mock): rendered segments land on the Timeline
           — music bed + stingers get arranged there. -->
      <UiButton
        v-if="selectedProjectRec?.project_type === 'podcast'"
        intent="secondary"
        size="small"
        label="Open Timeline ➜"
        title="Arrange rendered segments with music beds and stingers on the multi-track Timeline"
        @click="goTimeline"
      />
    </div>

    <!-- ── No blocks yet ──────────────────────────────────────────────── -->
    <div
      v-if="viewMode === 'detail' && selectedProjectId && selectedSceneId && blocks.length === 0"
      class="jv-banner"
    >
      <div style="margin-bottom:8px">
        This {{ copy.chapter.singular.toLowerCase() }} has no {{ copy.line.plural.toLowerCase() }} yet.
        Paste its text below (paragraphs become blocks, narrator-implied — assign
        speakers later in <a href="#studio">Studio · Script</a>), or run attribution there directly.
      </div>
      <UiTextarea v-model="pasteText" :rows="8" :placeholder="`Paste the ${copy.chapter.singular.toLowerCase()} text…`" style="width:100%" />
      <div style="margin-top:8px">
        <UiButton intent="primary" size="small" :loading="pasteBusy" :disabled="pasteBusy || !pasteText.trim()" label="Add as blocks" @click="savePastedText" />
      </div>
    </div>

    <!-- ── Block list ─────────────────────────────────────────────────── -->
    <div v-if="viewMode === 'detail' && blocks.length" class="jv-section">
      <div
        v-for="block in blocks"
        :key="block.id"
        class="jv-card chapter-view__block"
      >
        <!-- Block header: position + persona -->
        <div class="chapter-view__block-header">
          <span class="chapter-view__block-num">{{ block.position + 1 }}</span>
          <UiTag intent="success" v-if="block.persona_id">{{ personaName(block.persona_id) }}</UiTag>
          <UiTag
            v-else-if="block.metadata?.marker"
            intent="ghost"
            title="Music / ad direction line from the import — no speaker, renders as silence or gets replaced on the Timeline"
          >♪ marker</UiTag>
          <UiChip
            v-if="!block.metadata?.marker"
            class="chapter__direction"
            :selected="!!block.direction"
            :title="block.direction ? 'Edit the performance note for this line' : 'Add a performance note — instruct-capable engines perform it (e.g. weary, almost whispering)'"
            @click="editDirection(block)"
          >{{ block.direction || "＋ direction" }}</UiChip>
          <span class="jv-spacer" />
          <UiChip
            title="Edit this line's text in place — the next render regenerates only this line"
            @click="startEditBlock(block)"
          >✎ Edit text</UiChip>
          <UiChip
            class="chapter-view__fixit"
            title="Heard a mispronunciation in this line? Send the word to Lexicons — only lines containing it re-render."
            @click="flagPronunciation(block)"
          >🔤 Fix pronunciation</UiChip>
        </div>

        <!-- Block text — read view, or in-place editor. -->
        <p v-if="editingBlockId !== block.id" class="chapter-view__block-text" :class="{ 'chapter-view__block-text--marker': block.metadata?.marker }"><template v-for="(part, pi) in tagParts(block.text)" :key="pi"><span v-if="part.tag" class="chapter__tag">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></p>
        <div v-else class="chapter-view__block-edit">
          <UiTextarea v-model="editingText" :rows="4" @keydown.escape="editingBlockId = null" />
          <div class="chapter-view__block-edit-actions">
            <UiButton intent="primary" size="small" label="Save" :loading="editSaveBusy" :disabled="editSaveBusy || !editingText.trim()" @click="saveBlockText(block)" />
            <UiButton intent="ghost" size="small" label="Cancel" @click="editingBlockId = null" />
            <span class="jv-muted" style="font-size:11.5px">Existing takes keep the old audio; the next render uses this text.</span>
          </div>
        </div>

        <!-- Takes area -->
        <div v-if="takesStore.loaded.has(block.id)" class="chapter-view__takes">
          <div
            v-if="getBlockTakes(block.id).length === 0"
            class="chapter-view__no-takes"
          >
            <!-- First-render affordance (G1): the Regenerate button below
                 only exists once takes do, so the empty state used to name
                 an action with no button. Same handler — it resolves the
                 cast voice (or asks) and renders the first take. -->
            <UiButton
              intent="primary"
              size="small"
              label="▶ Generate first take"
              :loading="regenBusy.get(block.id)"
              @click="regenerateBlock(block)"
            />
            <span class="jv-muted" style="font-size:12px">
              No takes yet — generate this {{ copy.line.singular }} to hear it.
            </span>
          </div>

          <template v-else>
            <!-- ── Take navigator ─────────────────────────────────────── -->
            <div class="chapter-view__take-nav">
              <button
                class="chapter-view__nav-arrow"
                :disabled="getActiveTakeIndex(block.id) >= getBlockTakes(block.id).length - 1"
                @click="takesStore.navigatePrev(block.id)"
                title="Older take"
              >&#8592;</button>

              <span class="chapter-view__take-counter">
                Take {{ getBlockTakes(block.id).length - getActiveTakeIndex(block.id) }}
                of {{ getBlockTakes(block.id).length }}
              </span>

              <button
                class="chapter-view__nav-arrow"
                :disabled="getActiveTakeIndex(block.id) <= 0"
                @click="takesStore.navigateNext(block.id)"
                title="Newer take"
              >&#8594;</button>

              <!-- Take dropdown -->
              <JvSelect
                class="chapter-view__take-select"
                :model-value="takesStore.getActiveTakeId(block.id)"
                :options="takeDropdownOptions(block.id)"
                @update:model-value="(id) => takesStore.setActiveTakeId(block.id, id)"
              />

              <!-- Default badge -->
              <UiTag
                v-if="getActiveTake(block.id)?.is_default"
                intent="success"
                label="default"
              />

              <!-- Lineage pill — click opens the full source-chain viewer -->
              <UiChip
                v-if="sourceTakeLabel(getActiveTake(block.id), block.id)"
                class="chapter-view__lineage chapter-view__lineage--btn"
                title="View full take lineage"
                @click="lineageTakeId = getActiveTake(block.id).id"
              >{{ sourceTakeLabel(getActiveTake(block.id), block.id) }}</UiChip>
            </div>

            <!-- ── Audio playback ─────────────────────────────────────── -->
            <div v-if="getActiveTake(block.id)?.generation_id" class="chapter-view__audio-row">
              <audio
                :src="audioUrl(getActiveTake(block.id))"
                :key="getActiveTake(block.id).id"
                controls
                class="chapter-view__audio"
              />
            </div>
            <div v-else class="chapter-view__no-audio jv-muted">
              No audio for this take.
            </div>

            <!-- ── Compare panel ──────────────────────────────────────── -->
            <div v-if="compareBlockId === block.id" class="chapter-view__compare">
              <div class="chapter-view__compare-header">
                <strong>Compare takes</strong>
                <button
                  class="chapter-view__compare-close"
                  @click="compareBlockId = null"
                >✕</button>
              </div>

              <div class="chapter-view__compare-grid">
                <!-- A-side: active take -->
                <div class="chapter-view__compare-side">
                  <div class="chapter-view__compare-label">
                    Take A (active)
                    <UiTag
                      v-if="getActiveTake(block.id)?.is_default"
                      intent="success" label="default" class="chapter-view__compare-tag"
                    />
                  </div>
                  <audio
                    v-if="getActiveTake(block.id)?.generation_id"
                    :src="audioUrl(getActiveTake(block.id))"
                    :key="'cmp-a-' + getActiveTake(block.id).id"
                    controls
                    class="chapter-view__audio"
                  />
                </div>

                <!-- B-side: user picks -->
                <div class="chapter-view__compare-side">
                  <div class="chapter-view__compare-label">Take B</div>
                  <JvSelect
                    :model-value="compareSecondaryIds.get(block.id) || ''"
                    :options="compareDropdownOptions(block.id)"
                    placeholder="Pick a take to compare…"
                    @update:model-value="(id) => compareSecondaryIds.set(block.id, id)"
                  />
                  <audio
                    v-if="compareTakeB(block.id)?.generation_id"
                    :src="audioUrl(compareTakeB(block.id))"
                    :key="'cmp-b-' + compareTakeB(block.id).id"
                    controls
                    class="chapter-view__audio"
                    style="margin-top: 8px"
                  />
                </div>
              </div>

              <!-- Promote B to default from the compare panel -->
              <div v-if="compareTakeB(block.id)" class="chapter-view__compare-actions">
                <UiButton
                  intent="secondary"
                  size="small"
                  label="Use Take B as default"
                  :loading="promoteBusy.has(compareTakeB(block.id).id)"
                  @click="promoteToDefault(compareTakeB(block.id).id, block.id)"
                />
              </div>
            </div>

            <!-- ── Action row ─────────────────────────────────────────── -->
            <div class="chapter-view__actions">
              <!-- Regenerate -->
              <UiButton
                intent="primary"
                size="small"
                label="Regenerate"
                :loading="regenBusy.get(block.id)"
                :disabled="!regenVoice"
                @click="regenerateBlock(block)"
              />

              <!-- Set as default -->
              <UiButton
                v-if="getActiveTake(block.id) && !getActiveTake(block.id).is_default"
                intent="secondary"
                size="small"
                label="Set as default"
                :loading="promoteBusy.has(getActiveTake(block.id).id)"
                @click="promoteToDefault(getActiveTake(block.id).id, block.id)"
              />

              <!-- Compare -->
              <UiButton
                intent="ghost"
                size="small"
                :label="compareBlockId === block.id ? 'Hide compare' : 'Compare'"
                :disabled="getBlockTakes(block.id).length < 2"
                @click="toggleCompare(block.id)"
              />

              <!-- Delete (two-step) -->
              <template v-if="getActiveTake(block.id) && !getActiveTake(block.id).is_default">
                <template v-if="deletePending.has(getActiveTake(block.id).id)">
                  <span class="chapter-view__confirm-label">Delete this take?</span>
                  <UiButton
                    intent="danger"
                    size="small"
                    label="Yes, delete"
                    :loading="deleteBusy.has(getActiveTake(block.id).id)"
                    @click="confirmDeleteTake(getActiveTake(block.id).id, block.id)"
                  />
                  <UiButton
                    intent="ghost"
                    size="small"
                    label="Cancel"
                    @click="cancelDeleteTake(getActiveTake(block.id).id)"
                  />
                </template>
                <UiButton
                  v-else
                  intent="danger-outline"
                  size="small"
                  label="Delete take"
                  @click="requestDeleteTake(getActiveTake(block.id).id)"
                />
              </template>
            </div>
          </template>
        </div>

        <!-- Loading takes indicator -->
        <div v-else class="chapter-view__takes-loading jv-muted">
          Loading takes…
        </div>
      </div>
    </div>

  </div>
  <LineageViewer
    :take-id="lineageTakeId"
    :open="lineageTakeId != null"
    @close="lineageTakeId = null"
  />
</template>

<style scoped>
/* ── Block card ──────────────────────────────────────────────────────────── */
.chapter-view__block {
  margin-bottom: 16px;
}

.chapter-view__block-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.chapter-view__block-num {
  font-size: 11px;
  font-weight: 700;
  color: var(--ink-3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  min-width: 20px;
}

.chapter-view__block-text--marker {
  color: var(--ink-3);
  font-style: italic;
  background: transparent;
}

.chapter-view__block-edit { display: flex; flex-direction: column; gap: 8px; }
.chapter-view__block-edit textarea { line-height: 1.6; font-size: 14px; resize: vertical; }
.chapter-view__block-edit-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

.chapter-view__block-text {
  color: var(--ink);
  line-height: 1.6;
  font-size: 14px;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: var(--surface-3);
  border-radius: var(--r-md);
  border-left: 3px solid var(--line-strong);
}

/* ── Takes area ──────────────────────────────────────────────────────────── */
.chapter-view__takes {
  border-top: 1px solid var(--line);
  padding-top: 12px;
}

.chapter-view__takes-loading {
  border-top: 1px solid var(--line);
  padding-top: 8px;
  font-size: 12px;
}

.chapter-view__no-takes {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink-3);
  font-size: 13px;
  padding: 4px 0;
}

/* ── Take navigator ──────────────────────────────────────────────────────── */
.chapter-view__take-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
}

.chapter-view__nav-arrow {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: var(--r-md);
  cursor: pointer;
  font-size: 14px;
  color: var(--ink-2);
  transition: background 0.12s, color 0.12s;
  flex-shrink: 0;
}
.chapter-view__nav-arrow:hover:not(:disabled) {
  background: var(--accent-soft);
  color: var(--accent);
  border-color: var(--accent-line);
}
.chapter-view__nav-arrow:disabled {
  opacity: 0.35;
  cursor: default;
}

.chapter-view__take-counter {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink-2);
  white-space: nowrap;
}

.chapter-view__take-select {
  min-width: 200px;
  max-width: 340px;
}

.chapter-view__lineage--btn { cursor: pointer; font: inherit; }
.chapter-view__lineage--btn:hover { border-color: var(--accent); color: var(--accent); }
.chapter-view__lineage {
  font-size: 11px;
  background: var(--warn-bg);
  color: var(--warn-ink);
  border: 1px solid var(--warn-line);
}

/* ── Audio playback ──────────────────────────────────────────────────────── */
.chapter-view__audio-row {
  margin-bottom: 10px;
}

.chapter-view__audio {
  width: 100%;
  height: 36px;
}

.chapter-view__no-audio {
  font-size: 12px;
  font-style: italic;
  padding: 4px 0 8px;
}

/* ── Actions row ─────────────────────────────────────────────────────────── */
.chapter-view__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 4px;
}

.chapter-view__confirm-label {
  font-size: 12px;
  color: var(--danger-ink);
  font-weight: 600;
}

/* ── Compare panel ───────────────────────────────────────────────────────── */
.chapter-view__compare {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-lg);
  padding: 14px;
  margin-bottom: 12px;
}

.chapter-view__compare-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  font-size: 13px;
  color: var(--ink);
}

.chapter-view__compare-close {
  background: none;
  border: none;
  cursor: pointer;
  color: var(--ink-3);
  font-size: 14px;
  padding: 2px 6px;
  border-radius: var(--r-sm);
}
.chapter-view__compare-close:hover {
  background: var(--surface-3);
  color: var(--ink);
}

.chapter-view__compare-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

.chapter-view__compare-side {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.chapter-view__compare-label {
  font-size: 11px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--ink-3);
  display: flex;
  align-items: center;
  gap: 6px;
}

.chapter-view__compare-tag {
  text-transform: none;
  letter-spacing: 0;
}

.chapter-view__compare-actions {
  margin-top: 12px;
  border-top: 1px solid var(--line);
  padding-top: 10px;
  display: flex;
  gap: 8px;
}
.chapter__tag {
  font-family: var(--font-mono);
  font-size: 0.85em;
  background: var(--info-soft, #eaf2fa);
  color: var(--info-blue, #2f74b5);
  border-radius: 4px;
  padding: 0 4px;
}
.chapter__direction { cursor: pointer; border-style: dashed; font: inherit; font-size: 11px; }

.chapter-view__export { display: flex; gap: 12px; align-items: stretch; margin-bottom: 14px; }
.chapter-view__export-card { flex: 1; padding: 14px 16px; margin: 0; }
.chapter-view__export-h { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
.chapter-view__export-id { display: flex; gap: 12px; align-items: center; margin-bottom: 12px; }
.chapter-view__export-portrait {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 20px; font-weight: 700; flex: none;
}
.chapter-view__export-name { font-size: 17px; font-weight: 700; }
.chapter-view__sum-row {
  display: flex; justify-content: space-between; gap: 14px;
  font-size: 12px; padding: 6px 0; border-bottom: 1px dashed var(--line);
}
.chapter-view__sum-row span { color: var(--ink-3); flex: none; }
.chapter-view__sum-row b { font-weight: 600; text-align: right; }
.chapter-view__export-actions { display: flex; gap: 8px; margin-top: 14px; }
.chapter-view__ckl { list-style: none; margin: 0; padding: 0; font-size: 12.5px; }
.chapter-view__ckl li { display: flex; gap: 8px; align-items: baseline; padding: 4px 0; }
.chapter-view__ckl .ok { color: var(--accent); font-weight: 700; }
.chapter-view__ckl .bad { color: var(--danger); font-weight: 700; }
.chapter-view__ckl .dim { color: var(--ink-3); }

.chapter-view__lede { font-size: 13px; margin: 0 0 4px; }
.chapter-view__list-toolbar { display: flex; gap: 8px; align-items: center; margin: 4px 0 10px; flex-wrap: wrap; }
.chapter-view__list-row { cursor: pointer; }
.chapter-view__list-row:hover td { background: var(--surface-2); }
.chapter-view__num { text-align: right; }
.chapter-view__backbar { margin-bottom: 8px; }

.chapter-view__flow { display: flex; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
.chapter-view__flow-step {
  appearance: none; font: inherit; cursor: pointer; text-align: left;
  display: flex; flex-direction: column; gap: 1px;
  border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); padding: 7px 14px;
}
.chapter-view__flow-step:hover { border-color: var(--accent-line); }
.chapter-view__flow-step--done { border-color: var(--accent-line); background: var(--accent-soft); }
.chapter-view__flow-label { font-size: 12px; font-weight: 700; color: var(--ink-2); }
.chapter-view__flow-step--done .chapter-view__flow-label { color: var(--accent-ink); }
.chapter-view__flow-sub { font-size: 10.5px; color: var(--ink-3); }
.chapter-view__no-chapters {
  border: 1px dashed var(--line-strong); border-radius: 10px;
  padding: 22px 24px; background: var(--surface); margin-top: 4px;
}
.chapter-view__no-chapters h4 { margin: 0 0 6px; font-size: 14px; }
.chapter-view__no-chapters p { margin: 0; font-size: 12.5px; line-height: 1.6; max-width: 640px; }

</style>
