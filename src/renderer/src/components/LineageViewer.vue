<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  LineageViewer — modal that shows the source-chain of a take.

  Walks Take.source_take_id back to the original via GET /v1/takes/{id}/lineage.
  Renders as a vertical timeline: oldest at top, newest at bottom. Each node
  has its own ▶ play button that routes through the GlobalAudioPlayer.

  Task #98 (Take-lineage chain viewer).
-->
<script setup>
import { ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { useAudioPlayer } from "../stores/audioPlayer.js";
import { UiButton } from "@delebash/llm-ui";

const props = defineProps({
  takeId: { type: String, default: null },
  open: { type: Boolean, default: false },
});
const emit = defineEmits(["close"]);

const api = useApi();
const audioPlayer = useAudioPlayer();

const chain = ref([]);
const loading = ref(false);
const error = ref(null);

async function load() {
  if (!props.takeId) return;
  loading.value = true;
  error.value = null;
  try {
    const r = await api.request(`/v1/takes/${props.takeId}/lineage`);
    chain.value = r?.chain || [];
  } catch (e) {
    error.value = String(e?.message || e);
    chain.value = [];
  } finally {
    loading.value = false;
  }
}

watch(() => [props.open, props.takeId], ([open]) => {
  if (open) load();
});

function playNode(n) {
  if (!n?.audio_url) return;
  audioPlayer.play({
    url: `${api.serverUrl}${n.audio_url}`,
    title: n.label || "Take",
    subtitle: n.text_preview || "",
  });
}

function fmtDate(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString();
}
</script>

<template>
  <div v-if="open" class="jv-overlay" @click.self="emit('close')">
    <div class="jv-modal lineage-modal">
      <header class="jv-modal__header">
        <div class="jv-modal__titleblock">
          <span class="jv-modal__eyebrow">Take history</span>
          <h3 class="jv-modal__title">Take lineage</h3>
        </div>
        <button type="button" class="jv-modal__close" title="Close" @click="emit('close')">✕</button>
      </header>

      <div class="jv-modal__body">
      <p v-if="loading" class="jv-muted">Loading chain…</p>
      <p v-else-if="error" class="jv-banner jv-banner--danger">{{ error }}</p>
      <p v-else-if="!chain.length" class="jv-muted">No lineage found for this take.</p>

      <div v-else class="lineage-chain">
        <div
          v-for="(n, i) in chain"
          :key="n.take_id"
          class="lineage-node"
          :class="{ 'lineage-node--default': n.is_default }"
        >
          <div class="lineage-node__rail">
            <div class="lineage-node__dot" />
            <div v-if="i < chain.length - 1" class="lineage-node__line" />
          </div>
          <div class="lineage-node__body">
            <div class="lineage-node__head">
              <strong>{{ n.label || `Take ${i + 1}` }}</strong>
              <span v-if="n.is_default" class="jv-pill jv-pill--green">default</span>
              <span class="jv-muted lineage-node__time">{{ fmtDate(n.created_at) }}</span>
              <span class="jv-spacer" />
              <UiButton
                intent="ghost"
                size="small"
                label="▶"
                :disabled="!n.audio_url"
                @click="playNode(n)"
              />
            </div>
            <p v-if="n.text_preview" class="lineage-node__text">{{ n.text_preview }}</p>
          </div>
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lineage-modal { width: min(540px, calc(100vw - 32px)); }

.lineage-chain { display: flex; flex-direction: column; }
.lineage-node { display: flex; gap: 12px; padding: 8px 0; }
.lineage-node__rail {
  position: relative;
  width: 14px;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.lineage-node__dot {
  width: 10px; height: 10px;
  border-radius: 50%;
  background: var(--ink-3);
  margin-top: 6px;
}
.lineage-node--default .lineage-node__dot { background: var(--accent); }
.lineage-node__line {
  flex: 1;
  width: 2px;
  background: var(--line);
  margin-top: 4px;
}
.lineage-node__body { flex: 1; }
.lineage-node__head {
  display: flex; align-items: center; gap: 8px;
  font-size: 13px;
}
.lineage-node__time { font-size: 11px; }
.lineage-node__text {
  font-size: 12px;
  color: var(--ink-2);
  margin: 4px 0 0;
}
</style>
