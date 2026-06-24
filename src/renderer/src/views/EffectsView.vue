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
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "@delebash/llm-ui";
import { confirmDialog, promptDialog } from "@delebash/llm-ui";
import { UiButton, UiInput, UiTag, UiChip } from "@delebash/llm-ui";
import EffectsChainEditorModal from "../components/EffectsChainEditorModal.vue";

const api = useApi();

const presets = ref([]);
const loading = ref(false);

// Canonical library toolbar (2026-06-12): search + ownership chips.
const search = ref("");
const FILTERS = [["all", "All"], ["builtin", "Built-in"], ["custom", "Custom"]];
const filter = ref("all");
const filtered = computed(() => {
  let list = presets.value;
  if (filter.value === "builtin") list = list.filter((p) => p.is_builtin);
  if (filter.value === "custom") list = list.filter((p) => !p.is_builtin);
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((p) =>
    (p.name || "").toLowerCase().includes(q) ||
    (p.chain || []).some((ef) => (ef.type || "").toLowerCase().includes(q)));
  return list;
});

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

      <div class="jv-lib-toolbar">
        <UiInput v-model="search" placeholder="Search chains…" size="small" width="name" />
        <div class="voices-chips" style="display:inline-flex;gap:4px">
          <UiChip :selected="filter === f[0]" v-for="f in FILTERS" :key="f[0]" type="button"  @click="filter = f[0]">{{ f[1] }}</UiChip>
        </div>
        <span class="jv-spacer" />
        <UiButton intent="primary" size="small" label="+ New chain preset" @click="startCreate" />
      </div>

      <div v-if="loading" class="jv-muted effects-view__empty">Loading…</div>
      <div v-else-if="!presets.length" class="jv-muted effects-view__empty">
        No presets yet. Click <strong>+ New chain preset</strong> to build one.
        Or save a chain from a persona's effects editor.
      </div>

      <table v-else class="jv-table">
        <thead>
          <tr><th>Name</th><th>Chain</th><th style="width:90px">Effects</th><th style="width:90px"></th><th class="jv-table__actions" style="width:150px">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered" :key="p.id" class="effects-view__row" title="Click to edit" @click="startEdit(p)">
            <td><strong>{{ p.name }}</strong><div v-if="p.description" class="jv-muted" style="font-size:11.5px">{{ p.description }}</div></td>
            <td>
              <span v-for="(ef, i) in (p.chain || [])" :key="i" class="effects-view__chain-pill">{{ ef.type }}</span>
              <span v-if="!(p.chain || []).length" class="jv-muted">(empty chain)</span>
            </td>
            <td>{{ (p.chain || []).length }}</td>
            <td><UiTag intent="ghost" v-if="p.is_builtin">built-in</UiTag></td>
            <td class="jv-table__actions" @click.stop>
              <UiButton intent="ghost" size="small" label="Edit" @click="startEdit(p)" />
              <UiButton intent="danger-outline" size="small" label="Delete" :disabled="p.is_builtin" @click="deletePreset(p)" />
            </td>
          </tr>
        </tbody>
      </table>
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


.effects-view__empty { padding: 40px 0; font-size: 13px; text-align: center; }

.effects-view__row { cursor: pointer; }
.effects-view__row:hover td { background: var(--surface-2); }
.effects-view__chain-pill {
  display: inline-block;
  margin: 1px 4px 1px 0;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 3px 9px;
  font-size: 11.5px;
  font-family: var(--font-mono);
  color: var(--ink-2);
}
</style>
