<!-- SPDX-License-Identifier: MIT -->
<!--
  LabsView — the Tools lane collapsed into one Settings-style tabbed
  view (user decision 2026-06-12, SAME tab strip as Settings —
  .jv-subnav): Compare · Train · Render · Audio (the TTS domain). Legacy
  hashes (#compare/#train/#renderlab/#audio) redirect here with
  jv.labs.sub carrying the target tab; #speakerlab redirects to the AI
  console's Lab instead (the Speaker Lab reunified there, parity batch
  2026-08-06). Only the active tab mounts (dynamic component), so each
  lab's fetches run on entry, not four at once.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import CompareView from "./CompareView.vue";
import TrainView from "./TrainView.vue";
import RenderLabView from "./RenderLabView.vue";
import AudioToolsView from "./AudioToolsView.vue";

// Per-tab explainer lede (user ask 2026-06-12: every lab gets intro text
// like Speaker Lab's). One mechanism here — sub-views must NOT hand-roll
// their own h2+lede header (that's how Speaker/Render ended up repeating
// their tab name as a duplicate title).
const SUBS = [
  {
    id: "compare", label: "Compare", component: CompareView,
    lede: "A/B comparison harness. Pick two takes — any WAVs, or pull the current takes of a chapter — and run the analyzer: loudness, duration, silence, clipping, and a verdict per metric.",
  },
  {
    id: "train", label: "Train", component: TrainView,
    lede: "Fine-tuning queue. Train a LoRA (or full fine-tune) on a voice's samples against a base engine; finished jobs land in the voice library as new profiles.",
  },
  {
    id: "renderlab", label: "Render", component: RenderLabView,
    lede: "A/B matrix harness for voice tuning. Pick a voice, 1-3 sample sentences, and 1-2 parameter axes. Up to 16 cells, capped at 2 concurrent renders.",
  },
  {
    id: "audio", label: "Audio", component: AudioToolsView,
    lede: "Standalone WAV utilities. Analyze any 16-bit PCM WAV (loudness, silence, clipping, fingerprint) or apply a mastering target to a file outside the render pipeline.",
  },
];

const activeSub = ref("compare");
const activeEntry = computed(
  () => SUBS.find((s) => s.id === activeSub.value) || SUBS[0],
);
const activeComponent = computed(() => activeEntry.value.component);

onMounted(() => {
  try {
    const sub = window.sessionStorage?.getItem("jv.labs.sub");
    if (sub && SUBS.some((s) => s.id === sub)) {
      activeSub.value = sub;
      window.sessionStorage.removeItem("jv.labs.sub");
    }
  } catch { /* ignore */ }
});
</script>

<template>
  <div class="labs">
    <div class="jv-subnav">
      <a
        v-for="s in SUBS"
        :key="s.id"
        class="jv-subnav__tab"
        :class="{ 'jv-subnav__tab--active': activeSub === s.id }"
        @click="activeSub = s.id"
      >{{ s.label }}</a>
    </div>
    <p v-if="activeEntry.lede" class="jv-content__lede">{{ activeEntry.lede }}</p>
    <component :is="activeComponent" />
  </div>
</template>

<style scoped>
.labs { display: flex; flex-direction: column; }
</style>
