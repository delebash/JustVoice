<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  StoriesView — multi-track timeline editor (voicebox's hallmark feature
  ported to Vue). For podcast assembly + game-dialogue arrangement +
  per-chapter multi-voice mixing.

  Web Audio API multi-track scheduler is in the useStoryPlayback composable
  (Phase 4c follow-on); this view renders the timeline + clip controls.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import ListPane from "../components/ListPane.vue";
import { pushToast } from "../services/toastBridge.js";

const api = useApi();

const stories = ref([]);
const search = ref("");
const selectedId = ref(null);
const playing = ref(false);
const playheadMs = ref(0);

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

onMounted(refresh);
</script>

<template>
  <div class="stories">
    <ListPane v-model:search-value="search" title="Stories" search-placeholder="Search stories…">
      <template #actions>
        <button class="btn btn--primary" @click="createStory">+ New</button>
      </template>

      <div v-if="filtered.length === 0" class="stories__empty">
        <p>No stories yet. Click <strong>+ New</strong> to start arranging clips on a multi-track timeline.</p>
      </div>
      <div
        v-for="s in filtered"
        :key="s.id"
        class="stories__item"
        :class="{ 'stories__item--active': s.id === selectedId }"
        @click="selectedId = s.id"
      >
        <strong>{{ s.name }}</strong>
        <span class="stories__item-meta">{{ s.items?.length || 0 }} clips</span>
      </div>
    </ListPane>

    <div class="stories__detail">
      <div v-if="!selectedStory" class="stories__detail-empty">
        <p>Select a story on the left, or create one to start arranging clips.</p>
      </div>
      <template v-else>
        <header class="stories__detail-header">
          <h2>{{ selectedStory.name }}</h2>
          <span class="stories__duration">{{ fmtTime(totalDurationMs) }}</span>
        </header>
        <p v-if="selectedStory.description" class="stories__description">{{ selectedStory.description }}</p>

        <div class="stories__transport">
          <button class="btn" @click="playing = !playing">{{ playing ? "⏸ Pause" : "▶ Play" }}</button>
          <button class="btn">⏹ Stop</button>
          <span class="stories__playhead">{{ fmtTime(playheadMs) }} / {{ fmtTime(totalDurationMs) }}</span>
        </div>

        <div class="timeline">
          <div v-for="t in trackCount" :key="t" class="timeline__track">
            <div class="timeline__label">Track {{ t }}</div>
            <div class="timeline__lane">
              <div
                v-for="item in (selectedStory.items || []).filter((i) => (i.track ?? 0) === t - 1)"
                :key="item.id"
                class="timeline__clip"
                :style="{ left: clipLeftPct(item) + '%', width: clipWidthPct(item) + '%' }"
              >
                {{ item.text?.slice(0, 30) || item.generation_id?.slice(0, 6) }}
              </div>
            </div>
          </div>
        </div>

        <p class="stories__hint">
          Full timeline editor (drag-to-arrange, trim handles, version-pin) lives in the Phase 4c
          follow-on. This view renders the layout; interactive edit lands in v1.1.
        </p>
      </template>
    </div>
  </div>
</template>

<style scoped>
.stories { display: grid; grid-template-columns: 360px 1fr; height: 100%; gap: 0; }
.stories__item { padding: 12px 16px; cursor: pointer; border-radius: 6px; margin: 0 8px 2px; display: flex; flex-direction: column; gap: 2px; }
.stories__item:hover { background: var(--surface-2, #fbfaf7); }
.stories__item--active { background: var(--accent, #3a7d63); color: #fff; }
.stories__item-meta { font-size: 11px; opacity: 0.7; }
.stories__detail { padding: 32px; overflow-y: auto; }
.stories__detail-empty { padding: 40px; text-align: center; color: var(--ink-2, #4a4a4a); }
.stories__detail-header { display: flex; align-items: baseline; gap: 12px; }
.stories__detail-header h2 { margin: 0; }
.stories__duration { color: var(--ink-3, #888); font-variant-numeric: tabular-nums; }
.stories__description { color: var(--ink-2, #4a4a4a); margin: 8px 0 24px; }
.stories__transport { display: flex; gap: 8px; align-items: center; margin-bottom: 16px; }
.stories__playhead { font-variant-numeric: tabular-nums; color: var(--ink-3, #888); margin-left: auto; }
.timeline { background: var(--surface-2, #fbfaf7); border: 1px solid var(--line, #e3e1dc); border-radius: 6px; padding: 12px; }
.timeline__track { display: flex; gap: 12px; margin-bottom: 6px; align-items: center; }
.timeline__label { width: 80px; font-size: 11px; color: var(--ink-2, #4a4a4a); text-transform: uppercase; letter-spacing: 0.05em; }
.timeline__lane { flex: 1; height: 32px; background: rgba(0, 0, 0, 0.04); border-radius: 4px; position: relative; }
.timeline__clip {
  position: absolute;
  top: 4px;
  bottom: 4px;
  background: var(--accent, #3a7d63);
  border-radius: 3px;
  padding: 0 6px;
  font-size: 11px;
  color: #fff;
  line-height: 24px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stories__empty { padding: 24px; text-align: center; color: var(--ink-3, #888); }
.stories__hint { font-size: 12px; color: var(--ink-3, #888); margin-top: 16px; font-style: italic; }
.btn { height: 32px; padding: 0 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--line-strong, #cfccc4); background: var(--surface-2, #fbfaf7); color: inherit; }
.btn--primary { background: var(--accent, #3a7d63); color: #fff; border-color: var(--accent, #3a7d63); }
</style>
