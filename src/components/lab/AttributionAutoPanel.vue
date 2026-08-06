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
-->
<script setup>
import { onMounted, ref } from "vue";
import { pushToast } from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";

const api = useApi();

const directMinB = ref(14);
const busy = ref(false);

async function load() {
  const cfg = await api.safeRequest("/v1/extraction/config", null);
  if (cfg) directMinB.value = cfg.direct_min_b ?? 14;
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
      If your model can think, <b>Reasoned</b> runs. The Thinking flag on the
      model's row in the catalog decides that — you can edit it there.
    </p>
    <p class="aap__rule">
      If it can't think but has at least
      <input class="aap__num" type="number" min="0.1" step="0.5" v-model="directMinB"
        aria-label="Direct size threshold in billions of parameters"
        :disabled="busy" @change="saveMinB" @keyup.enter="saveMinB" />
      billion parameters, <b>Direct</b> runs. Smaller models get <b>Guided</b>.
    </p>
    <p class="aap__rule">
      If JustVoice can't tell how big the model is, it plays it safe and uses
      <b>Guided</b>.
    </p>
  </div>
</template>

<style scoped>
.aap { display: flex; flex-direction: column; gap: 10px; max-width: 560px; }
.aap__intro, .aap__rule { margin: 0; font-size: 13px; color: var(--ink-2); }
.aap__num {
  width: 64px; font: inherit; font-size: 13px; text-align: center;
  border: 1px solid var(--line-strong, #cfccc4); border-radius: 6px;
  background: var(--surface); color: var(--ink); padding: 2px 4px;
}
</style>
