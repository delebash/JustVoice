<!-- SPDX-License-Identifier: MIT -->
<!--
  ＋ New clone — inside the persona's page (decided 2026-10-04: "the whole
  design should be part of the persona"; plan
  docs/plans/2026-10-04-persona-voice-making.md §3). Moved from Voices →
  Clone, with Voices → Import folded in: the clip can be kept as it is,
  without listening first. Keep saves the voice to Voices at once (B); the
  persona then speaks with it.

  The clip: drop, browse, paste a URL, record, or one of your captures. Its
  length and how noisy it is are checked before anything is kept.
-->
<script setup>
import { computed, onBeforeUnmount, reactive, ref } from "vue";
import {
  DownloadBar, UiButton, UiCheckbox, UiField, UiInput, UiSelect, UiTag, UiTextarea, fmtBytes, pushToast,
} from "@delebash/llm-ui";
import { CAPTURES, capabilities, keepVoice, modelStatus, silentWav, statusOf, terms, termsAccepted, wait } from "../../services/mock/personaMock.js";
import { MODEL_NOTE, engineOf, fmtLength, forDirection, languageOptionsFor, modelOptions, preferred } from "../../services/mock/mockMakers.js";

const props = defineProps({
  personaName: { type: String, default: "" },
  direction: { type: String, default: "" },   // the persona page's "How it can be directed"
});
const emit = defineEmits(["kept"]);

// ── The clip ────────────────────────────────────────────────────────────
const clip = ref(null);   // {name, bytes, seconds, snr}
const url = ref("");
const recording = ref(false);
const captureId = ref("");
const dragging = ref(false);
const fileInput = ref(null);

function setClip(c) {
  clip.value = c;
  preview.value = null;
}
function clearClip() {
  clip.value = null;
  url.value = "";
  captureId.value = "";
  preview.value = null;
}
function readFile(file) {
  if (!file) return;
  const objectUrl = URL.createObjectURL(file);
  const probe = new Audio(objectUrl);
  probe.addEventListener("loadedmetadata", () => {
    setClip({ name: file.name, bytes: file.size, seconds: probe.duration || 0, snr: 31 });
    URL.revokeObjectURL(objectUrl);
  }, { once: true });
  probe.addEventListener("error", () => {
    pushToast({ kind: "error", message: `Couldn't read ${file.name} as audio.` });
    URL.revokeObjectURL(objectUrl);
  }, { once: true });
}
function onDrop(e) {
  dragging.value = false;
  readFile(e.dataTransfer?.files?.[0]);
}
function browse() {
  fileInput.value?.click();
}
let urlTimer = null;
function onUrl(v) {
  url.value = v;
  clearTimeout(urlTimer);
  if (!/^https?:\/\/\S+/.test(v.trim())) return;
  urlTimer = setTimeout(async () => {
    await wait(500);
    const name = decodeURIComponent(v.trim().split("/").pop() || "audio.wav");
    setClip({ name, bytes: 1_120_000, seconds: 35, snr: 29 });
    pushToast({ kind: "success", message: "Audio fetched." });
  }, 600);
}
onBeforeUnmount(() => clearTimeout(urlTimer));
function toggleRecord() {
  if (!recording.value) {
    recording.value = true;
    return;
  }
  recording.value = false;
  setClip({ name: "recording.wav", bytes: 256_000, seconds: 8, snr: 19 });
}
function pickCapture(id) {
  captureId.value = id;
  const c = CAPTURES.find((x) => x.id === id);
  if (c) setClip({ ...c.clip });
}
const captureOptions = [{ value: "", label: "— pick a capture —" }, ...CAPTURES.map((c) => ({ value: c.id, label: c.label }))];

// The two checks: length (from the file) and noise (measured on the clip).
const MIN_S = 10;
const MAX_S = 120;
const MIN_SNR = 25;
const lengthCheck = computed(() => {
  const s = clip.value?.seconds;
  if (!s) return null;
  if (s < MIN_S) return { intent: "accent2", label: `⚠ ${fmtLength(s)} — under 10 s; the copy comes out thin` };
  if (s > MAX_S) return { intent: "accent2", label: `⚠ ${fmtLength(s)} — over 2 minutes; trim it to one clean stretch` };
  return { intent: "success", label: `✓ ${fmtLength(s)} long` };
});
const noiseCheck = computed(() => {
  const snr = clip.value?.snr;
  if (!snr) return null;
  return snr >= MIN_SNR
    ? { intent: "success", label: `✓ clean — ${snr} dB above the noise` }
    : { intent: "accent2", label: `⚠ noisy — ${snr} dB above the noise; the copy will carry it` };
});

// ── The model ───────────────────────────────────────────────────────────
const options = computed(() => forDirection(modelOptions("supports_voice_cloning"), props.direction));
const model = ref(preferred(options.value, ["chatterbox-turbo", "voxcpm2", "chatterbox-multilingual", "qwen3-base", "pocket"]));
const row = computed(() => capabilities[model.value] || null);
const engine = computed(() => engineOf(model.value));
const engineTerms = computed(() => terms[engine.value] || null);
const termsPending = computed(() => !!engineTerms.value && !termsAccepted[engine.value]);
function acceptTerms() {
  termsAccepted[engine.value] = true;
  pushToast({ kind: "success", message: `${row.value.display_name} can clone voices now.` });
}
const notInstalled = computed(() => statusOf(model.value) === "not installed");

// Installing a model — the real DownloadBar on a pretend task.
const install = ref(null);
function startInstall() {
  const total = 1_050_000_000;
  const task = reactive({ state: "running", done: 0, total, label: "", error: "", finalizing: false });
  task.cancel = () => { task.state = "cancelled"; };
  task.retry = () => startInstall();
  task.dismiss = () => { install.value = null; };
  install.value = task;
  const tick = setInterval(() => {
    const t = install.value;
    if (t?.state !== "running") return clearInterval(tick);
    t.done = Math.min(total, t.done + total / 12);
    t.label = `${Math.round((t.done / total) * 100)}% · ${fmtBytes(t.done)} of ${fmtBytes(total)}`;
    if (t.done >= total) {
      clearInterval(tick);
      t.state = "done";
      modelStatus[model.value] = "not loaded";
    }
  }, 250);
}

const transcript = ref("");
const skipWords = ref(false);
const name = ref("");
const language = ref("");
const languages = computed(() => languageOptionsFor(model.value));

// ── Preview, Keep ───────────────────────────────────────────────────────
const preview = ref(null);   // {url, label}
const busy = ref(false);
const blocker = computed(() => {
  if (!clip.value) return "Choose a recording.";
  if (!model.value) return "Pick a model.";
  if (notInstalled.value) return `Install ${row.value.display_name} first.`;
  if (termsPending.value) return `Accept ${engineTerms.value.owner}'s terms above first.`;
  return "";
});
async function runPreview() {
  if (blocker.value || busy.value) return;
  busy.value = true;
  await wait(900);
  if (preview.value?.url) URL.revokeObjectURL(preview.value.url);
  preview.value = {
    url: URL.createObjectURL(silentWav(4)),
    label: `${name.value.trim() || "The clone"} on ${row.value.display_name}, as ${props.personaName || "this persona"} speaks`,
  };
  busy.value = false;
}
function keep() {
  if (blocker.value || !name.value.trim()) return;
  const lang = language.value || languages.value[0]?.value || "en";
  const v = keepVoice({
    engine: engine.value, model: model.value, source: "cloned", name: name.value.trim(),
    language: lang, gender: "", clip: { seconds: clip.value.seconds, snr: clip.value.snr },
    transcript: skipWords.value ? "" : transcript.value.trim(),
  });
  pushToast({ kind: "success", message: `Voice "${v.name}" saved to Voices.` });
  emit("kept", v);
}
</script>

<template>
  <div class="jv-card">
    <div class="jv-card__header">
      <h3 class="jv-card__title">New clone</h3>
    </div>
    <div class="jv-card__body jv-col">
      <div v-if="termsPending" class="jv-banner jv-banner--info">
        <strong>{{ engineTerms.title }}</strong>
        <p class="jv-hint">{{ row.display_name }} clones a voice only after you accept {{ engineTerms.owner }}'s terms — once, on this install. Its built-in voices need no acceptance.</p>
        <p class="jv-hint">{{ engineTerms.text }}</p>
        <UiButton intent="primary" size="small" :label="`Accept ${engineTerms.owner}'s terms`" @click="acceptTerms" />
      </div>

      <!-- The clip. -->
      <div class="jv-drop" :class="{ 'jv-drop--active': dragging, 'jv-drop--filled': clip }"
        @dragover.prevent="dragging = true" @dragleave="dragging = false" @drop.prevent="onDrop">
        <template v-if="clip">
          <div class="jv-drop__row">
            <span>♫ {{ clip.name }} · {{ fmtBytes(clip.bytes) }}</span>
            <span class="jv-spacer" />
            <UiButton intent="ghost" size="small" label="✕" title="Remove this clip" @click="clearClip" />
          </div>
          <div class="jv-inline-row">
            <UiTag v-if="lengthCheck" :intent="lengthCheck.intent">{{ lengthCheck.label }}</UiTag>
            <UiTag v-if="noiseCheck" :intent="noiseCheck.intent">{{ noiseCheck.label }}</UiTag>
          </div>
        </template>
        <template v-else>
          <div class="jv-drop__row">
            <UiInput :model-value="url" width="full" placeholder="Paste an audio URL — it fetches itself"
              @update:model-value="onUrl" />
            <UiButton intent="secondary" size="small" label="Browse…" title="Pick a recording from your files" @click="browse" />
            <UiButton :intent="recording ? 'danger-outline' : 'secondary'" size="small"
              :label="recording ? '■ Stop recording' : '🎙 Record'"
              :title="recording ? 'Stop and use what you just recorded' : 'Record a reference clip with your microphone'"
              @click="toggleRecord" />
          </div>
          <div class="jv-drop__row">
            <UiField label="Or one of your captures" layout="block">
              <UiSelect :model-value="captureId" :options="captureOptions" width="name" @update:model-value="pickCapture" />
            </UiField>
          </div>
          <p class="jv-hint">Drag a recording anywhere into this box, paste a URL, browse, or record. 10 s to 2 minutes of one person speaking — WAV, MP3, M4A, FLAC or OGG.</p>
        </template>
        <input ref="fileInput" type="file" accept="audio/*" hidden @change="(e) => readFile(e.target.files?.[0])" />
      </div>

      <!-- The model it speaks on — set here, once (plan 10-03 §5.2). -->
      <div class="jv-field-row">
        <UiField label="Model" layout="block">
          <UiSelect v-model="model" :options="options" width="name" />
        </UiField>
        <UiField v-if="languages.length > 1" label="Language of the clip" layout="block">
          <UiSelect v-model="language" :options="[{ value: '', label: 'Auto' }, ...languages]" width="id" />
        </UiField>
      </div>
      <p class="jv-hint">{{ MODEL_NOTE[model] }}</p>
      <div v-if="notInstalled" class="jv-banner jv-banner--warn">
        <strong>{{ row.display_name }} isn't installed.</strong>
        <div class="jv-inline-row">
          <UiButton v-if="!install" intent="secondary" size="small" label="⤓ Install" @click="startInstall" />
        </div>
      </div>
      <DownloadBar v-if="install" :title="row.display_name" :task="install" done-label="Installed" />

      <UiField v-if="row?.supports_clone_prompt_text" label="What's said in the recording" layout="block" class="jv-stretch"
        hint="This model listens to the clip while reading these words, so a word-for-word match gives a truer copy. Skip it and the copy still works — just less exact.">
        <UiTextarea v-model="transcript" :rows="2" :disabled="skipWords"
          placeholder="Type the words from the clip, exactly as spoken." />
      </UiField>
      <UiCheckbox v-if="row?.supports_xvector_only" v-model="skipWords"
        label="Skip the words — clone from the sound alone (faster to set up, less exact)" />

      <div class="jv-field-row">
        <UiField label="Name" layout="block">
          <UiInput v-model="name" width="name" placeholder="e.g. Marius" />
        </UiField>
        <UiButton intent="secondary" :label="busy ? 'Rendering…' : '▶ Preview'" :loading="busy" :disabled="!!blocker"
          title="Speak the Hear it line with this clone, as this persona speaks" @click="runPreview" />
        <UiButton intent="primary" label="💾 Keep" :disabled="!!blocker || !name.trim()"
          :title="name.trim() ? 'Save this voice to Voices; this persona speaks with it' : 'Give the voice a name'" @click="keep" />
      </div>
      <p v-if="blocker" class="jv-muted">{{ blocker }}</p>
      <p v-else class="jv-hint">Listen first, or keep the clip as it is — either way it's saved to Voices.</p>
      <div v-if="preview" class="jv-col">
        <span class="jv-hint">{{ preview.label }}</span>
        <audio :src="preview.url" controls autoplay class="jv-audio-inline" />
      </div>
    </div>
  </div>
</template>
