<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useTakesStore } from "../stores/takes.js";
import { pushToast } from "../services/toastBridge.js";
import { promptDialog } from "../services/dialog.js";
import { projectsService } from "../services/projects.js";
import { useCopy } from "../services/copy.js";
import { useUiContext } from "../stores/uiContext.js";
import { useActiveProject } from "../stores/activeProject.js";
import JvButton from "../components/jv/JvButton.vue";
import LineageViewer from "../components/LineageViewer.vue";
import EmptyState from "../components/EmptyState.vue";
import JvField from "../components/jv/JvField.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvTag from "../components/jv/JvTag.vue";

const api = useApi();
const activeProject = useActiveProject();
const tasks = useRenderTasks();
const takesStore = useTakesStore();
// Per-use-case terminology (plan locked decision #7 / Slice 5). Audiobook
// users see "Chapter / Line"; game devs see "Scene / Voiceline"; podcasters
// see "Segment / Block"; etc. Driven by the onboarding primary use case.
const copy = useCopy();

// ── Project / scene / block selection ──────────────────────────────────────

const projects = ref([]);
const scenes = ref([]);
const personasById = ref({});
async function loadPersonas() {
  try {
    const r = await api.safeRequest("/v1/personas", { personas: [] });
    personasById.value = Object.fromEntries((r?.personas || []).map((p) => [p.id, p.name]));
  } catch { /* tolerated */ }
}
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
  let m;
  while ((m = re.exec(text || "")) !== null) {
    if (m.index > last) out.push({ tag: false, text: text.slice(last, m.index) });
    out.push({ tag: true, text: m[0] });
    last = m.index + m[0].length;
  }
  if (last < (text || "").length) out.push({ tag: false, text: text.slice(last) });
  return out.length ? out : [{ tag: false, text: text || "" }];
}
const blocks = ref([]);
const selectedProjectId = ref(null);
const selectedSceneId = ref(null);

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

async function loadProjects() {
  try {
    const res = await projectsService.list();
    projects.value = res.projects || [];
    if (projects.value.length && !selectedProjectId.value) {
      const prefer = projects.value.find((p) => p.id === activeProject.id);
      selectedProjectId.value = (prefer || projects.value[0]).id;
    }
  } catch (e) {
    pushToast({ message: `Failed to load projects: ${e.message || e}`, kind: "error" });
  }
}

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
      selectedSceneId.value = scenes.value[0].id;
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

// Breadcrumb publishing — Chapter › [Project] › [Scene]
const uiContext = useUiContext();
function publishCrumbs() {
  const segments = [];
  const project = projects.value.find((p) => p.id === selectedProjectId.value);
  if (project) segments.push({ label: project.name, href: "#books" });
  const scene = scenes.value.find((s) => s.id === selectedSceneId.value);
  if (scene) segments.push({ label: scene.title || `Chapter ${scene.position + 1}` });
  uiContext.set(segments);
}
watch([selectedProjectId, selectedSceneId, projects, scenes], publishCrumbs);

onMounted(() => { loadProjects(); loadPersonas(); });

// ── Voices (for re-generation) ─────────────────────────────────────────────

const voices = ref([]);
const currentEngine = ref(null);

async function refreshVoices() {
  try {
    const [v, cur] = await Promise.all([
      api.request("/v1/voices"),
      api.request("/v1/engines/current").catch(() => ({ engine: null })),
    ]);
    voices.value = v.voices || [];
    currentEngine.value = cur?.engine || null;
  } catch (_) {}
}

onMounted(refreshVoices);

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
const llmRewrite = ref(false);
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
  const voice = regenVoice.value;
  if (!voice) {
    pushToast({ message: "Select a voice before regenerating.", kind: "warn" });
    return;
  }
  regenBusy.value.set(block.id, true);
  const task = tasks.start({
    label: `Regen block · ${block.text.slice(0, 40)}…`,
    kind: "chapter",
    statsFn: () => ["1 block"],
    onCancel: () => {},
  });
  try {
    // Render the block text as a single line.
    const blob = await api.request("/v1/render_chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: [{ voice, text: block.text }],
        between_lines: { silence_ms: 0 },
      }),
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
const exportOpen = ref(false);
const exportQc = ref(null);
const exportQcBusy = ref(false);
const exportBusy = ref("");

const selectedProjectRec = computed(() =>
  projects.value.find((p) => p.id === selectedProjectId.value) || null,
);

async function runExportQc() {
  if (!selectedProjectId.value || exportQcBusy.value) return;
  exportQcBusy.value = true;
  exportQc.value = null;
  try {
    exportQc.value = await api.request(`/v1/projects/${selectedProjectId.value}/qc`);
  } catch (e) {
    pushToast({ message: `QC failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  } finally {
    exportQcBusy.value = false;
  }
}

const qcDurationLabel = computed(() => {
  const total = (exportQc.value?.chapters || []).reduce((s, c) => s + (c.duration_s || 0), 0);
  if (!total) return "";
  const h = Math.floor(total / 3600), m = Math.round((total % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} m` : `${m} m`;
});

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function exportM4B() {
  const p = selectedProjectRec.value;
  if (!p || exportBusy.value) return;
  exportBusy.value = "m4b";
  pushToast({ message: "Export M4B — rendering anything not cached, then muxing chapters…", kind: "info" });
  try {
    const blob = await api.requestBlob("POST", `/v1/projects/${p.id}/export_m4b`);
    saveBlob(blob, `${(p.name || "book").replace(/[^\w.-]+/g, "_")}.m4b`);
    pushToast({ message: "M4B exported.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Export failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  } finally {
    exportBusy.value = "";
  }
}

async function exportChapterWavs() {
  const p = selectedProjectRec.value;
  if (!p || exportBusy.value) return;
  exportBusy.value = "zip";
  pushToast({ message: "Packaging per-chapter audio…", kind: "info" });
  try {
    const blob = await projectsService.exportZip(p.id, { includeAudio: true, includeMasters: true });
    saveBlob(blob, `${(p.name || "book").replace(/[^\w.-]+/g, "_")}.zip`);
    pushToast({ message: "Chapter package exported.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Export failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  } finally {
    exportBusy.value = "";
  }
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
      const attributed = blocks.length > 0 && blocks.every((b) => !!b.persona_id);
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
  if (!st || !st.blocks) return { cls: "jv-pill--ghost", label: "not analyzed" };
  return st.attributed
    ? { cls: "jv-pill--green", label: "attributed" }
    : { cls: "jv-pill--warn", label: "unassigned speakers" };
}
function renderState(id) {
  const c = sceneCache.value[id];
  if (!c || !c.total) return { cls: "jv-pill--ghost", label: "—" };
  if (c.cached === c.total) return { cls: "jv-pill--green", label: "✓ cached" };
  if (c.cached > 0) return { cls: "jv-pill--accent", label: `${c.cached}/${c.total} cached` };
  return { cls: "jv-pill--ghost", label: "—" };
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
</script>

<template>
  <div class="chapter-view">

    <!-- ── Project / scene selectors ───────────────────────────────────── -->
    <div class="jv-section">
      <h3 class="jv-section__title">{{ copy.chapter.singular }} view</h3>

      <div class="jv-card chapter-view__selectors">
        <JvField :label="copy.book.singular" layout="inline">
          <JvSelect
            v-model="selectedProjectId"
            :options="projectOptions"
            :placeholder="`Select a ${copy.book.singular.toLowerCase()}…`"
            width="name"
          />
        </JvField>
        <JvField :label="copy.chapter.singular" layout="inline">
          <JvSelect
            v-model="selectedSceneId"
            :options="sceneOptions"
            :disabled="!selectedProjectId || !scenes.length"
            :placeholder="`Select a ${copy.chapter.singular.toLowerCase()}…`"
            width="name"
          />
        </JvField>
        <JvField label="Voice for re-generate" layout="inline">
          <JvSelect
            v-model="regenVoice"
            :options="voiceOptions"
            :disabled="availableVoices.length === 0"
            width="name"
          />
        </JvField>
        <span class="jv-spacer" />
        <JvButton
          variant="secondary"
          size="sm"
          :label="exportOpen ? '✕ Close export' : '⬇ Export'"
          :disabled="!selectedProjectId"
          title="Package the whole project — M4B with chapter markers, per-chapter audio, ACX checklist"
          @click="exportOpen = !exportOpen; exportOpen && !exportQc && runExportQc()"
        />
      </div>
    </div>

    <!-- ── Export panel (package + ACX checklist) ─────────────────────── -->
    <div v-if="exportOpen && selectedProjectRec" class="chapter-view__export">
      <div class="jv-card chapter-view__export-card">
        <div class="chapter-view__export-h">
          <strong>{{ copy.book.singular }} package</strong>
          <span class="jv-pill" :class="exportQc?.all_ok ? 'jv-pill--green' : 'jv-pill--ghost'">{{ exportQc?.all_ok ? "ready" : "unchecked" }}</span>
        </div>
        <div class="chapter-view__export-id">
          <span class="chapter-view__export-portrait">{{ (selectedProjectRec.name || "?").slice(0, 1).toUpperCase() }}</span>
          <div>
            <div class="chapter-view__export-name">{{ selectedProjectRec.name }}</div>
            <div class="jv-muted" style="font-size:12px">
              {{ scenes.length }} {{ copy.chapter.plural.toLowerCase() }}<template v-if="qcDurationLabel"> · {{ qcDurationLabel }}</template>
            </div>
          </div>
        </div>
        <div class="chapter-view__sum-row"><span>Format</span><b>M4B (AAC) · chapter markers from {{ copy.chapter.singular.toLowerCase() }} titles</b></div>
        <div class="chapter-view__sum-row"><span>Also export</span><b>per-{{ copy.chapter.singular.toLowerCase() }} WAV + masters (zip)</b></div>
        <div class="chapter-view__sum-row"><span>Master</span><b>{{ selectedProjectRec.mastering_preset || (selectedProjectRec.project_type === "audiobook" ? "ACX −20 LUFS" : "default") }}</b></div>
        <div class="chapter-view__export-actions">
          <JvButton variant="primary" :loading="exportBusy === 'm4b'" :disabled="!!exportBusy" label="⬇ Export M4B" @click="exportM4B" />
          <JvButton variant="secondary" :loading="exportBusy === 'zip'" :disabled="!!exportBusy" :label="`⬇ ${copy.chapter.singular} WAVs (zip)`" @click="exportChapterWavs" />
        </div>
      </div>

      <div class="jv-card chapter-view__export-card">
        <div class="chapter-view__export-h">
          <strong>ACX checklist</strong>
          <span class="jv-spacer" />
          <JvButton variant="ghost" size="sm" :loading="exportQcBusy" label="↻ Re-check" title="Render every chapter (cache-served when unchanged) and measure against the ACX limits" @click="runExportQc" />
        </div>
        <p v-if="exportQcBusy" class="jv-muted">Rendering + measuring {{ copy.chapter.plural.toLowerCase() }} — cached audio makes this fast…</p>
        <template v-else-if="exportQc">
          <ul class="chapter-view__ckl">
            <li><span :class="exportQc.chapters.every(c => c.rms_ok) ? 'ok' : 'bad'">{{ exportQc.chapters.every(c => c.rms_ok) ? "✓" : "✗" }}</span>
              RMS between −23 dB and −18 dB ({{ exportQc.chapters.filter(c => c.rms_ok).length }} of {{ exportQc.chapters.length }} {{ copy.chapter.plural.toLowerCase() }})</li>
            <li><span :class="exportQc.chapters.every(c => c.peak_ok) ? 'ok' : 'bad'">{{ exportQc.chapters.every(c => c.peak_ok) ? "✓" : "✗" }}</span>
              Peak ≤ −3 dB</li>
            <li><span class="dim">○</span> Noise floor ≤ −60 dB RMS <span class="jv-muted">— not measured yet (needs room-tone analysis)</span></li>
            <li><span class="dim">○</span> Room tone head/tail <span class="jv-muted">— not measured yet</span></li>
            <li><span class="dim">○</span> Opening & closing credits <span class="jv-muted">— add as {{ copy.chapter.plural.toLowerCase() }}</span></li>
          </ul>
          <div class="jv-banner" :class="exportQc.all_ok ? 'jv-banner--info' : 'jv-banner--warn'" style="margin-top:10px;font-size:12px">
            {{ exportQc.all_ok
              ? "Measured checks pass. Mastering chain: project preset — duplicate under Render Presets to tweak."
              : "Some chapters are out of spec — fix levels in Studio · Render, then re-check." }}
          </div>
        </template>
        <p v-else class="jv-muted">Run the check to measure every {{ copy.chapter.singular.toLowerCase() }} against the ACX limits.</p>
      </div>
    </div>

    <!-- ── Chapters home base — per-chapter status table (mock step 3) ── -->
    <template v-if="viewMode === 'list' && selectedProjectId">
      <p class="chapter-view__lede jv-muted">
        Each {{ copy.chapter.singular.toLowerCase() }} moves independently through
        <strong>cast → script → render</strong>. Open one to read it, or send the whole
        {{ copy.book.singular.toLowerCase() }} to Studio.
      </p>
      <div class="chapter-view__list-toolbar">
        <input v-model="chapterFilter" class="jv-input jv-input--sm" style="max-width:260px" :placeholder="`Filter ${copy.chapter.plural.toLowerCase()}…`" />
        <button v-for="c in [['all','All'],['needs-script','Needs script'],['ready','Ready'],['rendered','Rendered']]" :key="c[0]"
          type="button" class="jv-pill" :class="chapterChip === c[0] ? 'jv-pill--solid' : 'jv-pill--ghost'"
          :title="c[0]==='needs-script' ? 'Chapters with unattributed or missing blocks' : c[0]==='rendered' ? 'Fully cached — re-render is free' : ''"
          @click="chapterChip = c[0]">{{ c[1] }}</button>
        <span class="jv-spacer" />
        <JvButton variant="secondary" size="sm" :label="`＋ Add ${copy.chapter.singular.toLowerCase()}`" @click="addChapter" />
        <JvButton variant="primary" size="sm" label="Open in Studio ➜" title="Cast → Script → Render for the whole project" @click="openInStudio" />
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
            <td><span class="jv-pill" :class="scriptState(sc.id).cls">{{ scriptState(sc.id).label }}</span></td>
            <td><span class="jv-pill" :class="renderState(sc.id).cls">{{ renderState(sc.id).label }}</span></td>
            <td style="text-align:right"><JvButton variant="ghost" size="sm" label="Open" @click.stop="openChapter(sc)" /></td>
          </tr>
          <tr v-if="!filteredScenes.length"><td colspan="6" class="jv-muted" style="padding:14px">No {{ copy.chapter.plural.toLowerCase() }} match.</td></tr>
        </tbody>
      </table>
    </template>

    <!-- ── No project banner ───────────────────────────────────────────── -->
    <EmptyState
      v-if="!selectedProjectId"
      icon="Sparkle"
      :title="`No ${copy.book.singular.toLowerCase()} selected`"
      :message="`Import a manuscript (JustWrite / CSV / SRT / Audacity labels / JustVoice JSON) or create a blank one to start.`"
      :action-label="`Open ${copy.book.plural}`"
      compact
      @action="(typeof window !== 'undefined') && (window.location.hash = '#books')"
    />

    <!-- ── Back to the chapter list (detail mode) ─────────────────────── -->
    <div v-if="viewMode === 'detail' && selectedProjectId" class="chapter-view__backbar">
      <JvButton variant="ghost" size="sm" :label="`← All ${copy.chapter.plural.toLowerCase()}`" @click="backToList" />
    </div>

    <!-- ── No blocks yet ──────────────────────────────────────────────── -->
    <div
      v-if="viewMode === 'detail' && selectedProjectId && selectedSceneId && blocks.length === 0"
      class="jv-banner"
    >
      This {{ copy.chapter.singular.toLowerCase() }} has no {{ copy.line.plural.toLowerCase() }} yet.
      Open <a href="#studio">Studio → Script tab</a> to paste prose and run speaker attribution.
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
          <span v-if="block.persona_id" class="jv-pill jv-pill--green">{{ personaName(block.persona_id) }}</span>
          <button
            type="button"
            class="jv-pill chapter__direction"
            :class="block.direction ? 'jv-pill--warn' : 'jv-pill--ghost'"
            :title="block.direction ? 'Edit the performance note for this line' : 'Add a performance note — instruct-capable engines perform it (e.g. weary, almost whispering)'"
            @click="editDirection(block)"
          >{{ block.direction || "＋ direction" }}</button>
          <span class="jv-spacer" />
          <button
            type="button"
            class="jv-pill jv-pill--ghost chapter-view__fixit"
            title="Heard a mispronunciation in this line? Send the word to Lexicons — only lines containing it re-render."
            @click="flagPronunciation(block)"
          >🔤 Fix pronunciation</button>
        </div>

        <!-- Block text (read-only) -->
        <p class="chapter-view__block-text"><template v-for="(part, pi) in tagParts(block.text)" :key="pi"><span v-if="part.tag" class="chapter__tag">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></p>

        <!-- Takes area -->
        <div v-if="takesStore.loaded.has(block.id)" class="chapter-view__takes">
          <div
            v-if="getBlockTakes(block.id).length === 0"
            class="chapter-view__no-takes"
          >
            No takes yet — click Regenerate to create the first one.
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
              <JvTag
                v-if="getActiveTake(block.id)?.is_default"
                variant="success"
                label="default"
              />

              <!-- Lineage pill — click opens the full source-chain viewer -->
              <button
                v-if="sourceTakeLabel(getActiveTake(block.id), block.id)"
                type="button"
                class="jv-pill chapter-view__lineage chapter-view__lineage--btn"
                title="View full take lineage"
                @click="lineageTakeId = getActiveTake(block.id).id"
              >{{ sourceTakeLabel(getActiveTake(block.id), block.id) }}</button>
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
                    <JvTag
                      v-if="getActiveTake(block.id)?.is_default"
                      variant="success" label="default" class="chapter-view__compare-tag"
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
                <JvButton
                  variant="secondary"
                  size="sm"
                  label="Use Take B as default"
                  :loading="promoteBusy.has(compareTakeB(block.id).id)"
                  @click="promoteToDefault(compareTakeB(block.id).id, block.id)"
                />
              </div>
            </div>

            <!-- ── Action row ─────────────────────────────────────────── -->
            <div class="chapter-view__actions">
              <!-- Regenerate -->
              <JvButton
                variant="primary"
                size="sm"
                label="Regenerate"
                :loading="regenBusy.get(block.id)"
                :disabled="!regenVoice"
                @click="regenerateBlock(block)"
              />

              <!-- Set as default -->
              <JvButton
                v-if="getActiveTake(block.id) && !getActiveTake(block.id).is_default"
                variant="secondary"
                size="sm"
                label="Set as default"
                :loading="promoteBusy.has(getActiveTake(block.id).id)"
                @click="promoteToDefault(getActiveTake(block.id).id, block.id)"
              />

              <!-- Compare -->
              <JvButton
                variant="ghost"
                size="sm"
                :label="compareBlockId === block.id ? 'Hide compare' : 'Compare'"
                :disabled="getBlockTakes(block.id).length < 2"
                @click="toggleCompare(block.id)"
              />

              <!-- Delete (two-step) -->
              <template v-if="getActiveTake(block.id) && !getActiveTake(block.id).is_default">
                <template v-if="deletePending.has(getActiveTake(block.id).id)">
                  <span class="chapter-view__confirm-label">Delete this take?</span>
                  <JvButton
                    variant="danger"
                    size="sm"
                    label="Yes, delete"
                    :loading="deleteBusy.has(getActiveTake(block.id).id)"
                    @click="confirmDeleteTake(getActiveTake(block.id).id, block.id)"
                  />
                  <JvButton
                    variant="ghost"
                    size="sm"
                    label="Cancel"
                    @click="cancelDeleteTake(getActiveTake(block.id).id)"
                  />
                </template>
                <JvButton
                  v-else
                  variant="danger-outline"
                  size="sm"
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

    <!-- ── Floating generate bar (preview lines 791-798) ──
         Pinned at bottom of the chapter editor. Shows the active voice +
         engine + effects + LLM-rewrite toggle. The lede above promises
         this. "Render block" button is disabled until a block is selected;
         once block-selection state exists (#87 follow-on) this renders the
         active block. -->
    <div v-if="viewMode === 'detail' && blocks.length" class="jv-floating chapter-view__generate-bar">
      <div class="jv-chip-card">🎙️
        <strong>{{ availableVoices.find((v) => v.id === regenVoice)?.name || regenVoice || "no voice" }}</strong>
        <select v-model="regenVoice" :disabled="!availableVoices.length" class="chapter-view__chip-select">
          <option v-for="o in voiceOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
      </div>
      <div class="jv-chip-card">🧠
        <strong>{{ currentEngine?.name || "no engine" }}</strong>
      </div>
      <div class="jv-chip-card">🎛️ Effects: <strong>none</strong> <span class="muted">▾</span></div>
      <label class="jv-chip-card">
        🎭 LLM rewrite
        <input type="checkbox" v-model="llmRewrite" />
      </label>
      <span class="jv-spacer" />
      <JvButton
        variant="primary"
        size="lg"
        :disabled="!regenVoice"
        label="▶ Render block"
        title="Pick a block above to render. Per-block Regenerate buttons inline in the block list."
      />
    </div>

  </div>
  <LineageViewer
    :take-id="lineageTakeId"
    :open="lineageTakeId != null"
    @close="lineageTakeId = null"
  />
</template>

<style scoped>
.chapter-view {
  padding: 24px 32px 64px;
  padding-bottom: 96px; /* leave room above the pinned floating generate bar */
}

/* ── Floating generate bar at the bottom ───────────────────────────────── */
.chapter-view__generate-bar {
  position: fixed;
  bottom: 16px;
  left: 96px;
  right: 16px;
  z-index: 50;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  padding: 10px 16px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.chapter-view__chip-select {
  appearance: none;
  background: transparent;
  border: 0;
  font-family: inherit;
  font-size: inherit;
  font-weight: 600;
  color: var(--ink);
  cursor: pointer;
  margin-left: 6px;
  width: 12px;
  overflow: hidden;
}

/* ── Selectors ───────────────────────────────────────────────────────────── */
.chapter-view__selectors {
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 16px;
}

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
  color: var(--ink-3);
  font-size: 13px;
  font-style: italic;
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
</style>
