<!-- SPDX-License-Identifier: MIT -->
<!--
  The kit's whole AI area — providers, model catalog + downloads, routing by
  feature (the presets JV's features run on), usage, the AI engine console —
  JustVoice as the family's third install; docgen's AiView is the donor shape.
  ONE host tab (ruling 8, JW's exact shape): "Speech AI" holds JV's own knobs.
  The KIT wizard runs here, voiced by main.js's quickSetupCopy and named
  "LLM engine setup" by the labels feed (ruling 6 — JV has two engine kinds).
-->
<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AiModelsArea, useModelApply } from "@delebash/llm-ui";
import SpeechAiSettings from "../components/SpeechAiSettings.vue";

const route = useRoute();
const router = useRouter();

// The ?quicksetup=1 deep link is a ONE-SHOT INSTRUCTION, not a place (docgen's
// 2026-08-03 lesson): read it once into a plain ref and strip it from the URL,
// or the wizard reopens on every remount and on Back.
const openWizardOnce = ref(route.query.quicksetup === "1");

onMounted(async () => {
  if (!openWizardOnce.value) return;
  // …and never offer to set up a machine that IS set up: arriving with a
  // default already applied, the wizard is pure noise.
  try {
    const { refreshApplied, currentDefaultProviderId } = useModelApply();
    await refreshApplied();
    if (currentDefaultProviderId.value) openWizardOnce.value = false;
  } catch { /* unknown → let it open; the unconfigured box is the case it serves */ }
  router.replace({ path: "/ai" }); // consumed either way
});
</script>

<template>
  <div class="ai-view">
    <AiModelsArea
      :auto-open-quick-setup="openWizardOnce"
      :initial-provider-scope="route.query.providers === 'online' ? 'online' : ''"
      app-tab-label="Speech AI"
      :data-links="[
        { label: 'Speaker Lab', href: '#speakerlab' },
      ]"
    >
      <template #app-tab><SpeechAiSettings /></template>
    </AiModelsArea>
  </div>
</template>
