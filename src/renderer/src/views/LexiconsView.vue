<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  LexiconsView — Pronunciation dictionaries.

  Library list (jv-lib-toolbar + jv-table); clicking a row opens ONE editor
  dialog. The dialog edits a working DRAFT (name + scope + entries) and
  commits on Save / discards on Cancel (save-pattern ruling 2026-06-14) —
  consistent with Personas + Render presets. "+ New lexicon" opens the same
  dialog directly on a blank draft (no prompt-then-popup). Canonical
  jv-overlay/jv-modal shell so the close ✕ never overlaps Import/Export.
-->
<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";
import { UiButton, UiInput, UiTag, UiChip } from "@delebash/llm-ui";
import EmptyState from "../components/EmptyState.vue";
import { useLexiconsStore } from "../stores/lexicons.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";

const api = useApi();

// lexicons / projects / personas from shared stores. Save commits via the
// API then refresh() → store.reload() so consumers (Personas, Overview)
// reflect the change.
const lexiconsStore = useLexiconsStore();
const projectsStore = useProjectsStore();
const personasStore = usePersonasStore();
const lexicons = computed(() => lexiconsStore.items);
const projects = computed(() => projectsStore.items);
const personas = computed(() => personasStore.items);

const search = ref("");
const SCOPE_FILTERS = [["all", "All"], ["global", "Reusable"], ["project", "Book"], ["persona", "Persona"]];
const scopeFilter = ref("all");
const loading = ref(false);

const filteredLexicons = computed(() => {
  let list = lexicons.value;
  if (scopeFilter.value !== "all") list = list.filter((l) => (l.scope || "global") === scopeFilter.value);
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((l) =>
    (l.name || "").toLowerCase().includes(q) ||
    (l.entries || []).some((e) => (e.grapheme || "").toLowerCase().includes(q)));
  return list;
});

const scopeBadge = (lex) => {
  const s = lex?.scope ?? "global";
  if (s === "project") return { label: "book", intent: "success" };
  if (s === "persona") return { label: "persona-scoped", intent: "accent2" };
  return { label: "reusable", intent: "ghost" };
};

function scopedToName(lex) {
  if (lex?.scope === "project" && lex.project_id) {
    return projects.value.find((p) => p.id === lex.project_id)?.name || lex.project_id;
  }
  if (lex?.scope === "persona" && lex.persona_id) {
    return personas.value.find((p) => p.id === lex.persona_id)?.name || lex.persona_id;
  }
  return null;
}

// ── Dialog state — one editor for create AND edit, over a draft ────────
const dialogOpen = ref(false);
const creating = ref(false);
const editingId = ref(null);   // null while creating
const draft = ref(null);        // { name, scope, project_id, persona_id, entries: [] }
const nameInputEl = ref(null);

// Entry sub-form (operates on draft.entries — no API until Save).
const newGrapheme = ref("");
const newPhonemeIpa = ref("");
const newAlias = ref("");
const editingEntryIndex = ref(null);

// Live preview (client-side, against the draft's entries).
const previewText = ref("");
const previewResult = ref("");

const SCOPE_OPTIONS = [
  { value: "global", label: "Reusable (global)" },
  { value: "project", label: "Book-scoped (project)" },
  { value: "persona", label: "Persona-scoped" },
];

function blankDraft() {
  return { name: "", scope: "global", project_id: null, persona_id: null, entries: [] };
}

async function refresh() {
  loading.value = true;
  try {
    await Promise.all([
      lexiconsStore.reload(),
      projectsStore.reload(),
      personasStore.reload(),
    ]);
  } finally {
    loading.value = false;
  }
}

function resetEntryForm() {
  editingEntryIndex.value = null;
  newGrapheme.value = "";
  newPhonemeIpa.value = "";
  newAlias.value = "";
}

function resetPreview() {
  previewText.value = "";
  previewResult.value = "";
}

function openEdit(lex) {
  creating.value = false;
  editingId.value = lex.id;
  draft.value = {
    name: lex.name ?? "",
    scope: lex.scope ?? "global",
    project_id: lex.project_id ?? null,
    persona_id: lex.persona_id ?? null,
    entries: JSON.parse(JSON.stringify(lex.entries ?? [])),
  };
  resetEntryForm();
  resetPreview();
  dialogOpen.value = true;
}

// Open the editor DIRECTLY on a blank draft — name + scope live IN the
// dialog, Save commits the create. Replaces the old prompt-then-popup
// (and its second scope-target prompt).
function createLexicon() {
  creating.value = true;
  editingId.value = null;
  draft.value = blankDraft();
  resetEntryForm();
  resetPreview();
  dialogOpen.value = true;
  nextTick(() => nameInputEl.value?.focus());
}

function closeDialog() {
  dialogOpen.value = false;
  creating.value = false;
  editingId.value = null;
  draft.value = null;
  resetEntryForm();
  resetPreview();
}

const canSave = computed(() => !!draft.value?.name.trim());

async function saveDialog() {
  if (!draft.value) return;
  if (!draft.value.name.trim()) {
    pushToast({ kind: "info", title: "Name the lexicon first" });
    return;
  }
  // Normalize scope target: only the matching id is sent.
  const scope = draft.value.scope || "global";
  const body = {
    name: draft.value.name.trim(),
    entries: draft.value.entries || [],
    scope,
    project_id: scope === "project" ? draft.value.project_id || null : null,
    persona_id: scope === "persona" ? draft.value.persona_id || null : null,
  };
  try {
    if (creating.value) {
      await api.request("/v1/lexicons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      // PUT replaces entries + name (scope is fixed after create).
      await api.request(`/v1/lexicons/${editingId.value}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    const wasCreating = creating.value;
    await refresh();
    closeDialog();
    pushToast({ kind: "success", title: wasCreating ? "Lexicon created" : "Lexicon saved" });
  } catch (e) {
    pushToast({ kind: "error", title: "Save failed", description: String(e?.message ?? e) });
  }
}

async function deleteLexicon(id) {
  const lx = lexicons.value.find((l) => l.id === id);
  const ok = await confirmDialog({
    title: "Delete lexicon?",
    message: `"${lx?.name ?? id}" and all its entries will be permanently removed.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/lexicons/${id}`, { method: "DELETE" });
    if (editingId.value === id) closeDialog();
    await refresh();
    pushToast({ kind: "success", title: "Lexicon deleted" });
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

// ── Entry ops — all mutate the DRAFT; nothing persists until Save. ─────
function buildEntry() {
  const entry = { grapheme: newGrapheme.value.trim() };
  if (newPhonemeIpa.value.trim()) entry.phoneme_ipa = newPhonemeIpa.value.trim();
  if (newAlias.value.trim()) entry.alias = newAlias.value.trim();
  return entry;
}

function saveEntry() {
  if (!draft.value || !newGrapheme.value.trim()) return;
  const entry = buildEntry();
  if (editingEntryIndex.value != null) {
    draft.value.entries.splice(editingEntryIndex.value, 1, entry);
  } else {
    draft.value.entries.push(entry);
  }
  resetEntryForm();
}

function startEditEntry(entry, index) {
  editingEntryIndex.value = index;
  newGrapheme.value = entry.grapheme || "";
  newPhonemeIpa.value = entry.phoneme_ipa || "";
  newAlias.value = entry.alias || "";
}

function deleteEntry(index) {
  if (!draft.value) return;
  draft.value.entries.splice(index, 1);
  if (editingEntryIndex.value === index) resetEntryForm();
}

async function bulkPasteTsv() {
  const raw = (await promptDialog({
    title: "Bulk paste TSV",
    fields: [{
      key: "tsv",
      label: "One entry per line: word [TAB] pronunciation [TAB] format(ipa|phonetic)",
      type: "textarea",
      rows: 8,
      placeholder: "Beauchamp\t/ˈbiːtʃəm/\tipa",
    }],
    confirmLabel: "Add entries",
  }))?.tsv;
  if (!raw || !draft.value) return;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let added = 0;
  for (const line of lines) {
    const parts = line.split("\t");
    const grapheme = parts[0]?.trim();
    const pron = parts[1]?.trim();
    const fmt = (parts[2] || "phonetic").trim().toLowerCase();
    if (!grapheme || !pron) continue;
    const entry = { grapheme };
    if (fmt === "ipa") entry.phoneme_ipa = pron; else entry.alias = pron;
    draft.value.entries.push(entry);
    added++;
  }
  pushToast({ kind: "success", title: `${added} entries added to the draft — Save to keep them` });
}

// ── Import / Export ───────────────────────────────────────────────────
// Library toolbar Import → opens the editor on a NEW draft prefilled from
// the file. In-dialog Import → merges the file's entries into the open draft.
const fileInputNew = ref(null);
const fileInputMerge = ref(null);
function chooseImportNew() { fileInputNew.value?.click(); }
function chooseImportMerge() { fileInputMerge.value?.click(); }

async function importNewFromFile(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    creating.value = true;
    editingId.value = null;
    draft.value = {
      name: parsed.name || file.name.replace(/\.justlex\.json$/i, ""),
      scope: parsed.scope || "global",
      project_id: parsed.project_id || null,
      persona_id: parsed.persona_id || null,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
    resetEntryForm();
    resetPreview();
    dialogOpen.value = true;
    pushToast({ kind: "info", title: `Loaded ${draft.value.entries.length} entries — review and Save` });
  } catch (e) {
    pushToast({ kind: "error", title: "Import failed", description: String(e?.message ?? e) });
  }
}

async function importIntoDraft(ev) {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file || !draft.value) return;
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = Array.isArray(parsed.entries) ? parsed.entries : [];
    draft.value.entries.push(...incoming);
    if (!draft.value.name && parsed.name) draft.value.name = parsed.name;
    pushToast({ kind: "success", title: `Merged ${incoming.length} entries into the draft — Save to keep` });
  } catch (e) {
    pushToast({ kind: "error", title: "Import failed", description: String(e?.message ?? e) });
  }
}

function exportLexicon() {
  if (!draft.value) return;
  const out = {
    name: draft.value.name,
    scope: draft.value.scope,
    project_id: draft.value.project_id,
    persona_id: draft.value.persona_id,
    entries: draft.value.entries,
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(draft.value.name || "lexicon").replace(/\W+/g, "-")}.justlex.json`;
  a.click();
  URL.revokeObjectURL(url);
  pushToast({ kind: "success", title: "Lexicon exported" });
}

// Client-side preview — best-effort longest-match grapheme replacement
// against the DRAFT entries.
function runPreview() {
  if (!draft.value || !previewText.value) {
    previewResult.value = "";
    return;
  }
  const entries = [...(draft.value.entries || [])].sort((a, b) => (b.grapheme?.length || 0) - (a.grapheme?.length || 0));
  let out = previewText.value;
  for (const e of entries) {
    if (!e.grapheme) continue;
    const replacement = e.alias || e.phoneme_ipa;
    if (!replacement) continue;
    const escaped = e.grapheme.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`\\b${escaped}\\b`, "g"), `「${replacement}」`);
  }
  previewResult.value = out;
}

onMounted(async () => {
  await refresh();
  // Fix-it loop handoff: Chapters/Studio flag a misread word → arrives
  // here prefilled. Open the first lexicon (or a new draft) with the
  // grapheme seeded into the entry form, ready for a pronunciation.
  try {
    const raw = window.sessionStorage?.getItem("jv.lexicon.prefill");
    if (raw) {
      window.sessionStorage.removeItem("jv.lexicon.prefill");
      const { grapheme } = JSON.parse(raw);
      if (grapheme) {
        if (lexicons.value.length) openEdit(lexicons.value[0]);
        else createLexicon();
        newGrapheme.value = grapheme;
        pushToast({
          message: `Fixing “${grapheme}” — spell it how it should sound, add it, then Save.`,
          kind: "info",
          duration: 8000,
        });
      }
    }
  } catch { /* ignore */ }
});
</script>

<template>
  <div class="lex">
    <!-- ── Library ─────────────────────────────────────────────────── -->
    <div class="jv-lib-toolbar">
      <UiInput v-model="search" placeholder="Search lexicons + words…" size="small" width="name" />
      <div style="display:inline-flex;gap:4px">
        <UiChip :selected="scopeFilter === f[0]" v-for="f in SCOPE_FILTERS" :key="f[0]" type="button"  @click="scopeFilter = f[0]">{{ f[1] }}</UiChip>
      </div>
      <span class="jv-spacer" />
      <UiButton intent="secondary" size="small" label="⬇ Import .justlex.json" @click="chooseImportNew" />
      <UiButton intent="primary" size="small" label="+ New lexicon" @click="createLexicon" />
    </div>

    <div v-if="loading" class="jv-muted lex__empty">Loading…</div>
    <EmptyState
      v-else-if="!lexicons.length"
      icon="Sparkle"
      title="No lexicons yet"
      message="Pronunciation dictionaries force domain words and proper names — Beauchamp → BEE-chum — to render consistently across a whole project."
      action-label="+ New lexicon"
      @action="createLexicon"
    />

    <table v-else class="jv-table">
      <thead>
        <tr><th>Name</th><th style="width:130px">Scope</th><th style="width:90px">Entries</th><th>Words</th><th class="jv-table__actions" style="width:150px">Actions</th></tr>
      </thead>
      <tbody>
        <tr v-for="lx in filteredLexicons" :key="lx.id" class="lex__row" title="Click to edit" @click="openEdit(lx)">
          <td><strong>{{ lx.name }}</strong><div v-if="scopedToName(lx)" class="jv-muted" style="font-size:11.5px">{{ scopedToName(lx) }}</div></td>
          <td><UiTag :intent="scopeBadge(lx).intent">{{ scopeBadge(lx).label }}</UiTag></td>
          <td>{{ (lx.entries || []).length }}</td>
          <td>
            <code v-for="(e, i) in (lx.entries || []).slice(0, 4)" :key="i" class="jv-mono lex__word">{{ e.grapheme }}</code>
            <span v-if="(lx.entries || []).length > 4" class="jv-muted">+{{ (lx.entries || []).length - 4 }}</span>
            <span v-if="!(lx.entries || []).length" class="jv-muted">(empty)</span>
          </td>
          <td class="jv-table__actions" @click.stop>
            <UiButton intent="ghost" size="small" label="Edit" @click="openEdit(lx)" />
            <UiButton intent="danger-outline" size="small" label="Delete" @click="deleteLexicon(lx.id)" />
          </td>
        </tr>
      </tbody>
    </table>

    <!-- ── Editor dialog — draft + Save/Cancel (canonical shell) ────── -->
    <div v-if="dialogOpen && draft" class="jv-overlay" @click.self="closeDialog">
      <div class="jv-modal lex__modal">
        <header class="jv-modal__header">
          <div class="jv-modal__titleblock">
            <span class="jv-modal__eyebrow">{{ creating ? "New lexicon" : "Lexicon" }}</span>
            <h3 class="jv-modal__title">{{ draft.name || "Untitled lexicon" }}</h3>
          </div>
          <button type="button" class="jv-modal__close" title="Cancel" @click="closeDialog">✕</button>
        </header>

        <div class="jv-modal__body">
          <div class="lex__field">
            <label>Name</label>
            <UiInput ref="nameInputEl" width="name" v-model="draft.name" placeholder="e.g. Stillwater proper names" @keydown.enter.prevent />
          </div>

          <div class="lex__field">
            <label>Scope</label>
            <!-- Editable only at create — scope is fixed once a lexicon exists. -->
            <div v-if="creating" class="lex__scope-row">
              <select class="jv-input jv-w-name" v-model="draft.scope">
                <option v-for="o in SCOPE_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
              </select>
              <select v-if="draft.scope === 'project'" class="jv-input jv-w-name" v-model="draft.project_id">
                <option :value="null">— pick a book —</option>
                <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
              <select v-if="draft.scope === 'persona'" class="jv-input jv-w-name" v-model="draft.persona_id">
                <option :value="null">— pick a persona —</option>
                <option v-for="p in personas" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select>
            </div>
            <div v-else class="lex__scope-row">
              <UiTag :intent="scopeBadge(draft).intent">{{ scopeBadge(draft).label }}</UiTag>
              <UiTag intent="ghost">applies before TTS</UiTag>
              <UiTag intent="ghost" v-if="draft.scope === 'project'">book: {{ scopedToName(draft) || "—" }}</UiTag>
              <UiTag intent="ghost" v-if="draft.scope === 'persona'">persona: {{ scopedToName(draft) || "—" }}</UiTag>
            </div>
          </div>

          <div class="lex__field">
            <label>Live preview text</label>
            <UiInput
              width="prose"
              v-model="previewText"
              placeholder="Beauchamp arrived in Stillwater on the NYPD ferry. — Worcestershire sauce on his cuff."
            />
            <p v-if="previewResult" class="lex__preview-out">{{ previewResult }}</p>
          </div>

          <table v-if="draft.entries.length" class="lex__table">
            <thead>
              <tr>
                <th>Word</th>
                <th>Pronunciation (IPA or phonetic)</th>
                <th style="width:90px">Format</th>
                <th style="width:150px" class="right"></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(e, i) in draft.entries" :key="i" :class="{ 'lex__row--editing': editingEntryIndex === i }">
                <td><strong>{{ e.grapheme }}</strong></td>
                <td><code class="jv-mono">{{ e.phoneme_ipa || e.alias || "—" }}</code></td>
                <td>{{ e.phoneme_ipa ? "IPA" : "phonetic" }}</td>
                <td class="right lex__entry-actions">
                  <UiButton intent="ghost" size="small" label="Edit" title="Edit this entry in the form below" @click="startEditEntry(e, i)" />
                  <UiButton intent="danger-outline" size="small" label="Delete" title="Remove this entry" @click="deleteEntry(i)" />
                </td>
              </tr>
            </tbody>
          </table>
          <p v-else class="jv-muted" style="padding: 12px 0; font-style: italic;">
            No entries yet — add one below, bulk-paste, or merge a <code>.justlex.json</code>.
          </p>

          <div class="jv-divider" />

          <h4 class="lex__sub-h">{{ editingEntryIndex != null ? "Edit entry" : "Add entry" }}</h4>
          <div class="lex__entry-grid">
            <label class="lex__field">
              <span>Grapheme (as written)</span>
              <UiInput width="name" v-model="newGrapheme" placeholder="Beauchamp" @keydown.enter="saveEntry" />
            </label>
            <label class="lex__field">
              <span>Phoneme IPA</span>
              <UiInput width="name" v-model="newPhonemeIpa" placeholder="/ˈbiːtʃəm/" @keydown.enter="saveEntry" />
            </label>
            <label class="lex__field">
              <span>Alias (phonetic — engine reads this)</span>
              <UiInput width="name" v-model="newAlias" placeholder="bee-chum" @keydown.enter="saveEntry" />
            </label>
          </div>

          <div class="lex__actions">
            <UiButton intent="secondary" size="small" :label="editingEntryIndex != null ? 'Update entry' : '+ Add entry'" @click="saveEntry" :disabled="!newGrapheme.trim() || (!newPhonemeIpa.trim() && !newAlias.trim())" />
            <UiButton v-if="editingEntryIndex != null" intent="ghost" size="small" label="Cancel edit" @click="resetEntryForm" />
            <UiButton v-else intent="secondary" size="small" label="Bulk paste TSV" @click="bulkPasteTsv" />
            <UiButton intent="secondary" size="small" label="▶ Preview against text" :disabled="!previewText.trim()" @click="runPreview" />
            <span class="lex__spacer" />
            <UiButton intent="secondary" size="small" label="⬇ Merge file" @click="chooseImportMerge" />
            <UiButton intent="secondary" size="small" label="⬆ Export" @click="exportLexicon" />
          </div>
        </div>

        <footer class="jv-modal__footer">
          <span class="jv-muted lex__count">{{ draft.entries.length }} entr{{ draft.entries.length === 1 ? "y" : "ies" }}</span>
          <span class="jv-spacer" />
          <UiButton intent="secondary" label="Cancel" @click="closeDialog" />
          <UiButton intent="primary" label="Save" :disabled="!canSave" @click="saveDialog" />
        </footer>
      </div>
    </div>

    <input ref="fileInputNew" type="file" accept=".justlex.json,application/json" style="display:none" @change="importNewFromFile" />
    <input ref="fileInputMerge" type="file" accept=".justlex.json,application/json" style="display:none" @change="importIntoDraft" />
  </div>
</template>

<style scoped>
.lex { display: flex; flex-direction: column; }

.lex__empty { padding: 40px 0; font-size: 13px; text-align: center; }

.lex__row { cursor: pointer; }
.lex__row:hover td { background: var(--surface-2); }
.lex__word {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 6px;
  margin-right: 4px;
  font-size: 11.5px;
}

.lex__modal { width: min(860px, calc(100vw - 32px)); }
.lex__count { font-size: 12px; }
.lex__spacer { flex: 1; }
.lex__entry-actions { white-space: nowrap; }
.lex__entry-actions > * + * { margin-left: 4px; }
.lex__row--editing td { background: var(--accent-soft); }

.lex__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 12px;
}
.lex__field > label,
.lex__field > span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}

.lex__scope-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; min-height: 30px; }

.lex__preview-out {
  margin: 4px 0 0;
  padding: 10px 12px;
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
  border-radius: 4px;
  font-size: 13px;
}

.lex__table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin-top: 4px;
}
.lex__table thead th {
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
}
.lex__table thead th.right { text-align: right; }
.lex__table tbody td {
  padding: 8px 6px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
}
.lex__table tbody td.right { text-align: right; }

.lex__sub-h { margin: 8px 0 12px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-3); }

.lex__entry-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px 18px;
  margin-bottom: 14px;
}

.lex__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
</style>
