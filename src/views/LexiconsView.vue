<!-- SPDX-License-Identifier: MIT -->
<!--
  LexiconsView — Pronunciation dictionaries.

  Library list (jv-lib-toolbar + jv-table); clicking a row opens ONE editor
  dialog. The dialog edits a working DRAFT (name + scope + entries) and
  commits on Save / discards on Cancel (save-pattern ruling 2026-06-14) —
  consistent with Personas + Render presets. "+ New lexicon" opens the same
  dialog directly on a blank draft (no prompt-then-popup). Uses the shared
  AppModal (@delebash/llm-ui) shell so the close ✕ never overlaps Import/Export.
-->
<script setup>
import { computed, nextTick, onActivated, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { previewLexiconText } from "../services/lexiconPreview.js";
import { pushToast, saveBlob } from "@delebash/llm-ui";
import { confirmDialog, promptDialog } from "@delebash/llm-ui";
import { UiButton, UiInput, UiTag, UiChip, UiSelect, AppModal, UiTable } from "@delebash/llm-ui";
import { EmptyState } from "@delebash/llm-ui";
import { useLexiconsStore } from "../stores/lexicons.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";

const api = useApi();

// lexicons / projects / personas from shared stores. Save commits via the
// API then refresh() → store.reload() so consumers (Personas, Home)
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

// An id is never the answer to "what is this scoped to" (user ruling
// 2026-08-15). A lookup that misses means the owner is gone, so say that.
function scopedToName(lex) {
  if (lex?.scope === "project" && lex.project_id) {
    return projects.value.find((p) => p.id === lex.project_id)?.name || "(deleted project)";
  }
  if (lex?.scope === "persona" && lex.persona_id) {
    return personas.value.find((p) => p.id === lex.persona_id)?.name || "(deleted persona)";
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

// ── The two grids (kit UiTable) ──────────────────────────────────────────
// The library list wears the JustVoice look; `row-hover` carries both the
// pointer cursor and the row tint, so `.lex__row`'s two scoped rules are gone.
const LEXICON_COLUMNS = [
  { id: "name", accessorKey: "name", header: "Name", sortable: true },
  { id: "scope", header: "Scope", headerStyle: { width: "130px" } },
  { id: "count", header: "Entries", headerStyle: { width: "90px" } },
  { id: "words", header: "Words" },
  { id: "actions", header: "Actions",
    headerStyle: { width: "150px", textAlign: "right" },
    cellStyle: { textAlign: "right", whiteSpace: "nowrap" } },
];

// The entry list inside the dialog keeps its own flat look (no card chrome,
// tighter padding), so it does NOT wear `jv-table-look`. Its actions address
// entries by INDEX, which a slot cannot hand back — so the index rides along
// as a field and doubles as the row key.
const entryRows = computed(() =>
  (draft.value?.entries || []).map((e, i) => ({ ...e, __i: i })),
);
const ENTRY_COLUMNS = [
  { id: "grapheme", accessorKey: "grapheme", header: "Word", sortable: true },
  { id: "pron", header: "Pronunciation (IPA or phonetic)" },
  { id: "kind", header: "Format", headerStyle: { width: "90px" } },
  { id: "actions", header: "",
    headerStyle: { width: "150px", textAlign: "right" },
    cellStyle: { textAlign: "right", whiteSpace: "nowrap" } },
];

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

// ── Name scan — the pronunciation pre-flight (C2, 2026-08-21) ─────────
// For a book-scoped lexicon: scan every block for likely proper nouns the
// lexicon doesn't cover yet, and add them as worklist rows. Turns "hear
// the mispronounced name in chapter 30" into a list fixed before render.
const scanBusy = ref(false);
const scanWords = ref(null); // null = never scanned; [] = scanned, clean

async function runNameScan() {
  if (!draft.value?.project_id || scanBusy.value) return;
  scanBusy.value = true;
  try {
    const r = await api.request(
      `/v1/projects/${draft.value.project_id}/pronunciation-report`,
      { method: "POST" },
    );
    const have = new Set((draft.value.entries || []).map((e) => (e.grapheme || "").toLowerCase()));
    scanWords.value = (r?.words || []).filter((w) => !have.has(w.word.toLowerCase()));
  } catch (e) {
    pushToast({ kind: "error", title: "Scan failed", description: String(e?.message ?? e) });
  } finally {
    scanBusy.value = false;
  }
}

function addScanWord(w) {
  draft.value.entries.push({ grapheme: w.word });
  scanWords.value = scanWords.value.filter((x) => x.word !== w.word);
}

function addAllScanWords() {
  for (const w of scanWords.value) draft.value.entries.push({ grapheme: w.word });
  scanWords.value = [];
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

async function exportLexicon() {
  if (!draft.value) return;
  const out = {
    name: draft.value.name,
    scope: draft.value.scope,
    project_id: draft.value.project_id,
    persona_id: draft.value.persona_id,
    entries: draft.value.entries,
  };
  const blob = new Blob([JSON.stringify(out, null, 2)], { type: "application/json" });
  // The kit's one save door (2026-08-15) — was one of five inline copies here.
  await saveBlob(blob, `${(draft.value.name || "lexicon").replace(/\W+/g, "-")}.justlex.json`,
    { title: "Save lexicon", filterName: "JustVoice lexicon", filterExt: "json" });
  pushToast({ kind: "success", title: "Lexicon exported" });
}

// Client-side preview via the ONE shared truth
// (services/lexiconPreview.js — mirrors what the render actually does:
// alias replaces the text; IPA annotates the word's pronunciation).
// This view used to preview alias-first while GenerateView previewed
// IPA-first and the render did a third thing; unified 2026-08-21.
function runPreview() {
  previewResult.value = (draft.value && previewText.value)
    ? previewLexiconText(previewText.value, draft.value.entries)
    : "";
}

// Fix-it loop handoff: Chapters/Studio flag a misread word → arrives here
// prefilled. Open the first lexicon (or a new draft) with the grapheme seeded
// into the entry form, ready for a pronunciation. Consumed after the first
// refresh AND on every re-entry (kept-alive view; a mounted-only read fires
// once per session — the second misread word of a session would arrive to
// nothing). The flag keeps the re-entry path from racing the first load.
let _lexiconsReady = false;
function consumeLexiconPrefill() {
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
}

onMounted(async () => {
  await refresh();
  _lexiconsReady = true;
  consumeLexiconPrefill();
});

onActivated(() => {
  if (_lexiconsReady) consumeLexiconPrefill();
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

    <UiTable v-else class="jv-table-look" :data="filteredLexicons" :columns="LEXICON_COLUMNS"
      data-key="id" row-hover @row-click="({ data }) => openEdit(data)">
      <template #name="{ row }">
        <strong>{{ row.name }}</strong>
        <div v-if="scopedToName(row)" class="jv-muted lex__scoped-to">{{ scopedToName(row) }}</div>
      </template>
      <template #scope="{ row }"><UiTag :intent="scopeBadge(row).intent">{{ scopeBadge(row).label }}</UiTag></template>
      <template #count="{ row }">{{ (row.entries || []).length }}</template>
      <template #words="{ row }">
        <code v-for="(e, i) in (row.entries || []).slice(0, 4)" :key="i" class="jv-mono lex__word">{{ e.grapheme }}</code>
        <span v-if="(row.entries || []).length > 4" class="jv-muted">+{{ (row.entries || []).length - 4 }}</span>
        <span v-if="!(row.entries || []).length" class="jv-muted">(empty)</span>
      </template>
      <template #actions="{ row }">
        <div class="jv-table__actions" @click.stop>
          <UiButton intent="ghost" size="small" label="Edit" @click="openEdit(row)" />
          <UiButton intent="danger-outline" size="small" label="Delete" @click="deleteLexicon(row.id)" />
        </div>
      </template>
    </UiTable>

    <!-- ── Editor dialog — draft + Save/Cancel (canonical shell) ────── -->
    <AppModal v-if="dialogOpen && draft" :eyebrow="creating ? 'New lexicon' : 'Lexicon'" :title="draft.name || 'Untitled lexicon'" :max-width="'860px'" dismissable @close="closeDialog">
          <div class="lex__field">
            <label>Name</label>
            <UiInput ref="nameInputEl" width="name" v-model="draft.name" placeholder="e.g. Stillwater proper names" @keydown.enter.prevent />
          </div>

          <div class="lex__field">
            <label>Scope</label>
            <!-- Editable only at create — scope is fixed once a lexicon exists. -->
            <div v-if="creating" class="lex__scope-row">
              <UiSelect width="name" v-model="draft.scope" :options="SCOPE_OPTIONS" />
              <UiSelect v-if="draft.scope === 'project'" width="name" v-model="draft.project_id"
                placeholder="— pick a book —" :options="projects" option-label="name" option-value="id" />
              <UiSelect v-if="draft.scope === 'persona'" width="name" v-model="draft.persona_id"
                placeholder="— pick a persona —" :options="personas" option-label="name" option-value="id" />
            </div>
            <div v-else class="lex__scope-row">
              <UiTag :intent="scopeBadge(draft).intent">{{ scopeBadge(draft).label }}</UiTag>
              <!-- "ghost" is a BUTTON intent — UiTag doesn't have it (the
                   2026-08-20 kit-truth sweep missed these three). -->
              <UiTag intent="secondary">applies before TTS</UiTag>
              <UiTag intent="secondary" v-if="draft.scope === 'project'">book: {{ scopedToName(draft) || "—" }}</UiTag>
              <UiTag intent="secondary" v-if="draft.scope === 'persona'">persona: {{ scopedToName(draft) || "—" }}</UiTag>
            </div>
          </div>

          <!-- ── The pronunciation pre-flight (book-scoped lexicons) ── -->
          <div v-if="draft.project_id" class="lex__field">
            <label>Names the book may mispronounce</label>
            <div class="jv-inline-row">
              <UiButton
                intent="secondary" size="small"
                :loading="scanBusy"
                :label="scanBusy ? 'Scanning…' : '🔎 Scan the book for names'"
                title="Find proper nouns this lexicon doesn't cover yet — fix them here instead of hearing them wrong in the finished audio"
                @click="runNameScan"
              />
              <UiButton
                v-if="scanWords && scanWords.length"
                intent="secondary" size="small"
                :label="`＋ Add all ${scanWords.length}`"
                @click="addAllScanWords"
              />
              <span v-if="scanWords && !scanWords.length" class="jv-hint">
                Every name found is already covered.
              </span>
            </div>
            <div v-if="scanWords && scanWords.length" class="lex__scan-words">
              <UiChip
                v-for="w in scanWords" :key="w.word"
                :title="`Appears ${w.count} time${w.count === 1 ? '' : 's'} — click to add as a worklist row`"
                @click="addScanWord(w)"
              >＋ {{ w.word }} ({{ w.count }})</UiChip>
            </div>
            <p v-if="scanWords && scanWords.length" class="jv-hint">
              Added names start blank — a blank row changes nothing until you
              give it a pronunciation, so add freely and fill in as you listen.
            </p>
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

          <UiTable class="lex__table" :data="entryRows" :columns="ENTRY_COLUMNS" data-key="__i"
            :row-class="(row) => (editingEntryIndex === row.__i ? 'lex__row--editing' : '')">
            <template #grapheme="{ row }"><strong>{{ row.grapheme }}</strong></template>
            <template #pron="{ row }"><code class="jv-mono">{{ row.phoneme_ipa || row.alias || "—" }}</code></template>
            <template #kind="{ row }">{{ row.phoneme_ipa ? "IPA" : "phonetic" }}</template>
            <template #actions="{ row }">
              <div class="lex__entry-actions">
                <UiButton intent="ghost" size="small" label="Edit" title="Edit this entry in the form below" @click="startEditEntry(row, row.__i)" />
                <UiButton intent="danger-outline" size="small" label="Delete" title="Remove this entry" @click="deleteEntry(row.__i)" />
              </div>
            </template>
            <template #empty>
              No entries yet — add one below, bulk-paste, or merge a <code>.justlex.json</code>.
            </template>
          </UiTable>

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

        <template #footer>
          <span class="jv-muted lex__count">{{ draft.entries.length }} entr{{ draft.entries.length === 1 ? "y" : "ies" }}</span>
          <span class="jv-spacer" />
          <UiButton intent="secondary" label="Cancel" @click="closeDialog" />
          <UiButton intent="primary" label="Save" :disabled="!canSave" @click="saveDialog" />
        </template>
    </AppModal>

    <input ref="fileInputNew" type="file" accept=".justlex.json,application/json" style="display:none" @change="importNewFromFile" />
    <input ref="fileInputMerge" type="file" accept=".justlex.json,application/json" style="display:none" @change="importIntoDraft" />
  </div>
</template>

<style scoped>
.lex { display: flex; flex-direction: column; }

.lex__empty { padding: 40px 0; font-size: 13px; text-align: center; }

/* The library row's cursor and hover tint come from UiTable's `row-hover`. */
.lex__scoped-to { font-size: 12.5px; }
.lex__word {
  background: var(--surface-2);
  border: 1px solid var(--line);
  border-radius: 4px;
  padding: 1px 6px;
  margin-right: 4px;
  font-size: 11.5px;
}

.lex__count { font-size: 12px; }
.lex__spacer { flex: 1; }
.lex__entry-actions { white-space: nowrap; }
.lex__entry-actions > * + * { margin-left: 4px; }
/* Row state paints the whole <tr> and has to reach INTO the component — a
   scoped `td` selector never matches a cell the child renders (audit §19.1). */
.lex__table :deep(.ui-table-row.lex__row--editing) td { background: var(--accent-soft); }

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

/* The dialog's entry list keeps its own flat look — no card chrome, tighter
   padding than `.jv-table-look` — so it wears none and overrides the kit's
   own values instead. `:deep` because every one of these targets an element
   the component renders. The `.right` classes are gone: alignment rides on
   the columns now. */
.lex__table { margin-top: 4px; }
.lex__table :deep(.ui-table) { font-size: 13px; }
.lex__table :deep(.ui-table thead th) {
  text-align: left;
  font-weight: 600;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--ink-3);
  padding: 8px 6px;
  border-bottom: 1px solid var(--line);
  background: transparent;
}
.lex__table :deep(.ui-table tbody td) {
  padding: 8px 6px;
  border-bottom: 1px solid var(--line-soft);
  vertical-align: middle;
}

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
.lex__scan-words { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0; max-width: 72ch; }
</style>
