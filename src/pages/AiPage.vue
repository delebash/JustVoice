<!-- SPDX-License-Identifier: MIT -->
<!--
  The ONE AI console — the kit's whole AI area (AiModelsArea). The strip: LLM providers · Speech ·
  Routing by feature · Usage · AI engine console. The providers tab is the kit's ("Providers &
  models" — connections + the local model catalog together, the kit's default shape), relabeled
  JV-only by its `kit.aiTabs.providers` key in en.json (two provider kinds need naming).

  Speech is the kit's tab for its audio.cpp runtime (round E, docs/plans/2026-10-29-round-e-onto-
  the-kit.md §4 step 5, G6–G9 — "JustVoice's UI in a kit slot"; its name the kit's, §5 item 6):
  the runtime's install, add-ons and settings, and every speech model with its size, licence,
  Auto / GPU / CPU, Download, Load and Delete, are the kit's. What it shows of OURS goes in its
  slots — each engine's head and foot (`group` by engine), our filters (`filter`) and sort
  (`groupSort`, `sort`), each model's
  facts and load options, Loaded now (what each kind holds, with Unload) and the Picking card
  above the models, and under them the speech servers you run and the cloud speech APIs. Its
  `changed` reaches every surface as `jv:health-refresh`
  (the top bar's pill, the stores); its `terms-required` opens our terms dialog, which repeats
  the Download or Load once they're accepted. The Speech engines tab of our own, its mock and the
  memory cells we fed the strip (vramFeed — the kit's strip shows each runtime's booking now,
  G10) went with round E.

  Deep links: ?tab=<id> (the old #engines page redirects here to the Speech tab, `runtime-audiocpp`)
  and ?action=<featureAction> (the old #speakerlab redirects to
  ?tab=features&action=speaker_attribution.guided — the Lab there IS the Speaker Lab now, running
  the real pipeline via the labAdapters seam; boot/jv.js registers it). The KIT wizard runs here,
  voiced and named "LLM engine setup" (ruling 6) by JustVoice's `kit.quickSetup.*` keys in en.json.
-->
<script setup>
import { nextTick, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { AiModelsArea, useModelApply, pageFlow } from "@delebash/ui";
import SpeechEngineFoot from "../components/SpeechEngineFoot.vue";
import SpeechEngineHead from "../components/SpeechEngineHead.vue";
import SpeechFilters from "../components/SpeechFilters.vue";
import SpeechLoadedRail from "../components/SpeechLoadedRail.vue";
import SpeechModelFacts from "../components/SpeechModelFacts.vue";
import SpeechPickingCard from "../components/SpeechPickingCard.vue";
import SpeechProvidersPanel from "../components/SpeechProvidersPanel.vue";
import { openEngineTerms } from "../services/engineTerms.js";
import { groupOf, groupOrder, modelOrder, modelShown } from "../services/speechTab.js";
import { useEnginesStore } from "../stores/engines.js";

const route = useRoute();
const router = useRouter();
const engines = useEnginesStore();

// The kit's Speech tab, with our grouping, filters, sort and answers to what it tells us.
const RUNTIME_TABS = {
  audiocpp: {
    props: {
      group: (m) => groupOf(m, engines.factsOf(m.id)),
      filter: (m, filters) => modelShown(m, filters, engines.factsOf(m.id)),
      // the sort our filters pick (filters.sort): the engines, and each engine's models
      groupSort: (a, b, filters) => groupOrder(a, b, filters.sort, engines.factsOf),
      sort: (a, b, filters) => modelOrder(a, b, filters.sort, engines.factsOf),
      onChanged: () => window.dispatchEvent(new Event("jv:health-refresh")),
      onTermsRequired: ({ model, retry }) => {
        const f = engines.factsOf(model.id);
        if (f) openEngineTerms(f.engine.id, { onAccepted: retry });
      },
    },
  },
};

// ?tab= / ?action= deep links (one-shot, like ?quicksetup): the redirect from
// the retired #engines page lands on the Speech tab; the retired
// #speakerlab's lands on the features tab with the attribution action focused.
const initialTab = ref(String(route.query.tab || ""));
const initialAction = ref(String(route.query.action || ""));

// The ?quicksetup=1 deep link is a ONE-SHOT INSTRUCTION, not a place (docgen's
// 2026-08-03 lesson): read it once into a plain ref and strip it from the URL,
// or the wizard reopens on every remount and on Back.
const openWizardOnce = ref(route.query.quicksetup === "1");

// This view is kept alive (the layout's KeepAlive), so the setup reads above fire
// once per session — a LATER #engines / #speakerlab redirect arrives as a query
// on the same route and must be re-consumed here. The kit area reacts to the
// prop updates (its own deep-link watcher, 2026-08-06) — but only when a prop CHANGES: the same
// link followed again (the user has moved to another tab since) would leave it as it is and never
// reach the area. So a repeat passes through "" first, a render apart, and arrives as a change.
async function deepLink(target, value) {
  if (target.value === value) {
    target.value = "";
    await nextTick();
  }
  target.value = value;
}
watch(() => route.fullPath, async () => {
  if (route.name !== "ai") return;
  const t = String(route.query.tab || "");
  const a = String(route.query.action || "");
  if (!t && !a) return;
  router.replace({ path: "/ai" }); // consumed — strip so Back doesn't re-fire
  if (t) await deepLink(initialTab, t);
  if (a) await deepLink(initialAction, a);
});

onMounted(async () => {
  // what the Speech tab's slots show of ours: each engine's models' facts, the default engine
  void engines.loadModels();
  void engines.loadDefaultEngine();
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
</script>

<template>
  <q-page :style-fn="pageFlow" class="ai-view">
    <AiModelsArea
      :auto-open-quick-setup="openWizardOnce"
      :initial-provider-scope="route.query.providers === 'online' ? 'online' : ''"
      :initial-tab="initialTab"
      :initial-feature-action="initialAction"
      :runtime-tabs="RUNTIME_TABS"
    >
      <template #runtime-audiocpp-group-head="{ group }"><SpeechEngineHead :engine-id="group.key" /></template>
      <template #runtime-audiocpp-group-foot="{ group, models, refresh }"><SpeechEngineFoot :engine-id="group.key" :models="models" :refresh="refresh" /></template>
      <template #runtime-audiocpp-filters="{ filters }"><SpeechFilters :filters="filters" /></template>
      <template #runtime-audiocpp-model="{ model, refresh }"><SpeechModelFacts :model="model" :refresh="refresh" /></template>
      <template #runtime-audiocpp-before-models="{ engine, models, refresh }">
        <SpeechLoadedRail :engine="engine" :models="models" :refresh="refresh" />
        <SpeechPickingCard />
      </template>
      <template #runtime-audiocpp-after-models>
        <!-- Self-hosted servers — the user runs these, with their verbs (add/edit/test — user QC
             ruling 2026-08-06) — then the cloud speech APIs. -->
        <section>
          <div class="ev-section-h">
            <h3>Self-hosted servers <span class="suffix">— speech servers you run</span></h3>
          </div>
          <SpeechProvidersPanel scope="selfhosted" />
        </section>
        <section>
          <div class="ev-section-h"><h3>Online · metered</h3></div>
          <p class="jv-hint">Cloud speech APIs — your account, billed by the provider</p>
          <SpeechProvidersPanel scope="cloud" />
        </section>
      </template>
    </AiModelsArea>
  </q-page>
</template>
