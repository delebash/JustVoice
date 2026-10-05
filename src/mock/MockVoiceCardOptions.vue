<!-- SPDX-License-Identifier: MIT -->
<!--
  The persona page's Voice card, two ways, side by side — the user, 2026-10-05:
  "show me both, i want to see each option". Same mock voices, same rule for
  the filters (each lists only what the others leave — services/facets.js),
  the same Version field. Only the arrangement differs:
  A — "Made by" first: How it can be directed and Made by on top; Made by both
      narrows the list to one kind and, for a made kind, opens its maker.
  B — "Narrow the list": the filters (Made by among them, as a dropdown) in one
      box, then the voice, then "Or make a new one: Clone · Design · Blend".
  Dev only, under npm run dev: #/mock/voice-card.
-->
<script setup>
import { computed, reactive } from "vue";
import { UiButton, UiField, UiSegmented, UiSelect, languageName } from "@delebash/llm-ui";
import { facetChoices, facetCounts, facetOptions, facetTotal, narrowed } from "../services/facets.js";
import { DIRECTION_OPTIONS, VOICE_KINDS, voiceKind, voiceKindWord, voiceLabel } from "../services/personaFacts.js";
import { voiceGender } from "../services/voiceGender.js";
import { MODEL_VERSIONS, store } from "./personaMock.js";

const voices = computed(() => store.voices);
const DIRECTION_WORD = { words: "written direction", tags: "tags", sliders: "sliders only" };
const DIRECTION_EXAMPLE = { words: "describe it", tags: "[fear] [sigh]", sliders: "pace, pitch, gain" };
const GENDER_WORD = { F: "Female", M: "Male", N: "Neutral" };
const KIND_LABEL = { builtin: "Built-in", clone: "Cloned", design: "Designed", blend: "Blended" };
const MAKE = VOICE_KINDS.filter((k) => ["clone", "design", "blend"].includes(k.value));
const baseLang = (c) => String(c || "").split(/[-_]/)[0].toLowerCase();
// One card's state and its filters — the two cards don't share them.
function makeCard(withKindFilter) {
  const st = reactive({ direction: "", kind: withKindFilter ? "" : "builtin", model: "", gender: "", language: "", voice: "", maker: "" });
  const filters = computed(() => [
    { key: "direction", value: st.direction, test: (v, d) => v.directed_by === d },
    { key: "kind", value: st.kind, test: (v, k) => voiceKind(v) === k },
    { key: "model", value: st.model, test: (v, m) => v.model === m },
    { key: "gender", value: st.gender, test: (v, g) => voiceGender(v) === g },
    { key: "language", value: st.language, test: (v, c) => baseLang(v.language) === c },
  ]);
  const shown = computed(() => narrowed(voices.value, filters.value));
  const voice = computed(() => voices.value.find((v) => v.id === st.voice) || null);
  const names = computed(() => Object.fromEntries(voices.value.map((v) => [v.model, v.model_name || v.model])));
  return {
    st,
    shown,
    voice,
    direction: computed(() => {
      const n = facetCounts(voices.value, filters.value, "direction", ["words", "tags", "sliders"], (v, d) => v.directed_by === d);
      return DIRECTION_OPTIONS.map((o) => ({
        value: o.value,
        label: `${o.value ? o.label : "Any"} (${o.value ? n[o.value] : facetTotal(voices.value, filters.value, "direction")})`,
        sublabel: o.value ? DIRECTION_EXAMPLE[o.value] : "every voice",
      }));
    }),
    kindSegments: computed(() => {
      const n = facetCounts(voices.value, filters.value, "kind", ["builtin", "clone", "design", "blend"], (v, k) => voiceKind(v) === k);
      return VOICE_KINDS.map((k) => (k.disabled ? k : { ...k, label: `${k.label} (${n[k.value]})` }));
    }),
    kindOptions: computed(() => facetChoices(voices.value, filters.value, "kind",
      [{ value: "", label: "Any" }, ...["builtin", "clone", "design", "blend"].map((k) => ({ value: k, label: KIND_LABEL[k] }))],
      (v, k) => voiceKind(v) === k)),
    models: computed(() => [{ value: "", label: "All models" },
      ...facetOptions(voices.value, filters.value, "model", (v) => v.model, (m, n) => `${names.value[m] || m} (${n})`)]),
    genders: computed(() => [{ value: "", label: "Any gender" },
      ...facetOptions(voices.value, filters.value, "gender", (v) => (GENDER_WORD[voiceGender(v)] ? voiceGender(v) : ""),
        (g, n) => `${GENDER_WORD[g]} (${n})`)]),
    languages: computed(() => [{ value: "", label: "All languages" },
      ...facetOptions(voices.value, filters.value, "language", (v) => baseLang(v.language), (c, n) => `${languageName(c) || c} (${n})`)]),
    voiceOptions: computed(() => {
      const list = voice.value && !shown.value.includes(voice.value) ? [voice.value, ...shown.value] : shown.value;
      return list.map((v) => ({
        value: v.id,
        label: [voiceLabel(v), voiceKind(v) !== "builtin" ? voiceKindWord(v) : "", DIRECTION_WORD[v.directed_by] || "sliders only"]
          .filter(Boolean).join(" · "),
      }));
    }),
    versions: computed(() => (MODEL_VERSIONS[voice.value?.model] || []).map((x) => ({ value: x, label: x }))),
    clear() { Object.assign(st, { direction: "", model: "", gender: "", language: "", kind: withKindFilter ? "" : st.kind }); },
  };
}
const a = makeCard(false);
const b = makeCard(true);
// A: a made kind opens its maker; Built-in shows none.
const aMaker = computed(() => (a.st.kind !== "builtin" ? a.st.kind : ""));
const MAKER_TITLE = { clone: "New clone", design: "New design", blend: "New blend" };
const MAKER_LEDE = {
  clone: "Record or pick a clip, choose the model it's for, and hear it as this persona before you keep it.",
  design: "Describe the voice in words, hear the takes, and keep the one you want.",
  blend: "Pick 2 to 5 of Kokoro's voices and give each a weight.",
};
</script>

<template>
  <div class="mock-vc">
    <!-- A — Made by first -->
    <section class="mock-vc__col">
      <p class="jv-eyebrow">A · Made by first</p>
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Voice</h3></div>
        <div class="jv-card__body jv-col">
          <UiField label="How it can be directed" layout="block">
            <UiSegmented v-model="a.st.direction" :options="a.direction.value" size="small" aria-label="How it can be directed" />
          </UiField>
          <UiField label="Made by" layout="block">
            <UiSegmented v-model="a.st.kind" :options="a.kindSegments.value" size="small" aria-label="Made by" />
          </UiField>
          <div class="jv-field-row">
            <UiField label="Model" layout="block"><UiSelect v-model="a.st.model" :options="a.models.value" width="name" /></UiField>
            <UiField label="Gender" layout="block"><UiSelect v-model="a.st.gender" :options="a.genders.value" width="id" /></UiField>
            <UiField label="Voice's language" layout="block"><UiSelect v-model="a.st.language" :options="a.languages.value" width="id" /></UiField>
          </div>
          <div class="jv-field-row">
            <UiField label="Voice" layout="block">
              <UiSelect v-model="a.st.voice" :options="a.voiceOptions.value" width="path" placeholder="Pick a voice" />
            </UiField>
            <UiButton intent="secondary" label="▶ Play" :disabled="!a.voice.value" />
            <UiField v-if="a.versions.value.length" label="Version" layout="block">
              <UiSelect :model-value="a.versions.value[0].value" :options="a.versions.value" width="name" />
            </UiField>
          </div>
          <p class="jv-hint">{{ a.shown.value.length }} voices</p>
        </div>
      </div>
      <div v-if="aMaker" class="jv-card jv-card--soft">
        <div class="jv-card__header"><h3 class="jv-card__title">{{ MAKER_TITLE[aMaker] }}</h3></div>
        <div class="jv-card__body"><p class="jv-hint">{{ MAKER_LEDE[aMaker] }}</p></div>
      </div>
    </section>

    <!-- B — Narrow the list -->
    <section class="mock-vc__col">
      <p class="jv-eyebrow">B · Narrow the list</p>
      <div class="jv-card">
        <div class="jv-card__header"><h3 class="jv-card__title">Voice</h3></div>
        <div class="jv-card__body jv-col">
          <div class="mock-vc__narrow">
            <span class="jv-eyebrow">Narrow the list</span>
            <UiField label="How it can be directed" layout="block">
              <UiSegmented v-model="b.st.direction" :options="b.direction.value" size="small" aria-label="How it can be directed" />
            </UiField>
            <div class="jv-field-row">
              <UiField label="Made by" layout="block"><UiSelect v-model="b.st.kind" :options="b.kindOptions.value" width="id" /></UiField>
              <UiField label="Model" layout="block"><UiSelect v-model="b.st.model" :options="b.models.value" width="name" /></UiField>
              <UiField label="Gender" layout="block"><UiSelect v-model="b.st.gender" :options="b.genders.value" width="id" /></UiField>
              <UiField label="Voice's language" layout="block"><UiSelect v-model="b.st.language" :options="b.languages.value" width="id" /></UiField>
              <span class="jv-hint mock-vc__count">{{ b.shown.value.length }} voices</span>
              <UiButton intent="ghost" size="small" label="Clear" @click="b.clear()" />
            </div>
          </div>
          <div class="jv-field-row">
            <UiField label="Voice" layout="block">
              <UiSelect v-model="b.st.voice" :options="b.voiceOptions.value" width="path" placeholder="Pick a voice" />
            </UiField>
            <UiButton intent="secondary" label="▶ Play" :disabled="!b.voice.value" />
            <UiField v-if="b.versions.value.length" label="Version" layout="block">
              <UiSelect :model-value="b.versions.value[0].value" :options="b.versions.value" width="name" />
            </UiField>
          </div>
          <div class="jv-inline-row">
            <span class="jv-hint">Or make a new one:</span>
            <UiButton v-for="k in MAKE" :key="k.value" size="small" :label="k.label"
              :intent="b.st.maker === k.value ? 'primary' : 'secondary'"
              @click="b.st.maker = b.st.maker === k.value ? '' : k.value" />
          </div>
        </div>
      </div>
      <div v-if="b.st.maker" class="jv-card jv-card--soft">
        <div class="jv-card__header"><h3 class="jv-card__title">{{ MAKER_TITLE[b.st.maker] }}</h3></div>
        <div class="jv-card__body"><p class="jv-hint">{{ MAKER_LEDE[b.st.maker] }}</p></div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.mock-vc { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
.mock-vc__col { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.mock-vc__narrow { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px;
  border: 1px solid var(--line); border-radius: var(--r-control); background: var(--surface-2); }
.mock-vc__count { align-self: flex-end; padding-bottom: 8px; }
@media (max-width: 1100px) { .mock-vc { grid-template-columns: 1fr; } }
</style>
