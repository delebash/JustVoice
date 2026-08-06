<!-- SPDX-License-Identifier: MIT -->
<!--
  TtsProviderForm — inline editor for ONE external speech provider (the TTS
  subset of the retired dual-kind ProviderForm; the LLM half died with the
  parity batch 2026-08-06 — language-model providers live on the LLM providers
  tab, the kit surface). Layout contract unchanged: the form is the EXPANDED
  BODY of a provider card (.ev-prov) — border-top + surface-2, no card chrome
  of its own.

  Structure, top to bottom:
    presets chip row (new providers only)
    .pf-row 1 — NAME · BASE URL · API KEY · where-it-runs
    install/setup hint band (known provider types)
    .pf-row 2 — TTS MODEL (+ fetched hint) · VOICES · ⟳ Fetch voices ·
                RESPONSE FORMAT
    fetched-voice chips (click to toggle selection)
    .pf-foot — status dot · Test connection · Remove · Cancel · Save
-->
<script setup>
import { computed, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { UiButton, UiCheckbox, UiSelect, pushToast } from "@delebash/llm-ui";

const props = defineProps({
  draft: { type: Object, required: true },
  editingKey: { type: String, required: true },
});
const emit = defineEmits(["save", "cancel", "delete"]);

// Self-hosted auto-detect — localhost / loopback / RFC-1918 / .local URLs
// default the toggle on; the user can override either way.
function looksSelfHosted(url) {
  return /^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|[\w-]+\.local)/i.test(url || "");
}
let _selfHostedTouched = false;
watch(() => props.draft?.self_hosted, (v, oldV) => {
  if (oldV !== undefined && v !== looksSelfHosted(props.draft?.baseUrl)) _selfHostedTouched = true;
});
watch(() => props.draft?.baseUrl, (url) => {
  if (!_selfHostedTouched && props.draft) props.draft.self_hosted = looksSelfHosted(url);
});

const api = useApi();
const busy = ref(false);

// Presets — one click fills name/url/type (speech providers only).
const PRESETS = [
  { id: "elevenlabs", label: "ElevenLabs", type: "elevenlabs", url: "https://api.elevenlabs.io/v1" },
  { id: "speechify", label: "Speechify", type: "speechify", url: "https://api.sws.speechify.com" },
  { id: "openai-tts", label: "OpenAI TTS", type: "openai-tts", url: "https://api.openai.com/v1" },
  { id: "kokoro", label: "Kokoro server", type: "openai-compat", url: "http://localhost:8880" },
  { id: "custom", label: "Custom…", type: "openai-compat", url: "" },
];
const activePreset = ref("");
function applyPreset(pr) {
  activePreset.value = pr.id;
  if (pr.id !== "custom") {
    props.draft.name = props.draft.name || pr.label;
    props.draft.baseUrl = pr.url;
  }
  props.draft.providerType = pr.type;
}

function slugify(name) {
  return (name || "provider").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "provider";
}

// Setup hints for known speech provider types.
const PROVIDER_HINTS = {
  elevenlabs: { url: "https://elevenlabs.io/", label: "ElevenLabs", note: "Online TTS with voice cloning. Free tier available; commercial use requires paid plan." },
  speechify: { url: "https://speechify.com/api/", label: "Speechify API", note: "Studio-quality online TTS. simba-multilingual is the default model." },
  speechmatics: { url: "https://www.speechmatics.com/", label: "Speechmatics", note: "Real-time + batch TTS. Preview tier endpoint at preview.tts.speechmatics.com." },
  "openai-tts": { url: "https://platform.openai.com/docs/guides/text-to-speech", label: "OpenAI TTS docs", note: "tts-1 / tts-1-hd. Lowest-cost online TTS; modest naturalness." },
  kokoro: { url: "https://github.com/remsky/Kokoro-FastAPI", label: "Kokoro-FastAPI", note: "Self-hosted Kokoro server with OpenAI-compatible /v1/audio/speech." },
  chatterbox: { url: "https://github.com/devnen/Chatterbox-TTS-Server", label: "Chatterbox-TTS-Server", note: "Self-hosted Chatterbox server. Voice cloning + exaggeration/cfg_weight knobs." },
  dia: { url: "https://github.com/devnen/Dia-TTS-Server", label: "Dia-TTS-Server", note: "Multi-speaker dialogue. v2.0+ supports hot-swap between Dia 1.6B / Dia2 family." },
  "qwen3-tts": { url: "https://github.com/groxaxo/Qwen3-TTS-Openai-Fastapi", label: "Qwen3-TTS server", note: "Best published English WER (0.77%). 3-second voice cloning. Plain OpenAI-compat." },
  "openai-compat": { url: "https://platform.openai.com/docs/api-reference/audio/createSpeech", label: "OpenAI-compatible spec", note: "Any server speaking POST /v1/audio/speech. Point baseUrl at the server root." },
};
const hint = computed(() => PROVIDER_HINTS[props.draft?.providerType] || PROVIDER_HINTS[props.draft?.id] || null);
function openHint() {
  if (!hint.value?.url) return;
  if (typeof window !== "undefined") window.open(hint.value.url, "_blank", "noopener,noreferrer");
}

// ── Model + voice discovery (through the external-engine probe). ──────
const fetchedModels = ref([]);
const fetchedVoices = ref([]);
const voicesLoading = ref(false);
const voicesError = ref("");
const TTS_RX = /tts|speech|simba|eleven/i;
const ttsModels = computed(() => fetchedModels.value.filter((m) => TTS_RX.test(m)));

async function probe() {
  return api.request("/v1/engines/external/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base_url: props.draft.baseUrl,
      api_key: props.draft.apiKey || null,
    }),
  });
}

async function fetchVoices() {
  voicesError.value = "";
  voicesLoading.value = true;
  fetchedVoices.value = [];
  try {
    if (!props.draft.baseUrl) {
      voicesError.value = "Set a base URL first.";
      return;
    }
    const r = await probe();
    fetchedModels.value = r?.models || [];
    fetchedVoices.value = r?.voices || [];
    if (!fetchedVoices.value.length) voicesError.value = "Server didn't return any voices.";
  } catch (e) {
    voicesError.value = e?.message || String(e);
  } finally {
    voicesLoading.value = false;
  }
}

function selectedVoiceArray() {
  const v = props.draft.voices;
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}
function isVoiceSelected(v) { return selectedVoiceArray().includes(v); }
function toggleVoice(v) {
  const cur = [...selectedVoiceArray()];
  const i = cur.indexOf(v);
  if (i >= 0) cur.splice(i, 1);
  else cur.push(v);
  props.draft.voices = cur;
}

// ── Test connection ───────────────────────────────────────────────────
const testBusy = ref(false);
const test = ref(null);
async function doTest() {
  test.value = null;
  testBusy.value = true;
  const t0 = performance.now();
  const ms = () => Math.max(1, Math.round(performance.now() - t0));
  try {
    if (!props.draft.baseUrl) {
      test.value = { ok: false, message: "set a base URL first" };
      return;
    }
    const r = await probe();
    if (r) {
      fetchedModels.value = r.models || [];
      fetchedVoices.value = r.voices || [];
      test.value = { ok: true, ms: ms(), models: (r.models || []).length, voices: (r.voices || []).length };
    } else {
      test.value = { ok: false, message: "probe failed" };
    }
  } catch (e) {
    test.value = { ok: false, message: e?.message || String(e) };
  } finally {
    testBusy.value = false;
  }
}
const statusText = computed(() => {
  if (testBusy.value) return "testing…";
  if (!test.value) {
    return props.draft?.apiKey || props.draft?.baseUrl ? "not tested" : "not tested — key missing";
  }
  if (!test.value.ok) return `unreachable — ${test.value.message}`;
  const bits = ["reachable"];
  if (test.value.models != null) bits.push(`${test.value.models} models`);
  if (test.value.voices) bits.push(`${test.value.voices} voices`);
  bits.push(`${test.value.ms} ms`);
  return bits.join(" · ");
});

async function onSave() {
  if (props.editingKey === "new" && !props.draft.id) {
    props.draft.id = slugify(props.draft.name);
  }
  if (!props.draft.name?.trim()) {
    pushToast({ message: "Give the provider a display name.", kind: "info" });
    return;
  }
  busy.value = true;
  try {
    emit("save", { ...props.draft, voices: selectedVoiceArray() });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="pf">
    <div class="pf-presets" v-if="editingKey === 'new'">
      <button v-for="pr in PRESETS" :key="pr.id" type="button"
        class="pf-preset" :class="{ on: activePreset === pr.id }"
        :title="pr.url || 'Start from a blank OpenAI-compatible provider'"
        @click="applyPreset(pr)">{{ pr.label }}</button>
    </div>

    <!-- Row 1: NAME · BASE URL · API KEY · where it runs -->
    <div class="pf-row">
      <div class="pf-f">
        <label>Name</label>
        <input type="text" v-model="draft.name" :placeholder="hint?.label || 'My provider'" />
      </div>
      <div class="pf-f pf-wide">
        <label>Base URL</label>
        <input type="text" v-model="draft.baseUrl" placeholder="https://…" />
      </div>
      <div class="pf-f">
        <label>API key</label>
        <input type="password" v-model="draft.apiKey" autocomplete="off" placeholder="sk-… (blank for local)" />
      </div>
      <div class="pf-f">
        <label title="Self-hosted = runs on your machine or network — free and private. Lists under Local on the Speech engines tab; its voices badge as self-hosted, not online·metered.">Where it runs</label>
        <UiCheckbox v-model="draft.self_hosted">self-hosted (my machine / network — free)</UiCheckbox>
      </div>
    </div>

    <div v-if="hint" class="pf-hintband">
      <strong>Install / setup:</strong>
      <a href="#" @click.prevent="openHint">{{ hint.label }}</a>
      <span class="jv-muted"> — {{ hint.note }}</span>
    </div>

    <!-- Row 2: TTS MODEL · VOICES · fetch · RESPONSE FORMAT -->
    <div class="pf-row">
      <div class="pf-f">
        <label>TTS model</label>
        <span class="pf-pick">
          <input type="text" v-model="draft.tts_model" placeholder="e.g. eleven_flash_v2_5" list="pf-tts-models" />
          <span class="pf-caret">▾</span>
        </span>
        <datalist id="pf-tts-models">
          <option v-for="m in ttsModels" :key="m" :value="m" />
        </datalist>
        <div class="pf-fhint" v-if="ttsModels.length">✓ fetched — {{ ttsModels.length }} TTS models on this server</div>
        <div class="pf-fhint dim" v-else>add a key + URL, then Test to fetch this server's models</div>
      </div>
      <div class="pf-f pf-wide">
        <label>Voices</label>
        <input
          type="text"
          :value="selectedVoiceArray().join(', ')"
          @input="draft.voices = $event.target.value.split(',').map((s) => s.trim()).filter(Boolean)"
          placeholder="e.g. af_bella, am_adam"
        />
        <div class="pf-fhint" v-if="fetchedVoices.length">✓ fetched — {{ fetchedVoices.length }} voices, click chips below to add</div>
      </div>
      <UiButton
        class="pf-fetchbtn" intent="secondary" size="small"
        :loading="voicesLoading" :disabled="voicesLoading || !draft.baseUrl"
        :label="fetchedVoices.length ? '⟳ Refresh' : '⟳ Fetch voices'"
        title="Query the provider's /v1/audio/voices" @click="fetchVoices"
      />
      <div class="pf-f">
        <label>Response format</label>
        <UiSelect v-model="draft.response_format" width="name" :options="[
          { value: 'wav', label: 'wav (recommended)' },
          { value: 'mp3', label: 'mp3' },
          { value: 'pcm', label: 'pcm' },
          { value: 'ogg', label: 'ogg' },
        ]" />
      </div>
    </div>
    <div v-if="voicesError" class="pf-error">{{ voicesError }}</div>

    <div v-if="fetchedVoices.length" class="pf-voicechips">
      <button v-for="v in fetchedVoices" :key="v" type="button"
        class="pf-vchip" :class="{ on: isVoiceSelected(v) }" @click="toggleVoice(v)">{{ v }}</button>
    </div>

    <footer class="pf-foot">
      <span class="pf-status">
        <span class="pf-dot" :class="{ off: !test || testBusy, err: test && !test.ok && !testBusy }"></span>
        {{ statusText }}
      </span>
      <span class="pf-spacer"></span>
      <UiButton intent="ghost" size="small" :loading="testBusy" label="Test connection"
        title="Ping + re-fetch models and voices" @click="doTest" />
      <UiButton v-if="editingKey !== 'new'" intent="danger-outline" size="small" label="Remove provider" @click="emit('delete')" />
      <UiButton intent="ghost" size="small" label="Cancel" @click="emit('cancel')" />
      <UiButton intent="primary" size="small" :loading="busy" :label="editingKey === 'new' ? 'Save provider' : 'Save'" @click="onSave" />
    </footer>
  </div>
</template>

<style scoped>
/* Mock contract: the form is the card BODY — border-top + surface-2,
   no card chrome of its own (the parent .ev-prov is the card). */
.pf {
  border-top: 1px solid var(--line);
  background: var(--surface-2);
  padding: 16px 18px;
}
.pf-presets { display: flex; gap: 8px; margin: 6px 0 4px; flex-wrap: wrap; }
.pf-preset {
  font: inherit; font-size: 12px;
  border: 1px solid var(--line); border-radius: 999px;
  padding: 5px 13px; cursor: pointer;
  background: var(--surface); color: var(--ink-2);
}
.pf-preset.on, .pf-preset:hover {
  border-color: var(--accent);
  color: var(--accent-ink, #2c6049);
  background: var(--accent-soft, #e8f0eb);
}
.pf-row { display: flex; gap: 14px; margin-top: 10px; align-items: flex-end; flex-wrap: wrap; }
.pf-f label {
  font-size: 11px; color: var(--ink-3);
  text-transform: uppercase; letter-spacing: .05em;
  display: block; margin-bottom: 3px;
}
.pf-row input[type="text"],
.pf-row input[type="password"] {
  font: inherit; font-size: 13px;
  border: 1px solid var(--line); border-radius: 7px;
  padding: 8px 11px; width: 240px;
  background: var(--surface); color: var(--ink);
}
.pf-wide input { width: 340px; }
.pf-pick { position: relative; display: block; }
.pf-pick input { padding-right: 26px; }
.pf-caret {
  position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
  color: var(--ink-3); font-size: 11px; pointer-events: none;
}
.pf-fhint { font-size: 11px; color: var(--accent-ink, #2c6049); margin-top: 3px; }
.pf-fhint.dim { color: var(--ink-3); }
.pf-fetchbtn { margin-bottom: 22px; }
.pf-hintband {
  display: flex; align-items: flex-start; gap: 6px;
  margin-top: 10px; padding: 8px 10px;
  border: 1px solid var(--line); border-radius: 7px;
  background: var(--surface);
  font-size: 11.5px; line-height: 1.5;
}
.pf-hintband strong { color: var(--ink-2); flex: none; }
.pf-hintband a { color: var(--accent-ink, #2c6049); text-decoration: underline; flex: none; }
.pf-voicechips { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.pf-vchip {
  font: inherit; font-size: 11px;
  border: 1px solid var(--line); border-radius: 999px;
  padding: 2px 9px; cursor: pointer;
  color: var(--ink-2); background: var(--surface);
}
.pf-vchip:hover { border-color: var(--accent); }
.pf-vchip.on {
  border-color: var(--accent);
  background: var(--accent-soft, #e8f0eb);
  color: var(--accent-ink, #2c6049);
  font-weight: 600;
}
.pf-error { font-size: 11px; color: var(--danger, #b04a3e); margin-top: 6px; }
.pf-foot { display: flex; gap: 8px; margin-top: 14px; align-items: center; }
.pf-spacer { flex: 1; }
.pf-status { font-size: 11.5px; color: var(--ink-3); display: flex; gap: 6px; align-items: center; }
.pf-dot { width: 8px; height: 8px; border-radius: 50%; background: #4d9b6d; flex: none; }
.pf-dot.off { background: var(--line-strong, #cfccc4); }
.pf-dot.err { background: #c45a4d; }
</style>
