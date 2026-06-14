<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  LexiconsView — Pronunciation dictionaries.

  Grid of lexicon cards (user decision 2026-06-12: Personas/Lexicons/
  Effects share the card-grid pattern); clicking a card drills into the
  detail editor with: ⬇ Import .justlex.json · ⬆ Export · scope row ·
  Live preview text input · entries table (Word/Pronunciation/Format)
  · + Add entry · Bulk paste TSV · ▶ Preview against text
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import EmptyState from "../components/EmptyState.vue";
import { useLexiconsStore } from "../stores/lexicons.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";

const api = useApi();

// lexicons / projects / personas from shared stores. Mutations here
// call refresh() → store.reload() so consumers (Personas, Overview)
// reflect the change.
const lexiconsStore = useLexiconsStore();
const projectsStore = useProjectsStore();
const personasStore = usePersonasStore();
const lexicons = computed(() => lexiconsStore.items);
const search = ref("");
const SCOPE_FILTERS = [["all", "All"], ["global", "Reusable"], ["project", "Book"], ["persona", "Persona"]];
const scopeFilter = ref("all");
const filteredLexicons = computed(() => {
  let list = lexicons.value;
  if (scopeFilter.value !== "all") list = list.filter((l) => (l.scope || "global") === scopeFilter.value);
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((l) =>
    (l.name || "").toLowerCase().includes(q) ||
    (l.entries || []).some((e) => (e.grapheme || "").toLowerCase().includes(q)));
  return list;
});
const projects = computed(() => projectsStore.items);
const personas = computed(() => personasStore.items);
const selectedId = ref(null);
const loading = ref(false);

const previewText = ref("");
const previewResult = ref(""); // text after pronunciation rewrites — best-effort, client-side.

const newGrapheme = ref("");
const newPhonemeIpa = ref("");
const newAlias = ref("");
const newNote = ref("");

const selected = computed(() => lexicons.value.find((l) => l.id === selectedId.value) ?? null);
const selectedScope = computed(() => selected.value?.scope ?? "global");

const scopeBadge = (lex) => {
  const s = lex?.scope ?? "global";
  if (s === "project") return { label: "book", cls: "jv-pill--green" };
  if (s === "persona") return { label: "persona-scoped", cls: "jv-pill--warn" };
  return { label: "reusable", cls: "jv-pill--ghost" };
};

function scopedToName(lex) {
  if (lex.scope === "project" && lex.project_id) {
    return projects.value.find((p) => p.id === lex.project_id)?.name || lex.project_id;
  }
  if (lex.scope === "persona" && lex.persona_id) {
    return personas.value.find((p) => p.id === lex.persona_id)?.name || lex.persona_id;
  }
  return null;
}

const fileInput = ref(null);
function chooseImportFile() { fileInput.value?.click(); }

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

async function createLexicon() {
  // Step 1: name + scope. Step 2 (only when scoped): pick the target.
  const base = await promptDialog({
    title: "New lexicon",
    fields: [
      { key: "name", label: "Name", placeholder: "e.g. Stillwater proper names" },
      {
        key: "scope",
        label: "Scope",
        type: "select",
        defaultValue: "global",
        options: [
          { value: "global", label: "Reusable (global)" },
          { value: "project", label: "Book-scoped (project)" },
          { value: "persona", label: "Persona-scoped" },
        ],
      },
    ],
    confirmLabel: "Create",
  });
  if (!base?.name) return;
  let projectId = null;
  let personaId = null;
  if (base.scope === "project") {
    if (!projects.value.length) {
      pushToast({ kind: "info", message: "No projects yet — creating as reusable instead." });
      base.scope = "global";
    } else {
      const picked = await promptDialog({
        title: "Scope to which book?",
        fields: [{
          key: "id", label: "Book", type: "select",
          defaultValue: projects.value[0].id,
          options: projects.value.map((p) => ({ value: p.id, label: p.name })),
        }],
        confirmLabel: "Create",
      });
      if (!picked) return;
      projectId = picked.id;
    }
  } else if (base.scope === "persona") {
    if (!personas.value.length) {
      pushToast({ kind: "info", message: "No personas yet — creating as reusable instead." });
      base.scope = "global";
    } else {
      const picked = await promptDialog({
        title: "Scope to which persona?",
        fields: [{
          key: "id", label: "Persona", type: "select",
          defaultValue: personas.value[0].id,
          options: personas.value.map((p) => ({ value: p.id, label: p.name })),
        }],
        confirmLabel: "Create",
      });
      if (!picked) return;
      personaId = picked.id;
    }
  }
  try {
    const created = await api.request("/v1/lexicons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: base.name,
        entries: [],
        scope: base.scope,
        project_id: projectId,
        persona_id: personaId,
      }),
    });
    await refresh();
    selectedId.value = created.id;
    pushToast({ kind: "success", title: "Lexicon created" });
  } catch (e) {
    pushToast({ kind: "error", title: "Create failed", description: String(e?.message ?? e) });
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
    if (selectedId.value === id) selectedId.value = null;
    await refresh();
    pushToast({ kind: "success", title: "Lexicon deleted" });
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

async function appendEntry() {
  if (!selectedId.value || !newGrapheme.value.trim()) return;
  const entry = { grapheme: newGrapheme.value.trim() };
  if (newPhonemeIpa.value.trim()) entry.phoneme_ipa = newPhonemeIpa.value.trim();
  if (newAlias.value.trim()) entry.alias = newAlias.value.trim();
  try {
    await api.request(`/v1/lexicons/${selectedId.value}/entries`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    });
    newGrapheme.value = "";
    newPhonemeIpa.value = "";
    newAlias.value = "";
    newNote.value = "";
    await refresh();
    pushToast({ kind: "success", title: "Entry appended" });
  } catch (e) {
    pushToast({ kind: "error", title: "Append failed", description: String(e?.message ?? e) });
  }
}

async function bulkPasteTsv() {
  // Textarea dialog — native prompt() is banned (returns null in the
  // Tauri webview) and was single-line anyway.
  const raw = (await promptDialog({
    title: "Bulk paste TSV",
    fields: [{
      key: "tsv",
      label: "One entry per line: word [TAB] pronunciation [TAB] format(ipa|phonetic) [TAB] note",
      type: "textarea",
      rows: 8,
      placeholder: "Beauchamp\t/ˈbiːtʃəm/\tipa\tfamily name",
    }],
    confirmLabel: "Add entries",
  }))?.tsv;
  if (!raw || !selectedId.value) return;
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  let appended = 0, failed = 0;
  for (const line of lines) {
    const parts = line.split("\t");
    const grapheme = parts[0]?.trim();
    const pron = parts[1]?.trim();
    const fmt = (parts[2] || "phonetic").trim().toLowerCase();
    if (!grapheme || !pron) { failed++; continue; }
    const entry = { grapheme };
    if (fmt === "ipa") entry.phoneme_ipa = pron; else entry.alias = pron;
    try {
      await api.request(`/v1/lexicons/${selectedId.value}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entry),
      });
      appended++;
    } catch { failed++; }
  }
  await refresh();
  pushToast({
    kind: failed ? "warn" : "success",
    title: `Bulk paste: ${appended} added${failed ? `, ${failed} failed` : ""}`,
  });
}

async function importFile(ev) {
  const file = ev.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const body = {
      name: parsed.name || file.name.replace(/\.justlex\.json$/i, ""),
      entries: parsed.entries || [],
      scope: parsed.scope || "global",
    };
    const created = await api.request("/v1/lexicons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await refresh();
    selectedId.value = created.id;
    pushToast({ kind: "success", title: `Imported ${body.entries.length} entries from ${file.name}` });
  } catch (e) {
    pushToast({ kind: "error", title: "Import failed", description: String(e?.message ?? e) });
  } finally {
    ev.target.value = "";
  }
}

function exportLexicon() {
  if (!selected.value) return;
  const blob = new Blob([JSON.stringify(selected.value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(selected.value.name || "lexicon").replace(/\W+/g, "-")}.justlex.json`;
  a.click();
  URL.revokeObjectURL(url);
  pushToast({ kind: "success", title: "Lexicon exported" });
}

// Client-side preview — best-effort longest-match grapheme replacement
// using `alias` (phonetic) where available, IPA otherwise. Real-rendering
// preview will go through /v1/lexicons/{id}/preview when that lands.
function runPreview() {
  if (!selected.value || !previewText.value) {
    previewResult.value = "";
    return;
  }
  const entries = [...(selected.value.entries || [])].sort((a, b) => b.grapheme.length - a.grapheme.length);
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
  // Fix-it loop handoff (journeys fixit journey): Chapters/Studio flag a
  // misread word → it arrives here prefilled, ready for a pronunciation.
  try {
    const raw = window.sessionStorage?.getItem("jv.lexicon.prefill");
    if (raw) {
      window.sessionStorage.removeItem("jv.lexicon.prefill");
      const { grapheme } = JSON.parse(raw);
      if (grapheme) {
        // Drill straight into a lexicon so the Append form is on screen.
        if (!selectedId.value && lexicons.value.length) selectedId.value = lexicons.value[0].id;
        newGrapheme.value = grapheme;
        pushToast({
          message: `Fixing “${grapheme}” — spell it how it should sound, test it, save. Only the lines containing it re-render; everything else stays cached.`,
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
    <!-- ── Table (consolidated pattern 2026-06-12) ─────────────────── -->
    <template v-if="true">
      <div class="jv-lib-toolbar">
        <JvInput v-model="search" placeholder="Search lexicons + words…" size="sm" width="name" />
        <div style="display:inline-flex;gap:4px">
          <button v-for="f in SCOPE_FILTERS" :key="f[0]" type="button" class="jv-pill" :class="scopeFilter === f[0] ? 'jv-pill--solid' : 'jv-pill--ghost'" @click="scopeFilter = f[0]">{{ f[1] }}</button>
        </div>
        <span class="jv-spacer" />
        <JvButton variant="secondary" size="sm" label="⬇ Import .justlex.json" @click="chooseImportFile" />
        <JvButton variant="primary" size="sm" label="+ New lexicon" @click="createLexicon" />
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
          <tr v-for="lx in filteredLexicons" :key="lx.id" class="lex__row" title="Click to edit" @click="selectedId = lx.id">
            <td><strong>{{ lx.name }}</strong><div v-if="scopedToName(lx)" class="jv-muted" style="font-size:11.5px">{{ scopedToName(lx) }}</div></td>
            <td><span class="jv-pill" :class="scopeBadge(lx).cls">{{ scopeBadge(lx).label }}</span></td>
            <td>{{ (lx.entries || []).length }}</td>
            <td>
              <code v-for="(e, i) in (lx.entries || []).slice(0, 4)" :key="i" class="jv-mono lex__word">{{ e.grapheme }}</code>
              <span v-if="(lx.entries || []).length > 4" class="jv-muted">+{{ (lx.entries || []).length - 4 }}</span>
              <span v-if="!(lx.entries || []).length" class="jv-muted">(empty)</span>
            </td>
            <td class="jv-table__actions" @click.stop>
              <JvButton variant="ghost" size="sm" label="Edit" @click="selectedId = lx.id" />
              <button type="button" class="jv-btn jv-btn--danger-outline jv-btn--sm" @click="deleteLexicon(lx.id)">Delete</button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- ── Editor dialog (consolidated pattern) ──────────────────────── -->
    <div v-if="selected" class="jv-overlay" @click.self="selectedId = null">
      <div class="jv-modal lex__modal">
      <button type="button" class="jv-modal__close lex__close" title="Close" @click="selectedId = null">✕</button>

      <div class="lex__editor">
        <header class="lex__editor-h">
          <h2>{{ selected.name }}</h2>
          <span class="jv-pill" :class="scopeBadge(selected).cls">{{ scopeBadge(selected).label }}</span>
          <span class="jv-muted lex__editor-count">{{ (selected.entries || []).length }} entries · applied before TTS</span>
          <span class="lex__spacer" />
          <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="chooseImportFile">⬇ Import .justlex.json</button>
          <button class="jv-btn jv-btn--secondary jv-btn--sm" @click="exportLexicon">⬆ Export</button>
          <button class="jv-btn jv-btn--danger-outline jv-btn--sm" @click="deleteLexicon(selected.id)">Delete</button>
        </header>

        <div class="lex__field">
          <label>Scope</label>
          <div class="lex__scope-row">
            <span class="jv-pill" :class="scopeBadge(selected).cls">{{ scopeBadge(selected).label }}</span>
            <span class="jv-pill jv-pill--ghost">applies before TTS</span>
            <span v-if="selectedScope === 'project'" class="jv-pill jv-pill--ghost">book: {{ scopedToName(selected) || "—" }}</span>
            <span v-if="selectedScope === 'persona'" class="jv-pill jv-pill--ghost">persona: {{ scopedToName(selected) || "—" }}</span>
          </div>
        </div>

        <div class="lex__field">
          <label>Live preview text</label>
          <input
            class="jv-input jv-w-prose"
            v-model="previewText"
            placeholder="Beauchamp arrived in Stillwater on the NYPD ferry. — Worcestershire sauce on his cuff."
          />
          <p v-if="previewResult" class="lex__preview-out">{{ previewResult }}</p>
        </div>

        <table v-if="(selected.entries || []).length" class="lex__table">
          <thead>
            <tr>
              <th>Word</th>
              <th>Pronunciation (IPA or phonetic)</th>
              <th style="width:90px">Format</th>
              <th style="width:80px" class="right"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(e, i) in selected.entries" :key="i">
              <td><strong>{{ e.grapheme }}</strong></td>
              <td><code class="jv-mono">{{ e.phoneme_ipa || e.alias || "—" }}</code></td>
              <td>{{ e.phoneme_ipa ? "IPA" : "phonetic" }}</td>
              <td class="right">
                <button class="jv-btn jv-btn--ghost jv-btn--sm" disabled title="Inline edit lands in #103.1">Edit</button>
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-muted" style="padding: 12px 0; font-style: italic;">
          No entries yet — add one below or import a <code>.justlex.json</code>.
        </p>

        <div class="jv-divider" />

        <h4 class="lex__sub-h">Append entry</h4>
        <div class="lex__entry-grid">
          <label class="lex__field">
            <span>Grapheme (as written)</span>
            <input class="jv-input jv-w-name" v-model="newGrapheme" placeholder="Beauchamp" @keydown.enter="appendEntry" />
          </label>
          <label class="lex__field">
            <span>Phoneme IPA</span>
            <input class="jv-input jv-w-name" v-model="newPhonemeIpa" placeholder="/ˈbiːtʃəm/" @keydown.enter="appendEntry" />
          </label>
          <label class="lex__field">
            <span>Alias (phonetic — engine reads this)</span>
            <input class="jv-input jv-w-name" v-model="newAlias" placeholder="bee-chum" @keydown.enter="appendEntry" />
          </label>
          <label class="lex__field">
            <span>Note (optional)</span>
            <input class="jv-input jv-w-name" v-model="newNote" placeholder="family name in Ch.3" />
          </label>
        </div>

        <div class="lex__actions">
          <JvButton variant="primary" label="+ Add entry" @click="appendEntry" :disabled="!newGrapheme.trim() || (!newPhonemeIpa.trim() && !newAlias.trim())" />
          <button class="jv-btn jv-btn--ghost jv-btn--sm" @click="bulkPasteTsv">Bulk paste TSV</button>
          <span class="lex__spacer" />
          <button
            class="jv-btn jv-btn--secondary jv-btn--sm"
            @click="runPreview"
            :disabled="!previewText.trim()"
          >▶ Preview against text</button>
        </div>
      </div>
      </div>
    </div>

    <input ref="fileInput" type="file" accept=".justlex.json,application/json" style="display:none" @change="importFile" />
  </div>
</template>

<style scoped>
.lex { display: flex; flex-direction: column; }

.lex__toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 12.5px;
}
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
.lex__modal { width: min(860px, calc(100vw - 32px)); max-height: 86vh; overflow-y: auto; position: relative; padding: 20px 22px; }
.lex__close { position: absolute; top: 12px; right: 12px; }
.lex__editor { }

.lex__editor-h {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}
.lex__editor-h h2 { margin: 0; font-size: 22px; }
.lex__editor-count { font-size: 12px; }
.lex__spacer { flex: 1; }

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
