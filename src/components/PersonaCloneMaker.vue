<!-- SPDX-License-Identifier: MIT -->
<!--
  New clone — on the persona's own page, at the top of the right column while
  "Made by" is Clone from audio (decided 2026-10-04: "the whole design should
  be part of the persona"; plan docs/plans/2026-10-04-persona-voice-making.md
  §3; the approved mock is src/mock/MockCloneMaker.vue).

  The clip comes from a drop, a browse, a pasted URL, a recording or one of
  your captures; its length and how far its speech stands above the noise are
  checked first. The model is one that matches the page's "How it can be
  directed", and the line under it says what a voice on it keeps. ▶ Preview
  speaks the Hear it line with this clip AS the persona (its language,
  delivery, lexicon, pace, pitch, gain and effects). 💾 Keep saves the voice to
  Voices at once — with or without a preview: Voices' old Import tab is folded
  in here ("keep the clip as it is") — and the persona takes it.
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRouter } from "vue-router";
import {
  UiButton, UiCheckbox, UiField, UiInput, UiSelect, UiTag, UiTextarea, fmtBytes, languageName, pushToast,
} from "@delebash/llm-ui";
import { acceptEngineTerms, handleTermsRefusal } from "../services/engineTerms.js";
import {
  MODEL_NOTE, blobToB64, checkClip, clipChecks, engineOfRow, makerModelOptions, preferredModel, previewCandidate,
} from "../services/voiceMakers.js";
import { useApi } from "../stores/api.js";

const props = defineProps({
  rows: { type: Object, default: () => ({}) },      // GET /v1/engines/capabilities → engines
  engines: { type: Array, default: () => [] },     // the engines store's items
  direction: { type: String, default: "" },        // the page's "How it can be directed"
  persona: { type: Object, default: null },        // the page's draft, as the preview takes it
  hearText: { type: String, default: "" },         // the Hear it line
});
const emit = defineEmits(["kept"]);
const api = useApi();
const router = useRouter();

// ── The clip ────────────────────────────────────────────────────────────
const clip = ref(null);           // a File or Blob
const clipName = ref("");
const measured = ref(null);       // {seconds, noise_margin_db}
const checking = ref(false);
const dropActive = ref(false);
const fileInput = ref(null);

async function setClip(blob, name) {
  clip.value = blob;
  clipName.value = name || blob?.name || "clip";
  measured.value = null;
  clearPreview();
  if (!blob) return;
  checking.value = true;
  try {
    measured.value = await checkClip(api, blob);
  } catch {
    measured.value = null;   // the checks are advice; a clip the page can't decode can still be kept
  } finally {
    checking.value = false;
  }
}
function clearClip() {
  clip.value = null;
  clipName.value = "";
  measured.value = null;
  sourceUrl.value = "";
  captureId.value = "";
  clearPreview();
}
function onDrop(ev) {
  dropActive.value = false;
  const f = ev.dataTransfer?.files?.[0];
  if (f) setClip(f, f.name);
}
const checks = computed(() => clipChecks(measured.value?.seconds, measured.value?.noise_margin_db));

// A pasted URL fetches itself once the typing pauses (Voices' pattern).
const sourceUrl = ref("");
let lastFetched = "";
let urlTimer = null;
watch(sourceUrl, (v) => {
  clearTimeout(urlTimer);
  const raw = (v || "").trim();
  if (!/^https?:\/\/\S+\.\S+/i.test(raw) || raw === lastFetched) return;
  urlTimer = setTimeout(async () => {
    try {
      const resp = await fetch(raw);
      if (!resp.ok) throw new Error(String(resp.status));
      const blob = await resp.blob();
      lastFetched = raw;
      await setClip(new File([blob], raw.split("/").pop() || "reference.wav", { type: blob.type || "audio/wav" }));
      pushToast({ message: "Audio fetched.", kind: "success" });
    } catch (e) {
      pushToast({ message: `Couldn't fetch that audio: ${e.message || e}`, kind: "error" });
    }
  }, 600);
});

// Record a clip here.
const recording = ref(false);
let mediaRecorder = null;
let chunks = [];
async function toggleRecord() {
  if (recording.value) { mediaRecorder?.stop(); return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mediaRecorder.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      recording.value = false;
      const blob = new Blob(chunks, { type: mediaRecorder.mimeType || "audio/webm" });
      setClip(new File([blob], "recording.webm", { type: blob.type }));
    };
    mediaRecorder.start();
    recording.value = true;
  } catch (e) {
    pushToast({ message: `Microphone unavailable: ${e.message || e}`, kind: "error" });
    recording.value = false;
  }
}
onBeforeUnmount(() => {
  clearTimeout(urlTimer);
  if (recording.value) mediaRecorder?.stop();
});

// One of your captures (Captures — dictation and system audio): its audio,
// and what it said as the clip's words.
const captures = ref([]);
const captureId = ref("");
api.safeRequest("/v1/captures", { captures: [] }).then((r) => { captures.value = r?.captures || []; });
const captureOptions = computed(() => [
  { value: "", label: "— pick a capture —" },
  ...captures.value.map((c) => ({
    value: c.id,
    label: `${new Date(c.created_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}`
      + (c.duration_ms ? ` · ${Math.round(c.duration_ms / 1000)} s` : "")
      + (c.transcript ? ` · “${c.transcript.slice(0, 32)}${c.transcript.length > 32 ? "…" : ""}”` : ""),
  })),
]);
async function pickCapture(id) {
  captureId.value = id;
  const c = captures.value.find((x) => x.id === id);
  if (!c) return;
  try {
    const blob = await api.requestBlob(`/v1/captures/${id}/audio`);
    await setClip(new File([blob], `capture-${id}.wav`, { type: blob.type || "audio/wav" }));
    if (c.transcript && !transcript.value.trim()) transcript.value = c.transcript;
  } catch (e) {
    pushToast({ message: `Couldn't read that capture: ${e?.message || e}`, kind: "error" });
  }
}

// ── The model — one that can be directed the page's way ─────────────────
const options = computed(() => makerModelOptions(props.rows, props.engines, "supports_voice_cloning", props.direction));
const model = ref("");
const ORDER = ["chatterbox-turbo", "voxcpm2", "chatterbox-multilingual", "qwen3-base", "pocket", "chatterbox-nano"];
watch(options, (opts) => {
  if (!opts.some((o) => o.value === model.value)) model.value = preferredModel(opts, ORDER);
}, { immediate: true });
const row = computed(() => props.rows[model.value] || null);
const engine = computed(() => engineOfRow(props.engines, model.value));
const runtimeMissing = computed(() => engine.value?.status === "not_installed");
const notLoaded = computed(() => !!engine.value && engine.value.status !== "loaded" && !runtimeMissing.value);
const termsPending = computed(() => (engine.value?.terms && !engine.value.terms_accepted ? engine.value : null));
const termsBusy = ref(false);
async function acceptTerms() {
  const e = termsPending.value;
  if (!e) return;
  termsBusy.value = true;
  try {
    await acceptEngineTerms(api, e.id);
    pushToast({ message: `${e.name} can clone voices now.`, kind: "success" });
  } catch (err) {
    pushToast({ message: `Couldn't record that: ${err?.message || err}`, kind: "error" });
  } finally {
    termsBusy.value = false;
  }
}

// The languages the model speaks, by name, from its own catalog.
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

const transcript = ref("");
const skipWords = ref(false);
watch(model, () => { skipWords.value = false; clearPreview(); });
const name = ref("");

// ── ▶ Preview, 💾 Keep ──────────────────────────────────────────────────
const blocker = computed(() => {
  if (!clip.value) return "Choose a recording.";
  if (!model.value) return props.direction ? "No model can clone a voice that can be directed this way." : "Pick a model.";
  if (runtimeMissing.value) return "Install the speech runtime first.";
  if (termsPending.value) return `Accept ${termsPending.value.terms.owner}'s terms above first.`;
  return "";
});
const preview = ref(null);   // {url, label}
const busy = ref(false);
const keeping = ref(false);
function clearPreview() {
  if (preview.value?.url) URL.revokeObjectURL(preview.value.url);
  preview.value = null;
}
async function candidate() {
  return {
    engine: engine.value.id,
    model: model.value,
    source: "cloned",
    ref_wav_b64: await blobToB64(clip.value),
    transcript: skipWords.value ? null : (transcript.value.trim() || null),
    xvector_only: skipWords.value,
    language: language.value || languageOptions.value[0]?.value || "en",
  };
}
async function runPreview() {
  if (blocker.value || busy.value) return;
  busy.value = true;
  try {
    const { blob } = await previewCandidate(api, props.persona, await candidate(), props.hearText);
    clearPreview();
    preview.value = { url: URL.createObjectURL(blob), label: `${name.value.trim() || "The clone"} on ${row.value?.display_name || model.value}, as this persona speaks` };
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
    const c = await candidate();
    const voice = await api.request("/v1/voices/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engine: c.engine, model: c.model, name: name.value.trim(), ref_wav_b64: c.ref_wav_b64,
        language: c.language, transcript: c.transcript || undefined, xvector_only: c.xvector_only,
      }),
    });
    pushToast({ message: `Voice "${voice.name}" saved to Voices.`, kind: "success" });
    emit("kept", voice);
  } catch (e) {
    if (!handleTermsRefusal(e)) pushToast({ message: `Keep failed: ${e?.message || e}`, kind: "error" });
  } finally {
    keeping.value = false;
  }
}
</script>

<template>
  <div class="jv-card">
    <div class="jv-card__header"><h3 class="jv-card__title">New clone</h3></div>
    <div class="jv-card__body jv-col">
      <div v-if="termsPending" class="jv-banner jv-banner--info">
        <strong>{{ termsPending.terms.title }}</strong>
        <p class="jv-hint">{{ termsPending.name }} clones a voice only after you accept {{ termsPending.terms.owner }}'s terms — once, on this install. Its preset voices need no acceptance.</p>
        <p class="jv-hint">{{ termsPending.terms.text }}</p>
        <div class="jv-inline-row">
          <UiButton intent="primary" size="small" :loading="termsBusy" :label="`Accept ${termsPending.terms.owner}'s terms`" @click="acceptTerms" />
        </div>
      </div>

      <!-- The clip. -->
      <div class="jv-drop" :class="{ 'jv-drop--active': dropActive, 'jv-drop--filled': clip }"
        @dragover.prevent="dropActive = true" @dragleave="dropActive = false" @drop.prevent="onDrop">
        <template v-if="clip">
          <div class="jv-drop__row">
            <span>♫ {{ clipName }} · {{ fmtBytes(clip.size) }}</span>
            <span class="jv-spacer" />
            <UiButton intent="ghost" size="small" label="✕" title="Remove this clip" @click="clearClip" />
          </div>
          <div class="jv-inline-row">
            <span v-if="checking" class="jv-hint">Checking the clip…</span>
            <UiTag v-if="checks.duration" :intent="checks.duration.intent">{{ checks.duration.label }}</UiTag>
            <UiTag v-if="checks.noise" :intent="checks.noise.intent">{{ checks.noise.label }}</UiTag>
          </div>
        </template>
        <template v-else>
          <div class="jv-drop__row">
            <UiInput v-model="sourceUrl" width="full" placeholder="Paste an audio URL — it fetches itself" />
            <UiButton intent="secondary" size="small" label="Browse…" title="Pick a recording from your files" @click="fileInput?.click()" />
            <UiButton :intent="recording ? 'danger-outline' : 'secondary'" size="small"
              :label="recording ? '■ Stop recording' : '🎙 Record'"
              :title="recording ? 'Stop and use what you just recorded' : 'Record a reference clip with your microphone'"
              @click="toggleRecord" />
          </div>
          <div v-if="captures.length" class="jv-drop__row">
            <UiField label="Or one of your captures" layout="block">
              <UiSelect :model-value="captureId" :options="captureOptions" width="name" @update:model-value="pickCapture" />
            </UiField>
          </div>
          <p class="jv-hint">Drag a recording anywhere into this box, paste a URL, browse, or record. 10 s to 2 minutes of one person speaking — WAV, MP3, M4A, FLAC or OGG.</p>
        </template>
        <input ref="fileInput" type="file" accept="audio/*" hidden
          @change="(e) => { const f = e.target.files?.[0]; if (f) setClip(f, f.name); e.target.value = ''; }" />
      </div>

      <!-- The model it speaks on — set here, once (plan 10-03 §5.2). -->
      <div class="jv-field-row">
        <UiField label="Model" layout="block">
          <UiSelect v-model="model" :options="options" width="name" :disabled="!options.length"
            :placeholder="options.length ? 'Pick a model' : 'None can be directed this way'" />
        </UiField>
        <UiField v-if="languageOptions.length > 1" label="Language of the clip" layout="block">
          <UiSelect v-model="language" :options="[{ value: '', label: 'Auto' }, ...languageOptions]" width="id" />
        </UiField>
      </div>
      <p v-if="MODEL_NOTE[model]" class="jv-hint">{{ MODEL_NOTE[model] }}</p>
      <p v-if="notLoaded" class="jv-hint">{{ row?.display_name || model }} isn't loaded — the first preview loads it, about a minute.</p>
      <div v-if="runtimeMissing" class="jv-banner jv-banner--warn">
        <strong>The speech runtime isn't installed.</strong>
        <div class="jv-inline-row">
          <UiButton intent="secondary" size="small" label="Open Speech engines"
            @click="router.push({ path: '/ai', query: { tab: 'speech-engines' } })" />
        </div>
      </div>

      <UiField v-if="row?.supports_clone_prompt_text" label="What's said in the recording" layout="block"
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
        <UiButton intent="primary" label="💾 Keep" :loading="keeping" :disabled="!!blocker || !name.trim()"
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
