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
import { computed, nextTick, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/ui/JvButton.vue";
import JvInput from "../components/ui/JvInput.vue";
import EffectsChainEditorModal from "../components/EffectsChainEditorModal.vue";
import { usePersonasStore } from "../stores/personas.js";

const api = useApi();
const personasStore = usePersonasStore();

const presets = ref([]);
const personas = computed(() => personasStore.items);
const loading = ref(false);

// Canonical library toolbar (2026-06-12): search + binding chips +
// master-target dropdown.
const search = ref("");
const FILTERS = [["all", "All"], ["builtin", "Built-in"], ["delivery", "Delivery-only"], ["bound", "Persona-bound"]];
const filter = ref("all");
const masterFilter = ref("");
const filtered = computed(() => {
  let list = presets.value;
  if (filter.value === "builtin") list = list.filter((p) => p.is_builtin);
  if (filter.value === "delivery") list = list.filter((p) => !p.voice_id);
  if (filter.value === "bound") list = list.filter((p) => !!p.voice_id);
  if (masterFilter.value) list = list.filter((p) => (p.master || "") === masterFilter.value);
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((p) => (p.name || "").toLowerCase().includes(q));
  return list;
});

const editorOpen = ref(false);
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
    const [pr] = await Promise.all([
      api.safeRequest("/v1/presets", { presets: [] }),
      personasStore.ensureLoaded(),
    ]);
    presets.value = pr?.presets ?? [];
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
  return Object.entries((p?.delivery) || {}).map(([k, v]) => {
    const s = String(v);
    return `${k}: ${s.length > 38 ? `${s.slice(0, 38)}…` : s}`;
  });
}

// Edit dialog (consolidated pattern 2026-06-12: table rows + one popup
// with the full form). Save-pattern ruling 2026-06-14: a modal editor
// edits a working DRAFT and commits on Save / discards on Cancel — no
// per-field auto-save. Built-in presets are read-only (view, not edit).
const editOpen = ref(false);
const editingId = ref(null);   // null while creating a new preset
const creating = ref(false);
const editDraft = ref(null);  // working copy; null when closed
const nameInputEl = ref(null);  // autofocus target on create
const editing = computed(() => presets.value.find((x) => x.id === editingId.value) || null);
const editIsBuiltin = computed(() => !creating.value && !!editing.value?.is_builtin);
const dialogTitle = computed(() => creating.value ? "New render preset" : (editing.value?.name || ""));

function openEdit(p) {
  creating.value = false;
  editingId.value = p.id;
  editDraft.value = {
    name: p.name ?? "",
    voice_id: p.voice_id ?? "",
    master: p.master ?? "",
    effects_chain: JSON.parse(JSON.stringify(p.effects_chain ?? [])),
  };
  editOpen.value = true;
}
// Open the editor DIRECTLY on a blank draft — no name prompt first
// (consistent with Personas; the old prompt-then-popup was the
// G-PERSONA-1 anti-pattern repeated here). Save commits the create.
function createPreset() {
  creating.value = true;
  editingId.value = null;
  editDraft.value = { name: "", voice_id: "", master: "", effects_chain: [] };
  editOpen.value = true;
  nextTick(() => nameInputEl.value?.focus());
}
function closeEdit() {
  editOpen.value = false;
  editingId.value = null;
  creating.value = false;
  editDraft.value = null;
}
async function saveEdit() {
  if (!editDraft.value || editIsBuiltin.value) return;
  if (!editDraft.value.name.trim()) {
    pushToast({ message: "Name the preset first.", kind: "info" });
    return;
  }
  try {
    if (creating.value) {
      await api.request("/v1/presets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editDraft.value.name.trim(),
          voice_id: editDraft.value.voice_id || null,
          delivery: {},
          effects_chain: editDraft.value.effects_chain || [],
          master: editDraft.value.master || null,
          lexicons: [],
        }),
      });
    } else {
      if (!editingId.value) return;
      await api.request(`/v1/presets/${editingId.value}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editDraft.value.name,
          voice_id: editDraft.value.voice_id || null,
          master: editDraft.value.master || null,
          effects_chain: editDraft.value.effects_chain || [],
        }),
      });
    }
    await refresh();
    const wasCreating = creating.value;
    closeEdit();
    pushToast({ message: wasCreating ? "Preset created." : "Preset saved.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error" });
  }
}

// The effects-chain editor edits the DRAFT's chain — it commits with the
// rest of the form on Save (not a separate PATCH), so Cancel discards it
// too.
function openChainEditor() {
  if (!editDraft.value || editIsBuiltin.value) return;
  editingChain.value = JSON.parse(JSON.stringify(editDraft.value.effects_chain || []));
  editorOpen.value = true;
}

function onChainSaved(newChain) {
  if (editDraft.value) editDraft.value.effects_chain = newChain;
  editorOpen.value = false;
  editingChain.value = [];
}

async function deletePreset(preset) {
  if (preset.is_builtin) return;  // built-ins are not user-deletable
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
      <h3 class="jv-section__title">Render presets</h3>
      <p class="jv-muted render-presets-view__lede">
        Named bundles of voice + delivery + effects chain + master target.
        Studio Render binds one preset per scene; the preset's settings overlay the persona's at render time.
      </p>
      <div class="jv-lib-toolbar">
        <JvInput v-model="search" placeholder="Search presets…" size="sm" width="name" />
        <div style="display:inline-flex;gap:4px">
          <button v-for="f in FILTERS" :key="f[0]" type="button" class="jv-pill" :class="filter === f[0] ? 'jv-pill--solid' : 'jv-pill--ghost'" @click="filter = f[0]">{{ f[1] }}</button>
        </div>
        <select class="jv-input jv-input--sm" style="max-width:160px" v-model="masterFilter" title="Filter by master target">
          <option value="">All targets</option>
          <option v-for="m in MASTER_TARGETS.filter((x) => x.value)" :key="m.value" :value="m.value">{{ m.label }}</option>
        </select>
        <span class="jv-spacer" />
        <JvButton variant="primary" size="sm" label="+ New preset" @click="createPreset" />
      </div>

      <div v-if="loading" class="jv-muted render-presets-view__empty">Loading…</div>
      <div v-else-if="!presets.length" class="jv-muted render-presets-view__empty">
        No render presets yet. Click <strong>+ New preset</strong> above.
      </div>

      <table v-else class="jv-table">
        <thead>
          <tr><th>Name</th><th>Persona</th><th style="width:120px">Master target</th><th>Delivery</th><th style="width:90px"></th><th class="jv-table__actions" style="width:150px">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered" :key="p.id" class="render-presets-view__row" title="Click to edit" @click="openEdit(p)">
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
              <JvButton variant="danger-outline" size="sm" label="Delete" :disabled="p.is_builtin" :title="p.is_builtin ? 'Built-in presets can\'t be deleted' : 'Delete preset'" @click="deletePreset(p)" />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Edit dialog — full form. Edits a working draft; Save commits,
         Cancel discards (save-pattern ruling 2026-06-14). Built-ins are
         read-only. -->
    <div v-if="editOpen && editDraft" class="jv-overlay" @click.self="closeEdit">
      <div class="jv-modal" style="width: min(560px, calc(100vw - 32px));">
        <header class="jv-modal__header">
          <div class="jv-modal__titleblock">
            <span class="jv-modal__eyebrow">Render preset</span>
            <h3 class="jv-modal__title">{{ dialogTitle }}</h3>
          </div>
          <span v-if="editIsBuiltin" class="jv-pill jv-pill--ghost">built-in · read-only</span>
          <button type="button" class="jv-modal__close" title="Close" @click="closeEdit">✕</button>
        </header>
        <div class="jv-modal__body render-presets-view__form">
          <label class="jv-form-row"><span>Name</span>
            <input ref="nameInputEl" type="text" class="jv-input jv-input--sm" v-model="editDraft.name" :disabled="editIsBuiltin" placeholder="e.g. Dramatic Dialogue" />
          </label>
          <label class="jv-form-row"><span>Persona</span>
            <select class="jv-input jv-input--sm" v-model="editDraft.voice_id" :disabled="editIsBuiltin">
              <option value="">— none (delivery only) —</option>
              <option v-for="ps in personas" :key="ps.id" :value="ps.id">{{ ps.name }}</option>
            </select>
          </label>
          <label class="jv-form-row"><span>Master target</span>
            <select class="jv-input jv-input--sm" v-model="editDraft.master" :disabled="editIsBuiltin">
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
              <span v-for="(ef, i) in (editDraft.effects_chain || [])" :key="i" class="jv-pill jv-pill--ghost" style="margin:1px 4px 1px 0">{{ ef.type }}</span>
              <span v-if="!(editDraft.effects_chain || []).length" class="jv-muted">(no effects)</span>
              <JvButton v-if="!editIsBuiltin" variant="secondary" size="sm" :label="(editDraft.effects_chain || []).length ? 'Edit chain' : 'Add chain'" @click="openChainEditor" />
            </div>
          </div>
        </div>
        <footer class="jv-dialog__footer">
          <template v-if="editIsBuiltin">
            <JvButton variant="primary" label="Close" @click="closeEdit" />
          </template>
          <template v-else>
            <JvButton variant="secondary" label="Cancel" @click="closeEdit" />
            <JvButton variant="primary" label="Save" @click="saveEdit" />
          </template>
        </footer>
      </div>
    </div>

    <EffectsChainEditorModal
      :open="editorOpen"
      v-model="editingChain"
      :context-label="editing?.name || 'Render preset'"
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
