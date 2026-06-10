<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  StoriesView — multi-track timeline editor (podcast assembly, game-dialogue
  arrangement, multi-voice chapters).

  v1 feature set (shape informed by voicebox's StoriesTab — see
  /voicebox-pin.txt — rebuilt for Vue + JustVoice's API):
    · Web Audio playback: clips scheduled at start_time_ms with volume
    · click-to-seek ruler + animated playhead
    · Generate & insert at playhead (renders via /v1/generate, drops the
      clip on the selected track using the X-Generation-Id header)
    · clip select + drag-to-move + inspector (track / start / volume / delete)
  Deferred (honest): trim handles, split-at-playhead, per-clip effects.
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { promptDialog, confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";

const api = useApi();

const stories = ref([]);
const search = ref("");
const selectedId = ref(null);
const playheadMs = ref(0);
const playing = ref(false);
const selectedItemId = ref(null);
const selectedTrack = ref(0);
const extraTracks = ref(0);
const generatorVoiceId = ref("");
const generatorText = ref("");
const generating = ref(false);
const savingItem = ref(false);

// ── Catalog state for the generator bar ──────────────────────────────
const voices = ref([]);
const currentEngine = ref(null);
async function loadGeneratorState() {
  const [v, e] = await Promise.all([
    api.safeRequest("/v1/voices", { voices: [] }),
    api.safeRequest("/v1/engines/current", { engine: null }),
  ]);
  voices.value = v?.voices ?? [];
  currentEngine.value = e?.engine ?? null;
  if (!generatorVoiceId.value && voices.value.length) generatorVoiceId.value = voices.value[0].id;
}

const filtered = computed(() => {
  if (!search.value) return stories.value;
  const q = search.value.toLowerCase();
  return stories.value.filter((s) => (s.name || "").toLowerCase().includes(q));
});
const selectedStory = computed(() => stories.value.find((s) => s.id === selectedId.value));
const selectedItem = computed(() =>
  (selectedStory.value?.items || []).find((i) => i.id === selectedItemId.value) || null,
);

const totalDurationMs = computed(() => {
  if (!selectedStory.value?.items?.length) return 10_000;
  return Math.max(
    10_000,
    ...selectedStory.value.items.map((i) => (i.start_time_ms || 0) + (i.duration || 0) * 1000),
  );
});
const trackCount = computed(() => {
  const fromItems = selectedStory.value?.items?.length
    ? Math.max(...selectedStory.value.items.map((i) => (i.track ?? 0) + 1))
    : 1;
  return Math.max(3, fromItems + extraTracks.value);
});

function trackLabel(trackIdx) {
  const clip = (selectedStory.value?.items || []).find((i) => (i.track ?? 0) === trackIdx);
  return clip?.persona_name || clip?.voice_name || `Track ${trackIdx + 1}`;
}

async function refresh() {
  try {
    const res = await api.request("/v1/stories");
    stories.value = res.stories ?? [];
    if (!selectedId.value && stories.value.length > 0) selectedId.value = stories.value[0].id;
    // Keep the selected story object fresh after item mutations.
  } catch (e) {
    pushToast({ kind: "error", title: "Couldn't load stories", description: String(e?.message ?? e) });
  }
}

async function createStory() {
  const name = await promptDialog({ title: "New story", label: "Story name", confirmLabel: "Create" });
  if (!name) return;
  try {
    const created = await api.post("/v1/stories", { name });
    await refresh();
    selectedId.value = created.id;
  } catch (e) {
    pushToast({ kind: "error", title: "Create failed", description: String(e?.message ?? e) });
  }
}

async function deleteStory() {
  const s = selectedStory.value;
  if (!s) return;
  const ok = await confirmDialog({
    title: "Delete story?",
    message: `Delete "${s.name}" and its clip arrangement? The underlying generations are kept.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/stories/${s.id}`, { method: "DELETE" });
    selectedId.value = null;
    stopPlayback();
    await refresh();
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

// ── Web Audio playback engine ─────────────────────────────────────────
//
// Clips schedule as AudioBufferSourceNodes relative to the playhead.
// Buffers cache by generation_id so replays + scrubs don't refetch.
let audioCtx = null;
const bufferCache = new Map(); // generation_id → AudioBuffer
let activeSources = [];
let playStartCtxTime = 0;
let playStartOffsetMs = 0;
let rafId = 0;

async function _bufferFor(item) {
  if (!item.audio_url || !item.generation_id) return null;
  if (bufferCache.has(item.generation_id)) return bufferCache.get(item.generation_id);
  const res = await fetch(`${api.serverUrl.replace(/\/$/, "")}${item.audio_url}`, {
    headers: api.token ? { Authorization: `Bearer ${api.token}` } : {},
  });
  if (!res.ok) return null;
  const buf = await audioCtx.decodeAudioData(await res.arrayBuffer());
  bufferCache.set(item.generation_id, buf);
  return buf;
}

async function startPlayback() {
  const items = selectedStory.value?.items || [];
  if (!items.length) {
    pushToast({ kind: "info", title: "Nothing to play", description: "Insert a clip first." });
    return;
  }
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  await audioCtx.resume();
  stopSources();
  const fromMs = playheadMs.value >= totalDurationMs.value ? 0 : playheadMs.value;
  playStartOffsetMs = fromMs;
  playStartCtxTime = audioCtx.currentTime + 0.05;

  for (const item of items) {
    const buffer = await _bufferFor(item);
    if (!buffer) continue;
    const clipStartMs = item.start_time_ms || 0;
    const trimStartS = (item.trim_start_ms || 0) / 1000;
    const clipDurS = Math.max(
      0,
      (item.duration || buffer.duration) - trimStartS - (item.trim_end_ms || 0) / 1000,
    );
    const endMs = clipStartMs + clipDurS * 1000;
    if (endMs <= fromMs) continue;

    const src = audioCtx.createBufferSource();
    src.buffer = buffer;
    const gain = audioCtx.createGain();
    gain.gain.value = item.volume ?? 1.0;
    src.connect(gain).connect(audioCtx.destination);

    const startsInS = Math.max(0, (clipStartMs - fromMs) / 1000);
    const offsetIntoClipS = trimStartS + Math.max(0, (fromMs - clipStartMs) / 1000);
    const remainS = clipDurS - Math.max(0, (fromMs - clipStartMs) / 1000);
    if (remainS <= 0) continue;
    src.start(playStartCtxTime + startsInS, offsetIntoClipS, remainS);
    activeSources.push(src);
  }
  playing.value = true;
  const tick = () => {
    if (!playing.value) return;
    playheadMs.value = playStartOffsetMs + Math.max(0, (audioCtx.currentTime - playStartCtxTime) * 1000);
    if (playheadMs.value >= totalDurationMs.value) {
      stopPlayback();
      playheadMs.value = totalDurationMs.value;
      return;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopSources() {
  for (const s of activeSources) {
    try { s.stop(); } catch { /* already ended */ }
  }
  activeSources = [];
}

function pausePlayback() {
  playing.value = false;
  cancelAnimationFrame(rafId);
  stopSources();
}

function stopPlayback() {
  pausePlayback();
  playheadMs.value = 0;
}

function togglePlay() {
  if (playing.value) pausePlayback();
  else startPlayback();
}

onBeforeUnmount(() => {
  pausePlayback();
  audioCtx?.close().catch(() => {});
});

// ── Seek (ruler click) ───────────────────────────────────────────────
function seekFromEvent(ev) {
  const lane = ev.currentTarget;
  const rect = lane.getBoundingClientRect();
  const frac = Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width));
  playheadMs.value = Math.round(frac * totalDurationMs.value);
  if (playing.value) { pausePlayback(); startPlayback(); }
}

// ── Generate & insert at playhead ────────────────────────────────────
async function generateAtPlayhead() {
  const story = selectedStory.value;
  if (!story || !generatorVoiceId.value || !generatorText.value.trim() || generating.value) return;
  generating.value = true;
  try {
    // Raw fetch — we need the X-Generation-Id response header, which the
    // api store's blob path doesn't expose.
    const res = await fetch(`${api.serverUrl.replace(/\/$/, "")}/v1/generate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(api.token ? { Authorization: `Bearer ${api.token}` } : {}),
      },
      body: JSON.stringify({ voice: generatorVoiceId.value, text: generatorText.value.trim(), cache: false }),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const genId = res.headers.get("X-Generation-Id");
    await res.blob(); // drain — the clip plays from the server copy
    if (!genId) throw new Error("server did not return X-Generation-Id");
    const updated = await api.post(`/v1/stories/${story.id}/items`, {
      generation_id: genId,
      track: selectedTrack.value,
      start_time_ms: Math.round(playheadMs.value),
    });
    stories.value = stories.value.map((s) => (s.id === updated.id ? updated : s));
    generatorText.value = "";
    pushToast({ kind: "success", title: "Clip inserted", description: `Track ${selectedTrack.value + 1} @ ${fmtTime(playheadMs.value)}` });
  } catch (e) {
    pushToast({ kind: "error", title: "Generate & insert failed", description: String(e?.message ?? e), duration: 7000 });
  } finally {
    generating.value = false;
  }
}

// ── Clip selection / drag-move / inspector ───────────────────────────
let dragState = null;

function onClipMouseDown(ev, item) {
  selectedItemId.value = item.id;
  selectedTrack.value = item.track ?? 0;
  const laneEl = ev.currentTarget.parentElement;
  dragState = {
    itemId: item.id,
    laneWidth: laneEl.getBoundingClientRect().width,
    startX: ev.clientX,
    origStartMs: item.start_time_ms || 0,
    movedMs: 0,
  };
  window.addEventListener("mousemove", onClipDragMove);
  window.addEventListener("mouseup", onClipDragEnd);
}

function onClipDragMove(ev) {
  if (!dragState) return;
  const story = selectedStory.value;
  const item = (story?.items || []).find((i) => i.id === dragState.itemId);
  if (!item) return;
  const deltaMs = ((ev.clientX - dragState.startX) / dragState.laneWidth) * totalDurationMs.value;
  dragState.movedMs = deltaMs;
  item.start_time_ms = Math.max(0, Math.round(dragState.origStartMs + deltaMs));
}

async function onClipDragEnd() {
  window.removeEventListener("mousemove", onClipDragMove);
  window.removeEventListener("mouseup", onClipDragEnd);
  const st = dragState;
  dragState = null;
  if (!st || Math.abs(st.movedMs) < 5) return; // click, not drag
  const story = selectedStory.value;
  const item = (story?.items || []).find((i) => i.id === st.itemId);
  if (!story || !item) return;
  await patchItem(item, { start_time_ms: item.start_time_ms });
}

async function patchItem(item, patch) {
  const story = selectedStory.value;
  if (!story) return;
  savingItem.value = true;
  try {
    const updated = await api.request(`/v1/stories/${story.id}/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    stories.value = stories.value.map((s) => (s.id === updated.id ? updated : s));
  } catch (e) {
    pushToast({ kind: "error", title: "Save failed", description: String(e?.message ?? e) });
    await refresh();
  } finally {
    savingItem.value = false;
  }
}

async function deleteSelectedItem() {
  const story = selectedStory.value;
  const item = selectedItem.value;
  if (!story || !item) return;
  try {
    const updated = await api.request(`/v1/stories/${story.id}/items/${item.id}`, { method: "DELETE" });
    stories.value = stories.value.map((s) => (s.id === updated.id ? updated : s));
    selectedItemId.value = null;
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

function fmtTime(ms) {
  const total = Math.round((ms || 0) / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
function clipLeftPct(item) {
  return ((item.start_time_ms || 0) / totalDurationMs.value) * 100;
}
function clipWidthPct(item) {
  const dur = (item.duration || 1) * 1000;
  return Math.max(1.5, (dur / totalDurationMs.value) * 100);
}

onMounted(async () => {
  await refresh();
  await loadGeneratorState();
});
</script>

<template>
  <div class="stories">
    <!-- ── Story list ──────────────────────────────────────────────── -->
    <div class="stories__sidebar jv-card jv-card--flat">
      <div class="jv-row stories__list-header">
        <span class="jv-section__title" style="margin:0;">Stories</span>
        <JvButton variant="primary" size="sm" label="+ New" @click="createStory" />
      </div>
      <div style="padding:8px 16px;">
        <JvInput v-model="search" placeholder="Search stories…" size="sm" />
      </div>

      <p v-if="filtered.length === 0" class="stories__empty jv-muted">
        No stories yet. Click <strong>+ New</strong> to start arranging clips on a multi-track timeline.
      </p>

      <div
        v-for="s in filtered"
        :key="s.id"
        class="jv-pane-list__item stories__story-item"
        :class="{ 'jv-pane-list__item--active': s.id === selectedId }"
        @click="selectedId = s.id; selectedItemId = null; stopPlayback()"
      >
        <strong>{{ s.name }}</strong>
        <span class="jv-pane-list__meta">{{ s.items?.length || 0 }} clips</span>
      </div>
    </div>

    <!-- ── Timeline detail ────────────────────────────────────────── -->
    <div class="stories__detail jv-card">
      <div v-if="!selectedStory" class="stories__detail-empty jv-muted">
        <p>Select a story on the left, or create one to start arranging clips.</p>
      </div>
      <template v-else>
        <div class="jv-row stories__detail-header">
          <h2 style="margin:0;">{{ selectedStory.name }}</h2>
          <span class="stories__duration jv-muted" style="font-variant-numeric:tabular-nums;">{{ fmtTime(totalDurationMs) }}</span>
          <span class="jv-spacer" />
          <JvButton variant="danger-outline" size="sm" label="Delete story" @click="deleteStory" />
        </div>

        <!-- Transport -->
        <div class="jv-row stories__transport">
          <JvButton
            :variant="playing ? 'secondary' : 'primary'"
            :label="playing ? '⏸ Pause' : '▶ Play'"
            :disabled="!(selectedStory.items || []).length"
            :title="(selectedStory.items || []).length ? '' : 'Insert a clip first'"
            @click="togglePlay"
          />
          <JvButton variant="secondary" label="⏹ Stop" :disabled="!playing && playheadMs === 0" @click="stopPlayback" />
          <span class="jv-pill jv-pill--ghost jv-mono stories__playhead">{{ fmtTime(playheadMs) }} / {{ fmtTime(totalDurationMs) }}</span>
          <span class="jv-muted" style="font-size: 11px">click a lane to seek · drag clips to move</span>
          <div class="jv-spacer" />
          <JvButton variant="secondary" size="sm" label="+ Add track" @click="extraTracks += 1" />
        </div>

        <!-- Timeline -->
        <div class="timeline">
          <div v-for="t in trackCount" :key="t" class="timeline__track">
            <button
              type="button"
              class="timeline__label jv-muted"
              :class="{ 'timeline__label--selected': selectedTrack === t - 1 }"
              :title="`Insert target: track ${t}`"
              @click="selectedTrack = t - 1"
            >{{ trackLabel(t - 1) }}</button>
            <div class="timeline__lane" @click.self="seekFromEvent">
              <div
                v-for="item in (selectedStory.items || []).filter((i) => (i.track ?? 0) === t - 1)"
                :key="item.id"
                class="timeline__clip"
                :class="[`timeline__clip--track${(t - 1) % 4}`, { 'timeline__clip--selected': selectedItemId === item.id }]"
                :style="{ left: clipLeftPct(item) + '%', width: clipWidthPct(item) + '%' }"
                :title="item.text || item.generation_id"
                @mousedown.prevent="onClipMouseDown($event, item)"
              >
                {{ item.text?.slice(0, 30) || (item.generation_id || "").slice(0, 6) }}
              </div>
              <!-- Playhead -->
              <div class="timeline__playhead" :style="{ left: (playheadMs / totalDurationMs) * 100 + '%' }" />
            </div>
          </div>
        </div>

        <!-- Clip inspector -->
        <div v-if="selectedItem" class="stories__inspector jv-card jv-card--flat">
          <span class="jv-pill jv-pill--ghost">clip</span>
          <span class="stories__inspector-text jv-ellipsis">{{ selectedItem.text || selectedItem.generation_id }}</span>
          <label class="stories__inspector-field">
            Track
            <input
              type="number" min="0" :max="trackCount - 1"
              class="jv-input jv-input--sm stories__inspector-num"
              :value="selectedItem.track"
              @change="patchItem(selectedItem, { track: Number($event.target.value) })"
            />
          </label>
          <label class="stories__inspector-field">
            Start
            <span class="jv-mono">{{ fmtTime(selectedItem.start_time_ms) }}</span>
          </label>
          <label class="stories__inspector-field">
            Volume
            <input
              type="range" min="0" max="2" step="0.05"
              :value="selectedItem.volume"
              @change="patchItem(selectedItem, { volume: Number($event.target.value) })"
            />
            <span class="jv-mono">{{ Math.round((selectedItem.volume ?? 1) * 100) }}%</span>
          </label>
          <span class="jv-spacer" />
          <JvButton variant="danger-outline" size="sm" label="✕ Remove clip" :disabled="savingItem" @click="deleteSelectedItem" />
        </div>

        <!-- Generate & insert -->
        <div class="stories__floating">
          <label class="jv-chip-card stories__chip" title="Voice for the new clip">
            🎙️
            <select v-model="generatorVoiceId" class="stories__chip-select">
              <option v-if="!voices.length" value="">no voices</option>
              <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name || v.id }}</option>
            </select>
          </label>
          <span class="jv-chip-card stories__chip">
            🧠 <strong>{{ currentEngine?.name || "no engine" }}</strong>
          </span>
          <span class="jv-chip-card stories__chip" :title="`Inserts on track ${selectedTrack + 1} at the playhead`">
            ⏱ <strong>T{{ selectedTrack + 1 }} · {{ fmtTime(playheadMs) }}</strong>
          </span>
          <input
            v-model="generatorText"
            class="jv-input stories__gen-text"
            placeholder="Type the line to render and drop at the playhead…"
            @keydown.enter="generateAtPlayhead"
          />
          <JvButton
            variant="primary"
            :loading="generating"
            :disabled="generating || !generatorVoiceId || !generatorText.trim()"
            :title="!currentEngine ? 'Load an engine first (Engines tab)' : ''"
            label="▶ Generate & insert"
            @click="generateAtPlayhead"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.stories {
  display: grid;
  grid-template-columns: 360px 1fr;
  height: 100%;
  gap: 16px;
  padding: 16px;
}

.stories__sidebar { display: flex; flex-direction: column; overflow-y: auto; padding: 0; }
.stories__list-header { padding: 14px 16px 10px; border-bottom: 1px solid var(--line); }
.stories__story-item { margin: 0 8px 2px; }
.stories__empty { padding: 24px 16px; text-align: center; }

.stories__detail { padding: 28px; overflow-y: auto; }
.stories__detail-empty { padding: 40px; text-align: center; }
.stories__detail-header { margin-bottom: 4px; align-items: baseline; }
.stories__transport { margin-bottom: 16px; }
.stories__playhead { font-size: 11px; }

.timeline {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 12px;
}
.timeline__track { display: flex; gap: 12px; margin-bottom: 6px; align-items: center; }
.timeline__label {
  width: 90px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
  background: none;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 4px 2px;
  cursor: pointer;
  text-align: left;
}
.timeline__label--selected { border-color: var(--accent); color: var(--accent); }
.timeline__lane {
  flex: 1;
  height: 36px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: var(--r-sm);
  position: relative;
  cursor: crosshair;
}
.timeline__clip {
  position: absolute;
  top: 4px;
  bottom: 4px;
  background: var(--accent);
  border-radius: 3px;
  padding: 0 6px;
  font-size: 11px;
  color: #fff;
  line-height: 28px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
  cursor: grab;
  user-select: none;
}
.timeline__clip:hover { opacity: 1; }
.timeline__clip--selected { outline: 2px solid var(--ink); opacity: 1; }
.timeline__clip--track0 { background: var(--accent); }
.timeline__clip--track1 { background: var(--warn); }
.timeline__clip--track2 { background: #2f74b5; }
.timeline__clip--track3 { background: var(--danger); }
.timeline__playhead {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--danger);
  pointer-events: none;
}

.stories__inspector {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-top: 12px;
  padding: 10px 14px;
  flex-wrap: wrap;
}
.stories__inspector-text { max-width: 260px; font-size: 12.5px; }
.stories__inspector-field { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; color: var(--ink-3); }
.stories__inspector-num { width: 56px; }

.stories__floating {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
  padding: 12px 14px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  box-shadow: var(--shadow-1);
}
.stories__chip { font-size: 13px; }
.stories__chip-select {
  border: 0;
  background: transparent;
  font-family: inherit;
  font-weight: 600;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  padding: 0 4px;
  min-width: 80px;
}
.stories__chip-select:focus { outline: 1px solid var(--accent); border-radius: 3px; }
.stories__gen-text { flex: 1; min-width: 220px; }
</style>
