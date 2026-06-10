<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  AddProviderModal — register a new TTS or LLM provider.

  Mirrors JustWrite's SettingsProviderForm shape: pick a provider type
  from the dropdown, the form shape-shifts to the right fields, save to
  the registry (POST /v1/llm-providers for kind="llm", POST /v1/engines/external
  for kind="tts"). After save, the parent refreshes /v1/engines and the
  new provider appears as a row in the catalog.

  Provider types per kind:
    LLM: anthropic, openai, openai-compat, gemini, ollama, deepseek, openrouter
    TTS: openai-compat, openai-tts, elevenlabs, speechify, speechmatics
-->
<script setup>
import { computed, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "./jv/JvButton.vue";

const props = defineProps({
  open: { type: Boolean, required: true },
  kind: { type: String, required: true },  // "tts" | "llm"
});

const emit = defineEmits(["close", "saved"]);

const api = useApi();

// Provider-type catalog per kind. Each entry carries the defaults the
// adapter ships with (mirror server/justvoice/engines/llm/openai_compat.py
// PROVIDER_DEFAULTS + the adapter-specific defaults from anthropic.py /
// gemini.py / ollama.py).
const LLM_PROVIDER_TYPES = [
  { type: "anthropic",     label: "Anthropic Claude",          baseUrl: "https://api.anthropic.com",                            defaultModel: "claude-haiku-4-5",        needsKey: true },
  { type: "openai",        label: "OpenAI",                    baseUrl: "https://api.openai.com/v1",                            defaultModel: "gpt-4o-mini",             needsKey: true },
  { type: "gemini",        label: "Google Gemini",             baseUrl: "https://generativelanguage.googleapis.com",            defaultModel: "gemini-2.5-flash",        needsKey: true },
  { type: "deepseek",      label: "DeepSeek",                  baseUrl: "https://api.deepseek.com/v1",                          defaultModel: "deepseek-chat",           needsKey: true },
  { type: "openrouter",    label: "OpenRouter",                baseUrl: "https://openrouter.ai/api/v1",                         defaultModel: "openai/gpt-4o-mini",      needsKey: true },
  { type: "ollama",        label: "Ollama (local)",            baseUrl: "http://localhost:11434",                               defaultModel: "llama3.2",                needsKey: false },
  { type: "openai-compat", label: "OpenAI-compatible (custom)",baseUrl: "http://localhost:11434/v1",                            defaultModel: "",                        needsKey: false },
];

const TTS_PROVIDER_TYPES = [
  { type: "elevenlabs",        label: "ElevenLabs",                       baseUrl: "https://api.elevenlabs.io",      defaultModel: "eleven_flash_v2_5",       needsKey: true },
  { type: "speechify",         label: "Speechify",                        baseUrl: "https://api.sws.speechify.com",  defaultModel: "simba-multilingual",      needsKey: true },
  { type: "speechmatics",      label: "Speechmatics",                     baseUrl: "https://preview.tts.speechmatics.com", defaultModel: "default",          needsKey: true },
  { type: "openai-tts",        label: "OpenAI TTS",                       baseUrl: "https://api.openai.com",         defaultModel: "tts-1",                   needsKey: true },
  { type: "openai-compat",     label: "OpenAI-compatible (custom server)",baseUrl: "",                                defaultModel: "tts-1",                   needsKey: false },
];

const providerTypes = computed(() => (props.kind === "llm" ? LLM_PROVIDER_TYPES : TTS_PROVIDER_TYPES));

const form = ref({
  id: "",
  name: "",
  provider_type: "",
  base_url: "",
  api_key: "",
  default_model: "",
});

const selectedType = computed(() =>
  providerTypes.value.find((t) => t.type === form.value.provider_type) || null,
);

const busy = ref(false);

// Reset the form whenever the modal opens or the kind changes.
watch(
  () => [props.open, props.kind],
  ([open]) => {
    if (open) {
      form.value = {
        id: "",
        name: "",
        provider_type: providerTypes.value[0]?.type || "",
        base_url: providerTypes.value[0]?.baseUrl || "",
        api_key: "",
        default_model: providerTypes.value[0]?.defaultModel || "",
      };
    }
  },
  { immediate: true },
);

// When the user changes provider type, refresh the URL + model defaults
// to that type's baked-in values. Anything the user already typed wins.
function onProviderTypeChange() {
  const spec = selectedType.value;
  if (!spec) return;
  if (!form.value.base_url) form.value.base_url = spec.baseUrl;
  if (!form.value.default_model) form.value.default_model = spec.defaultModel;
}

function suggestedId() {
  const t = form.value.provider_type || "provider";
  const stamp = Math.random().toString(36).slice(2, 6);
  return `${t}-${stamp}`;
}

async function save() {
  if (!form.value.provider_type) {
    pushToast({ message: "Pick a provider type first.", kind: "info" });
    return;
  }
  if (!form.value.name.trim()) {
    pushToast({ message: "Give the provider a name.", kind: "info" });
    return;
  }
  if (selectedType.value?.needsKey && !form.value.api_key.trim()) {
    pushToast({ message: "API key required for this provider.", kind: "info" });
    return;
  }
  const id = form.value.id.trim() || suggestedId();
  busy.value = true;
  try {
    if (props.kind === "llm") {
      await api.request("/v1/llm-providers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          name: form.value.name,
          provider_type: form.value.provider_type,
          base_url: form.value.base_url || "",
          api_key: form.value.api_key || null,
          default_model: form.value.default_model || "",
        }),
      });
    } else {
      // TTS providers register through settings.engines.external. The
      // server's _register_external_engines dispatches by provider_type
      // (Phase 2 / Slice 5) so the right adapter class instantiates.
      // PATCH /v1/settings is the bulk-update route; pull the current
      // settings, append the new entry, write back.
      const current = await api.request("/v1/settings");
      const externals = [...(current?.engines?.external || [])];
      externals.push({
        id,
        name: form.value.name,
        provider_type: form.value.provider_type,
        base_url: form.value.base_url || "",
        api_key: form.value.api_key || null,
        model: form.value.default_model || "",
        voices: [],
        response_format: "wav",
      });
      await api.request("/v1/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engines: { external: externals } }),
      });
    }
    pushToast({ message: `${form.value.name} registered.`, kind: "success" });
    emit("saved");
    emit("close");
  } catch (e) {
    pushToast({
      message: `Save failed: ${e?.message || e}`,
      kind: "error",
      duration: 6000,
    });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="open" class="jv-overlay" @click.self="$emit('close')">
    <div class="jv-modal add-provider-modal">
      <header class="jv-modal__header">
        <div class="jv-modal__titleblock">
          <span class="jv-modal__eyebrow">{{ kind === "llm" ? "LLM provider" : "TTS provider" }}</span>
          <h3 class="jv-modal__title">Add provider</h3>
        </div>
        <button type="button" class="jv-modal__close" @click="$emit('close')">✕</button>
      </header>

      <div class="jv-modal__body add-provider-modal__body">
        <label class="add-provider-modal__field">
          <span>Provider type</span>
          <select
            v-model="form.provider_type"
            class="jv-input jv-w-name"
            @change="onProviderTypeChange"
          >
            <option
              v-for="t in providerTypes"
              :key="t.type"
              :value="t.type"
            >{{ t.label }}</option>
          </select>
          <span v-if="selectedType" class="jv-muted add-provider-modal__hint">
            Default base URL <code class="jv-mono">{{ selectedType.baseUrl || "(none — set explicitly below)" }}</code>
          </span>
        </label>

        <label class="add-provider-modal__field">
          <span>Display name</span>
          <input
            v-model="form.name"
            class="jv-input jv-w-name"
            :placeholder="`e.g. 'My ${selectedType?.label || 'Provider'}'`"
          />
        </label>

        <label class="add-provider-modal__field">
          <span>ID (optional)</span>
          <input
            v-model="form.id"
            class="jv-input jv-w-id"
            :placeholder="suggestedId()"
          />
          <span class="jv-muted add-provider-modal__hint">
            Stable identifier used by feature pins. Auto-generated if left blank.
          </span>
        </label>

        <label class="add-provider-modal__field">
          <span>Base URL</span>
          <input
            v-model="form.base_url"
            class="jv-input jv-w-url"
            :placeholder="selectedType?.baseUrl || ''"
          />
        </label>

        <label v-if="selectedType?.needsKey || form.api_key" class="add-provider-modal__field">
          <span>API key {{ selectedType?.needsKey ? "(required)" : "(optional)" }}</span>
          <input
            v-model="form.api_key"
            type="password"
            class="jv-input jv-w-url"
            placeholder="sk-..."
            autocomplete="off"
          />
        </label>

        <label class="add-provider-modal__field">
          <span>Default model</span>
          <input
            v-model="form.default_model"
            class="jv-input jv-w-id"
            :placeholder="selectedType?.defaultModel || ''"
          />
          <span class="jv-muted add-provider-modal__hint">
            Used when a feature pin doesn't specify a model.
          </span>
        </label>
      </div>

      <footer class="jv-modal__footer">
        <span class="jv-spacer" />
        <JvButton variant="secondary" label="Cancel" @click="$emit('close')" />
        <JvButton variant="primary" :loading="busy" :disabled="busy" label="Add provider" @click="save" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.add-provider-modal { width: min(540px, calc(100vw - 32px)); }
.add-provider-modal__body { padding: 16px 22px; display: flex; flex-direction: column; gap: 14px; }

.add-provider-modal__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.add-provider-modal__field > span {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.add-provider-modal__hint { font-size: 11.5px; }
.add-provider-modal__hint code {
  background: var(--surface-2);
  padding: 1px 4px;
  border-radius: 3px;
}
</style>
