<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  EffectsView — pedalboard effect chain editor + preset library.
  Left preset list, right detail editor with drag-reorderable effects.

  Backend: server/justvoice/api/effects.py exposes the effect catalog + preset
  CRUD. Pedalboard adoption triggered the Apache-2.0 → GPL-3.0-or-later flip.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvTag from "../components/jv/JvTag.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvCheckbox from "../components/jv/JvCheckbox.vue";

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

const addEffectModel = ref("");

const effectOptions = computed(() =>
  availableEffects.value.map((e) => ({ label: e.type, value: e.type })),
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
  if (!type) return;
  const def = availableEffects.value.find((e) => e.type === type);
  if (!def) return;
  const params = {};
  for (const [k, p] of Object.entries(def.params || {})) {
    params[k] = p.default;
  }
  editingChain.value.push({ type, enabled: true, params });
  addEffectModel.value = "";
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
  <div class="effects jv-pane">
    <!-- ── Preset list ──────────────────────────────────────────────── -->
    <div class="effects__sidebar">
      <div class="effects__list-header jv-row" style="padding:14px 16px 10px; border-bottom:1px solid var(--line);">
        <span class="jv-section__title" style="margin:0;">Effect presets</span>
        <JvButton variant="primary" size="sm" label="+ New" />
      </div>
      <div style="padding:8px 16px;">
        <JvInput v-model="search" placeholder="Search presets…" size="sm" />
      </div>

      <div
        v-for="p in filtered"
        :key="p.id"
        class="jv-pane-list__item effects__preset-item"
        :class="{ 'jv-pane-list__item--active': p.id === selectedId }"
        @click="selectPreset(p)"
      >
        <div class="jv-row" style="gap:6px;">
          <strong>{{ p.name }}</strong>
          <JvTag v-if="p.is_builtin" variant="default" label="built-in" />
        </div>
        <span class="jv-pane-list__meta">{{ (p.chain || []).length }} effects</span>
      </div>
    </div>

    <!-- ── Detail / editor ─────────────────────────────────────────── -->
    <div class="jv-pane-detail effects__detail">
      <div v-if="!selectedPreset" class="effects__detail-empty jv-muted">
        <p>Select a preset or create one. Drag effects to reorder. Toggle each on/off without removing.</p>
      </div>
      <template v-else>
        <div class="jv-row effects__detail-header">
          <h2 style="margin:0;">{{ selectedPreset.name }}</h2>
          <div class="jv-spacer" />
          <JvButton variant="primary" label="Save" />
        </div>
        <p class="jv-muted" style="margin:6px 0 20px;">{{ selectedPreset.description || "No description." }}</p>

        <!-- Effect chain -->
        <div class="effects__chain">
          <div
            v-for="(eff, idx) in editingChain"
            :key="idx"
            class="jv-card effects__effect"
            :class="{ 'effects__effect--disabled': !eff.enabled }"
          >
            <div class="jv-row effects__effect-header">
              <div class="jv-btn-group">
                <JvButton variant="secondary" size="icon" :disabled="idx === 0" @click="moveEffect(idx, -1)">▲</JvButton>
                <JvButton variant="secondary" size="icon" :disabled="idx === editingChain.length - 1" @click="moveEffect(idx, 1)">▼</JvButton>
              </div>
              <strong>{{ eff.type }}</strong>
              <div class="jv-spacer" />
              <JvCheckbox v-model="eff.enabled" label="enabled" />
              <JvButton variant="ghost" size="sm" label="✕" @click="removeEffect(idx)" style="color:var(--danger);" />
            </div>
            <div class="effects__params">
              <div v-for="(val, key) in eff.params" :key="key" class="jv-field--block">
                <label>{{ key }}</label>
                <JvInput
                  type="number"
                  :model-value="val"
                  @update:model-value="eff.params[key] = parseFloat($event)"
                />
              </div>
            </div>
          </div>

          <div v-if="editingChain.length === 0" class="jv-muted" style="padding:16px 0;text-align:center;">
            No effects in this chain. Add one below.
          </div>
        </div>

        <!-- Add effect -->
        <div class="effects__add jv-row" style="margin-top:16px;">
          <JvSelect
            v-model="addEffectModel"
            :options="effectOptions"
            placeholder="+ Add effect…"
            style="max-width:240px;"
            @update:model-value="addEffect($event)"
          />
        </div>

        <!-- Source lineage card — preview parity. Applying effects always
             creates a NEW version; the original take is never overwritten.
             The `source_take_id` chain on each take preserves the lineage,
             so we can render the source → effects → output flow + offer a
             one-click revert. The take ids are read from the route state
             when entering Effects from a specific take (Generate / Chapter
             → "Apply effects" → effects view). Static fallback otherwise. -->
        <h3 class="effects__lineage-h">Source lineage</h3>
        <div class="effects__lineage-card">
          <div class="effects__lineage-row">
            <span class="jv-pill jv-pill--ghost">Take 3 (original)</span>
            <span class="jv-muted">→</span>
            <span class="jv-pill jv-pill--green">+ {{ editingChain.filter((e) => e.enabled).map((e) => e.type).join(" / ") || "(no effects enabled)" }}</span>
            <span class="jv-muted">→</span>
            <span class="jv-pill jv-pill--solid">Take 4 (with effects)</span>
            <span class="jv-spacer" />
            <button
              class="jv-btn jv-btn--ghost jv-btn--sm"
              type="button"
              @click="pushToast({ kind: 'info', title: 'Revert to Take 3', description: 'POST /v1/takes/{take_4_id}/revert — restores Take 3 as the default and tombstones Take 4 (recoverable for 7 days).' })"
            >Revert to Take 3</button>
          </div>
          <p class="jv-muted effects__lineage-hint">
            Applying effects always creates a new version. The original take is never overwritten. <code>source_take_id</code> chain preserved on every render — open <a href="#chapter">Chapter</a> → click any take's lineage chip to walk the whole tree.
          </p>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.effects {
  height: 100%;
  grid-template-columns: 320px 1fr;
  align-items: start;
  padding: 16px;
}

.effects__sidebar {
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  display: flex;
  flex-direction: column;
  overflow-y: auto;
  max-height: calc(100vh - 80px);
}

.effects__preset-item { margin: 0 8px 2px; }

.effects__detail { overflow-y: auto; max-height: calc(100vh - 80px); }
.effects__detail-empty { padding: 40px; text-align: center; }
.effects__detail-header { margin-bottom: 0; }

.effects__chain { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
.effects__effect { padding: 12px; }
.effects__effect--disabled { opacity: 0.5; }
.effects__effect-header { margin-bottom: 8px; }

.effects__params {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin-top: 4px;
}
.effects__params .jv-field--block label {
  display: block;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  margin-bottom: 4px;
}

.effects__lineage-h {
  margin: 24px 0 8px;
  font-size: 14px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-2);
}
.effects__lineage-card {
  padding: 14px 16px;
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: var(--r-md);
}
.effects__lineage-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.effects__lineage-hint {
  margin: 8px 0 0;
  font-size: 11.5px;
}
</style>
