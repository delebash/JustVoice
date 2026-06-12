<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  RenderPresetsView — render preset library editor.

  Render presets bundle voice + delivery + effects chain + master target
  + lexicons. Studio Render tab picks a preset per scene; the merge order
  is persona (tier-2) → preset (tier-3). Personas reference these
  presets' effects chain by COPY at apply time, not by FK.

  Each preset row exposes:
    - Name + description
    - Voice picker (Persona FK)
    - Master target select
    - Delivery JSON (read-only display, edit via Render Lab in v1)
    - Effects chain → opens EffectsChainEditorModal
    - Save / Delete
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { promptDialog } from "../services/dialog.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import EffectsChainEditorModal from "../components/EffectsChainEditorModal.vue";

const api = useApi();

const presets = ref([]);
const personas = ref([]);
const loading = ref(false);

const editorOpen = ref(false);
const editingPreset = ref(null);
const editingChain = ref([]);

const MASTER_TARGETS = [
  { value: "", label: "None" },
  { value: "acx", label: "ACX (audiobook)" },
  { value: "inaudio", label: "iAudio" },
  { value: "podcast", label: "Podcast" },
  { value: "youtube", label: "YouTube" },
];

async function refresh() {
  loading.value = true;
  try {
    const [pr, p] = await Promise.all([
      api.safeRequest("/v1/presets", { presets: [] }),
      api.safeRequest("/v1/personas", { personas: [] }),
    ]);
    presets.value = pr?.presets ?? [];
    personas.value = p?.personas ?? [];
  } finally {
    loading.value = false;
  }
}

function personaName(id) {
  return personas.value.find((p) => p.id === id)?.name || id || "—";
}

function deliveryPills(p) {
  // Compact read-only summary of the delivery payload (edit via Render
  // Lab in v1). `instruct` is prose — truncate it.
  return Object.entries(p.delivery || {}).map(([k, v]) => {
    const s = String(v);
    return `${k}: ${s.length > 38 ? s.slice(0, 38) + "…" : s}`;
  });
}

// Edit dialog (consolidated pattern 2026-06-12: table rows + one popup
// with the full form). Fields commit per-change; Done closes.
const editOpen = ref(false);
const editingId = ref(null);
const editing = computed(() => presets.value.find((x) => x.id === editingId.value) || null);
function openEdit(p) {
  editingId.value = p.id;
  editOpen.value = true;
}

async function createPreset() {
  // Native prompt() is banned (project_gotchas) AND returns null in the
  // Tauri webview — which is why creates silently never saved.
  const name = (await promptDialog({
    title: "New render preset",
    message: "Name this render preset:",
    placeholder: "e.g. Dramatic Dialogue",
  }))?.trim();
  if (!name) return;
  try {
    // Delivery-only by design — a preset is HOW a render sounds; the
    // voice binding is optional and can be picked on the card after.
    await api.request("/v1/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        voice_id: null,
        delivery: {},
        effects_chain: [],
        master: null,
        lexicons: [],
      }),
    });
    pushToast({ message: `Created "${name}".`, kind: "success" });
    await refresh();
    const created = presets.value.find((x) => x.name === name);
    if (created) openEdit(created);
  } catch (e) {
    pushToast({ message: `Create failed: ${e?.message || e}`, kind: "error" });
  }
}

async function updateField(preset, field, value) {
  try {
    await api.request(`/v1/presets/${preset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    await refresh();
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error" });
  }
}

function openChainEditor(preset) {
  editingPreset.value = preset;
  editingChain.value = JSON.parse(JSON.stringify(preset.effects_chain || []));
  editorOpen.value = true;
}

async function onChainSaved(newChain) {
  if (!editingPreset.value) {
    editorOpen.value = false;
    return;
  }
  try {
    await api.request(`/v1/presets/${editingPreset.value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effects_chain: newChain }),
    });
    pushToast({ message: `Updated "${editingPreset.value.name}" effects.`, kind: "success" });
    await refresh();
  } catch (e) {
    pushToast({ message: `Update failed: ${e?.message || e}`, kind: "error" });
  } finally {
    editorOpen.value = false;
    editingPreset.value = null;
    editingChain.value = [];
  }
}

async function deletePreset(preset) {
  const ok = await confirmDialog({
    title: `Delete "${preset.name}"?`,
    message: "The preset will be removed. Scenes that were using it lose their preset binding.",
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/presets/${preset.id}`, { method: "DELETE" });
    pushToast({ message: `Deleted "${preset.name}".`, kind: "success" });
    await refresh();
  } catch (e) {
    pushToast({ message: `Delete failed: ${e?.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
</script>

<template>
  <div class="render-presets-view">
    <div class="jv-section">
      <div class="jv-section__head">
        <h3 class="jv-section__title">Render presets</h3>
        <JvButton variant="primary" size="sm" label="+ New preset" @click="createPreset" />
      </div>
      <p class="jv-muted render-presets-view__lede">
        Named bundles of voice + delivery + effects chain + master target.
        Studio Render binds one preset per scene; the preset's settings overlay the persona's at render time.
      </p>

      <div v-if="loading" class="jv-muted render-presets-view__empty">Loading…</div>
      <div v-else-if="!presets.length" class="jv-muted render-presets-view__empty">
        No render presets yet. Click <strong>+ New preset</strong> above.
      </div>

      <table v-else class="jv-table">
        <thead>
          <tr><th>Name</th><th>Persona</th><th style="width:120px">Master target</th><th>Delivery</th><th style="width:90px"></th><th class="jv-table__actions" style="width:150px">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in presets" :key="p.id" class="render-presets-view__row" title="Click to edit" @click="openEdit(p)">
            <td><strong>{{ p.name }}</strong></td>
            <td class="jv-muted">{{ p.voice_id ? personaName(p.voice_id) : "— delivery only —" }}</td>
            <td class="jv-muted">{{ p.master || "none" }}</td>
            <td>
              <span v-for="(d, i) in deliveryPills(p)" :key="i" class="jv-pill jv-pill--ghost" style="margin:1px 4px 1px 0">{{ d }}</span>
              <span v-if="!deliveryPills(p).length" class="jv-muted">(engine defaults)</span>
            </td>
            <td><span v-if="p.is_builtin" class="jv-pill jv-pill--ghost">built-in</span></td>
            <td class="jv-table__actions" @click.stop>
              <JvButton variant="ghost" size="sm" label="Edit" @click="openEdit(p)" />
              <button type="button" class="jv-btn jv-btn--danger-outline jv-btn--sm" @click="deletePreset(p)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Edit dialog — full form (consolidated pattern). -->
    <div v-if="editOpen && editing" class="jv-overlay" @click.self="editOpen = false">
      <div class="jv-modal" style="width: min(560px, calc(100vw - 32px));">
        <header class="jv-modal__header">
          <div class="jv-modal__titleblock">
            <span class="jv-modal__eyebrow">Render preset</span>
            <h3 class="jv-modal__title">{{ editing.name }}</h3>
          </div>
          <span v-if="editing.is_builtin" class="jv-pill jv-pill--ghost">built-in</span>
          <button type="button" class="jv-modal__close" title="Close" @click="editOpen = false">✕</button>
        </header>
        <div class="jv-modal__body render-presets-view__form">
          <label class="jv-form-row"><span>Name</span>
            <input type="text" class="jv-input jv-input--sm" :value="editing.name" @change="updateField(editing, 'name', $event.target.value)" />
          </label>
          <label class="jv-form-row"><span>Persona</span>
            <select class="jv-input jv-input--sm" :value="editing.voice_id || ''" @change="updateField(editing, 'voice_id', $event.target.value)">
              <option value="">— none (delivery only) —</option>
              <option v-for="ps in personas" :key="ps.id" :value="ps.id">{{ ps.name }}</option>
            </select>
          </label>
          <label class="jv-form-row"><span>Master target</span>
            <select class="jv-input jv-input--sm" :value="editing.master || ''" @change="updateField(editing, 'master', $event.target.value || null)">
              <option v-for="m in MASTER_TARGETS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </label>
          <div class="jv-form-row jv-form-row--stack"><span>Delivery</span>
            <div>
              <span v-for="(d, i) in deliveryPills(editing)" :key="i" class="jv-pill jv-pill--ghost" style="margin:1px 4px 1px 0">{{ d }}</span>
              <span v-if="!deliveryPills(editing).length" class="jv-muted">(engine defaults — tune in Labs · Render and save from a cell)</span>
            </div>
          </div>
          <div class="jv-form-row jv-form-row--stack"><span>Effects chain</span>
            <div>
              <span v-for="(ef, i) in (editing.effects_chain || [])" :key="i" class="jv-pill jv-pill--ghost" style="margin:1px 4px 1px 0">{{ ef.type }}</span>
              <span v-if="!(editing.effects_chain || []).length" class="jv-muted">(no effects)</span>
              <JvButton variant="secondary" size="sm" :label="(editing.effects_chain || []).length ? 'Edit chain' : 'Add chain'" @click="openChainEditor(editing)" />
            </div>
          </div>
          <p class="jv-muted" style="font-size:11.5px; margin: 6px 0 0">Changes save automatically.</p>
        </div>
        <footer class="jv-dialog__footer">
          <JvButton variant="primary" label="Done" @click="editOpen = false" />
        </footer>
      </div>
    </div>

    <EffectsChainEditorModal
      :open="editorOpen"
      v-model="editingChain"
      :context-label="editingPreset?.name || 'Render preset'"
      @save="onChainSaved"
      @cancel="editorOpen = false"
    />
  </div>
</template>

<style scoped>
.render-presets-view { padding: 0; }
.render-presets-view__lede {
  font-size: 13px;
  max-width: var(--w-prose);
  margin: 4px 0 16px;
}
.render-presets-view__empty {
  padding: 40px 0;
  font-size: 13px;
  text-align: center;
}
.render-presets-view__row { cursor: pointer; }
.render-presets-view__row:hover td { background: var(--surface-2); }
.render-presets-view__form { display: flex; flex-direction: column; gap: 10px; }
.render-presets-view__form .jv-form-row { display: flex; align-items: center; gap: 10px; }
.render-presets-view__form .jv-form-row > span { width: 110px; flex: none; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--ink-3); font-weight: 600; }
.render-presets-view__form .jv-form-row .jv-input { flex: 1; }
.render-presets-view__form .jv-form-row--stack { align-items: flex-start; }
</style>
