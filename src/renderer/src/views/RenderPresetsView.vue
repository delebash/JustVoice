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
import { onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";
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

async function createPreset() {
  const name = await promptDialog({ title: "New render preset", label: "Preset name", confirmLabel: "Create" });
  if (!name) return;
  if (!personas.value.length) {
    pushToast({ message: "Create a persona first.", kind: "info" });
    return;
  }
  try {
    await api.request("/v1/presets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        voice_id: personas.value[0].id,
        delivery: {},
        effects_chain: [],
        master: null,
        lexicons: [],
      }),
    });
    pushToast({ message: `Created "${name}".`, kind: "success" });
    await refresh();
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

      <div v-else class="jv-card-grid">
        <article v-for="p in presets" :key="p.id" class="jv-card render-presets-view__card">
          <header class="render-presets-view__card-h">
            <input
              type="text"
              class="jv-input jv-input--sm jv-w-name"
              :value="p.name"
              @change="updateField(p, 'name', $event.target.value)"
            />
            <button
              type="button"
              class="jv-btn jv-btn--danger-outline jv-btn--sm"
              @click="deletePreset(p)"
            >Delete</button>
          </header>

          <div class="jv-form-row">
            <label>Voice</label>
            <select
              class="jv-input jv-input--sm jv-w-name"
              :value="p.voice_id"
              @change="updateField(p, 'voice_id', $event.target.value)"
            >
              <option v-for="ps in personas" :key="ps.id" :value="ps.id">{{ ps.name }}</option>
            </select>
          </div>

          <div class="jv-form-row">
            <label>Master</label>
            <select
              class="jv-input jv-input--sm jv-w-id"
              :value="p.master || ''"
              @change="updateField(p, 'master', $event.target.value || null)"
            >
              <option v-for="m in MASTER_TARGETS" :key="m.value" :value="m.value">{{ m.label }}</option>
            </select>
          </div>

          <div class="jv-form-row jv-form-row--stack">
            <span class="jv-form-row__label">Effects chain</span>
            <div class="render-presets-view__chain">
              <span
                v-for="(ef, i) in (p.effects_chain || [])"
                :key="i"
                class="jv-pill jv-pill--ghost"
              >{{ ef.type }}</span>
              <span v-if="!(p.effects_chain || []).length" class="jv-muted">(no effects)</span>
              <JvButton variant="secondary" size="sm" :label="(p.effects_chain || []).length ? 'Edit chain' : 'Add chain'" @click="openChainEditor(p)" />
            </div>
          </div>
        </article>
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
.render-presets-view__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
}
.render-presets-view__card-h {
  display: flex;
  align-items: center;
  gap: 10px;
}
.render-presets-view__card-h .jv-input { flex: 1; }
.render-presets-view__chain {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}
</style>
