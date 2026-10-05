<!-- SPDX-License-Identifier: MIT -->
<!--
  New design — on the persona's own page, at the top of the right column while
  "Type" is Designed (decided 2026-10-04; plan
  docs/plans/2026-10-04-persona-voice-making.md §3; the approved mock is
  src/mock/MockDesignMaker.vue). Both of the 08-22 paths ("same as
  alexandria"):
    · 💾 Keep as a description — the voice IS the words; every line is spoken
      from them (Qwen3 VoiceDesign or VoxCPM2), so it can shift a little from
      line to line;
    · 📌 Keep a take — one take you liked becomes the voice's clip, spoken by a
      clone model you pick, so it sounds the same on every line; it stays a
      design with its description.
  Each ▶ Preview is a new take, spoken AS the persona. Either Keep saves to
  Voices at once; a kept voice is fixed — the page's "Start from this one"
  copies a kept design's words in here. "Start from the note" copies the
  persona's note in — never silently (2026-08-15 §3 decision 11).
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { UiButton, UiChip, UiField, UiInput, UiSelect, UiTextarea, languageName, pushToast } from "@delebash/llm-ui";
import { handleTermsRefusal } from "../services/engineTerms.js";
import {
  DESIGN_NOTE, MODEL_NOTE, engineOfRow, makerModelOptions, preferredModel, previewCandidate,
} from "../services/voiceMakers.js";
import { useApi } from "../stores/api.js";

const props = defineProps({
  rows: { type: Object, default: () => ({}) },
  engines: { type: Array, default: () => [] },
  direction: { type: String, default: "" },
  persona: { type: Object, default: null },
  hearText: { type: String, default: "" },
  note: { type: String, default: "" },            // the persona's note
  startFrom: { type: Object, default: null },     // a kept design to start a copy from
});
const emit = defineEmits(["kept"]);
const api = useApi();
const router = useRouter();

// ── The design model ────────────────────────────────────────────────────
const options = computed(() => makerModelOptions(props.rows, props.engines, "supports_voice_design"));
const model = ref("");
watch(options, (opts) => {
  if (opts.some((o) => o.value === model.value)) return;
  const wanted = props.startFrom?.model;
  model.value = opts.some((o) => o.value === wanted) ? wanted : preferredModel(opts, ["qwen3-vd", "voxcpm2"]);
}, { immediate: true });
const row = computed(() => props.rows[model.value] || null);
const engine = computed(() => engineOfRow(props.engines, model.value));
const runtimeMissing = computed(() => engine.value?.status === "not_installed");
const notLoaded = computed(() => !!engine.value && engine.value.status !== "loaded" && !runtimeMissing.value);

const variants = ref({});
watch(engine, async (e) => {
  if (!e || variants.value[e.id]) return;
  const r = await api.safeRequest(`/v1/engines/${e.id}/models`, { variants: [] });
  variants.value = { ...variants.value, [e.id]: r?.variants || [] };
}, { immediate: true });
const languageOptions = computed(() => {
  const all = variants.value[engine.value?.id] || [];
  const family = all.filter((v) => v.id === model.value || v.id.startsWith(`${model.value}-`));
  const codes = [...new Set((family.length ? family : all).flatMap((v) => v.languages || []))];
  return codes.map((c) => ({ value: c, label: languageName(c) || c })).sort((a, b) => a.label.localeCompare(b.label));
});
const language = ref("");
watch(languageOptions, (opts) => {
  if (language.value && !opts.some((o) => o.value === language.value)) language.value = "";
});
function spokenLanguage() {
  return language.value || props.persona?.language || languageOptions.value.find((o) => o.value === "en")?.value
    || languageOptions.value[0]?.value || "en";
}

const description = ref(props.startFrom?.design_prompt || "");
const name = ref(props.startFrom ? `${props.startFrom.name} (2)` : "");
function fromNote() {
  description.value = props.note;
}

// ── Takes — every ▶ Preview is a new one ─────────────────────────────────
const takes = ref([]);       // [{n, url, previewId}]
const chosen = ref(null);
const busy = ref(false);
const blocker = computed(() => {
  if (!model.value) return "No model here can design a voice — install Qwen3 VoiceDesign or VoxCPM2 on AI Settings → Speech engines.";
  if (runtimeMissing.value) return "Install the speech runtime first.";
  if (!description.value.trim()) return "Describe the voice you want.";
  return "";
});
function candidate() {
  return {
    engine: engine.value.id, model: model.value, source: "designed",
    prompt: description.value.trim(), language: spokenLanguage(),
  };
}
async function runPreview() {
  if (blocker.value || busy.value) return;
  busy.value = true;
  try {
    const { blob, previewId } = await previewCandidate(api, props.persona, candidate(), props.hearText);
    const n = (takes.value.at(-1)?.n || 0) + 1;
    const dropped = takes.value.length >= 5 ? takes.value[0] : null;
    if (dropped) URL.revokeObjectURL(dropped.url);
    takes.value = [...takes.value.slice(dropped ? 1 : 0), { n, url: URL.createObjectURL(blob), previewId }];
    chosen.value = n;
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ message: `Preview failed: ${e?.message || e}`, kind: "error" });
  } finally {
    busy.value = false;
  }
}
const chosenTake = computed(() => takes.value.find((t) => t.n === chosen.value) || null);
onBeforeUnmount(() => { for (const t of takes.value) URL.revokeObjectURL(t.url); });

// ── Keep ────────────────────────────────────────────────────────────────
// Both design models take written direction, so a voice kept as its
// description does too; asked for tags or sliders only, keep a take instead.
const descriptionOff = computed(() => (props.direction && props.direction !== "words"
  ? "Qwen3 VoiceDesign and VoxCPM2 take written direction — keep a take on a model below instead."
  : ""));
const cloneOptions = computed(() => makerModelOptions(props.rows, props.engines, "supports_voice_cloning", props.direction));
const cloneModel = ref("");
watch(cloneOptions, (opts) => {
  if (!opts.some((o) => o.value === cloneModel.value)) {
    cloneModel.value = preferredModel(opts, ["voxcpm2", "chatterbox-turbo", "chatterbox-multilingual", "qwen3-base", "pocket"]);
  }
}, { immediate: true });
const keeping = ref(false);
async function keepDescription() {
  if (blocker.value || descriptionOff.value || !name.value.trim() || keeping.value) return;
  keeping.value = true;
  try {
    const c = candidate();
    const voice = await api.request("/v1/voices/design", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engine: c.engine, model: c.model, name: name.value.trim(), prompt: c.prompt, language: c.language }),
    });
    pushToast({ message: `Voice "${voice.name}" saved to Voices.`, kind: "success" });
    emit("kept", voice);
  } catch (e) {
    pushToast({ message: `Keep failed: ${e?.message || e}`, kind: "error" });
  } finally {
    keeping.value = false;
  }
}
async function keepTake() {
  const take = chosenTake.value;
  if (!take || !cloneModel.value || !name.value.trim() || keeping.value) return;
  keeping.value = true;
  try {
    const r = await api.request(`/v1/voices/preview/${take.previewId}/save`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name.value.trim(), model: cloneModel.value }),
    });
    const voice = await api.request(`/v1/voices/${r.voice_id}`);
    pushToast({ message: `Voice "${voice.name}" saved to Voices — take ${take.n} is its clip.`, kind: "success" });
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
    <div class="jv-card__header"><h3 class="jv-card__title">New design</h3></div>
    <div class="jv-card__body jv-col">
      <div class="jv-field-row">
        <UiField label="Model" layout="block">
          <UiSelect v-model="model" :options="options" width="name" :disabled="!options.length" placeholder="None can design here" />
        </UiField>
        <UiField v-if="languageOptions.length > 1" label="Language" layout="block">
          <UiSelect v-model="language" :options="[{ value: '', label: 'Auto' }, ...languageOptions]" width="id" />
        </UiField>
      </div>
      <p v-if="DESIGN_NOTE[model]" class="jv-hint">{{ DESIGN_NOTE[model] }}</p>
      <p v-if="notLoaded" class="jv-hint">{{ row?.display_name || model }} isn't loaded — the first preview loads it, about a minute.</p>
      <div v-if="runtimeMissing" class="jv-banner jv-banner--warn">
        <strong>The speech runtime isn't installed.</strong>
        <div class="jv-inline-row">
          <UiButton intent="secondary" size="small" label="Open Speech engines"
            @click="router.push({ path: '/ai', query: { tab: 'speech-engines' } })" />
        </div>
      </div>

      <UiField layout="block" hint="Age, accent, texture, pace, mood — the model reads this the way a director reads a note.">
        <template #label>
          <span class="jv-field-label-row">Describe the voice
            <UiButton intent="ghost" size="small" label="↧ Start from the note" :disabled="!note"
              :title="note ? 'Copy this persona\'s note in, to edit' : 'This persona has no note yet'" @click="fromNote" />
          </span>
        </template>
        <UiTextarea v-model="description" :rows="3" placeholder="a gravel-voiced harbour-master in his seventies, unhurried" />
      </UiField>

      <div class="jv-field-row">
        <UiField label="Name" layout="block">
          <UiInput v-model="name" width="name" placeholder="e.g. Harbour-master" />
        </UiField>
        <UiButton intent="secondary" :label="busy ? 'Rendering…' : '▶ Preview'" :loading="busy" :disabled="!!blocker"
          title="Speak the Hear it line from this description, as this persona speaks — each preview is a new take" @click="runPreview" />
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
          <UiButton intent="primary" label="💾 Keep as a description" :loading="keeping"
            :disabled="!!blocker || !!descriptionOff || !name.trim()"
            :title="descriptionOff || (name.trim() ? '' : 'Give the voice a name')" @click="keepDescription" />
          <p class="jv-hint">{{ descriptionOff || "Every line is spoken from these words. It can shift a little between lines." }}</p>
        </div>
        <div class="jv-col jv-col--start">
          <div class="jv-field-row">
            <UiField label="Spoken by" layout="block">
              <UiSelect v-model="cloneModel" :options="cloneOptions" width="name" :disabled="!cloneOptions.length"
                placeholder="None can be directed this way" />
            </UiField>
            <UiButton intent="secondary" :label="chosenTake ? `📌 Keep take ${chosenTake.n}` : '📌 Keep a take'"
              :loading="keeping" :disabled="!chosenTake || !cloneModel || !name.trim()"
              :title="chosenTake ? '' : 'Preview first, then keep the take you like'" @click="keepTake" />
          </div>
          <p class="jv-hint">The take becomes the voice's clip, so it sounds the same on every line. {{ MODEL_NOTE[cloneModel] || "" }}</p>
        </div>
      </div>
    </div>
  </div>
</template>
