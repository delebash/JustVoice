<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  EffectsView — pedalboard effect chain editor + preset library. Lifts the
  voicebox EffectsTab pattern (left preset list, right detail editor with
  drag-reorderable effects).

  Backend: server/justtts/api/effects.py exposes the effect catalog + preset
  CRUD. Pedalboard adoption triggered the Apache-2.0 → GPL-3.0-or-later flip.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import ListPane from "../components/ListPane.vue";
import { pushToast } from "../services/toastBridge.js";

const api = useApi();

const presets = ref([]);
const search = ref("");
const selectedId = ref(null);
const availableEffects = ref([]);
const editingChain = ref([]);

const filtered = computed(() => {
  if (!search.value) return presets.value;
  const q = search.value.toLowerCase();
  return presets.value.filter((p) => (p.name || "").toLowerCase().includes(q));
});

const selectedPreset = computed(() =>
  presets.value.find((p) => p.id === selectedId.value),
);

async function refresh() {
  try {
    const [presetsRes, effectsRes] = await Promise.all([
      api.request("/v1/effects/presets").catch(() => ({ presets: [] })),
      api.request("/v1/effects/available").catch(() => ({ effects: [] })),
    ]);
    presets.value = presetsRes.presets ?? presetsRes ?? [];
    availableEffects.value = effectsRes.effects ?? effectsRes ?? [];
    if (!selectedId.value && presets.value.length > 0) {
      selectedId.value = presets.value[0].id;
      editingChain.value = JSON.parse(JSON.stringify(presets.value[0].chain || []));
    }
  } catch (e) {
    pushToast({ kind: "error", title: "Couldn't load effects", description: String(e?.message ?? e) });
  }
}

function selectPreset(p) {
  selectedId.value = p.id;
  editingChain.value = JSON.parse(JSON.stringify(p.chain || []));
}

function addEffect(type) {
  const def = availableEffects.value.find((e) => e.type === type);
  if (!def) return;
  const params = {};
  for (const [k, p] of Object.entries(def.params || {})) {
    params[k] = p.default;
  }
  editingChain.value.push({ type, enabled: true, params });
}

function removeEffect(idx) {
  editingChain.value.splice(idx, 1);
}

function moveEffect(idx, dir) {
  const newIdx = idx + dir;
  if (newIdx < 0 || newIdx >= editingChain.value.length) return;
  const [item] = editingChain.value.splice(idx, 1);
  editingChain.value.splice(newIdx, 0, item);
}

onMounted(refresh);
</script>

<template>
  <div class="effects">
    <ListPane v-model:search-value="search" title="Effect presets" search-placeholder="Search presets…">
      <template #actions>
        <button class="btn btn--primary">+ New</button>
      </template>

      <div v-for="p in filtered" :key="p.id" class="effects__item" :class="{ active: p.id === selectedId }" @click="selectPreset(p)">
        <strong>{{ p.name }}</strong>
        <span v-if="p.is_builtin" class="effects__builtin">built-in</span>
        <span class="effects__item-meta">{{ (p.chain || []).length }} effects</span>
      </div>
    </ListPane>

    <div class="effects__detail">
      <div v-if="!selectedPreset" class="effects__detail-empty">
        <p>Select a preset or create one. Drag effects to reorder. Toggle each on/off without removing.</p>
      </div>
      <template v-else>
        <header class="effects__detail-header">
          <h2>{{ selectedPreset.name }}</h2>
          <button class="btn btn--primary">Save</button>
        </header>
        <p class="effects__description">{{ selectedPreset.description || "No description." }}</p>

        <div class="effects__chain">
          <div v-for="(eff, idx) in editingChain" :key="idx" class="effects__effect" :class="{ disabled: !eff.enabled }">
            <div class="effects__effect-header">
              <button class="effects__move" @click="moveEffect(idx, -1)" :disabled="idx === 0">▲</button>
              <button class="effects__move" @click="moveEffect(idx, 1)" :disabled="idx === editingChain.length - 1">▼</button>
              <strong>{{ eff.type }}</strong>
              <label class="effects__toggle">
                <input type="checkbox" v-model="eff.enabled" />
                <span>enabled</span>
              </label>
              <button class="effects__remove" @click="removeEffect(idx)">✕</button>
            </div>
            <div class="effects__params">
              <div v-for="(val, key) in eff.params" :key="key" class="effects__param">
                <label>{{ key }}</label>
                <input type="number" :value="val" @input="eff.params[key] = parseFloat($event.target.value)" />
              </div>
            </div>
          </div>
        </div>

        <div class="effects__add">
          <select @change="addEffect($event.target.value); $event.target.value = ''">
            <option value="">+ Add effect…</option>
            <option v-for="e in availableEffects" :key="e.type" :value="e.type">{{ e.type }}</option>
          </select>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.effects { display: grid; grid-template-columns: 320px 1fr; height: 100%; gap: 0; }
.effects__item { padding: 12px 16px; cursor: pointer; border-radius: 6px; margin: 0 8px 2px; display: flex; flex-direction: column; gap: 2px; position: relative; }
.effects__item:hover { background: var(--surface-2, #fbfaf7); }
.effects__item.active { background: var(--accent, #3a7d63); color: #fff; }
.effects__item-meta { font-size: 11px; opacity: 0.7; }
.effects__builtin { font-size: 10px; padding: 2px 6px; border-radius: 3px; background: rgba(0, 0, 0, 0.1); position: absolute; right: 12px; top: 12px; }
.effects__detail { padding: 32px; overflow-y: auto; }
.effects__detail-empty { padding: 40px; text-align: center; color: var(--ink-2, #4a4a4a); }
.effects__detail-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.effects__detail-header h2 { margin: 0; }
.effects__description { color: var(--ink-2, #4a4a4a); margin: 0 0 24px; }
.effects__effect { background: var(--surface-2, #fbfaf7); border: 1px solid var(--line, #e3e1dc); border-radius: 6px; padding: 12px; margin-bottom: 8px; }
.effects__effect.disabled { opacity: 0.5; }
.effects__effect-header { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
.effects__move { width: 24px; height: 24px; border: 1px solid var(--line-strong, #cfccc4); background: var(--surface, #fff); border-radius: 4px; cursor: pointer; font-size: 10px; }
.effects__move:disabled { opacity: 0.3; cursor: not-allowed; }
.effects__toggle { margin-left: auto; font-size: 12px; display: flex; gap: 4px; align-items: center; }
.effects__remove { background: transparent; border: 0; color: var(--danger, #a8442e); cursor: pointer; font-size: 14px; }
.effects__params { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.effects__param label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3, #888); margin-bottom: 4px; }
.effects__param input { width: 100%; padding: 4px 8px; border: 1px solid var(--line, #e3e1dc); border-radius: 4px; font-size: 13px; }
.effects__add { margin-top: 16px; }
.effects__add select { width: 240px; height: 32px; padding: 0 8px; border: 1px solid var(--line-strong, #cfccc4); border-radius: 6px; background: var(--surface-2, #fbfaf7); }
.btn { height: 32px; padding: 0 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--line-strong, #cfccc4); background: var(--surface-2, #fbfaf7); color: inherit; }
.btn--primary { background: var(--accent, #3a7d63); color: #fff; border-color: var(--accent, #3a7d63); }
</style>
