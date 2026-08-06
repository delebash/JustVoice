<!-- SPDX-License-Identifier: MIT -->
<!--
  AttributionConfigExtra — the attribution Lab adapter's per-column controls
  (the kit ConfigColumn mounts it via the labAdapters seam). v-models the
  column config's `extra`, which rides the run body into
  /v1/extraction/analyze-text.

  The Auto simplification (approved 2026-08-06): the per-column Route chips
  are GONE — the card you're on IS the route (its Lab run always forces its
  own route; the adapter sends it), so a route selector here could only lie
  or repeat. What remains: the pipeline explainer, Anchor propagation, and
  the confidence floor. The kit column's own Save-as-preset is the one save
  mechanism.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { UiInput, UiToggle } from "@delebash/llm-ui";
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

// The extra's shape: { useFloor: bool, floor: number|"", propagate: bool }.
// No route rides `extra` — the adapter derives it from the action (the card
// IS the route).
const useFloor = computed(() => props.modelValue?.useFloor ?? true);
const floor = computed(() => props.modelValue?.floor ?? "");
const propagate = computed(() => props.modelValue?.propagate ?? true);

// This card's own route — names the floor placeholder's source.
const ACTION_ROUTE = {
  "speaker_attribution.guided": "guided",
  "speaker_attribution.direct": "direct",
  "speaker_attribution.reasoned": "reasoned",
};

// The route registry (floors) — the Lab's truth surface, from the same
// /v1/extraction/config the pipeline serves.
const extractionConfig = ref(null);
onMounted(async () => {
  try { extractionConfig.value = await api.request("/v1/extraction/config"); } catch { /* older server */ }
});
const ownFloor = computed(
  () =>
    extractionConfig.value?.tiers?.find(
      (t) => t.name === (ACTION_ROUTE[props.action] || "guided"),
    )?.confidence_floor ?? "0.7",
);
</script>

<template>
  <!-- Discovery columns: the floor/anchor knobs configure the reading
       pipeline, not the who-exists scan — only the explainer applies. -->
  <div v-if="action === 'speaker_attribution.identify'" class="attx">
    <div class="jv-banner attx__note">
      Runs the real discovery pipeline — the same scan behind Studio's "new
      speakers found" banner. It proposes names not in the known-characters
      list as a review list; nothing is created from here.
    </div>
  </div>
  <div v-else class="attx">
    <!-- The pipeline explainer — what runs is the REAL pipeline, on THIS
         card's own route. -->
    <div class="jv-banner attx__note">
      Runs the real reading pipeline on this card's route: the passage is
      split into segments on quote marks (no AI), narration attributes to the
      narrator automatically, "Tom said" anchors the quote beside it, and the
      model reads only the dialogue. Reassigning a result below teaches the
      next run.
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
          :placeholder="String(ownFloor)"
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
.attx__knob { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.attx__floor { width: var(--w-token); font-family: var(--font-mono); font-size: 12px; }
</style>
