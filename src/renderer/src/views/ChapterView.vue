<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, computed, watch, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useTakesStore } from "../stores/takes.js";
import { pushToast } from "../services/toastBridge.js";
import { projectsService } from "../services/projects.js";
import JvButton from "../components/jv/JvButton.vue";
import JvField from "../components/jv/JvField.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvTag from "../components/jv/JvTag.vue";

const api = useApi();
const tasks = useRenderTasks();
const takesStore = useTakesStore();

// ── Project / scene / block selection ──────────────────────────────────────

const projects = ref([]);
const scenes = ref([]);
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
    ? [{ label: "— no scenes —", value: null }]
    : scenes.value.map((s) => ({
        label: s.title || `Scene ${s.position + 1}`,
        value: s.id,
      }))
);

async function loadProjects() {
  try {
    const res = await projectsService.list();
    projects.value = res.projects || [];
    if (projects.value.length && !selectedProjectId.value) {
      selectedProjectId.value = projects.value[0].id;
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
    scenes.value = res.scenes || [];
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
    blocks.value = (res.blocks || []).sort((a, b) => a.position - b.position);
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

onMounted(loadProjects);

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
    pushToast({ message: "Block regenerated.", kind: "success" });
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
</script>

<template>
  <div class="chapter-view">

    <!-- ── Project / scene selectors ───────────────────────────────────── -->
    <div class="jv-section">
      <h3 class="jv-section__title">Chapter view</h3>

      <div class="jv-card chapter-view__selectors">
        <JvField label="Project" layout="inline">
          <JvSelect
            v-model="selectedProjectId"
            :options="projectOptions"
            placeholder="Select a project…"
          />
        </JvField>
        <JvField label="Scene / Chapter" layout="inline">
          <JvSelect
            v-model="selectedSceneId"
            :options="sceneOptions"
            :disabled="!selectedProjectId || !scenes.length"
            placeholder="Select a scene…"
          />
        </JvField>
        <JvField label="Voice for re-generate" layout="inline">
          <JvSelect
            v-model="regenVoice"
            :options="voiceOptions"
            :disabled="availableVoices.length === 0"
          />
        </JvField>
      </div>
    </div>

    <!-- ── No project banner ───────────────────────────────────────────── -->
    <div v-if="!selectedProjectId" class="jv-banner">
      No project selected. <a href="#books"><strong>Go to Projects</strong></a> → import one (JustWrite / CSV / SRT / Audacity labels / JustVoice JSON) or create a blank one.
    </div>

    <!-- ── No blocks yet ──────────────────────────────────────────────── -->
    <div
      v-else-if="selectedSceneId && blocks.length === 0"
      class="jv-banner"
    >
      This scene has no blocks yet.
    </div>

    <!-- ── Block list ─────────────────────────────────────────────────── -->
    <div v-else-if="blocks.length" class="jv-section">
      <div
        v-for="block in blocks"
        :key="block.id"
        class="jv-card chapter-view__block"
      >
        <!-- Block header: position + persona -->
        <div class="chapter-view__block-header">
          <span class="chapter-view__block-num">{{ block.position + 1 }}</span>
          <span v-if="block.persona_id" class="jv-pill">{{ block.persona_id }}</span>
          <span v-if="block.direction" class="jv-pill jv-pill--warn">{{ block.direction }}</span>
        </div>

        <!-- Block text (read-only) -->
        <p class="chapter-view__block-text">{{ block.text }}</p>

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

              <!-- Lineage pill -->
              <span
                v-if="sourceTakeLabel(getActiveTake(block.id), block.id)"
                class="jv-pill chapter-view__lineage"
              >{{ sourceTakeLabel(getActiveTake(block.id), block.id) }}</span>
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

    <!-- ── Floating generate bar (voicebox parity, preview lines 791-798) ──
         Pinned at bottom of the chapter editor. Shows the active voice +
         engine + effects + LLM-rewrite toggle. The lede above promises
         this. "Render block" button is disabled until a block is selected;
         once block-selection state exists (#87 follow-on) this renders the
         active block. -->
    <div v-if="blocks.length" class="jv-floating chapter-view__generate-bar">
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
</style>
