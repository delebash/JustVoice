<!-- SPDX-License-Identifier: MIT -->
<!--
  ＋ New blend — inside the persona's page (decided 2026-10-04; plan
  docs/plans/2026-10-04-persona-voice-making.md §3). Moved from Voices →
  Blend: Kokoro's own voices, mixed four ways, with the same words. Keep saves
  it to Voices at once (B). (Recombine's custom cut points are not drawn.)
-->
<script setup>
import { computed, ref } from "vue";
import {
  UiButton, UiField, UiInput, UiSegmented, UiSelect, UiSlider, languageName, pushToast,
} from "@delebash/llm-ui";
import { facetOptions, facetTotal, narrowed } from "../../services/facets.js";
import { baseLang, voiceLabel } from "../../services/personaFacts.js";
import { genderWord, voiceGender } from "../../services/voiceGender.js";
import { keepVoice, silentWav, store, wait } from "../../services/mock/personaMock.js";

const props = defineProps({
  personaName: { type: String, default: "" },
});
const emit = defineEmits(["kept"]);

const STRATEGIES = [
  { value: "blend", label: "Blend" },
  { value: "extrapolate", label: "Extrapolate" },
  { value: "vector", label: "Vector math" },
  { value: "recombine", label: "Recombine" },
];
const STRATEGY_HINT = {
  blend: "A weighted mix of the picked voices. The weights are shares, so what matters is their ratio — the percentages below are what actually gets used.",
  extrapolate: "Amplify what makes one voice distinctive, by pushing it away from the average of every voice in the pack. 1 is the voice unchanged.",
  vector: "Voice arithmetic: add the voices carrying traits you want, subtract one carrying traits you don't. Try Michael + Heart − Sarah for a male Heart.",
  recombine: "Take a voice's timbre — what it sounds like — and have it speak with another voice's prosody: its rhythm, pacing and intonation.",
};
const strategy = ref("blend");

// ── The voices to pick from — Kokoro's own, filtered ────────────────────
const pack = computed(() => store.voices.filter((v) => v.model === "kokoro" && v.source === "preset"));
const langFilter = ref("");
const genderFilter = ref("");
// Language and gender each list only what the other leaves (decided
// 2026-10-05, services/facets.js) — French + Male left every picker empty.
const packFilters = computed(() => [
  { key: "lang", value: langFilter.value, test: (v, c) => baseLang(v.language) === c },
  { key: "gender", value: genderFilter.value, test: (v, g) => voiceGender(v) === g },
]);
const langOptions = computed(() => [
  { value: "", label: `Any language (${facetTotal(pack.value, packFilters.value, "lang")})` },
  ...facetOptions(pack.value, packFilters.value, "lang", (v) => baseLang(v.language), (c, n) => `${languageName(c) || c} (${n})`),
]);
const genderOptions = computed(() => [
  { value: "", label: "Any gender" },
  ...facetOptions(pack.value, packFilters.value, "gender", (v) => voiceGender(v), (g, n) => `${genderWord(g)} (${n})`),
]);
const pickable = computed(() => narrowed(pack.value, packFilters.value));
const voiceOptions = computed(() => [
  { value: "", label: "— pick a voice —" },
  ...pickable.value.map((v) => ({
    value: v.id,
    label: voiceLabel(v),
  })),
]);
const nameOf = (id) => store.voices.find((v) => v.id === id)?.name || "";

// ── Each way's own fields ───────────────────────────────────────────────
const MAX_SOURCES = 5;
const mix = ref([{ id: "", weight: 0.5 }, { id: "", weight: 0.5 }]);
const totalWeight = computed(() => mix.value.reduce((s, r) => s + (r.id ? Number(r.weight) : 0), 0));
const share = (r) => (r.id && totalWeight.value ? `${Math.round((Number(r.weight) / totalWeight.value) * 100)} %` : "—");
const amplify = ref("");
const intensity = ref(1.5);
const INTENSITY_MARKS = [{ value: 0, label: "0 · average" }, { value: 1, label: "1 · unchanged" }, { value: 3, label: "3 · extreme" }];
const adds = ref([{ id: "", weight: 1 }]);
const subs = ref([{ id: "", weight: 1 }]);
const timbre = ref("");
const prosody = ref("");

const blocker = computed(() => {
  const s = strategy.value;
  if (s === "extrapolate") return amplify.value ? "" : "Pick the voice to amplify.";
  if (s === "recombine") {
    if (!timbre.value) return "Pick the voice to take the timbre from.";
    if (!prosody.value) return "Pick the voice to take the prosody from.";
    return "";
  }
  if (s === "vector") {
    const used = [...adds.value, ...subs.value].filter((r) => r.id);
    if (!adds.value.some((r) => r.id)) return "Add at least one voice.";
    if (used.every((r) => !Number(r.weight))) return "Every weight is zero — nothing to combine.";
    return "";
  }
  const picked = mix.value.filter((r) => r.id);
  if (picked.length < 2) return "Pick at least two voices to mix.";
  if (!totalWeight.value) return "The weights must add up to more than zero.";
  return "";
});

function recipe() {
  const s = strategy.value;
  if (s === "extrapolate") return `${nameOf(amplify.value)} × ${intensity.value}`;
  if (s === "recombine") return `${nameOf(timbre.value)}'s timbre · ${nameOf(prosody.value)}'s prosody`;
  if (s === "vector") {
    return [...adds.value.filter((r) => r.id).map((r) => `+ ${nameOf(r.id)}`), ...subs.value.filter((r) => r.id).map((r) => `− ${nameOf(r.id)}`)].join(" ");
  }
  return mix.value.filter((r) => r.id).map((r) => `${nameOf(r.id)} ${share(r)}`).join(" · ");
}

// ── Preview, Keep ───────────────────────────────────────────────────────
const name = ref("");
const preview = ref(null);
const busy = ref(false);
async function runPreview() {
  if (blocker.value || busy.value) return;
  busy.value = true;
  await wait(600);
  if (preview.value?.url) URL.revokeObjectURL(preview.value.url);
  preview.value = { url: URL.createObjectURL(silentWav(4)), label: `${recipe()}, as ${props.personaName || "this persona"} speaks` };
  busy.value = false;
}
function keep() {
  if (blocker.value || !name.value.trim()) return;
  const v = keepVoice({
    engine: "kokoro", model: "kokoro", source: "blended", name: name.value.trim(),
    language: "en-US", gender: "", speaks: ["en-US"], blend: recipe(),
  });
  pushToast({ kind: "success", message: `Voice "${v.name}" saved to Voices.` });
  emit("kept", v);
}
</script>

<template>
  <div class="jv-card">
    <div class="jv-card__header">
      <h3 class="jv-card__title">New blend</h3>
    </div>
    <div class="jv-card__body jv-col">
      <p class="jv-hint">Blended voices mix Kokoro's own voices.</p>
      <UiSegmented v-model="strategy" :options="STRATEGIES" size="small" aria-label="How the voices combine" />
      <p class="jv-hint">{{ STRATEGY_HINT[strategy] }}</p>

      <div class="jv-field-row">
        <UiField label="Language" layout="block">
          <UiSelect v-model="langFilter" :options="langOptions" width="name" />
        </UiField>
        <UiField label="Gender" layout="block">
          <UiSelect v-model="genderFilter" :options="genderOptions" width="id" />
        </UiField>
      </div>

      <template v-if="strategy === 'blend'">
        <div v-for="(r, i) in mix" :key="i" class="jv-field-row">
          <UiField :label="i ? '' : 'Voice'" layout="block">
            <UiSelect v-model="r.id" :options="voiceOptions" width="name" />
          </UiField>
          <UiField :label="i ? '' : 'Weight'" layout="block">
            <UiSlider v-model="r.weight" :min="0" :max="1" :step="0.05" width="short" aria-label="Weight" />
          </UiField>
          <span class="jv-hint">{{ share(r) }}</span>
          <UiButton v-if="mix.length > 2" intent="ghost" size="small" label="✕" title="Remove this voice from the mix"
            @click="mix = mix.filter((_, j) => j !== i)" />
        </div>
        <div class="jv-inline-row"><UiButton intent="ghost" size="small" label="+ Add a voice" :disabled="mix.length >= MAX_SOURCES"
          @click="mix = [...mix, { id: '', weight: 0.5 }]" /></div>
      </template>

      <template v-else-if="strategy === 'extrapolate'">
        <div class="jv-field-row">
          <UiField label="Voice to amplify" layout="block">
            <UiSelect v-model="amplify" :options="voiceOptions" width="name" />
          </UiField>
          <UiField label="Intensity" layout="block">
            <UiSlider v-model="intensity" :min="0" :max="3" :step="0.05" width="regular" :marks="INTENSITY_MARKS" aria-label="Intensity" />
          </UiField>
        </div>
        <p class="jv-hint">Above 1 exaggerates what makes this voice unlike the others. Far above it, the voice leaves the range the model was trained on and can start to break up.</p>
      </template>

      <template v-else-if="strategy === 'vector'">
        <p class="jv-hint"><strong>Voices to add — traits you want</strong></p>
        <div v-for="(r, i) in adds" :key="`a${i}`" class="jv-field-row">
          <UiSelect v-model="r.id" :options="voiceOptions" width="name" aria-label="Voice to add" />
          <UiSlider v-model="r.weight" :min="0" :max="2" :step="0.05" width="short" aria-label="Strength" />
          <UiButton v-if="adds.length > 1" intent="ghost" size="small" label="✕" title="Remove this voice"
            @click="adds = adds.filter((_, j) => j !== i)" />
        </div>
        <div class="jv-inline-row"><UiButton intent="ghost" size="small" label="+ Add a voice" @click="adds = [...adds, { id: '', weight: 1 }]" /></div>
        <p class="jv-hint"><strong>Voices to subtract — traits you don't</strong></p>
        <div v-for="(r, i) in subs" :key="`s${i}`" class="jv-field-row">
          <UiSelect v-model="r.id" :options="voiceOptions" width="name" aria-label="Voice to subtract" />
          <UiSlider v-model="r.weight" :min="0" :max="2" :step="0.05" width="short" aria-label="Strength" />
          <UiButton v-if="subs.length > 1" intent="ghost" size="small" label="✕" title="Remove this voice"
            @click="subs = subs.filter((_, j) => j !== i)" />
        </div>
        <div class="jv-inline-row"><UiButton intent="ghost" size="small" label="+ Subtract a voice" @click="subs = [...subs, { id: '', weight: 1 }]" /></div>
        <p class="jv-hint">This one keeps its full strength instead of being averaged down, so the result is the arithmetic you asked for.</p>
      </template>

      <template v-else>
        <div class="jv-field-row">
          <UiField label="Timbre from" layout="block">
            <UiSelect v-model="timbre" :options="voiceOptions" width="name" />
          </UiField>
          <UiField label="Prosody from" layout="block">
            <UiSelect v-model="prosody" :options="voiceOptions" width="name" />
          </UiField>
        </div>
        <p class="jv-hint">Timbre is what the voice sounds like; prosody is its rhythm, pacing and intonation. They live in separate halves of the voice's style data, which is what makes this possible.</p>
      </template>

      <div class="jv-field-row">
        <UiField label="Name" layout="block">
          <UiInput v-model="name" width="name" placeholder="e.g. Dusk" />
        </UiField>
        <UiButton intent="secondary" :label="busy ? 'Rendering…' : '▶ Preview'" :loading="busy" :disabled="!!blocker"
          title="Speak the Hear it line with this blend, as this persona speaks" @click="runPreview" />
        <UiButton intent="primary" label="💾 Keep" :disabled="!!blocker || !name.trim()"
          :title="name.trim() ? 'Save this voice to Voices; this persona speaks with it' : 'Give the voice a name'" @click="keep" />
      </div>
      <p v-if="blocker" class="jv-muted">{{ blocker }}</p>
      <div v-if="preview" class="jv-col">
        <span class="jv-hint">{{ preview.label }}</span>
        <audio :src="preview.url" controls autoplay class="jv-audio-inline" />
      </div>
    </div>
  </div>
</template>
