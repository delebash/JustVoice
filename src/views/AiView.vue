<!-- SPDX-License-Identifier: MIT -->
<!--
  The ONE AI console — the kit's whole AI area plus JV's speech surface as a
  HOST TAB. The strip (user QC ruling 2026-08-06 — five, one per concern):
  LLM providers · Speech engines · Routing by feature · Usage · AI engine
  console. The providers tab is the kit's ("Providers & models" — connections
  + the local model catalog together, the kit's default shape), relabeled
  JV-only via the labels feed (two provider kinds need naming — see main.js);
  Speech engines is the one speech surface with its own Local/Online pair
  (engines + self-hosted under Local, cloud APIs under Online). The
  four-tab split this replaced (separate TTS-providers and LLM-models tabs)
  was the batch's miss — the models tab duplicated the catalog already inside
  LLM providers, and the provider halves belong inside the speech surface.
  Deep links: ?tab=<id> (the old #engines page redirects here to the Speech
  engines tab) and ?action=<featureAction> (the old #speakerlab redirects to
  ?tab=features&action=speaker_attribution.guided — the Lab there IS the
  Speaker Lab now, running the real pipeline via the labAdapters seam;
  main.js registers it). The KIT wizard runs here, voiced by main.js's
  quickSetupCopy and named "LLM engine setup" by the labels feed (ruling 6).
-->
<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AiModelsArea, useModelApply } from "@delebash/llm-ui";
import SpeechEnginesTab from "../components/SpeechEnginesTab.vue";
// The one-strip consolidation (2026-08-15): JV feeds its memory cells
// (TTS · STT · Other apps · Busy) and the LLM cell's idle claim into the
// kit's top strip — the strip is the ONE memory surface on this console.
import { hostCells, llmClaim, subscribeVramFeed } from "../services/vramFeed.js";

const route = useRoute();
const router = useRouter();

let unsubscribeVram = null;

// The one speech host tab, right after the (LLM) providers tab.
const APP_TABS = [
  { id: "speech-engines", label: "Speech engines", after: "providers" },
];

// ?tab= / ?action= deep links (one-shot, like ?quicksetup): the redirect from
// the retired #engines page lands on the Speech engines tab; the retired
// #speakerlab's lands on the features tab with the attribution action focused.
const initialTab = ref(String(route.query.tab || ""));
const initialAction = ref(String(route.query.action || ""));

// The ?quicksetup=1 deep link is a ONE-SHOT INSTRUCTION, not a place (docgen's
// 2026-08-03 lesson): read it once into a plain ref and strip it from the URL,
// or the wizard reopens on every remount and on Back.
const openWizardOnce = ref(route.query.quicksetup === "1");

// This view is kept alive (App.vue's KeepAlive), so the setup reads above fire
// once per session — a LATER #engines / #speakerlab redirect arrives as a query
// on the same route and must be re-consumed here. The kit area reacts to the
// prop updates (its own deep-link watcher, 2026-08-06).
watch(() => route.fullPath, () => {
  if (route.name !== "ai") return;
  const t = String(route.query.tab || "");
  const a = String(route.query.action || "");
  if (!t && !a) return;
  if (t) initialTab.value = t;
  if (a) initialAction.value = a;
  router.replace({ path: "/ai" }); // consumed — strip so Back doesn't re-fire
});

onMounted(async () => {
  unsubscribeVram = subscribeVramFeed();
  if (route.query.tab || route.query.action) router.replace({ path: "/ai" }); // consumed
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

onBeforeUnmount(() => { if (unsubscribeVram) unsubscribeVram(); });
</script>

<template>
  <div class="ai-view">
    <AiModelsArea
      :auto-open-quick-setup="openWizardOnce"
      :initial-provider-scope="route.query.providers === 'online' ? 'online' : ''"
      :initial-tab="initialTab"
      :initial-feature-action="initialAction"
      :app-tabs="APP_TABS"
      :hw-cells="hostCells"
      :llm-claim="llmClaim"
    >
      <template #app-tab-speech-engines><SpeechEnginesTab /></template>
    </AiModelsArea>
  </div>
</template>
