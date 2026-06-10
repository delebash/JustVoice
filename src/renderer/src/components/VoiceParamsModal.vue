<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  VoiceParamsModal — Tier-2 voice tuning editor.

  Phase 4 / Slice 1 — ported in shape from JustWrite's VoiceParamsModal.vue.
  Renders the per-engine knob schema fetched from /v1/engines/capabilities
  with sparse-override semantics: empty cells fall through to the engine's
  default; only explicitly-set cells get persisted.
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import JvButton from "./jv/JvButton.vue";

const props = defineProps({
  open: { type: Boolean, required: true },
  voiceId: { type: String, default: "" },
  voiceName: { type: String, default: "" },
  // The persona's default_delivery dict — sparse, only set keys.
  modelValue: { type: Object, default: () => ({}) },
});

const emit = defineEmits(["save", "cancel"]);

const api = useApi();

// Working copy. Committed on Save, discarded on Cancel.
const params = ref({});

// Per-engine knob schema. Format from /v1/engines/capabilities:
//   { knobs: [{key, label, type, default, min, max, step, advanced, hint}] }
const capability = ref(null);
const capabilityFetchSeq = ref(0);

const primaryKnobs = computed(() =>
  (capability.value?.knobs || []).filter((k) => !k.advanced),
);
const advancedKnobs = computed(() =>
  (capability.value?.knobs || []).filter((k) => k.advanced),
);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    params.value = { ...(props.modelValue || {}) };
    await loadCapability();
  },
);

async function loadCapability() {
  if (!props.voiceId) return;
  const seq = ++capabilityFetchSeq.value;
  try {
    // Resolve which engine owns this voice. /v1/voices returns each
    // voice with its engine id; cross-reference against the capability
    // map so the right knob schema renders. The previous "pick first
    // engine in the map" path produced wrong knobs for any voice that
    // wasn't from whatever engine sorted first.
    const [voicesResp, capsResp] = await Promise.all([
      api.safeRequest(`/v1/voices`, { voices: [] }),
      api.safeRequest(`/v1/engines/capabilities`, { engines: {} }),
    ]);
    if (seq !== capabilityFetchSeq.value) return;
    const voices = voicesResp?.voices || [];
    const me = voices.find((v) => v.id === props.voiceId);
    const engineId = me?.engine || me?.engine_id;
    const engines = capsResp?.engines || {};
    if (engineId && engines[engineId]) {
      capability.value = engines[engineId];
      return;
    }
    // Fallback: voice not in /v1/voices yet, or no engine reported.
    // Use union of all engines' knobs so the user at least sees something
    // editable instead of an empty modal.
    const allKnobs = Object.values(engines).flatMap((e) => e?.knobs || []);
    const seen = new Set();
    const unionKnobs = allKnobs.filter((k) => {
      if (seen.has(k.key)) return false;
      seen.add(k.key);
      return true;
    });
    capability.value = { knobs: unionKnobs };
  } catch {
    capability.value = { knobs: [] };
  }
}

function setParam(key, value) {
  if (value === "" || value === null || value === undefined || Number.isNaN(value)) {
    delete params.value[key];
    params.value = { ...params.value };
    return;
  }
  params.value = { ...params.value, [key]: value };
}

function clearParam(key) {
  delete params.value[key];
  params.value = { ...params.value };
}

function isOverride(key) {
  return Object.prototype.hasOwnProperty.call(params.value, key);
}

function onSave() {
  emit("save", { ...params.value });
}
function onCancel() { emit("cancel"); }

onMounted(() => {
  if (props.open) {
    params.value = { ...(props.modelValue || {}) };
    loadCapability();
  }
});
</script>

<template>
  <div v-if="open" class="jv-overlay" @click.self="onCancel">
    <div class="jv-modal voice-params-modal">
      <header class="jv-modal__header">
        <div class="jv-modal__titleblock">
          <span class="jv-modal__eyebrow">Tier-2 voice tuning</span>
          <h3 class="jv-modal__title">{{ voiceName || voiceId || "Voice" }}</h3>
        </div>
        <button type="button" class="jv-modal__close" @click="onCancel">✕</button>
      </header>

      <div class="jv-modal__body voice-params-modal__body">
        <p class="jv-muted voice-params-modal__lede">
          Per-voice overrides. Empty cells fall through to the engine's default
          at render time. Only explicit values are persisted.
        </p>

        <p v-if="!(capability?.knobs || []).length" class="jv-muted">
          No tunable knobs for this engine.
        </p>

        <div v-else class="voice-params-modal__grid">
          <label
            v-for="k in primaryKnobs"
            :key="k.key"
            class="voice-params-modal__field"
          >
            <span>
              {{ k.label }}
              <button
                v-if="isOverride(k.key)"
                type="button"
                class="voice-params-modal__reset"
                title="Clear override (use engine default)"
                @click="clearParam(k.key)"
              >reset</button>
            </span>
            <input
              v-if="k.type === 'number'"
              type="number"
              class="jv-input jv-w-token"
              :value="params[k.key] ?? ''"
              :min="k.min"
              :max="k.max"
              :step="k.step"
              :placeholder="`(default ${k.default})`"
              @input="setParam(k.key, $event.target.value === '' ? null : Number($event.target.value))"
            />
            <input
              v-else
              type="text"
              class="jv-input"
              :value="params[k.key] ?? ''"
              :placeholder="`(default ${k.default})`"
              @input="setParam(k.key, $event.target.value)"
            />
            <span v-if="k.hint" class="jv-muted voice-params-modal__hint">{{ k.hint }}</span>
          </label>
        </div>

        <details v-if="advancedKnobs.length" class="voice-params-modal__advanced">
          <summary>⚙ Advanced ({{ advancedKnobs.length }})</summary>
          <div class="voice-params-modal__grid">
            <label
              v-for="k in advancedKnobs"
              :key="k.key"
              class="voice-params-modal__field"
            >
              <span>
                {{ k.label }}
                <button
                  v-if="isOverride(k.key)"
                  type="button"
                  class="voice-params-modal__reset"
                  @click="clearParam(k.key)"
                >reset</button>
              </span>
              <input
                v-if="k.type === 'number'"
                type="number"
                class="jv-input jv-w-token"
                :value="params[k.key] ?? ''"
                :min="k.min"
                :max="k.max"
                :step="k.step"
                :placeholder="`(default ${k.default})`"
                @input="setParam(k.key, $event.target.value === '' ? null : Number($event.target.value))"
              />
              <input
                v-else
                type="text"
                class="jv-input"
                :value="params[k.key] ?? ''"
                :placeholder="`(default ${k.default})`"
                @input="setParam(k.key, $event.target.value)"
              />
            </label>
          </div>
        </details>
      </div>

      <footer class="jv-modal__footer">
        <span class="jv-spacer" />
        <JvButton variant="secondary" label="Cancel" @click="onCancel" />
        <JvButton variant="primary" label="Save" @click="onSave" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.voice-params-modal { width: min(640px, calc(100vw - 32px)); }
.voice-params-modal__body { padding: 16px 22px; }
.voice-params-modal__lede { font-size: 12.5px; margin: 0 0 12px; }

.voice-params-modal__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px 16px;
}
.voice-params-modal__field {
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.voice-params-modal__field > span {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.voice-params-modal__reset {
  appearance: none;
  background: transparent;
  border: 0;
  font: inherit;
  font-size: 10px;
  color: var(--accent);
  cursor: pointer;
  text-transform: none;
  letter-spacing: 0;
  padding: 0;
}
.voice-params-modal__hint { font-size: 11px; }

.voice-params-modal__advanced { margin-top: 14px; }
.voice-params-modal__advanced > summary {
  cursor: pointer;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--ink-3);
  user-select: none;
  padding: 8px 0;
}
</style>
