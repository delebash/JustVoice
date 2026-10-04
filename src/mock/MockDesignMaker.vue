<!-- SPDX-License-Identifier: MIT -->
<!--
  ＋ New design — inside the persona's page (decided 2026-10-04; plan
  docs/plans/2026-10-04-persona-voice-making.md §3). Both of the 08-22
  paths ("same as alexandria"):
    · Keep as a description — the voice IS the words; every line is spoken
      from them (Qwen3 VoiceDesign or VoxCPM2), so it can shift a little from
      line to line.
    · Keep this take — one take you liked becomes the voice's clip, spoken by
      a clone model, so it sounds the same on every line.
  Either way it is saved to Voices the moment you keep it (B), and a kept
  voice is fixed: "＋ New design from this one" on the persona starts a copy.
  "Start from the note" copies the persona's note in — never silently
  (2026-08-15 §3 decision 11).
-->
<script setup>
import { computed, ref } from "vue";
import { UiButton, UiChip, UiField, UiInput, UiSelect, UiTextarea, pushToast } from "@delebash/llm-ui";
import { capabilities, keepVoice, silentWav, wait } from "./personaMock.js";
import { MODEL_NOTE, engineOf, languageOptionsFor, modelOptions } from "./mockMakers.js";

const props = defineProps({
  personaName: { type: String, default: "" },
  note: { type: String, default: "" },
  startFrom: { type: Object, default: null },   // a kept design to copy: {name, design_prompt, model}
});
const emit = defineEmits(["kept", "close"]);

const DESIGN_NOTE = {
  "qwen3-vd": MODEL_NOTE["qwen3-vd"],
  voxcpm2: "Each line is spoken from the description, so the voice can shift a little from line to line. Takes written direction on top. 30 languages.",
};

const options = computed(() => modelOptions("supports_voice_design"));
const model = ref(props.startFrom?.model && DESIGN_NOTE[props.startFrom.model] ? props.startFrom.model : "qwen3-vd");
const row = computed(() => capabilities[model.value] || null);
const description = ref(props.startFrom?.design_prompt || "");
const name = ref(props.startFrom ? `${props.startFrom.name} (2)` : "");
const language = ref("");
const languages = computed(() => languageOptionsFor(model.value));

function fromNote() {
  description.value = props.note;
}

// ── Takes — every Preview is a fresh roll ───────────────────────────────
const takes = ref([]);       // [{n, url}]
const chosen = ref(null);    // a take's n
const busy = ref(false);
const blocker = computed(() => {
  if (!description.value.trim()) return "Describe the voice you want.";
  return "";
});
async function runPreview() {
  if (blocker.value || busy.value) return;
  busy.value = true;
  await wait(1100);
  const n = (takes.value.at(-1)?.n || 0) + 1;
  takes.value = [...takes.value, { n, url: URL.createObjectURL(silentWav(4)) }].slice(-5);
  chosen.value = n;
  busy.value = false;
}
const chosenTake = computed(() => takes.value.find((t) => t.n === chosen.value) || null);

// ── Keep ────────────────────────────────────────────────────────────────
const cloneOptions = computed(() => modelOptions("supports_voice_cloning"));
const cloneModel = ref("voxcpm2");
function base(fields) {
  return {
    source: "designed", name: name.value.trim(), gender: "",
    language: language.value || languages.value.find((l) => l.value === "en")?.value || languages.value[0]?.value || "en",
    design_prompt: description.value.trim(), ...fields,
  };
}
function keepDescription() {
  if (blocker.value || !name.value.trim()) return;
  const v = keepVoice(base({ engine: engineOf(model.value), model: model.value }));
  pushToast({ kind: "success", message: `Voice "${v.name}" saved to Voices.` });
  emit("kept", v);
}
function keepTake() {
  if (!chosenTake.value || !name.value.trim()) return;
  const v = keepVoice(base({ engine: engineOf(cloneModel.value), model: cloneModel.value, clip: { seconds: 4, snr: 40 } }));
  pushToast({ kind: "success", message: `Voice "${v.name}" saved to Voices — take ${chosenTake.value.n} is its clip.` });
  emit("kept", v);
}
</script>

<template>
  <div class="jv-card">
    <div class="jv-card__header">
      <h3 class="jv-card__title">New design</h3>
      <UiButton intent="ghost" size="small" label="✕" title="Close without keeping" @click="emit('close')" />
    </div>
    <div class="jv-card__body jv-col">
      <div class="jv-field-row">
        <UiField label="Model" layout="block">
          <UiSelect v-model="model" :options="options" width="name" />
        </UiField>
        <UiField v-if="languages.length > 1" label="Language" layout="block">
          <UiSelect v-model="language" :options="[{ value: '', label: 'Auto' }, ...languages]" width="id" />
        </UiField>
      </div>
      <p class="jv-hint">{{ DESIGN_NOTE[model] }}</p>

      <UiField layout="block" class="jv-stretch"
        hint="Age, accent, texture, pace, mood — the model reads this the way a director reads a note.">
        <template #label>
          <span class="jv-field-label-row">Describe the voice
            <UiButton intent="ghost" size="small" label="↧ Start from the note" :disabled="!note"
              :title="note ? `Copy ${personaName || 'this persona'}'s note in, to edit` : 'This persona has no note yet'" @click="fromNote" />
          </span>
        </template>
        <UiTextarea v-model="description" :rows="3" placeholder="a gravel-voiced harbour-master in his seventies, unhurried" />
      </UiField>

      <div class="jv-field-row">
        <UiField label="Name" layout="block">
          <UiInput v-model="name" width="name" placeholder="e.g. Harbour-master" />
        </UiField>
        <UiButton intent="secondary" :label="busy ? 'Rendering…' : '▶ Preview'" :loading="busy" :disabled="!!blocker"
          title="Speak the Hear it line from this description — each preview is a new take" @click="runPreview" />
      </div>
      <p v-if="blocker" class="jv-muted">{{ blocker }}</p>

      <div v-if="takes.length" class="jv-col">
        <div class="jv-inline-row">
          <UiChip v-for="t in takes" :key="t.n" :selected="chosen === t.n" :label="`Take ${t.n}`" @click="chosen = t.n" />
        </div>
        <audio v-if="chosenTake" :src="chosenTake.url" controls autoplay class="jv-audio-inline" />
      </div>

      <div class="jv-col">
        <div class="jv-col jv-col--start">
          <UiButton intent="primary" label="💾 Keep as a description" :disabled="!!blocker || !name.trim()"
            :title="name.trim() ? '' : 'Give the voice a name'" @click="keepDescription" />
          <p class="jv-hint">Every line is spoken from these words. It can shift a little between lines.</p>
        </div>
        <div class="jv-col jv-col--start">
          <div class="jv-field-row">
            <UiField label="Spoken by" layout="block">
              <UiSelect v-model="cloneModel" :options="cloneOptions" width="name" />
            </UiField>
            <UiButton intent="secondary" :label="chosenTake ? `📌 Keep take ${chosenTake.n}` : '📌 Keep a take'"
              :disabled="!chosenTake || !name.trim()"
              :title="chosenTake ? '' : 'Preview first, then keep the take you like'" @click="keepTake" />
          </div>
          <p class="jv-hint">The take becomes the voice's clip, so it sounds the same on every line. {{ MODEL_NOTE[cloneModel] }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
