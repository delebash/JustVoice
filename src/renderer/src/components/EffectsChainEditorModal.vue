<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  EffectsChainEditorModal — drag-reorderable list of pedalboard effects
  with per-effect parameter forms. Opens against a chain ref; emits
  `save` with the new chain when the user clicks Save, or `cancel`
  otherwise.

  Slice 7 of the Profile-kill plan / Effects v1 wiring. Lives standalone
  so it can be reused from PersonasView, RenderPreset editor (Phase 6),
  and the EffectsView preset library.

  Backend pairings:
    GET /v1/effects/catalog      — per-effect parameter schemas
    GET /v1/effect-presets       — saved chains the user can load wholesale
  Both are nice-to-haves: when the catalog request fails the modal still
  shows the 11 supported types from a local fallback.
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { UiButton, UiInput, UiCheckbox, UiTag } from "@delebash/llm-ui";

const props = defineProps({
  open: { type: Boolean, required: true },
  modelValue: { type: Array, default: () => [] },
  // Optional context label shown in the header eyebrow (e.g. persona name).
  contextLabel: { type: String, default: "" },
});

const emit = defineEmits(["update:modelValue", "save", "cancel"]);

const api = useApi();

// Working copy of the chain — committed on Save, discarded on Cancel.
const chain = ref([]);
const catalog = ref([]);   // [{type, label, description, params: [{key, label, type, default, min, max, step}]}]
const presets = ref([]);   // [{id, name, description, chain, is_builtin}]
const presetPickerOpen = ref(false);
const saveAsName = ref("");

// Fallback minimal catalog so the modal isn't blocked if /v1/effects/catalog
// hasn't loaded yet. Server is authoritative; this just guards the rare
// race where the modal opens before the fetch resolves.
const FALLBACK_CATALOG = [
  { type: "reverb",      label: "Reverb",          params: [] },
  { type: "distortion",  label: "Distortion",      params: [] },
  { type: "gain",        label: "Gain",            params: [] },
  { type: "compressor",  label: "Compressor",      params: [] },
  { type: "pitch_shift", label: "Pitch shift",     params: [] },
  { type: "delay",       label: "Delay",           params: [] },
  { type: "highpass",    label: "High-pass",       params: [] },
  { type: "lowpass",     label: "Low-pass",        params: [] },
  { type: "eq_low",      label: "EQ — Low shelf",  params: [] },
  { type: "eq_mid",      label: "EQ — Mid peak",   params: [] },
  { type: "eq_high",     label: "EQ — High shelf", params: [] },
];

const effectiveCatalog = computed(() => catalog.value.length ? catalog.value : FALLBACK_CATALOG);

const addEffectType = ref("");

function specFor(type) {
  return effectiveCatalog.value.find((e) => e.type === type) || null;
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      // Deep-copy the incoming chain so the user can edit + cancel.
      chain.value = JSON.parse(JSON.stringify(props.modelValue || []));
      addEffectType.value = "";
      presetPickerOpen.value = false;
      saveAsName.value = "";
      loadCatalogIfNeeded();
      loadPresetsIfNeeded();
    }
  },
  { immediate: true },
);

async function loadCatalogIfNeeded() {
  if (catalog.value.length) return;
  try {
    const r = await api.request("/v1/effects/catalog");
    catalog.value = r?.effects || [];
  } catch (_) { /* falls back to FALLBACK_CATALOG */ }
}

async function loadPresetsIfNeeded() {
  try {
    const r = await api.request("/v1/effect-presets");
    presets.value = r?.presets || [];
  } catch (_) { presets.value = []; }
}

function addEffect() {
  const type = addEffectType.value;
  if (!type) return;
  const spec = specFor(type);
  const params = {};
  for (const p of spec?.params || []) {
    if (p.default !== undefined) params[p.key] = p.default;
  }
  chain.value.push({ type, params });
  addEffectType.value = "";
}

function removeAt(i) {
  chain.value.splice(i, 1);
}

function move(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= chain.value.length) return;
  const tmp = chain.value[i];
  chain.value[i] = chain.value[j];
  chain.value[j] = tmp;
}

function setParam(i, key, value) {
  const entry = chain.value[i];
  if (!entry) return;
  if (!entry.params) entry.params = {};
  entry.params[key] = value;
}

function loadPreset(preset) {
  chain.value = JSON.parse(JSON.stringify(preset.chain || []));
  presetPickerOpen.value = false;
  pushToast({ message: `Loaded preset "${preset.name}".`, kind: "success", duration: 3000 });
}

async function saveAsPreset() {
  const name = (saveAsName.value || "").trim();
  if (!name) {
    pushToast({ message: "Name the preset first.", kind: "info" });
    return;
  }
  try {
    await api.request("/v1/effect-presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, chain: chain.value, description: null }),
    });
    saveAsName.value = "";
    await loadPresetsIfNeeded();
    pushToast({ message: `Saved "${name}" to the Effects page (chain presets — not Render Presets).`, kind: "success", duration: 6000 });
  } catch (e) {
    pushToast({
      message: `Save preset failed: ${e?.message || e}`,
      kind: "error",
      duration: 6000,
    });
  }
}

function onSave() {
  emit("update:modelValue", chain.value);
  emit("save", chain.value);
}

function onCancel() {
  emit("cancel");
}

onMounted(() => {
  if (props.open) {
    loadCatalogIfNeeded();
    loadPresetsIfNeeded();
  }
});
</script>

<template>
  <div v-if="open" class="jv-overlay" @click.self="onCancel">
    <div class="jv-modal effects-modal">
      <header class="jv-modal__header">
        <div class="jv-modal__titleblock">
          <span v-if="contextLabel" class="jv-modal__eyebrow">{{ contextLabel }}</span>
          <h3 class="jv-modal__title">Effects chain</h3>
        </div>
        <button type="button" class="jv-modal__close" @click="onCancel">✕</button>
      </header>

      <div class="jv-modal__body effects-modal__body">
        <!-- Preset picker — loads a saved chain wholesale -->
        <div class="effects-modal__row">
          <UiButton
            intent="ghost" size="small"
            :label="presetPickerOpen ? 'Hide presets' : 'Load from preset…'"
            @click="presetPickerOpen = !presetPickerOpen"
          />
          <span class="jv-muted" v-if="presets.length">{{ presets.length }} saved</span>
        </div>
        <div v-if="presetPickerOpen" class="effects-modal__presets">
          <button
            v-for="p in presets"
            :key="p.id"
            type="button"
            class="effects-modal__preset-row"
            @click="loadPreset(p)"
          >
            <strong>{{ p.name }}</strong>
            <UiTag intent="ghost" v-if="p.is_builtin">built-in</UiTag>
            <span class="jv-muted">{{ (p.chain || []).length }} effect{{ (p.chain || []).length === 1 ? '' : 's' }}</span>
          </button>
          <p v-if="!presets.length" class="jv-muted">No saved chains yet. Build one below and click "Save chain to Effects library".</p>
        </div>

        <div class="jv-divider" />

        <!-- Active chain — ordered list with per-effect param forms -->
        <p v-if="!chain.length" class="jv-muted effects-modal__empty">
          No effects. Pick a type below and click <strong>Add</strong>.
        </p>

        <ul class="effects-modal__chain">
          <li
            v-for="(ef, i) in chain"
            :key="i"
            class="effects-modal__effect"
          >
            <div class="effects-modal__effect-h">
              <strong>{{ specFor(ef.type)?.label || ef.type }}</strong>
              <span class="effects-modal__step">step {{ i + 1 }}</span>
              <span class="jv-spacer" />
              <UiButton intent="ghost" size="small" label="↑" :disabled="i === 0" title="Move up" @click="move(i, -1)" />
              <UiButton intent="ghost" size="small" label="↓" :disabled="i === chain.length - 1" title="Move down" @click="move(i, 1)" />
              <UiButton intent="danger-outline" size="small" label="Remove" @click="removeAt(i)" />
            </div>
            <p v-if="specFor(ef.type)?.description" class="jv-muted effects-modal__desc">
              {{ specFor(ef.type).description }}
            </p>
            <div v-if="(specFor(ef.type)?.params || []).length" class="effects-modal__params">
              <label
                v-for="p in specFor(ef.type).params"
                :key="p.key"
                class="effects-modal__param"
              >
                <span>{{ p.label }}</span>
                <UiCheckbox
                  v-if="p.type === 'boolean'"
                  :model-value="!!ef.params?.[p.key]"
                  @change="setParam(i, p.key, $event.target.checked)"
                />
                <UiInput
                  v-else
                  type="number"
                  class="effects-modal__param-num"
                  :model-value="ef.params?.[p.key] ?? p.default"
                  :min="p.min"
                  :max="p.max"
                  :step="p.step"
                  @update:model-value="setParam(i, p.key, Number($event))"
                />
              </label>
            </div>
          </li>
        </ul>

        <div class="jv-divider" />

        <!-- Add a new effect -->
        <div class="effects-modal__row effects-modal__add">
          <span class="effects-modal__add-label">Add effect:</span>
          <select v-model="addEffectType" class="jv-input jv-w-name">
            <option value="">— pick a type —</option>
            <option
              v-for="e in effectiveCatalog"
              :key="e.type"
              :value="e.type"
            >{{ e.label }}</option>
          </select>
          <UiButton
            intent="secondary"
            size="small"
            label="Add"
            :disabled="!addEffectType"
            @click="addEffect"
          />
        </div>

        <!-- Save as preset -->
        <div class="effects-modal__row effects-modal__saveas">
          <UiInput
            v-model="saveAsName"
            width="name"
            placeholder="Name (e.g. Cave reverb, Phone filter)…"
          />
          <UiButton
            intent="ghost"
            size="small"
            label="Save chain to Effects library"
            :disabled="!saveAsName.trim() || !chain.length"
            @click="saveAsPreset"
          />
        </div>
      </div>

      <footer class="jv-modal__footer">
        <span class="jv-spacer" />
        <UiButton intent="secondary" label="Cancel" @click="onCancel" />
        <UiButton intent="primary" label="Save" @click="onSave" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.effects-modal { width: min(720px, calc(100vw - 32px)); }

.effects-modal__body { padding: 18px 22px; }

.effects-modal__row {
  display: flex;
  align-items: center;
  gap: 10px;
}
.effects-modal__row + .effects-modal__row { margin-top: 8px; }

.effects-modal__presets {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 8px;
}
.effects-modal__preset-row {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 8px 12px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--ink);
  font: inherit;
}
.effects-modal__preset-row:hover {
  background: var(--accent-soft);
  border-color: var(--accent);
}

.effects-modal__empty { padding: 24px 0; text-align: center; }

.effects-modal__chain {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.effects-modal__effect {
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  padding: 12px;
  background: var(--surface-2);
}

.effects-modal__effect-h {
  display: flex;
  align-items: center;
  gap: 8px;
}
.effects-modal__step {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
}
.effects-modal__desc {
  margin: 4px 0 8px;
  font-size: 11.5px;
}

.effects-modal__params {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px 14px;
}
.effects-modal__param {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.effects-modal__param > span {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.effects-modal__param-num { width: 100%; }

.effects-modal__add {
  align-items: center;
  margin-top: 14px;
}
.effects-modal__add-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}

.effects-modal__saveas {
  margin-top: 14px;
}
.effects-modal__saveas > input { flex: 1; }
</style>
