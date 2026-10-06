<!-- SPDX-License-Identifier: MIT -->
<!--
  AttributionAutoPanel — the "Auto" row's pane (the Auto simplification,
  approved 2026-08-06: "the auto just explains what it does why it picks
  features and that you can set param size to change it, correct, simple").
  Plain words + ONE control: the editable size line
  (settings.extraction.direct_min_b). No pills — production always runs
  Auto; a route card's Lab run forces its own route per run. No readout, no
  model names: the run itself reports its route (Studio's meta line says
  "Auto's pick" vs "forced").
  And Analyze's second look on/off (settings.extraction.second_look,
  2026-10-05 — docs/plans/2026-10-05-second-look-build.md).
-->
<script setup>
import { onMounted, ref } from "vue";
import { UiToggle, pushToast } from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";

const api = useApi();

const directMinB = ref(14);
const secondLook = ref(true);
const busy = ref(false);

async function load() {
  const cfg = await api.safeRequest("/v1/extraction/config", null);
  if (cfg) {
    directMinB.value = cfg.direct_min_b ?? 14;
    secondLook.value = cfg.second_look !== false;
  }
}

async function saveSecondLook(on) {
  busy.value = true;
  try {
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction: { second_look: on } }),
    });
    pushToast({ message: on ? "Second look on." : "Second look off.", kind: "success", duration: 2500 });
    await load();
  } catch (e) {
    pushToast({ message: `Couldn't save: ${e?.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

async function saveMinB() {
  const n = Number(directMinB.value);
  if (!Number.isFinite(n) || n <= 0) {
    await load();
    return;
  }
  busy.value = true;
  try {
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction: { direct_min_b: n } }),
    });
    pushToast({ message: `Size rule saved — Direct at ${n} B and up.`, kind: "success", duration: 2500 });
    await load();
  } catch (e) {
    pushToast({ message: `Couldn't save: ${e?.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="aap">
    <p class="aap__intro">
      Auto never picks a model. It looks at the model you've already assigned
      and picks the feature that suits it.
    </p>
    <p class="aap__rule">
      If your model has at least
      <input class="aap__num" type="number" min="0.1" step="0.5" v-model="directMinB"
        aria-label="Direct size threshold in billions of parameters"
        :disabled="busy" @change="saveMinB" @keyup.enter="saveMinB" />
      billion parameters, <b>Direct</b> runs. Smaller models get <b>Guided</b>.
      A mixture-of-experts model counts its total size (26B for the built-in
      Gemma).
    </p>
    <p class="aap__rule">
      If JustVoice can't tell how big the model is, it plays it safe and uses
      <b>Guided</b>.
    </p>
    <div class="aap__toggle">
      <UiToggle :model-value="secondLook" :disabled="busy" aria-label="Second look"
        @update:model-value="saveSecondLook" />
      <p class="aap__rule">
        <b>Second look.</b> Off by default: Analyze leaves the lines it can't place blank, and
        Script's <b>🔎 Second look</b> asks about them when you choose — usually after adding a
        missing speaker. On, Analyze asks about each one itself, once more, with the chapters
        either side — a speaker unseen in one chapter is often named in the next. Either way
        what it finds is marked to check. Its prompt is the <b>Speaker attribution · second
        look</b> card.
      </p>
    </div>
  </div>
</template>

<style scoped>
.aap { display: flex; flex-direction: column; gap: 10px; max-width: 560px; }
.aap__intro, .aap__rule { margin: 0; font-size: 13px; color: var(--ink-2); }
.aap__toggle { display: flex; align-items: flex-start; gap: 10px; }
.aap__num {
  width: 64px; font: inherit; font-size: 13px; text-align: center;
  border: 1px solid var(--line-strong, #cfccc4); border-radius: 6px;
  background: var(--surface); color: var(--ink); padding: 2px 4px;
}
</style>
