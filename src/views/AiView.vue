<!-- SPDX-License-Identifier: MIT -->
<!--
  The ONE AI console (family parity batch 2026-08-06) — the kit's whole AI area
  plus JV's speech surfaces as HOST TABS. The strip (JV's approved seven):
  LLM providers · TTS providers · Speech engines · LLM models · Routing by
  feature · Usage · AI engine console. The providers/models tabs are the kit's,
  relabeled JV-only via the labels feed (two provider kinds need naming — see
  main.js); TTS providers + Speech engines are host tabs lifted from the
  retired Voice engines page; the Models split rides the kit's opt-in
  `modelsTab`. Deep links: ?tab=<id> (the old #engines page redirects here to
  the Speech engines tab). The KIT wizard runs here, voiced by main.js's
  quickSetupCopy and named "LLM engine setup" by the labels feed (ruling 6).
-->
<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AiModelsArea, useModelApply } from "@delebash/llm-ui";
import SpeechAiSettings from "../components/SpeechAiSettings.vue";
import SpeechEnginesTab from "../components/SpeechEnginesTab.vue";
import TtsProvidersTab from "../components/TtsProvidersTab.vue";

const route = useRoute();
const router = useRouter();

// The two speech host tabs sit right after the (LLM) providers tab — the
// approved strip order.
const APP_TABS = [
  { id: "tts-providers", label: "TTS providers", after: "providers" },
  { id: "speech-engines", label: "Speech engines", after: "tts-providers" },
];

// ?tab= deep link (one-shot, like ?quicksetup): the redirect from the retired
// #engines page lands on the Speech engines tab.
const initialTab = ref(String(route.query.tab || ""));

// The ?quicksetup=1 deep link is a ONE-SHOT INSTRUCTION, not a place (docgen's
// 2026-08-03 lesson): read it once into a plain ref and strip it from the URL,
// or the wizard reopens on every remount and on Back.
const openWizardOnce = ref(route.query.quicksetup === "1");

onMounted(async () => {
  if (route.query.tab) router.replace({ path: "/ai" }); // consumed
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
      :initial-tab="initialTab"
      :app-tabs="APP_TABS"
      models-tab
      app-tab-label="Speech AI"
      :data-links="[
        { label: 'Speaker Lab', href: '#speakerlab' },
      ]"
    >
      <template #app-tab-tts-providers><TtsProvidersTab /></template>
      <template #app-tab-speech-engines><SpeechEnginesTab /></template>
      <template #app-tab><SpeechAiSettings /></template>
    </AiModelsArea>
  </div>
</template>
