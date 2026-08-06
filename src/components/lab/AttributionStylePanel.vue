<!-- SPDX-License-Identifier: MIT -->
<!--
  AttributionStylePanel — the reading-style dial on the Speaker attribution
  routing pane (approved 2026-08-06; mounted via the kit's featurePanels seam).
  The original auto behavior, made VISIBLE and steerable: Auto shows which
  style it currently picks and why ("your model is small"); Guided/Direct
  force one for production Analyze runs. The truth comes from
  /v1/extraction/config (the server makes the pick — no client math); the
  choice persists in settings.extraction.reading_style. The Lab's per-column
  override still wins over this for test runs.
-->
<script setup>
import { onMounted, ref } from "vue";
import { pushToast } from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";

const api = useApi();

const style = ref("auto");
const autoStyle = ref(null);
const autoReason = ref("");
const model = ref("");
const busy = ref(false);

async function load() {
  const cfg = await api.safeRequest("/v1/extraction/config", null);
  if (!cfg) return;
  style.value = cfg.reading_style || "auto";
  autoStyle.value = cfg.auto_style || null;
  autoReason.value = cfg.auto_reason || "";
  model.value = cfg.resolved_model || "";
}

async function pick(v) {
  if (busy.value || v === style.value) return;
  busy.value = true;
  const prev = style.value;
  style.value = v;
  try {
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ extraction: { reading_style: v } }),
    });
    pushToast({
      message: v === "auto"
        ? "Reading style: automatic — picked from your model each run."
        : `Reading style: ${v === "guided" ? "Guided" : "Direct"} — every run uses it.`,
      kind: "success",
      duration: 2500,
    });
  } catch (e) {
    style.value = prev;
    pushToast({ message: `Couldn't save the reading style: ${e?.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}

const OPTIONS = [
  { value: "auto", label: "Auto", title: "JustVoice picks Guided or Direct from the model each run — the original behavior" },
  { value: "guided", label: "Guided", title: "Always send the rules + worked examples — for small models" },
  { value: "direct", label: "Direct", title: "Always send the rules alone — for big models" },
];

onMounted(load);
</script>

<template>
  <div class="asp">
    <span class="jv-eyebrow">Reading style</span>
    <div class="asp__chips">
      <button v-for="o in OPTIONS" :key="o.value" type="button" class="asp__chip"
        :class="{ on: style === o.value }" :title="o.title" :disabled="busy"
        @click="pick(o.value)">{{ o.label }}</button>
    </div>
    <span v-if="style === 'auto' && autoStyle" class="jv-muted asp__note">
      currently {{ autoStyle === "guided" ? "Guided" : "Direct" }} — {{ autoReason }}<template v-if="model"> ({{ model }})</template>
    </span>
    <span v-else-if="style !== 'auto'" class="jv-muted asp__note">
      forced for every run — Auto returns the pick to the model
    </span>
  </div>
</template>

<style scoped>
.asp { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0 0 14px; }
.asp__chips { display: inline-flex; gap: 4px; }
.asp__chip {
  font: inherit; font-size: 12px; cursor: pointer;
  border: 1px solid var(--line-strong, #cfccc4); border-radius: 999px;
  background: var(--surface); color: var(--ink-2); padding: 3px 12px;
}
.asp__chip.on { background: var(--accent); border-color: var(--accent); color: #fff; }
.asp__chip:disabled { opacity: 0.6; cursor: default; }
.asp__note { font-size: 12px; }
</style>
