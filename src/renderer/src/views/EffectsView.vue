<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  EffectsView — Effect-chain preset library.

  Slice 7 of the Profile-kill plan / Effects v1 wiring. Lists every
  saved chain preset (built-in + user-saved). Clicking "Edit" opens
  the EffectsChainEditorModal pre-loaded with that preset's chain.
  Saving the modal back replaces the preset's chain.

  Personas reference these chains by COPY at apply time, not by FK —
  so editing a preset doesn't retroactively change a persona's chain.
  This matches the "templates copy on apply" pattern locked for Profile
  in plan Q1.
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
const loading = ref(false);

const editorOpen = ref(false);
const editingPreset = ref(null);
const editingChain = ref([]);

async function refresh() {
  loading.value = true;
  try {
    const r = await api.safeRequest("/v1/effect-presets", { presets: [] });
    presets.value = r?.presets ?? [];
  } finally {
    loading.value = false;
  }
}

function startCreate() {
  editingPreset.value = null;
  editingChain.value = [];
  editorOpen.value = true;
}

function startEdit(preset) {
  editingPreset.value = preset;
  editingChain.value = JSON.parse(JSON.stringify(preset.chain || []));
  editorOpen.value = true;
}

async function onEditorSaved(newChain) {
  if (editingPreset.value) {
    // Update existing preset.
    try {
      await api.request(`/v1/effect-presets/${editingPreset.value.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chain: newChain }),
      });
      pushToast({
        message: `Updated "${editingPreset.value.name}".`,
        kind: "success",
      });
    } catch (e) {
      pushToast({
        message: `Update failed: ${e?.message || e}`,
        kind: "error",
        duration: 6000,
      });
    }
  } else {
    // Create new — name it via our dialog (native prompt() is banned:
    // it returns null in the Tauri webview, so creates silently died).
    const name = (await promptDialog({
      title: "New effect chain preset",
      message: "Name this effect chain preset:",
      placeholder: "e.g. Ghost — whisper + reverb",
    }))?.trim();
    if (!name) {
      editorOpen.value = false;
      return;
    }
    try {
      await api.request("/v1/effect-presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, chain: newChain }),
      });
      pushToast({ message: `Created "${name}".`, kind: "success" });
    } catch (e) {
      pushToast({
        message: `Create failed: ${e?.message || e}`,
        kind: "error",
        duration: 6000,
      });
    }
  }
  editorOpen.value = false;
  editingPreset.value = null;
  editingChain.value = [];
  await refresh();
}

async function deletePreset(p) {
  if (p.is_builtin) return;
  const ok = await confirmDialog({
    title: `Delete "${p.name}"?`,
    message: "The preset will be removed. Personas that have already applied this chain keep their copy.",
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/effect-presets/${p.id}`, { method: "DELETE" });
    await refresh();
    pushToast({ message: `Deleted "${p.name}".`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e?.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
</script>

<template>
  <div class="effects-view">
    <div class="jv-section">
      <h3 class="jv-section__title">Effect-chain presets</h3>
      <p class="jv-muted effects-view__lede">
        Saved pedalboard chains you can apply to a Persona's effects from the
        chain editor's "Load from preset" picker. Editing a preset here does
        NOT retroactively change personas that already applied it — chains
        copy at apply time, like a voice template.
      </p>

      <div class="effects-view__toolbar">
        <JvButton variant="primary" size="sm" label="+ New chain preset" @click="startCreate" />
      </div>

      <div v-if="loading" class="jv-muted effects-view__empty">Loading…</div>
      <div v-else-if="!presets.length" class="jv-muted effects-view__empty">
        No presets yet. Click <strong>+ New chain preset</strong> to build one.
        Or save a chain from a persona's effects editor.
      </div>

      <div v-else class="effects-view__grid">
        <article
          v-for="p in presets"
          :key="p.id"
          class="jv-card effects-view__preset"
        >
          <header class="effects-view__preset-h">
            <strong>{{ p.name }}</strong>
            <span v-if="p.is_builtin" class="jv-pill jv-pill--ghost">built-in</span>
            <span class="jv-pill jv-pill--ghost">
              {{ (p.chain || []).length }} effect{{ (p.chain || []).length === 1 ? '' : 's' }}
            </span>
          </header>
          <p v-if="p.description" class="jv-muted effects-view__desc">{{ p.description }}</p>
          <ul class="effects-view__chain-pills">
            <li
              v-for="(ef, i) in (p.chain || [])"
              :key="i"
              class="effects-view__chain-pill"
            >{{ ef.type }}</li>
            <li v-if="!(p.chain || []).length" class="jv-muted">(empty chain)</li>
          </ul>
          <footer class="effects-view__preset-actions">
            <span class="jv-spacer" />
            <JvButton variant="secondary" size="sm" label="Edit" @click="startEdit(p)" />
            <button
              type="button"
              class="jv-btn jv-btn--danger-outline jv-btn--sm"
              :disabled="p.is_builtin"
              @click="deletePreset(p)"
            >Delete</button>
          </footer>
        </article>
      </div>
    </div>

    <!-- Modal — pre-loaded with the chain being edited (or empty for new). -->
    <EffectsChainEditorModal
      :open="editorOpen"
      v-model="editingChain"
      :context-label="editingPreset?.name || 'New preset'"
      @save="onEditorSaved"
      @cancel="editorOpen = false"
    />
  </div>
</template>

<style scoped>
.effects-view { padding: 0; }
.effects-view__lede { font-size: 13px; max-width: 720px; margin: 8px 0 14px; }

.effects-view__toolbar { margin-bottom: 16px; }

.effects-view__empty { padding: 40px 0; font-size: 13px; text-align: center; }

.effects-view__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--gap-grid);
}

.effects-view__preset {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
}
.effects-view__preset-h {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.effects-view__desc { font-size: 12.5px; margin: 0; }
.effects-view__chain-pills {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.effects-view__chain-pill {
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  color: var(--ink-2);
}
.effects-view__preset-actions {
  display: flex;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--border-soft);
}
</style>
