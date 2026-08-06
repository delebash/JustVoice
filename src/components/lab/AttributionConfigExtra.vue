<!-- SPDX-License-Identifier: MIT -->
<!--
  AttributionConfigExtra — the attribution Lab adapter's per-column controls
  (the kit ConfigColumn mounts it via the labAdapters seam). v-models the
  column config's `extra`, which rides the run body into
  /v1/extraction/analyze-text.

  QC rework 2026-08-06: the reading styles wear their ORIGINAL names
  (Guided / Direct — the §9 renames erased the user's vocabulary), "Reasoned"
  is gone (it was Direct's text + a forced think flag; thinking belongs to the
  preset + the runner's capability gate now), the anchors toggle is back to
  its original "Anchor propagation" wording, and the duplicate saved-setups
  row died — the kit column's own Save-as-preset is the one save mechanism.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { UiChip, UiInput, UiToggle } from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  action: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const api = useApi();

function patch(obj) {
  emit("update:modelValue", { ...(props.modelValue || {}), ...obj });
}

// The extra's shape: { tier: ""|"guided"|"direct", useFloor: bool,
// floor: number|"", propagate: bool }. "" tier = Auto (the server picks from
// the model the run resolves to).
const tier = computed(() => props.modelValue?.tier ?? "");
const useFloor = computed(() => props.modelValue?.useFloor ?? true);
const floor = computed(() => props.modelValue?.floor ?? "");
const propagate = computed(() => props.modelValue?.propagate ?? true);

// The style registry (floors) — the Lab's truth surface, from the same
// /v1/extraction/config the pipeline serves.
const extractionConfig = ref(null);
onMounted(async () => {
  try { extractionConfig.value = await api.request("/v1/extraction/config"); } catch { /* older server */ }
});
function tierSpec(name) {
  return extractionConfig.value?.tiers?.find((t) => t.name === name) || null;
}

// The ORIGINAL names, with a plain gloss (QC ruling 2026-08-06).
const TIER_OPTIONS = computed(() => [
  { value: "", label: "Auto", title: "JustVoice picks Guided or Direct from the model this column runs" },
  { value: "guided", label: "Guided", title: `Rules + worked examples — for small models${tierSpec("guided") ? ` · accept bar ${tierSpec("guided").confidence_floor}` : ""}` },
  { value: "direct", label: "Direct", title: `The rules alone — for big models${tierSpec("direct") ? ` · accept bar ${tierSpec("direct").confidence_floor}` : ""}` },
]);
function setTier(v) {
  const spec = tierSpec(v);
  // Picking a style surfaces ITS floor as the editable starting value; Auto
  // clears back to the pipeline's own resolution.
  patch({ tier: v, floor: spec ? spec.confidence_floor : "" });
}
</script>

<template>
  <!-- Discovery columns: the reading-style/floor knobs configure the reading
       pipeline, not the who-exists scan — only the explainer applies. -->
  <div v-if="action === 'speaker_attribution.identify'" class="attx">
    <div class="jv-banner attx__note">
      Runs the real discovery pipeline — the same scan behind Studio's "new
      speakers found" banner. It proposes names not in the known-characters
      list as a review list; nothing is created from here.
    </div>
  </div>
  <div v-else class="attx">
    <!-- The pipeline explainer — what runs is the REAL pipeline. -->
    <div class="jv-banner attx__note">
      Runs the real reading pipeline: the passage is split into segments on quote
      marks (no AI), narration attributes to the narrator automatically, "Tom
      said" anchors the quote beside it, and the model reads only the dialogue.
      Reassigning a result below teaches the next run.
    </div>

    <div class="attx__row">
      <span class="jv-eyebrow">Reading style</span>
      <div class="attx__tiers">
        <UiChip v-for="t in TIER_OPTIONS" :key="t.value" :selected="tier === t.value"
          :title="t.title" @click="setTier(t.value)">{{ t.label }}</UiChip>
      </div>
    </div>

    <div class="attx__row">
      <span class="attx__knob" title="Pre-AI: 'Tom said' attributes the adjacent quote at full confidence">
        <UiToggle :model-value="propagate" aria-label="Anchor propagation" @update:model-value="(v) => patch({ propagate: v })" />
        <span>Anchor propagation</span>
      </span>
      <span class="attx__knob" title="Below this confidence, the pick becomes 'unknown' instead of a guess">
        <UiToggle :model-value="useFloor" aria-label="Confidence floor" @update:model-value="(v) => patch({ useFloor: v })" />
        <span>Confidence floor</span>
        <UiInput :model-value="floor" size="small" class="attx__floor" :disabled="!useFloor"
          :placeholder="String(tierSpec(tier || 'guided')?.confidence_floor ?? '0.7')"
          title="0–1 · below this, picks become 'unknown'"
          @update:model-value="(v) => patch({ floor: v })" />
      </span>
    </div>
  </div>
</template>

<style scoped>
.attx { display: flex; flex-direction: column; gap: 10px; }
.attx__note { font-size: 12px; line-height: 1.6; }
.attx__row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.attx__tiers { display: inline-flex; gap: 4px; flex-wrap: wrap; }
.attx__tiers .ui-chip { cursor: pointer; border: 0; font: inherit; font-size: 11.5px; }
.attx__knob { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.attx__floor { width: var(--w-token); font-family: var(--font-mono); font-size: 12px; }
</style>
