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
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";

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
          <div class="jv-spacer" />
          <span class="jv-mono jv-muted stories__playhead">{{ fmtTime(playheadMs) }} / {{ fmtTime(totalDurationMs) }}</span>
        </div>

        <!-- Multi-track timeline — custom layout, keep scoped CSS -->
        <div class="timeline">
          <div v-for="t in trackCount" :key="t" class="timeline__track">
            <div class="timeline__label jv-muted">Track {{ t }}</div>
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

        <p class="stories__hint jv-muted">
          Full timeline editor (drag-to-arrange, trim handles, version-pin) lives in the Phase 4c
          follow-on. This view renders the layout; interactive edit lands in v1.1.
        </p>
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
  color: var(--on-accent);
  line-height: 24px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
