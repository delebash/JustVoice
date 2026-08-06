<!-- SPDX-License-Identifier: MIT -->
<!--
  AttributionConfigExtra — the attribution Lab adapter's per-column controls
  (the kit ConfigColumn mounts it via the labAdapters seam; parity batch
  2026-08-06 — the Speaker Lab reunification). v-models the column config's
  `extra`, which rides the run body into /v1/extraction/analyze-text.

  Carries, from the retired SpeakerLabView (the 12-point inventory):
  (1) the tier control, first-class per column, in HUMAN words —
      "Auto (matched to the model)" / "With examples" / "Rules only" /
      "Rules + thinking";
  (8) the confidence-floor override + anchor propagation;
  (9) saved named setups on the SAME server pref (`speakerLabPresets`) the old
      Lab wrote — old presets load (the fields this panel owns apply; provider/
      model/temperature now live on the kit column's own preset row);
  (12) the pipeline explainer note.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { UiButton, UiChip, UiInput, UiSelect, UiToggle, promptDialog, pushToast } from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";
import { readPref, writePref } from "../../services/prefs.js";

const props = defineProps({
  modelValue: { type: Object, default: () => ({}) },
  action: { type: String, default: "" },
});
const emit = defineEmits(["update:modelValue"]);

const api = useApi();

function patch(obj) {
  emit("update:modelValue", { ...(props.modelValue || {}), ...obj });
}

// The extra's shape: { tier: ""|"guided"|"direct"|"reasoned", useFloor: bool,
// floor: number|"" , propagate: bool }. "" tier = Auto (the server classifies
// from the model the run resolves to).
const tier = computed(() => props.modelValue?.tier ?? "");
const useFloor = computed(() => props.modelValue?.useFloor ?? true);
const floor = computed(() => props.modelValue?.floor ?? "");
const propagate = computed(() => props.modelValue?.propagate ?? true);

// The tier registry (floors, think flags) — the Lab's truth surface, from the
// same /v1/extraction/config the pipeline serves.
const extractionConfig = ref(null);
onMounted(async () => {
  try { extractionConfig.value = await api.request("/v1/extraction/config"); } catch { /* older server */ }
});
function tierSpec(name) {
  return extractionConfig.value?.tiers?.find((t) => t.name === name) || null;
}

// The approved human words (parity batch — the copy law: outcomes, not jargon).
const TIER_OPTIONS = computed(() => [
  { value: "", label: "Auto (matched to the model)", title: "JustVoice picks between the reading instructions for you, based on the model's size" },
  { value: "guided", label: "With examples", title: `Worked examples included — for smaller models${tierSpec("guided") ? ` · floor ${tierSpec("guided").confidence_floor}` : ""}` },
  { value: "direct", label: "Rules only", title: `The same job without the examples — for larger models${tierSpec("direct") ? ` · floor ${tierSpec("direct").confidence_floor}` : ""}` },
  { value: "reasoned", label: "Rules + thinking", title: `Rules with reasoning enabled — for hybrid thinking models${tierSpec("reasoned") ? ` · floor ${tierSpec("reasoned").confidence_floor}` : ""}` },
]);
function setTier(v) {
  const spec = tierSpec(v);
  // Picking a tier surfaces ITS floor as the editable starting value (the old
  // Lab's applyTier); Auto clears back to the pipeline's own resolution.
  patch({ tier: v, floor: spec ? spec.confidence_floor : "" });
}

// ── Saved named setups — the carried `speakerLabPresets` server pref. ──
const setups = ref([]);
const activeSetup = ref("");
onMounted(() => {
  const loaded = readPref("speakerLabPresets", []);
  setups.value = Array.isArray(loaded) ? loaded : [];
});
function persist() { writePref("speakerLabPresets", setups.value); }

async function saveSetup() {
  const name = await promptDialog({
    title: "Save this setup",
    message: "Name this reading configuration — it appears in every column's setup picker.",
    placeholder: "e.g. small model · tight floor",
  });
  if (!name) return;
  setups.value = [
    ...setups.value.filter((p) => p.name !== name),
    { name, config: { tier: tier.value, use_floor: useFloor.value, confidenceFloor: floor.value, propagate: propagate.value } },
  ];
  persist();
  activeSetup.value = name;
  pushToast({ message: `Setup "${name}" saved.`, kind: "success", duration: 2500 });
}
function loadSetup(name) {
  activeSetup.value = name;
  if (!name) return;
  const p = setups.value.find((x) => x.name === name);
  if (!p) return;
  const c = p.config || {};
  // Old Speaker-Lab presets carried more (provider/model/temperature/prompts) —
  // those live on the kit column now (its own preset row + prompt boxes); this
  // panel applies the fields it owns.
  patch({
    tier: c.tier ?? "",
    useFloor: c.use_floor ?? true,
    floor: c.confidenceFloor ?? "",
    propagate: c.propagate ?? true,
  });
}
function deleteSetup() {
  if (!activeSetup.value) return;
  setups.value = setups.value.filter((p) => p.name !== activeSetup.value);
  persist();
  activeSetup.value = "";
}
</script>

<template>
  <!-- Discovery columns: the tier/floor knobs configure the reading pipeline,
       not the who-exists scan — only the explainer applies. -->
  <div v-if="action === 'speaker_attribution.identify'" class="attx">
    <div class="jv-banner attx__note">
      Runs the real discovery pipeline — the same scan behind Studio's "new
      speakers found" banner. It proposes names not in the known-characters
      list as a review list; nothing is created from here.
    </div>
  </div>
  <div v-else class="attx">
    <!-- (12) The pipeline explainer — what runs is the REAL pipeline. -->
    <div class="jv-banner attx__note">
      Runs the real reading pipeline: the passage is split into segments on quote
      marks (no AI), narration attributes to the narrator automatically, "Tom
      said" anchors the quote beside it, and the model reads only the dialogue.
      Reassigning a result below teaches the next run.
    </div>

    <div class="attx__row">
      <span class="jv-eyebrow">Reading instructions</span>
      <div class="attx__tiers">
        <UiChip v-for="t in TIER_OPTIONS" :key="t.value" :selected="tier === t.value"
          :title="t.title" @click="setTier(t.value)">{{ t.label }}</UiChip>
      </div>
    </div>

    <div class="attx__row">
      <span class="attx__knob" title="Pre-AI: 'Tom said' anchors the adjacent quote at full confidence">
        <UiToggle :model-value="propagate" aria-label="Anchor propagation" @update:model-value="(v) => patch({ propagate: v })" />
        <span>Use "Tom said" anchors</span>
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

    <!-- (9) Saved setups — the carried speakerLabPresets pref. -->
    <div class="attx__row">
      <span class="jv-eyebrow">Saved setups</span>
      <UiSelect :model-value="activeSetup" width="name" title="Load a saved reading setup"
        :options="[{ value: '', label: '— none —' }, ...setups.map((p) => ({ value: p.name, label: p.name }))]"
        @update:model-value="loadSetup" />
      <UiButton v-if="activeSetup" intent="ghost" size="small" label="🗑" title="Delete this setup" @click="deleteSetup" />
      <UiButton intent="secondary" size="small" label="＋ Save as" title="Save these reading controls as a named setup" @click="saveSetup" />
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
