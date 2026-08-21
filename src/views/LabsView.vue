<!-- SPDX-License-Identifier: MIT -->
<!--
  LabsView — the Tools lane collapsed into one Settings-style tabbed
  view (user decision 2026-06-12, SAME tab strip as Settings —
  the kit's UiTabStrip): Compare · Render · Audio (the TTS domain). Train left on
  2026-08-19 — training is a way to GET a voice, so it lives in Voices
  beside clone/design/import/blend (ruling 13); #train still lands on it.
  Legacy hashes (#compare/#renderlab/#audio) redirect here with
  jv.labs.sub carrying the target tab; #speakerlab redirects to the AI
  console's Lab instead (the Speaker Lab reunified there, parity batch
  2026-08-06). Only the active tab mounts (dynamic component), so each
  lab's fetches run on entry, not four at once.
-->
<script setup>
import { computed, onActivated, ref } from "vue";
// The tab strip is the kit's, shared with Settings and LoRA. It used to be a
// hand-rolled `.jv-subnav`, which had drifted to 12px — under this app's
// minimum type size.
import { UiTabStrip } from "@delebash/llm-ui";
import CompareView from "./CompareView.vue";
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

// Consumed on EVERY entry (kept-alive view; a mounted-time read fires once
// per session — later #compare/#train/#renderlab/#audio links would no-op).
onActivated(() => {
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
    <UiTabStrip v-model="activeSub" :tabs="SUBS" aria-label="Labs" />
    <p v-if="activeEntry.lede" class="jv-content__lede">{{ activeEntry.lede }}</p>
    <component :is="activeComponent" />
  </div>
</template>

<style scoped>
.labs { display: flex; flex-direction: column; }
/* The 20px under the strip was `.jv-subnav`'s own `margin-bottom`. The kit
   component sets no outer spacing — that is the consumer's business — so it
   is restored here. A child component's ROOT element carries the parent's
   scope id, so this scoped rule reaches it without `:deep`. */
.ui-tabstrip { margin-bottom: 20px; }
</style>
