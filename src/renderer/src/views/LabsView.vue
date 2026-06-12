<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  LabsView — the Tools lane collapsed into one Settings-style tabbed
  view (user decision 2026-06-12): Compare · Train · Speaker · Render ·
  Audio. Legacy hashes (#compare/#train/#speakerlab/#renderlab/#audio)
  redirect here with jv.labs.sub carrying the target tab. Only the
  active tab mounts (dynamic component), so each lab's fetches run on
  entry, not five at once.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import CompareView from "./CompareView.vue";
import TrainView from "./TrainView.vue";
import SpeakerLabView from "./SpeakerLabView.vue";
import RenderLabView from "./RenderLabView.vue";
import AudioToolsView from "./AudioToolsView.vue";

const SUBS = [
  { id: "compare",    label: "Compare",  component: CompareView },
  { id: "train",      label: "Train",    component: TrainView },
  { id: "speakerlab", label: "Speaker",  component: SpeakerLabView },
  { id: "renderlab",  label: "Render",   component: RenderLabView },
  { id: "audio",      label: "Audio",    component: AudioToolsView },
];

const activeSub = ref("compare");
const activeComponent = computed(
  () => SUBS.find((s) => s.id === activeSub.value)?.component || CompareView,
);

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
    <div class="labs__subnav">
      <button
        v-for="s in SUBS"
        :key="s.id"
        type="button"
        class="jv-pill"
        :class="activeSub === s.id ? 'jv-pill--solid' : 'jv-pill--ghost'"
        @click="activeSub = s.id"
      >{{ s.label }}</button>
    </div>
    <component :is="activeComponent" />
  </div>
</template>

<style scoped>
.labs { display: flex; flex-direction: column; }
.labs__subnav { display: flex; gap: 6px; margin-bottom: 16px; flex-wrap: wrap; }
</style>
