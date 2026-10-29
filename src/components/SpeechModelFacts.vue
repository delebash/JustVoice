<!-- SPDX-License-Identifier: MIT -->
<!--
  One model's facts on AI Settings → Speech — the kit's audio.cpp tab, its `model` slot under the
  kit's row (its size, licence, state, Auto / GPU / CPU, Load, Delete — round E,
  docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 5, G6): what JustVoice knows of it — the
  languages it speaks, cloning, built-in voices, how it is directed, audio.cpp's status for it, its
  description, View on Hugging Face, Set as default — and its load options (audio.cpp's session
  options, every one its spec lists — the adoption plan, E4): the ones JustVoice measured on the
  row, the rest folded under "Load options (N)", saved per model through our
  PUT /v1/engines/{id}/models/{version}/runtime-options. The kit reads them at every load (our
  `sessionOptions` hook), so the server lets a loaded model whose options changed go and it is
  loaded again here, through the kit's Load. Moved from the Speech engines tab's model rows, which
  went with round E; its words and classes are that tab's.
-->
<script setup>
import { computed } from "vue";
import { UiButton, UiSelect, languageName, loadRuntimeModel, openExternal, pushToast } from "@delebash/ui";
import { useApi } from "../stores/api.js";
import { useEnginesStore } from "../stores/engines.js";
import { setDefaultVariant } from "../services/engineDefaults.js";
import { openEngineTerms } from "../services/engineTerms.js";
import { directionCell } from "../services/personaFacts.js";
import DeliveryKnobs from "./DeliveryKnobs.vue";

const props = defineProps({
  // the model's row as the kit's tab lists it (GET /v1/ai/runtimes/audiocpp/models)
  model: { type: Object, required: true },
  // the tab's own `refresh` — it reads its models again
  refresh: { type: Function, default: null },
});

const api = useApi();
const engines = useEnginesStore();
const facts = computed(() => engines.factsOf(props.model.id));
const e = computed(() => facts.value?.engine ?? null);
const v = computed(() => facts.value?.variant ?? null);
const tts = computed(() => (e.value?.kinds?.length ? e.value.kinds[0] : e.value?.kind || "tts") === "tts");
const osBlocked = computed(() => e.value?.supported_on_this_os === false);
const busy = computed(() => !!props.model.loading);

// audio.cpp's own wording when its list describes rather than names ("100+ languages").
const langText = computed(() => {
  if (v.value?.languages_note) return v.value.languages_note;
  const ls = v.value?.languages || [];
  if (!ls.length) return "";
  return ls.length === 1 ? languageName(ls[0]) || ls[0] : `${ls.length} languages`;
});
const langTitle = computed(() => (v.value?.languages || []).map((c) => languageName(c) || c).join(" · "));
const isDefault = computed(() => e.value?.default_variant_id === v.value?.id);

// Set-as-default MODEL (version): the user layer over the catalog's default
// (engine_overrides[id].default_variant) — what a line on this model speaks with when no version
// of it is loaded. The one door, shared with the persona page's Version choice (2026-10-05).
async function setDefault() {
  try {
    await setDefaultVariant(api, e.value.id, v.value.id);
    pushToast({ message: `${v.value.name} is now ${e.value.name || e.value.id}'s default version.`, kind: "success" });
    await engines.reload(); // the list serves the RESOLVED default — re-read the badge truth
  } catch (err) {
    pushToast({ message: `Couldn't set the default: ${err?.message || err}`, kind: "error" });
  }
}

// The load options JustVoice measured (Qwen3's Attention and Decoder weights) stay on the row as
// they were; every other one is folded under "Load options", as audio.cpp's own UI folds a
// model's options — on the persona page's knob grid (DeliveryKnobs), each a dropdown, a switch,
// a number box or a text field as its spec types it.
const options = computed(() => v.value?.runtime_options || []);
const rowOptions = computed(() => options.value.filter((o) => o.featured && o.type === "choice"));
const foldedOptions = computed(() => options.value.filter((o) => !(o.featured && o.type === "choice")));
// A value as the control holds it: a switch's on/off, a number, else the text audio.cpp reads.
function optionTyped(o, value) {
  if (value === null || value === undefined) return null;
  if (o.type === "switch") return value === "true";
  if (o.type === "number") return Number(value);
  return value;
}
const optionKnobs = computed(() =>
  foldedOptions.value.map((o) => ({
    key: o.key,
    label: o.label,
    hint: o.hint,
    type: o.type,
    box: true,
    min: o.min,
    max: o.max,
    step: 1,
    choices: o.choices.map((c) => c.value),
    neutral: optionTyped(o, o.default),
  })),
);
// What is set: the values other than the default (each with its ↺).
const optionValues = computed(() =>
  Object.fromEntries(foldedOptions.value.filter((o) => o.value !== o.default).map((o) => [o.key, optionTyped(o, o.value)])),
);

// A model's load options are saved per model; `value` null is back to the default. A loaded model
// whose options changed was let go by the server (`reload`): it loads again through the kit's Load
// (loadRuntimeModel — a task on the AI tasks strip, a refusal said by the kit, a licence it waits
// for our terms dialog), the tab's own row showing it load.
async function setRuntimeOption(key, value) {
  const cur = Object.fromEntries(options.value.filter((o) => o.value != null).map((o) => [o.key, o.value]));
  const next = { ...cur };
  if (value === null || value === undefined || value === "") delete next[key];
  else next[key] = String(value);
  if (cur[key] === next[key]) return;
  let r;
  try {
    r = await api.put(`/v1/engines/${encodeURIComponent(e.value.id)}/models/${encodeURIComponent(v.value.id)}/runtime-options`, { options: next });
  } catch (err) {
    pushToast({ message: `Couldn't change ${v.value.name}'s options: ${err?.message || err}`, kind: "error" });
    return;
  }
  await engines.loadModels(e.value.id);
  if (!r?.reload) return;
  const engineId = e.value.id;
  const loading = loadRuntimeModel("audiocpp", props.model.id, {
    label: v.value.name,
    onTermsRequired: ({ retry }) => openEngineTerms(engineId, { onAccepted: retry }),
  });
  await props.refresh?.(); // the row shows it loading again
  await loading;
  window.dispatchEvent(new Event("jv:health-refresh"));
  await props.refresh?.();
}
</script>

<template>
  <div v-if="v" class="ev-mfacts" :class="{ dim: osBlocked }">
    <!-- The facts chips: languages · Cloning · Built-in voices · how it's directed · audio.cpp's
         status — read straight off our catalog's facts; nothing here is typed twice. -->
    <span class="ev-vchips">
      <span v-if="langText" class="ev-cap" :title="langTitle">{{ langText }}</span>
      <span v-if="v.voice_cloning === true" class="ev-cap clone" title="Clones a voice from a short clean sample">CLONING</span>
      <span v-if="v.preset_voices > 0" class="ev-cap presets" :title="`${v.preset_voices} built-in voices — no sample needed`">BUILT-IN · {{ v.preset_voices }}</span>
      <span v-if="v.directed_by" class="ev-cap" :class="{ directed: directionCell(v.directed_by).intent === 'success' }"
        :title="directionCell(v.directed_by).title">{{ directionCell(v.directed_by).label.toUpperCase() }}</span>
      <span v-if="e.catalog_status" class="ev-cap" title="audio.cpp's own status for this model">{{ e.catalog_status.toUpperCase() }}</span>
    </span>
    <p v-if="v.description" class="ev-mfacts__desc">{{ v.description }}</p>
    <div v-if="v.hf_repo || tts" class="ev-mfacts__row">
      <UiButton v-if="v.hf_repo" intent="ghost" size="small" label="View on Hugging Face" @click="openExternal(`https://huggingface.co/${v.hf_repo}`)" />
      <!-- Set as default (version): what a line on this model speaks with when none is loaded -->
      <UiButton v-if="tts" :intent="isDefault ? 'success' : 'secondary'" size="small"
        :label="isDefault ? 'Default ✓' : 'Set as default'"
        title="The version this engine loads when nothing picks one explicitly"
        @click="isDefault ? null : setDefault()" />
    </div>
    <!-- The model's load options (audit 2026-10-04 §13.5; every one its spec lists since the
         adoption plan's E4): the ones JustVoice measured on the row, read when the model loads. -->
    <div v-if="rowOptions.length" class="ev-mplace" :data-variant-options="v.id">
      <template v-for="o in rowOptions" :key="o.key">
        {{ o.label }}
        <UiSelect :modelValue="o.value" width="id" size="small" :options="o.choices" :title="o.hint"
          :disabled="busy || osBlocked" @update:modelValue="(val) => setRuntimeOption(o.key, val)" />
      </template>
      <span class="ev-mplace__why">Read when the model loads — a change reloads it.</span>
    </div>
    <!-- The rest folded, as audio.cpp's own UI folds a model's options (a <details>, as the kit's
         ConfigColumn folds its samplers). -->
    <details v-if="foldedOptions.length" class="ev-mfold" :data-variant-load-options="v.id">
      <summary>Load options ({{ foldedOptions.length }})</summary>
      <p v-if="!rowOptions.length" class="ev-mplace__why">Read when the model loads — a change reloads it.</p>
      <DeliveryKnobs :knobs="optionKnobs" :values="optionValues" :pauses="[]" :disabled="busy || osBlocked"
        @commit="(key, val) => setRuntimeOption(key, val)" @reset="(key) => setRuntimeOption(key, null)" />
    </details>
  </div>
</template>
