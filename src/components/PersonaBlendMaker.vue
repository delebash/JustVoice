<!-- SPDX-License-Identifier: MIT -->
<!--
  New blend — on the persona's own page, at the top of the right column while
  "Type" is Blended (decided 2026-10-04; plan
  docs/plans/2026-10-04-persona-voice-making.md §3; the approved mock is
  src/components/mock/MockBlendMaker.vue). Moved from Voices → Blend whole: Kokoro's own
  voices, mixed four ways — Blend, Extrapolate, Vector math, Recombine (with
  its custom cut points) — with the same words and the same checks. ▶ Preview
  speaks the Hear it line with the mix AS the persona; 💾 Keep saves it to
  Voices at once and the persona takes it.

  Why the four ways are what they are — StyleTTS2's two halves, the pack
  mean, the analogy arithmetic — is recorded where they were built, beside
  Voices' old Blend tab (then views/VoicesView.vue, 2026-08-21).
-->
<script setup>
import { computed, ref } from "vue";
import {
  UiButton, UiCheckbox, UiField, UiInput, UiSegmented, UiSelect, UiSlider, languageName, pushToast,
} from "@delebash/llm-ui";
import { handleTermsRefusal } from "../services/engineTerms.js";
import { facetOptions, facetTotal, narrowed } from "../services/facets.js";
import { baseLang, voiceLabel } from "../services/personaFacts.js";
import { genderWord, voiceGender } from "../services/voiceGender.js";
import { previewCandidate } from "../services/voiceMakers.js";
import { useApi } from "../stores/api.js";

const props = defineProps({
  voices: { type: Array, default: () => [] },     // the voices store's items
  persona: { type: Object, default: null },
  hearText: { type: String, default: "" },
});
const emit = defineEmits(["kept"]);
const api = useApi();

const BLEND_MAX_SOURCES = 5;
// The server resolves this pseudo-id to the pack's centroid
// (engines/blending.py MEAN_SOURCE) — keep the two spellings in step.
const MEAN_SOURCE = "__pack_mean__";
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

// ── The voices you can mix — Kokoro's, found by language and gender ─────
const pack = computed(() => props.voices.filter((v) => v.engine === "kokoro"));
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
const voiceOptions = computed(() => [
  { value: "", label: "— pick a voice —" },
  ...narrowed(pack.value, packFilters.value)
    .map((v) => ({
      value: v.id,
      label: voiceLabel(v),
    })),
]);
const nameOf = (id) => props.voices.find((v) => v.id === id)?.name || "";

// ── Each way's own fields ───────────────────────────────────────────────
const mix = ref([{ voice_id: "", weight: 1 }, { voice_id: "", weight: 1 }]);
const amplify = ref("");
const intensity = ref(1.5);
const INTENSITY_MARKS = [{ value: 0, label: "0 · average" }, { value: 1, label: "1 · unchanged" }, { value: 3, label: "3 · extreme" }];
const adds = ref([{ voice_id: "", weight: 1 }, { voice_id: "", weight: 1 }]);
const subs = ref([{ voice_id: "", weight: 1 }]);
const timbre = ref("");
const prosody = ref("");
const customCut = ref(false);
const segments = ref([{ voice_id: "", start: 0, end: 0.5 }, { voice_id: "", start: 0.5, end: 1 }]);
const pct = (n) => `${Math.round((Number(n) || 0) * 100)}%`;

/** Everything the chosen way sends: ids + weights, or segments. */
function blendPayload() {
  const s = strategy.value;
  if (s === "extrapolate") {
    const k = Number(intensity.value) || 0;
    // mean + k·(v − mean) = k·v + (1−k)·mean — an ordinary weighted combination.
    return { strategy: s, ids: amplify.value ? [amplify.value, MEAN_SOURCE] : [], weights: [k, 1 - k], segments: null };
  }
  if (s === "vector") {
    const add = adds.value.filter((r) => r.voice_id);
    const sub = subs.value.filter((r) => r.voice_id);
    return {
      strategy: s,
      ids: [...add, ...sub].map((r) => r.voice_id),
      weights: [...add.map((r) => Math.abs(Number(r.weight) || 0)), ...sub.map((r) => -Math.abs(Number(r.weight) || 0))],
      segments: null,
    };
  }
  if (s === "recombine") {
    const segs = customCut.value
      ? segments.value.filter((g) => g.voice_id)
      : timbre.value && prosody.value
        ? [{ voice_id: timbre.value, start: 0, end: 0.5 }, { voice_id: prosody.value, start: 0.5, end: 1 }]
        : [];
    return { strategy: s, ids: segs.map((g) => g.voice_id), weights: [], segments: segs };
  }
  const picked = mix.value.filter((r) => r.voice_id);
  return { strategy: s, ids: picked.map((r) => r.voice_id), weights: picked.map((r) => Number(r.weight) || 0), segments: null };
}
function share(r) {
  const picked = mix.value.filter((x) => x.voice_id);
  const total = picked.reduce((a, x) => a + (Number(x.weight) || 0), 0);
  return r.voice_id && total > 0 ? `${Math.round(((Number(r.weight) || 0) / total) * 100)}%` : "";
}
const blocker = computed(() => {
  const p = blendPayload();
  if (p.strategy === "extrapolate") return amplify.value ? "" : "Pick the voice to amplify.";
  if (p.strategy === "recombine") {
    if (customCut.value) {
      if (p.segments.length < 2) return "Pick a voice for each segment.";
      const covered = [...p.segments].sort((a, b) => a.start - b.start);
      if (covered[0].start > 0 || covered[covered.length - 1].end < 1) {
        return "The segments must cover 0% to 100% — a style vector with holes does not render.";
      }
      return "";
    }
    if (!timbre.value) return "Pick the voice to take the timbre from.";
    if (!prosody.value) return "Pick the voice to take the prosody from.";
    return "";
  }
  if (p.strategy === "vector") {
    if (!adds.value.some((r) => r.voice_id)) return "Add at least one voice.";
    if (!p.weights.some((w) => w !== 0)) return "Every weight is zero — nothing to combine.";
    return "";
  }
  if (p.ids.length < 2) return "Pick at least two voices to mix.";
  if (p.weights.reduce((a, b) => a + b, 0) <= 0) return "The weights must add up to more than zero.";
  return "";
});
function recipe() {
  const p = blendPayload();
  if (p.strategy === "extrapolate") return `${nameOf(amplify.value)} × ${intensity.value}`;
  if (p.strategy === "recombine") return p.segments.map((g) => `${nameOf(g.voice_id)} ${pct(g.start)}–${pct(g.end)}`).join(" · ");
  if (p.strategy === "vector") return p.ids.map((id, i) => `${p.weights[i] < 0 ? "−" : "+"} ${nameOf(id)}`).join(" ");
  return mix.value.filter((r) => r.voice_id).map((r) => `${nameOf(r.voice_id)} ${share(r)}`).join(" · ");
}

// ── ▶ Preview, 💾 Keep ──────────────────────────────────────────────────
const name = ref("");
const preview = ref(null);
const busy = ref(false);
const keeping = ref(false);
function candidate() {
  const p = blendPayload();
  return {
    engine: "kokoro", model: "kokoro", source: "blended", strategy: p.strategy,
    source_voice_ids: p.ids, weights: p.weights, ...(p.segments ? { segments: p.segments } : {}),
  };
}
async function runPreview() {
  if (blocker.value || busy.value) return;
  busy.value = true;
  try {
    const { blob } = await previewCandidate(api, props.persona, candidate(), props.hearText);
    if (preview.value?.url) URL.revokeObjectURL(preview.value.url);
    preview.value = { url: URL.createObjectURL(blob), label: `${recipe()}, as this persona speaks` };
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ message: `Preview failed: ${e?.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}
async function keep() {
  if (blocker.value || !name.value.trim() || keeping.value) return;
  keeping.value = true;
  try {
    const voice = await api.request("/v1/voices/blend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...candidate(), name: name.value.trim() }),
    });
    pushToast({ message: `Voice "${voice.name}" saved to Voices.`, kind: "success" });
    emit("kept", voice);
  } catch (e) {
    pushToast({ message: `Keep failed: ${e?.message || e}`, kind: "error" });
  } finally {
    keeping.value = false;
  }
}
</script>

<template>
  <div class="jv-card">
    <div class="jv-card__header"><h3 class="jv-card__title">New blend</h3></div>
    <div class="jv-card__body jv-col">
      <p class="jv-hint">Blended voices mix Kokoro's own voices.</p>
      <div class="jv-inline-row">
        <UiSegmented v-model="strategy" :options="STRATEGIES" size="small" aria-label="How the voices combine" />
      </div>
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
        <div v-for="(r, i) in mix" :key="`m${i}`" class="jv-field-row">
          <UiField :label="i ? '' : 'Voice'" layout="block">
            <UiSelect v-model="r.voice_id" :options="voiceOptions" width="name" />
          </UiField>
          <UiField :label="i ? '' : 'Weight'" layout="block">
            <UiSlider v-model="r.weight" :min="0" :max="1" :step="0.05" width="short" aria-label="Weight" />
          </UiField>
          <span class="jv-hint">{{ share(r) }}</span>
          <UiButton v-if="mix.length > 2" intent="ghost" size="small" label="✕" title="Remove this voice from the mix"
            @click="mix = mix.filter((_, j) => j !== i)" />
        </div>
        <div class="jv-inline-row">
          <UiButton intent="ghost" size="small" label="+ Add a voice" :disabled="mix.length >= BLEND_MAX_SOURCES"
            @click="mix = [...mix, { voice_id: '', weight: 1 }]" />
        </div>
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
          <UiSelect v-model="r.voice_id" :options="voiceOptions" width="name" aria-label="Voice to add" />
          <UiSlider v-model="r.weight" :min="0" :max="2" :step="0.05" width="short" aria-label="Strength" />
          <UiButton v-if="adds.length > 1" intent="ghost" size="small" label="✕" title="Remove this voice"
            @click="adds = adds.filter((_, j) => j !== i)" />
        </div>
        <div class="jv-inline-row">
          <UiButton intent="ghost" size="small" label="+ Add a voice" @click="adds = [...adds, { voice_id: '', weight: 1 }]" />
        </div>
        <p class="jv-hint"><strong>Voices to subtract — traits you don't</strong></p>
        <div v-for="(r, i) in subs" :key="`s${i}`" class="jv-field-row">
          <UiSelect v-model="r.voice_id" :options="voiceOptions" width="name" aria-label="Voice to subtract" />
          <UiSlider v-model="r.weight" :min="0" :max="2" :step="0.05" width="short" aria-label="Strength" />
          <UiButton v-if="subs.length > 1" intent="ghost" size="small" label="✕" title="Remove this voice"
            @click="subs = subs.filter((_, j) => j !== i)" />
        </div>
        <div class="jv-inline-row">
          <UiButton intent="ghost" size="small" label="+ Subtract a voice" @click="subs = [...subs, { voice_id: '', weight: 1 }]" />
        </div>
        <p class="jv-hint">This one keeps its full strength instead of being averaged down, so the result is the arithmetic you asked for.</p>
      </template>

      <template v-else>
        <template v-if="!customCut">
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
        <template v-else>
          <div v-for="(g, i) in segments" :key="`g${i}`" class="jv-field-row">
            <UiField :label="i ? '' : 'Voice'" layout="block">
              <UiSelect v-model="g.voice_id" :options="voiceOptions" width="name" />
            </UiField>
            <UiField :label="i ? '' : 'From'" layout="block">
              <UiSlider v-model="g.start" :min="0" :max="1" :step="0.05" width="short" :format="pct" readout aria-label="From" />
            </UiField>
            <UiField :label="i ? '' : 'To'" layout="block">
              <UiSlider v-model="g.end" :min="0" :max="1" :step="0.05" width="short" :format="pct" readout aria-label="To" />
            </UiField>
            <UiButton v-if="segments.length > 2" intent="ghost" size="small" label="✕" title="Remove this segment"
              @click="segments = segments.filter((_, j) => j !== i)" />
          </div>
          <div class="jv-inline-row">
            <UiButton intent="ghost" size="small" label="+ Add a segment"
              @click="segments = [...segments, { voice_id: '', start: 0, end: 1 }]" />
          </div>
          <p class="jv-hint">0–50% is timbre, 50–100% is prosody. The segments have to cover the whole range — a style vector with holes in it does not render.</p>
        </template>
        <UiCheckbox v-model="customCut" label="Cut somewhere other than the timbre/prosody seam" />
      </template>

      <div class="jv-field-row">
        <UiField label="Name" layout="block">
          <UiInput v-model="name" width="name" placeholder="e.g. Dusk" />
        </UiField>
        <UiButton intent="secondary" :label="busy ? 'Rendering…' : '▶ Preview'" :loading="busy" :disabled="!!blocker"
          title="Speak the Hear it line with this blend, as this persona speaks" @click="runPreview" />
        <UiButton intent="primary" label="💾 Keep" :loading="keeping" :disabled="!!blocker || !name.trim()"
          :title="name.trim() ? 'Save this voice to Voices; this persona speaks with it' : 'Give the voice a name'" @click="keep" />
      </div>
      <p v-if="blocker && blendPayload().ids.length" class="jv-muted">{{ blocker }}</p>
      <div v-if="preview" class="jv-col">
        <span class="jv-hint">{{ preview.label }}</span>
        <audio :src="preview.url" controls autoplay class="jv-audio-inline" />
      </div>
    </div>
  </div>
</template>
