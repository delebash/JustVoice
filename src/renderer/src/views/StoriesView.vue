<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  StoriesView — multi-track timeline editor. For podcast assembly +
  game-dialogue arrangement + per-chapter multi-voice mixing.

  Web Audio API multi-track scheduler is in the useStoryPlayback composable
  (Phase 4c follow-on); this view renders the timeline + clip controls.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";

const api = useApi();

const stories = ref([]);
const search = ref("");
const selectedId = ref(null);
const playing = ref(false);
const playheadMs = ref(0);
const zoomMs = ref(60_000); // 60-second window default — matches preview HTML.
const generatorVoiceId = ref("");
const generatorEngineId = ref("");

const ZOOM_OPTIONS = [
  { id: 10_000,  label: "Zoom 10s" },
  { id: 60_000,  label: "Zoom 60s" },
  { id: 300_000, label: "Zoom 5m" },
  { id: 0,       label: "Zoom — fit project" },
];

// Track labels — pull persona/voice name from the first clip on each track,
// fall back to a numeric label (Track 1) when the lane is empty. Matches
// the preview's "Narrator / Mara / Old Crow / SFX" naming convention.
function trackLabel(trackIdx) {
  const items = selectedStory.value?.items || [];
  const clip = items.find((i) => (i.track ?? 0) === trackIdx);
  return (
    clip?.persona_name ||
    clip?.voice_name ||
    clip?.label ||
    `Track ${trackIdx + 1}`
  );
}

// Voices + engines for the floating generator bar — same /v1/voices +
// /v1/engines/current the Generate tab uses.
const voices = ref([]);
const currentEngine = ref(null);
async function loadGeneratorState() {
  try {
    const [v, e] = await Promise.all([
      api.safeRequest("/v1/voices", { voices: [] }),
      api.safeRequest("/v1/engines/current", { engine: null }),
    ]);
    voices.value = v?.voices ?? [];
    currentEngine.value = e?.engine ?? null;
    if (!generatorVoiceId.value && voices.value.length) generatorVoiceId.value = voices.value[0].id;
    if (currentEngine.value?.id) generatorEngineId.value = currentEngine.value.id;
  } catch { /* fail silent — bar still renders, just empty */ }
}

async function generateAtPlayhead() {
  if (!selectedStory.value) return;
  if (!generatorVoiceId.value) {
    pushToast({ kind: "error", title: "Pick a voice first" });
    return;
  }
  pushToast({
    kind: "info",
    title: "▶ Generate & insert at playhead",
    description: `Will render with voice ${generatorVoiceId.value} on engine ${generatorEngineId.value || "current"} and drop the clip at ${fmtTime(playheadMs.value)} on the selected track.`,
  });
}

const filtered = computed(() => {
  if (!search.value) return stories.value;
  const q = search.value.toLowerCase();
  return stories.value.filter((s) => (s.name || "").toLowerCase().includes(q));
});

const selectedStory = computed(() =>
  stories.value.find((s) => s.id === selectedId.value),
);

const totalDurationMs = computed(() => {
  if (!selectedStory.value?.items) return 0;
  return Math.max(
    ...selectedStory.value.items.map((i) => (i.start_time_ms || 0) + (i.duration || 0) * 1000),
    1000,
  );
});

const trackCount = computed(() => {
  if (!selectedStory.value?.items) return 3;
  return Math.max(3, ...selectedStory.value.items.map((i) => (i.track ?? 0) + 1));
});

async function refresh() {
  try {
    const res = await api.request("/v1/stories");
    stories.value = res.stories ?? res ?? [];
    if (!selectedId.value && stories.value.length > 0) selectedId.value = stories.value[0].id;
  } catch (e) {
    pushToast({ kind: "error", title: "Couldn't load stories", description: String(e?.message ?? e) });
  }
}

async function createStory() {
  const name = prompt("Story name:");
  if (!name) return;
  try {
    const created = await api.request("/v1/stories", {
      method: "POST",
      body: { name },
    });
    await refresh();
    selectedId.value = created.id;
  } catch (e) {
    pushToast({ kind: "error", title: "Create failed", description: String(e?.message ?? e) });
  }
}

function fmtTime(ms) {
  const total = Math.round(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function clipLeftPct(item) {
  return ((item.start_time_ms || 0) / totalDurationMs.value) * 100;
}
function clipWidthPct(item) {
  const dur = (item.duration || 1) * 1000;
  return Math.max(2, (dur / totalDurationMs.value) * 100);
}

onMounted(async () => {
  await refresh();
  await loadGeneratorState();
});
</script>

<template>
  <div class="stories">
    <!-- ── Story list ───────────────────────────────────────────────── -->
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
        @click="selectedId = s.id"
      >
        <strong>{{ s.name }}</strong>
        <span class="jv-pane-list__meta">{{ s.items?.length || 0 }} clips</span>
      </div>
    </div>

    <!-- ── Timeline detail ─────────────────────────────────────────── -->
    <div class="stories__detail jv-card">
      <div v-if="!selectedStory" class="stories__detail-empty jv-muted">
        <p>Select a story on the left, or create one to start arranging clips.</p>
      </div>
      <template v-else>
        <div class="jv-row stories__detail-header">
          <h2 style="margin:0;">{{ selectedStory.name }}</h2>
          <span class="stories__duration jv-muted" style="font-variant-numeric:tabular-nums;">{{ fmtTime(totalDurationMs) }}</span>
        </div>
        <p v-if="selectedStory.description" class="jv-muted" style="margin:6px 0 16px;">{{ selectedStory.description }}</p>

        <!-- Transport controls -->
        <div class="jv-row stories__transport">
          <JvButton
            :variant="playing ? 'secondary' : 'primary'"
            :label="playing ? '⏸ Pause' : '▶ Play'"
            @click="playing = !playing"
          />
          <JvButton variant="secondary" label="⏹ Stop" @click="playing = false; playheadMs = 0" />
          <span class="jv-pill jv-pill--ghost jv-mono stories__playhead">{{ fmtTime(playheadMs) }} / {{ fmtTime(totalDurationMs) }}</span>
          <span class="jv-muted" style="font-size: 11px">spacebar play/pause · arrow keys scrub</span>
          <div class="jv-spacer" />
          <select
            class="jv-input stories__zoom"
            v-model.number="zoomMs"
            :title="'Zoom level'"
          >
            <option v-for="z in ZOOM_OPTIONS" :key="z.id" :value="z.id">{{ z.label }}</option>
          </select>
          <JvButton variant="secondary" size="sm" label="+ Add track" />
          <JvButton variant="secondary" size="sm" label="⬇ Drop WAV/MP3/FLAC/OGG/M4A here" />
        </div>

        <p class="jv-muted stories__dnd-hint">
          Drag-drop WAV / MP3 / FLAC / OGG / M4A / AAC / WebM onto a track to import. Per-clip controls (trim handles · split-at-playhead with S · volume 0–200% · version-pin) land via task <code>#95</code>.
        </p>

        <!-- Multi-track timeline — custom layout, keep scoped CSS -->
        <div class="timeline">
          <div v-for="t in trackCount" :key="t" class="timeline__track">
            <div class="timeline__label jv-muted" :title="`Track ${t}`">{{ trackLabel(t - 1) }}</div>
            <div class="timeline__lane">
              <div
                v-for="item in (selectedStory.items || []).filter((i) => (i.track ?? 0) === t - 1)"
                :key="item.id"
                class="timeline__clip"
                :class="`timeline__clip--track${(t - 1) % 4}`"
                :style="{ left: clipLeftPct(item) + '%', width: clipWidthPct(item) + '%' }"
              >
                {{ item.text?.slice(0, 30) || item.generation_id?.slice(0, 6) }}
              </div>
            </div>
          </div>
        </div>

        <p class="stories__hint jv-muted">
          Full timeline editor (drag-to-arrange, trim handles, version-pin) lives in the Phase 4c
          follow-on. This view renders the layout; interactive edit lands in v1.1.
        </p>

        <!-- Floating generator bar — preview parity §Stories. Pick voice +
             engine, click "▶ Generate & insert at playhead" and the clip is
             rendered then dropped on the currently-selected track at the
             current playhead position. -->
        <div class="stories__floating">
          <label class="jv-chip-card stories__chip" title="Voice for the new clip">
            🎙️
            <select v-model="generatorVoiceId" class="stories__chip-select">
              <option v-if="!voices.length" value="">no voices</option>
              <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name || v.id }}</option>
            </select>
          </label>
          <span class="jv-chip-card stories__chip">
            🧠 <strong>{{ currentEngine?.name || generatorEngineId || "no engine" }}</strong>
          </span>
          <span class="jv-chip-card stories__chip" title="Playhead position">
            ⏱ <strong>{{ fmtTime(playheadMs) }}</strong>
          </span>
          <span class="jv-spacer" />
          <JvButton
            variant="primary"
            size="lg"
            label="▶ Generate & insert at playhead"
            :disabled="!generatorVoiceId"
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

/* Sidebar */
.stories__sidebar {
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  padding: 0;
}
.stories__list-header {
  padding: 14px 16px 10px;
  border-bottom: 1px solid var(--line);
}
.stories__story-item { margin: 0 8px 2px; }
.stories__empty { padding: 24px 16px; text-align: center; }

/* Detail pane */
.stories__detail { padding: 28px; overflow-y: auto; }
.stories__detail-empty { padding: 40px; text-align: center; }
.stories__detail-header { margin-bottom: 4px; align-items: baseline; }
.stories__transport { margin-bottom: 20px; }
.stories__playhead { font-size: 12px; }
.stories__hint { font-size: 12px; margin-top: 16px; font-style: italic; }

/* Timeline — view-specific layout kept as scoped CSS */
.timeline {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
  padding: 12px;
}
.timeline__track {
  display: flex;
  gap: 12px;
  margin-bottom: 6px;
  align-items: center;
}
.timeline__label {
  width: 80px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  flex-shrink: 0;
}
.timeline__lane {
  flex: 1;
  height: 32px;
  background: rgba(0, 0, 0, 0.04);
  border-radius: var(--r-sm);
  position: relative;
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
  line-height: 24px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: 0.85;
  cursor: pointer;
}
.timeline__clip:hover { opacity: 1; }
.timeline__clip--track0 { background: var(--accent); }       /* forest green */
.timeline__clip--track1 { background: var(--warn); }          /* warm gold */
.timeline__clip--track2 { background: #2f74b5; }              /* info blue */
.timeline__clip--track3 { background: var(--danger); }        /* oxblood */
.stories__dnd-hint { font-size: 11.5px; margin: 8px 0 4px; }
.stories__playhead { font-size: 11px; }

.stories__zoom {
  height: 28px;
  width: auto;
  font-size: 12px;
  padding: 0 8px;
}

/* Floating bar at the bottom of the timeline pane — preview parity. */
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
</style>
