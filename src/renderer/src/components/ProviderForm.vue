<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  ProviderForm — inline editor for a single LLM or TTS provider.

  Layout contract: preview/engines-redesign.html `.pform` (approved v7).
  The form is the EXPANDED BODY of a provider card — EnginesView renders
  it inside `.ev-prov` directly under the white `.ev-prow` header, so
  this component carries no border/card chrome of its own: border-top +
  surface-2 background only. No accent border, no tinted card (the old
  green JustWrite-style card is gone deliberately).

  Structure, top to bottom (mirrors the mock element-for-element):
    presets chip row (new providers only)
    .pf-row 1 — NAME · BASE URL · API KEY · capability checkboxes
    install/setup hint band (known provider types)
    .pf-row 2 (LLM) — API FORMAT · CHAT MODEL (combobox + ✓-fetched hint)
                      · ⟳ Fetch models · EMBEDDING MODEL (+ hint)
    .pf-row 3 (TTS) — TTS MODEL (+ hint) · VOICES (+ hint) · ⟳ Fetch voices
                      · RESPONSE FORMAT
    fetched-voice chips (click to toggle selection)
    .pf-foot — status dot + "reachable · N models · M ms" · spacer ·
               Test connection · Remove provider · Cancel · Save
-->
<script setup>
import { computed, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "./ui/JvButton.vue";

const props = defineProps({
  // The provider being edited. For new providers, pass an empty shape.
  draft: { type: Object, required: true },
  // "new" or the provider id; "new" enables presets + auto-id.
  editingKey: { type: String, required: true },
});

const emit = defineEmits(["save", "cancel", "delete"]);

// Item 9: self-hosted auto-detect — localhost / loopback / RFC-1918 /
// .local URLs default the toggle on; the user can override either way.
import { watch as _watch } from "vue";
function looksSelfHosted(url) {
  return /^(https?:\/\/)?(localhost|127\.|0\.0\.0\.0|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|[\w-]+\.local)/i.test(url || "");
}
let _selfHostedTouched = false;
_watch(() => props.draft?.self_hosted, (v, oldV) => {
  if (oldV !== undefined && v !== looksSelfHosted(props.draft?.base_url)) _selfHostedTouched = true;
});
_watch(() => props.draft?.base_url, (url) => {
  if (!_selfHostedTouched && props.draft) props.draft.self_hosted = looksSelfHosted(url);
});

const api = useApi();
const busy = ref(false);

// ── Presets (approved engines-redesign contract) — one click fills
// name / base URL / API format / capabilities. ───────────────────────
const PRESETS = [
  { id: "ollama",     label: "Ollama",     kind: "llm",  type: "ollama",        url: "http://localhost:11434" },
  { id: "openai",     label: "OpenAI",     kind: "both", type: "openai",        url: "https://api.openai.com/v1" },
  { id: "anthropic",  label: "Anthropic",  kind: "llm",  type: "anthropic",     url: "https://api.anthropic.com" },
  { id: "elevenlabs", label: "ElevenLabs", kind: "tts",  type: "openai-compat", url: "https://api.elevenlabs.io/v1" },
  { id: "deepseek",   label: "DeepSeek",   kind: "llm",  type: "deepseek",      url: "https://api.deepseek.com" },
  { id: "custom",     label: "Custom…",    kind: "llm",  type: "openai-compat", url: "" },
];
const activePreset = ref("");
function applyPreset(pr) {
  activePreset.value = pr.id;
  if (pr.id !== "custom") {
    props.draft.name = props.draft.name || pr.label;
    props.draft.base_url = pr.url;
    props.draft.provider_type = pr.type;
  }
  props.draft.kind = pr.kind;
}

// Capability checkboxes — map onto the existing kind field
// ("llm" | "tts" | "both") so the save plumbing is untouched.
const capLLM = computed({
  get: () => props.draft.kind === "llm" || props.draft.kind === "both",
  set: (v) => { props.draft.kind = v ? (capTTS.value ? "both" : "llm") : (capTTS.value ? "tts" : "llm"); },
});
const capTTS = computed({
  get: () => props.draft.kind === "tts" || props.draft.kind === "both",
  set: (v) => { props.draft.kind = v ? (capLLM.value ? "both" : "tts") : (capLLM.value ? "llm" : "tts"); },
});

// Auto-slug the id from the name for new providers — the contract hides
// the ID field (developer noise; pins reference it internally).
function slugify(name) {
  return (name || "provider").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "provider";
}

// Hint metadata — when the provider type is known, surface a link to
// that provider's install guide or homepage.
const PROVIDER_HINTS = {
  // LLM
  anthropic:    { url: "https://console.anthropic.com/", label: "Anthropic Console", note: "Claude Haiku / Sonnet / Opus. API key from console; default model claude-haiku-4-5." },
  openai:       { url: "https://platform.openai.com/api-keys", label: "OpenAI platform", note: "GPT-4o, o1, o3 reasoning models. API key from platform.openai.com." },
  gemini:       { url: "https://ai.google.dev/", label: "Google AI Studio", note: "Gemini 2.5 Flash / Pro. Free tier available; rate-limited." },
  ollama:       { url: "https://ollama.com/", label: "ollama.com", note: "Local LLM runner. Install Ollama, run `ollama pull llama3.2`, then point baseUrl at http://localhost:11434." },
  deepseek:     { url: "https://platform.deepseek.com/", label: "DeepSeek platform", note: "DeepSeek Chat / Coder. Low-cost long-context." },
  openrouter:   { url: "https://openrouter.ai/keys", label: "OpenRouter", note: "Single key, hundreds of model routes. Use openrouter.ai/api/v1 as baseUrl." },
  // TTS
  elevenlabs:   { url: "https://elevenlabs.io/", label: "ElevenLabs", note: "Online TTS with voice cloning. Free tier available; commercial use requires paid plan." },
  speechify:    { url: "https://speechify.com/api/", label: "Speechify API", note: "Studio-quality online TTS. simba-multilingual is the default model." },
  speechmatics: { url: "https://www.speechmatics.com/", label: "Speechmatics", note: "Real-time + batch TTS. Preview tier endpoint at preview.tts.speechmatics.com." },
  "openai-tts": { url: "https://platform.openai.com/docs/guides/text-to-speech", label: "OpenAI TTS docs", note: "tts-1 / tts-1-hd. Lowest-cost online TTS; modest naturalness." },
  kokoro:       { url: "https://github.com/remsky/Kokoro-FastAPI", label: "Kokoro-FastAPI", note: "Self-hosted Kokoro server with OpenAI-compatible /v1/audio/speech." },
  chatterbox:   { url: "https://github.com/devnen/Chatterbox-TTS-Server", label: "Chatterbox-TTS-Server", note: "Self-hosted Chatterbox server. Voice cloning + exaggeration/cfg_weight knobs." },
  dia:          { url: "https://github.com/devnen/Dia-TTS-Server", label: "Dia-TTS-Server", note: "Multi-speaker dialogue. v2.0+ supports hot-swap between Dia 1.6B / Dia2 family." },
  "qwen3-tts":  { url: "https://github.com/groxaxo/Qwen3-TTS-Openai-Fastapi", label: "Qwen3-TTS server", note: "Best published English WER (0.77%). 3-second voice cloning. Plain OpenAI-compat." },
  "openai-compat": { url: "https://platform.openai.com/docs/api-reference/audio/createSpeech", label: "OpenAI-compatible spec", note: "Any server speaking POST /v1/audio/speech. Point baseUrl at the server root." },
};

const hint = computed(() => PROVIDER_HINTS[props.draft?.provider_type] || PROVIDER_HINTS[props.draft?.id] || null);

function openHint() {
  if (!hint.value?.url) return;
  if (typeof window !== "undefined") {
    window.open(hint.value.url, "_blank", "noopener,noreferrer");
  }
}

function showLlmFields() {
  // The capability checkboxes (draft.kind) are the single source of truth.
  return props.draft?.kind === "llm" || props.draft?.kind === "both";
}
function showTtsFields() {
  return props.draft?.kind === "tts" || props.draft?.kind === "both";
}

// ── Model discovery ─────────────────────────────────────────────────
// Registered LLM providers answer through their adapter
// (/v1/llm-providers/{id}/models); everything else goes through the
// probe endpoint with the draft's current credentials so the user can
// fetch before saving.
const fetchedModels = ref([]);
const modelsLoading = ref(false);
const modelsError = ref("");

const EMBED_RX = /embed/i;
const TTS_RX = /tts|whisper|speech/i;
const chatModels = computed(() =>
  fetchedModels.value.filter((m) => !EMBED_RX.test(m) && !TTS_RX.test(m)),
);
const embeddingModels = computed(() =>
  fetchedModels.value.filter((m) => EMBED_RX.test(m)),
);
const ttsModels = computed(() =>
  fetchedModels.value.filter((m) => TTS_RX.test(m)),
);

function llmAdapterRegistered() {
  return props.editingKey !== "new" && props.draft?.kind !== "tts";
}

async function fetchModels() {
  modelsError.value = "";
  modelsLoading.value = true;
  fetchedModels.value = [];
  try {
    if (llmAdapterRegistered()) {
      const r = await api.request(`/v1/llm-providers/${props.editingKey}/models`);
      fetchedModels.value = r?.models || [];
      if (!fetchedModels.value.length) {
        modelsError.value = r?.error || "Provider returned no models.";
      }
    } else {
      if (!props.draft.base_url) {
        modelsError.value = "Set a base URL first.";
        return;
      }
      const r = await probe();
      fetchedModels.value = r?.models || [];
      if (!fetchedModels.value.length) modelsError.value = "Server returned no models.";
    }
  } catch (e) {
    modelsError.value = e?.message || String(e);
  } finally {
    modelsLoading.value = false;
  }
}

// ── Voice discovery (TTS only) ───────────────────────────────────────
const fetchedVoices = ref([]);
const voicesLoading = ref(false);
const voicesError = ref("");

async function probe() {
  return api.request("/v1/engines/external/probe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      base_url: props.draft.base_url,
      api_key: props.draft.api_key || null,
    }),
  });
}

async function fetchVoices() {
  voicesError.value = "";
  voicesLoading.value = true;
  fetchedVoices.value = [];
  try {
    if (!props.draft.base_url) {
      voicesError.value = "Set a base URL first.";
      return;
    }
    const r = await probe();
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
function isVoiceSelected(v) {
  return selectedVoiceArray().includes(v);
}
function toggleVoice(v) {
  const cur = [...selectedVoiceArray()];
  const i = cur.indexOf(v);
  if (i >= 0) cur.splice(i, 1);
  else cur.push(v);
  props.draft.voices = cur;
}

// ── Test connection (the mock's footer status line) ─────────────────
// One button pings AND re-fetches models/voices; the result feeds the
// "● reachable · N models · M ms" status in the footer.
const testBusy = ref(false);
const test = ref(null); // { ok, message, models, voices, ms }

async function doTest() {
  test.value = null;
  testBusy.value = true;
  const t0 = performance.now();
  const ms = () => Math.max(1, Math.round(performance.now() - t0));
  try {
    if (llmAdapterRegistered()) {
      const r = await api.request(`/v1/llm-providers/${props.editingKey}/ping`, { method: "POST" });
      test.value = r?.ok
        ? { ok: true, ms: ms(), models: null, voices: null }
        : { ok: false, message: r?.error || "not reachable" };
      if (r?.ok) fetchModels();
    } else {
      if (!props.draft.base_url) {
        test.value = { ok: false, message: "set a base URL first" };
        return;
      }
      const r = await probe();
      if (r) {
        fetchedModels.value = r.models || [];
        if (showTtsFields()) fetchedVoices.value = r.voices || [];
        test.value = {
          ok: true,
          ms: ms(),
          models: (r.models || []).length,
          voices: (r.voices || []).length,
        };
      } else {
        test.value = { ok: false, message: "probe failed" };
      }
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
    return props.draft?.api_key || props.draft?.base_url ? "not tested" : "not tested — key missing";
  }
  if (!test.value.ok) return `unreachable — ${test.value.message}`;
  const bits = ["reachable"];
  if (test.value.models != null) bits.push(`${test.value.models} models`);
  if (showTtsFields() && test.value.voices) bits.push(`${test.value.voices} voices`);
  bits.push(`${test.value.ms} ms`);
  return bits.join(" · ");
});

// ── Save ─────────────────────────────────────────────────────────────
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
    <!-- Presets — one click fills url/format/capabilities. -->
    <div class="pf-presets" v-if="editingKey === 'new'">
      <button v-for="pr in PRESETS" :key="pr.id" type="button"
        class="pf-preset" :class="{ on: activePreset === pr.id }"
        :title="pr.url || 'Start from a blank OpenAI-compatible provider'"
        @click="applyPreset(pr)">{{ pr.label }}</button>
    </div>

    <!-- Row 1: NAME · BASE URL · API KEY · capabilities -->
    <div class="pf-row">
      <div class="pf-f">
        <label>Name</label>
        <input type="text" v-model="draft.name" :placeholder="hint?.label || 'My provider'" />
      </div>
      <div class="pf-f pf-wide">
        <label>Base URL</label>
        <input type="text" v-model="draft.base_url" placeholder="https://…" />
      </div>
      <div class="pf-f">
        <label>API key</label>
        <input type="password" v-model="draft.api_key" autocomplete="off" placeholder="sk-… (blank for local)" />
      </div>
      <div class="pf-f">
        <label title="Self-hosted = runs on your machine or network — free and private. Lists under Local; its voices badge as self-hosted, not online·metered.">Where it runs</label>
        <label style="display:flex;align-items:center;gap:6px;font-weight:400;text-transform:none;letter-spacing:0">
          <input type="checkbox" class="jv-check" v-model="draft.self_hosted" />
          <span>self-hosted (my machine / network — free)</span>
        </label>
      </div>
      <div class="pf-caps">
        <label title="Chat + embeddings — compose, rewrite, speaker extraction, refinement"><input type="checkbox" class="jv-check" v-model="capLLM" /> <span class="pf-cap llm">LLM</span></label>
        <label title="Voice synthesis via /v1/audio/speech"><input type="checkbox" class="jv-check" v-model="capTTS" /> <span class="pf-cap tts">TTS</span></label>
      </div>
    </div>

    <!-- Install/setup hint band for known provider types -->
    <div v-if="hint" class="pf-hintband">
      <strong>Install / setup:</strong>
      <a href="#" @click.prevent="openHint">{{ hint.label }}</a>
      <span class="jv-muted"> — {{ hint.note }}</span>
    </div>

    <!-- Row 2 (LLM): API FORMAT · CHAT MODEL · fetch · EMBEDDING MODEL -->
    <div class="pf-row" v-if="showLlmFields()">
      <div class="pf-f">
        <label title="The wire format the adapter uses. openai-compat covers OpenAI-compatible local servers, DeepSeek, OpenRouter; ollama uses /api/chat for reasoning support.">API format</label>
        <select v-model="draft.provider_type" class="jv-input jv-w-name">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="openai-compat">OpenAI-compatible</option>
          <option value="gemini">Gemini</option>
          <option value="ollama">Ollama</option>
          <option value="deepseek">DeepSeek</option>
          <option value="openrouter">OpenRouter</option>
        </select>
      </div>
      <div class="pf-f">
        <label>Chat model</label>
        <span class="pf-pick">
          <input type="text" v-model="draft.default_model" placeholder="e.g. claude-haiku-4-5" list="pf-chat-models" />
          <span class="pf-caret" title="Pick from the models this provider's API reports">▾</span>
        </span>
        <datalist id="pf-chat-models">
          <option v-for="m in chatModels" :key="m" :value="m" />
        </datalist>
        <div class="pf-fhint" v-if="chatModels.length">✓ fetched — pick from {{ chatModels.length }} models, or type any model id</div>
        <div class="pf-fhint dim" v-else>Fetch to pick from this server's model list</div>
      </div>
      <JvButton
        class="pf-fetchbtn"
        variant="secondary"
        size="sm"
        :loading="modelsLoading"
        :disabled="modelsLoading || (editingKey === 'new' && !draft.base_url)"
        :label="fetchedModels.length ? '⟳ Refresh' : '⟳ Fetch models'"
        title="Re-query the provider's model list"
        @click="fetchModels"
      />
      <div class="pf-f">
        <label>Embedding model <span class="pf-opt">optional</span></label>
        <span class="pf-pick">
          <input type="text" v-model="draft.embedding_model" placeholder="text-embedding-3-small" list="pf-embed-models" />
          <span class="pf-caret">▾</span>
        </span>
        <datalist id="pf-embed-models">
          <option v-for="m in embeddingModels" :key="m" :value="m" />
        </datalist>
        <div class="pf-fhint" v-if="embeddingModels.length">✓ fetched — {{ embeddingModels.length }} embedding models</div>
      </div>
    </div>
    <div v-if="modelsError" class="pf-error">{{ modelsError }}</div>

    <!-- Row 3 (TTS): TTS MODEL · VOICES · fetch · RESPONSE FORMAT -->
    <div class="pf-row" v-if="showTtsFields()">
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
      <JvButton
        class="pf-fetchbtn"
        variant="secondary"
        size="sm"
        :loading="voicesLoading"
        :disabled="voicesLoading || !draft.base_url"
        :label="fetchedVoices.length ? '⟳ Refresh' : '⟳ Fetch voices'"
        title="Query the provider's /v1/audio/voices"
        @click="fetchVoices"
      />
      <div class="pf-f">
        <label>Response format</label>
        <select v-model="draft.response_format" class="jv-input jv-w-name">
          <option value="wav">wav (recommended)</option>
          <option value="mp3">mp3</option>
          <option value="pcm">pcm</option>
          <option value="ogg">ogg</option>
        </select>
      </div>
    </div>
    <div v-if="voicesError" class="pf-error">{{ voicesError }}</div>

    <!-- Fetched voices as toggle chips (mock's voicechips row) -->
    <div v-if="showTtsFields() && fetchedVoices.length" class="pf-voicechips">
      <button
        v-for="v in fetchedVoices"
        :key="v"
        type="button"
        class="pf-vchip"
        :class="{ on: isVoiceSelected(v) }"
        @click="toggleVoice(v)"
      >{{ v }}</button>
    </div>

    <!-- Footer: status · spacer · Test connection · Remove · Cancel · Save -->
    <footer class="pf-foot">
      <span class="pf-status">
        <span class="pf-dot" :class="{ off: !test || testBusy, err: test && !test.ok && !testBusy }"></span>
        {{ statusText }}
      </span>
      <span class="pf-spacer"></span>
      <JvButton
        variant="ghost"
        size="sm"
        :loading="testBusy"
        label="Test connection"
        title="Ping + re-fetch models and voices"
        @click="doTest"
      />
      <JvButton
        v-if="editingKey !== 'new'"
        variant="danger-outline" size="sm" label="Remove provider"
        @click="emit('delete')"
      />
      <JvButton variant="ghost" size="sm" label="Cancel" @click="emit('cancel')" />
      <JvButton variant="primary" size="sm" :loading="busy" :label="editingKey === 'new' ? 'Save provider' : 'Save'" @click="onSave" />
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

/* Horizontal field rows — labels ABOVE inputs, uppercase 11px. */
.pf-row { display: flex; gap: 14px; margin-top: 10px; align-items: flex-end; flex-wrap: wrap; }
.pf-f label {
  font-size: 11px; color: var(--ink-3);
  text-transform: uppercase; letter-spacing: .05em;
  display: block; margin-bottom: 3px;
}
.pf-f .pf-opt { text-transform: none; letter-spacing: 0; }
.pf-row input[type="text"],
.pf-row input[type="password"] {
  font: inherit; font-size: 13px;
  border: 1px solid var(--line); border-radius: 7px;
  padding: 8px 11px; width: 240px;
  background: var(--surface); color: var(--ink);
}
/* selects use the canonical .jv-input box (G4) — no scoped override */
.pf-wide input { width: 340px; }

/* Model combobox affordance — caret over the input, hint line under. */
.pf-pick { position: relative; display: block; }
.pf-pick input { padding-right: 26px; }
.pf-caret {
  position: absolute; right: 9px; top: 50%; transform: translateY(-50%);
  color: var(--ink-3); font-size: 11px; pointer-events: none;
}
.pf-fhint { font-size: 11px; color: var(--accent-ink, #2c6049); margin-top: 3px; }
.pf-fhint.dim { color: var(--ink-3); }
.pf-fetchbtn { margin-bottom: 22px; }

.pf-caps { display: flex; gap: 14px; align-items: center; padding-bottom: 6px; }
.pf-caps label { display: flex; gap: 6px; align-items: center; font-size: 13px; cursor: pointer; }
.pf-caps input { accent-color: var(--accent); width: 15px; height: 15px; }
.pf-cap {
  font-size: 9.5px; font-weight: 700; letter-spacing: .05em;
  padding: 2px 7px; border-radius: 999px;
  border: 1px solid var(--line-strong, #cfccc4);
}
.pf-cap.llm { border-color: #e2d2b0; background: #f5edda; color: #b08a3e; }
.pf-cap.tts { border-color: var(--accent-line, #b8d2c3); background: var(--accent-soft, #e8f0eb); color: var(--accent-ink, #2c6049); }

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
