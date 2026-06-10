<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  ProviderForm — inline editor for a single LLM or TTS provider.

  Direct port of JustWrite's SettingsProviderForm.vue:362-657 pattern
  (read in full this turn). Rendered inline in EnginesView's per-tab
  Registered Providers section — appears either at the top of the list
  (when adding) or in place of a provider's read-row (when editing).

  Affordance coverage (per the 2026-06-10 EnginesView Affordance Table):
    #3 id field (readonly on edit)
    #4 name field
    #5 kind select (llm / tts / both)
    #6 base URL with placeholder
    #7 BYO install hint band (per-provider seed metadata)
    #8 API key password field
    #9 LLM: runner select (openai-compat / ollama)
    #10 LLM: chat model Combobox + Fetch models + loading/error
    #11 LLM: tier segmented picker per chat model with auto/pinned + clear-pin
    #12 LLM: embedding model Combobox
    #13 TTS: TTS model Combobox + Fetch models
    #14 TTS: voices multi-select + Fetch voices
    #17 engine-specific param fields
    #18 Save / Cancel buttons
    #19 Ping action
  Rows #15, #16 (Chatterbox / Dia hot-swap) are not implemented — the
  /save_settings + /restart_server endpoints those JustWrite calls hit
  aren't present in JustVoice's local engine managers. Documented as ❌
  in the response, not silently skipped.
-->
<script setup>
import { computed, ref, reactive, onBeforeUnmount, watch } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "./jv/JvButton.vue";

const props = defineProps({
  // The provider being edited. For new providers, pass an empty shape
  // — the form initializes its own defaults from kindHint.
  draft: { type: Object, required: true },
  // "new" or the provider id; "new" enables the id field for typing.
  editingKey: { type: String, required: true },
  // "llm" or "tts" — drives which sections render. "both" appears
  // inside the kind dropdown when editing a provider that handles both.
  kindHint: { type: String, default: "llm" },
});

const emit = defineEmits(["save", "cancel", "delete"]);

const api = useApi();
const busy = ref(false);

// Hint metadata — when the user types a known provider id, surface a
// link to that provider's install guide or homepage. Mirrors the
// JustWrite pattern at SettingsProviderForm.vue:34-49.
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

// ── Model discovery ─────────────────────────────────────────────────
// For LLM providers, GET /v1/llm-providers/{id}/models returns the
// adapter's `models()` result. For TTS providers, hits the probe
// endpoint with the current baseUrl + apiKey to get models + voices.
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

async function fetchModels() {
  modelsError.value = "";
  modelsLoading.value = true;
  fetchedModels.value = [];
  try {
    if (props.kindHint === "llm" && props.editingKey !== "new") {
      // Live provider — the adapter is registered; ask it.
      const r = await api.request(`/v1/llm-providers/${props.editingKey}/models`);
      fetchedModels.value = r?.models || [];
      if (!fetchedModels.value.length) {
        modelsError.value = r?.error || "Provider returned no models.";
      }
    } else {
      // New provider OR TTS — use the probe endpoint with the draft's
      // current credentials so the user can fetch before saving.
      if (!props.draft.base_url) {
        modelsError.value = "Set a base URL first.";
        return;
      }
      const r = await api.request("/v1/engines/external/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: props.draft.base_url,
          api_key: props.draft.api_key || null,
        }),
      });
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

async function fetchVoices() {
  voicesError.value = "";
  voicesLoading.value = true;
  fetchedVoices.value = [];
  try {
    if (!props.draft.base_url) {
      voicesError.value = "Set a base URL first.";
      return;
    }
    const r = await api.request("/v1/engines/external/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        base_url: props.draft.base_url,
        api_key: props.draft.api_key || null,
      }),
    });
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
const voicesDropdownOpen = ref(false);

// Close voices dropdown on outside click.
let outsideClickFn = null;
const voicesBoxRef = ref(null);
function bindOutsideClick() {
  outsideClickFn = (e) => {
    if (voicesDropdownOpen.value && voicesBoxRef.value && !voicesBoxRef.value.contains(e.target)) {
      voicesDropdownOpen.value = false;
    }
  };
  document.addEventListener("mousedown", outsideClickFn);
}
function unbindOutsideClick() {
  if (outsideClickFn) {
    document.removeEventListener("mousedown", outsideClickFn);
    outsideClickFn = null;
  }
}
watch(voicesDropdownOpen, (open) => {
  if (open) bindOutsideClick();
  else unbindOutsideClick();
});
onBeforeUnmount(unbindOutsideClick);

// ── Tier classification (LLM chat model) ────────────────────────────
// Per JustWrite's `:225-242`, the tier is the prompt-routing bucket
// for speaker attribution. Calls /v1/llm-providers/classify-tier to
// auto-suggest; user can pin a different tier per model.
const TIERS = [
  { value: "guided",   label: "Guided",   blurb: "Small / Q3 models. Hand-held prompts." },
  { value: "direct",   label: "Direct",   blurb: "8B+ models. Standard one-shot." },
  { value: "reasoned", label: "Reasoned", blurb: "Reasoning models. Allow chain-of-thought." },
];

const autoTier = ref("");

async function refreshAutoTier() {
  autoTier.value = "";
  const model = props.draft.default_model;
  if (!model) return;
  try {
    const r = await api.request("/v1/llm-providers/classify-tier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    autoTier.value = r?.tier || "";
  } catch {
    autoTier.value = "";
  }
}

watch(() => props.draft?.default_model, refreshAutoTier, { immediate: true });

const pinnedTier = computed({
  get() { return props.draft.pinned_tier || ""; },
  set(v) { props.draft.pinned_tier = v; },
});

const effectiveTier = computed(() => pinnedTier.value || autoTier.value);

function pinTier(t) {
  pinnedTier.value = pinnedTier.value === t ? "" : t;  // toggle off if same
}

// ── Ping ────────────────────────────────────────────────────────────
const pingResult = ref(null);
const pingBusy = ref(false);

async function doPing() {
  pingResult.value = null;
  pingBusy.value = true;
  try {
    if (props.kindHint === "llm" && props.editingKey !== "new") {
      const r = await api.request(`/v1/llm-providers/${props.editingKey}/ping`, { method: "POST" });
      pingResult.value = { ok: !!r?.ok, message: r?.ok ? "Reachable." : (r?.error || "Not reachable.") };
    } else {
      // For TTS / new providers, probe is the equivalent of a ping.
      if (!props.draft.base_url) {
        pingResult.value = { ok: false, message: "Set a base URL first." };
        return;
      }
      const r = await api.request("/v1/engines/external/probe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base_url: props.draft.base_url,
          api_key: props.draft.api_key || null,
        }),
      });
      pingResult.value = {
        ok: !!r,
        message: r
          ? `Reachable. Server hint: ${r.server_hint || "unknown"} · ${(r.models || []).length} models · ${(r.voices || []).length} voices.`
          : "Probe failed.",
      };
    }
  } catch (e) {
    pingResult.value = { ok: false, message: e?.message || String(e) };
  } finally {
    pingBusy.value = false;
  }
}

// ── Save / Cancel / Delete ─────────────────────────────────────────
async function onSave() {
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

function showLlmFields() {
  return props.kindHint === "llm" || props.draft?.kind === "llm" || props.draft?.kind === "both";
}
function showTtsFields() {
  return props.kindHint === "tts" || props.draft?.kind === "tts" || props.draft?.kind === "both";
}
</script>

<template>
  <div class="provider-form">
    <div class="provider-form__grid">
      <!-- #3 id field — readonly on edit so feature pins don't orphan. -->
      <span class="provider-form__label">ID</span>
      <input
        type="text"
        class="jv-input jv-input--sm jv-w-id"
        :value="draft.id"
        :readonly="editingKey !== 'new'"
        @input="draft.id = $event.target.value"
        placeholder="e.g. my-claude"
      />

      <!-- #4 display name -->
      <span class="provider-form__label">Display name</span>
      <input
        type="text"
        class="jv-input jv-input--sm jv-w-name"
        v-model="draft.name"
        :placeholder="`e.g. ${hint?.label || 'My provider'}`"
      />

      <!-- #5 kind select — llm / tts / both -->
      <span class="provider-form__label">Kind</span>
      <select v-model="draft.kind" class="jv-input jv-input--sm jv-w-id">
        <option value="llm">LLM (chat / embedding)</option>
        <option value="tts">TTS (voice)</option>
        <option value="both">Both</option>
      </select>

      <!-- #6 base URL -->
      <span class="provider-form__label">Base URL</span>
      <input
        type="text"
        class="jv-input jv-input--sm jv-w-url"
        v-model="draft.base_url"
        placeholder="https://api.example.com/v1"
      />

      <!-- #7 BYO install hint band — surfaces the install/signup link
           for known provider types. Spans both grid columns so the
           description isn't squashed. -->
      <div v-if="hint" class="provider-form__hint">
        <strong>Install / setup:</strong>
        <a href="#" @click.prevent="openHint">{{ hint.label }}</a>
        <span class="jv-muted"> — {{ hint.note }}</span>
      </div>

      <!-- #8 API key -->
      <span class="provider-form__label">API key</span>
      <input
        type="password"
        class="jv-input jv-input--sm jv-w-url"
        v-model="draft.api_key"
        autocomplete="off"
        placeholder="sk-… (leave blank for local self-hosted servers)"
      />

      <!-- #9 LLM: runner select. Only render when kind includes llm. -->
      <template v-if="showLlmFields()">
        <span class="provider-form__label" title="The wire format the adapter uses. openai-compat covers Anthropic, OpenAI, DeepSeek, OpenRouter, OpenAI-compatible local servers. ollama uses /api/chat for reasoning support.">API format</span>
        <select v-model="draft.provider_type" class="jv-input jv-input--sm jv-w-id">
          <option value="anthropic">Anthropic</option>
          <option value="openai">OpenAI</option>
          <option value="openai-compat">OpenAI-compatible</option>
          <option value="gemini">Gemini</option>
          <option value="ollama">Ollama</option>
          <option value="deepseek">DeepSeek</option>
          <option value="openrouter">OpenRouter</option>
        </select>

        <!-- #10 chat model Combobox + Fetch button -->
        <span class="provider-form__label">Chat model</span>
        <div class="provider-form__fetch-row">
          <input
            type="text"
            class="jv-input jv-input--sm jv-w-name"
            v-model="draft.default_model"
            :placeholder="chatModels.length ? `Type to filter ${chatModels.length} fetched models` : 'e.g. claude-haiku-4-5'"
            list="provider-form-chat-models"
          />
          <datalist id="provider-form-chat-models">
            <option v-for="m in chatModels" :key="m" :value="m" />
          </datalist>
          <JvButton
            variant="secondary"
            size="sm"
            :loading="modelsLoading"
            :disabled="modelsLoading || (editingKey === 'new' && !draft.base_url)"
            :label="fetchedModels.length ? '↻ Refresh' : 'Fetch models'"
            @click="fetchModels"
          />
        </div>
        <span v-if="modelsError" class="provider-form__error">{{ modelsError }}</span>

        <!-- #11 Tier picker — segmented, with auto/pinned source label. -->
        <template v-if="draft.default_model">
          <span class="provider-form__label" title="Routes speaker attribution prompts. Guided = small models, Direct = mid, Reasoned = chain-of-thought. Auto-detected from the model id; pin to override.">Tier</span>
          <div class="provider-form__tier-row">
            <button
              v-for="t in TIERS"
              :key="t.value"
              type="button"
              class="provider-form__tier-btn"
              :class="{
                'provider-form__tier-btn--active': effectiveTier === t.value,
                'provider-form__tier-btn--pinned': pinnedTier === t.value,
              }"
              :title="t.blurb"
              @click="pinTier(t.value)"
            >
              {{ t.label }}
            </button>
            <span class="jv-muted provider-form__tier-source">
              {{ pinnedTier ? "(pinned)" : autoTier ? `(auto-detected ${autoTier})` : "" }}
            </span>
            <button
              v-if="pinnedTier"
              type="button"
              class="jv-btn jv-btn--ghost jv-btn--sm"
              @click="pinnedTier = ''"
            >Clear pin</button>
          </div>
        </template>

        <!-- #12 embedding model Combobox -->
        <span class="provider-form__label">Embedding model <span class="jv-muted">(optional)</span></span>
        <input
          type="text"
          class="jv-input jv-input--sm jv-w-name"
          v-model="draft.embedding_model"
          :placeholder="embeddingModels.length ? `${embeddingModels.length} embedding models fetched` : 'text-embedding-3-small'"
          list="provider-form-embed-models"
        />
        <datalist id="provider-form-embed-models">
          <option v-for="m in embeddingModels" :key="m" :value="m" />
        </datalist>
      </template>

      <!-- #13 TTS: TTS model Combobox + Fetch -->
      <template v-if="showTtsFields()">
        <span class="provider-form__label">TTS model</span>
        <div class="provider-form__fetch-row">
          <input
            type="text"
            class="jv-input jv-input--sm jv-w-name"
            v-model="draft.tts_model"
            :placeholder="ttsModels.length ? `${ttsModels.length} TTS models fetched` : 'e.g. eleven_flash_v2_5'"
            list="provider-form-tts-models"
          />
          <datalist id="provider-form-tts-models">
            <option v-for="m in ttsModels" :key="m" :value="m" />
          </datalist>
          <JvButton
            v-if="!showLlmFields()"
            variant="secondary"
            size="sm"
            :loading="modelsLoading"
            :disabled="modelsLoading || !draft.base_url"
            :label="fetchedModels.length ? '↻ Refresh' : 'Fetch models'"
            @click="fetchModels"
          />
        </div>

        <!-- #14 voices multi-select + Fetch voices -->
        <span class="provider-form__label">Voices</span>
        <div class="provider-form__fetch-row" ref="voicesBoxRef">
          <div class="provider-form__voices-input">
            <input
              type="text"
              class="jv-input jv-input--sm jv-w-name"
              :value="selectedVoiceArray().join(', ')"
              @input="draft.voices = $event.target.value.split(',').map((s) => s.trim()).filter(Boolean)"
              @focus="voicesDropdownOpen = !!fetchedVoices.length"
              @click="voicesDropdownOpen = !!fetchedVoices.length"
              :placeholder="fetchedVoices.length ? `Pick from ${fetchedVoices.length} or type` : 'e.g. af_bella, am_adam'"
            />
            <button
              type="button"
              class="provider-form__voices-chev"
              :disabled="!fetchedVoices.length"
              @click="voicesDropdownOpen = !voicesDropdownOpen"
            >▾</button>
            <ul v-if="voicesDropdownOpen && fetchedVoices.length" class="provider-form__voices-list">
              <li
                v-for="v in fetchedVoices"
                :key="v"
                :class="{ 'provider-form__voices-item--selected': isVoiceSelected(v) }"
                @mousedown.prevent="toggleVoice(v)"
              >
                <span class="provider-form__voices-check">{{ isVoiceSelected(v) ? "✓" : "" }}</span>
                {{ v }}
              </li>
            </ul>
          </div>
          <JvButton
            variant="secondary"
            size="sm"
            :loading="voicesLoading"
            :disabled="voicesLoading || !draft.base_url"
            :label="fetchedVoices.length ? '↻ Refresh' : 'Fetch voices'"
            @click="fetchVoices"
          />
        </div>
        <span v-if="voicesError" class="provider-form__error">{{ voicesError }}</span>
      </template>

      <!-- Engine-specific param block (#17) — for online TTS providers,
           this surfaces things like response_format. Lightweight v1
           implementation: response_format select. Future extension is
           a getParamSchema(provider_type) similar to JustWrite's
           providerParams.js. -->
      <template v-if="showTtsFields()">
        <span class="provider-form__label">Response format</span>
        <select v-model="draft.response_format" class="jv-input jv-input--sm jv-w-token">
          <option value="wav">wav (recommended)</option>
          <option value="mp3">mp3</option>
          <option value="pcm">pcm</option>
          <option value="ogg">ogg</option>
        </select>
      </template>
    </div>

    <!-- Ping result strip + actions -->
    <div v-if="pingResult" class="provider-form__ping-result" :class="{ 'provider-form__ping-result--err': !pingResult.ok }">
      {{ pingResult.ok ? "✓ " : "✗ " }}{{ pingResult.message }}
    </div>

    <footer class="provider-form__footer">
      <JvButton
        variant="ghost"
        size="sm"
        :loading="pingBusy"
        label="Ping"
        @click="doPing"
        title="Send a probe request to verify the URL + API key work."
      />
      <button
        v-if="editingKey !== 'new'"
        type="button"
        class="jv-btn jv-btn--danger-outline jv-btn--sm"
        @click="emit('delete')"
      >Delete</button>
      <span class="jv-spacer" />
      <JvButton variant="ghost" size="sm" label="Cancel" @click="emit('cancel')" />
      <JvButton variant="primary" size="sm" :loading="busy" label="Save" @click="onSave" />
    </footer>
  </div>
</template>

<style scoped>
.provider-form {
  border: 1.5px solid var(--accent);
  border-radius: 10px;
  background: var(--accent-soft);
  padding: 14px;
  margin: 8px 0 12px;
}
.provider-form__grid {
  display: grid;
  grid-template-columns: 140px minmax(0, 1fr);
  gap: 8px 14px;
  font-size: 12.5px;
  align-items: center;
}
.provider-form__label {
  color: var(--ink-3);
  font-size: 11.5px;
  font-weight: 500;
}
.provider-form__hint {
  grid-column: 1 / -1;
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--surface);
  font-size: 11.5px;
  line-height: 1.5;
}
.provider-form__hint strong { color: var(--accent-ink); }
.provider-form__hint a {
  color: var(--accent-ink);
  text-decoration: underline;
  margin-left: 4px;
}
.provider-form__fetch-row {
  display: flex;
  gap: 6px;
  align-items: stretch;
  flex-wrap: wrap;
}
.provider-form__error {
  grid-column: 2;
  font-size: 11px;
  color: var(--danger);
}
.provider-form__tier-row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.provider-form__tier-btn {
  appearance: none;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 4px 12px;
  font: inherit;
  font-size: 11.5px;
  cursor: pointer;
  color: var(--ink-2);
}
.provider-form__tier-btn:hover { background: var(--surface-2); }
.provider-form__tier-btn--active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
}
.provider-form__tier-btn--pinned::after {
  content: " ●";
  color: #fff;
}
.provider-form__tier-source {
  font-size: 10.5px;
}
.provider-form__voices-input {
  position: relative;
  flex: 1;
  min-width: 200px;
}
.provider-form__voices-input .jv-input { width: 100%; padding-right: 28px; }
.provider-form__voices-chev {
  appearance: none;
  position: absolute;
  top: 50%;
  right: 4px;
  transform: translateY(-50%);
  width: 22px;
  height: 22px;
  border: 0;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  border-radius: 4px;
  font-size: 10px;
}
.provider-form__voices-chev:hover:not(:disabled) {
  color: var(--ink);
  background: var(--surface-2);
}
.provider-form__voices-chev:disabled { opacity: 0.4; cursor: not-allowed; }
.provider-form__voices-list {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 60;
  margin: 0;
  padding: 4px;
  list-style: none;
  background: var(--surface);
  border: 1px solid var(--line-strong);
  border-radius: 6px;
  box-shadow: var(--shadow-3);
  max-height: 240px;
  overflow-y: auto;
}
.provider-form__voices-list li {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  border-radius: 3px;
  cursor: pointer;
}
.provider-form__voices-list li:hover { background: var(--surface-2); }
.provider-form__voices-item--selected {
  color: var(--accent-ink);
  font-weight: 600;
  background: var(--accent-soft);
}
.provider-form__voices-check {
  display: inline-block;
  width: 12px;
  color: var(--accent);
}
.provider-form__ping-result {
  margin-top: 10px;
  padding: 6px 10px;
  border-radius: 4px;
  font-size: 11.5px;
  background: var(--accent-soft);
  color: var(--accent-ink);
}
.provider-form__ping-result--err {
  background: var(--danger-bg);
  color: var(--danger-ink);
}
.provider-form__footer {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--line);
}
</style>
