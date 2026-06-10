<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  LexiconsView — Pronunciation dictionaries.
  Per preview Lexicons §:
    • List on left with scope badge per item (book / reusable / persona-scoped)
    • Detail pane with: ⬇ Import .justlex.json · ⬆ Export · scope row ·
      Live preview text input · entries table (Word/Pronunciation/Format/Note)
      · + Add entry · Bulk paste TSV · ▶ Preview against text
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import EmptyState from "../components/EmptyState.vue";

const api = useApi();

const lexicons = ref([]);
const projects = ref([]);
const personas = ref([]);
const selectedId = ref(null);
const loading = ref(false);

const previewText = ref("");
const previewResult = ref(""); // text after pronunciation rewrites — best-effort, client-side.

const newName = ref("");
const newScope = ref("global");
const newProjectId = ref("");
const newPersonaId = ref("");

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

const fileInput = ref(null);
function chooseImportFile() { fileInput.value?.click(); }

async function refresh() {
  loading.value = true;
  try {
    const [lxRes, pRes, prRes] = await Promise.all([
      api.safeRequest("/v1/lexicons", { lexicons: [] }),
      api.safeRequest("/v1/projects", { projects: [] }),
      api.safeRequest("/v1/personas", { personas: [] }),
    ]);
    lexicons.value = lxRes?.lexicons ?? [];
    projects.value = pRes?.projects ?? [];
    personas.value = prRes?.personas ?? [];
    if (!selectedId.value && lexicons.value.length) selectedId.value = lexicons.value[0].id;
  } finally {
    loading.value = false;
  }
}

async function createLexicon() {
  if (!newName.value.trim()) return;
  const body = {
    name: newName.value.trim(),
    entries: [],
    scope: newScope.value,
    project_id: newScope.value === "project" ? newProjectId.value || null : null,
    persona_id: newScope.value === "persona" ? newPersonaId.value || null : null,
  };
  try {
    const created = await api.request("/v1/lexicons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    newName.value = "";
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
  const raw = prompt(
    "Paste TSV (one entry per line, columns: word [TAB] pronunciation [TAB] format(ipa|phonetic) [TAB] note). Example:\nBeauchamp\t/ˈbiːtʃəm/\tipa\tfamily name",
    "",
  );
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

onMounted(refresh);
</script>

<template>
  <div class="lex">
    <aside class="lex__list">
      <header class="lex__list-h">
        <h3>Lexicons</h3>
        <JvButton variant="primary" size="sm" label="+ New" @click="newName = 'New lexicon'; createLexicon()" />
      </header>
      <div class="lex__list-meta jv-muted">{{ lexicons.length }} dictionaries</div>

      <div v-if="loading" class="lex__empty jv-muted">Loading…</div>
      <EmptyState
        v-else-if="!lexicons.length"
        icon="Sparkle"
        title="No lexicons yet"
        message="Pronunciation dictionaries force domain words and proper names — Beauchamp → BEE-chum — to render consistently across a whole project."
        action-label="+ New lexicon"
        compact
        @action="newName = 'New lexicon'; createLexicon()"
      />

      <div
        v-for="lx in lexicons"
        :key="lx.id"
        class="lex__item"
        :class="{ 'lex__item--active': selectedId === lx.id }"
        @click="selectedId = lx.id"
      >
        <div class="lex__item-h">
          <strong>{{ lx.name }}</strong>
          <span class="jv-pill" :class="scopeBadge(lx).cls">{{ scopeBadge(lx).label }}</span>
        </div>
        <div class="lex__item-meta jv-muted">
          {{ (lx.entries || []).length }} entries
          <span v-if="lx.scope === 'project' && lx.project_id"> · scoped to <code>{{ lx.project_id }}</code></span>
          <span v-if="lx.scope === 'persona' && lx.persona_id"> · scoped to <code>{{ lx.persona_id }}</code></span>
        </div>
      </div>

      <div class="jv-divider" />

      <div class="lex__new">
        <h4 class="lex__new-h">+ New lexicon</h4>
        <input class="jv-input" v-model="newName" placeholder="Lexicon name" />
        <select class="jv-input" v-model="newScope">
          <option value="global">Reusable (global)</option>
          <option value="project">Book-scoped (project)</option>
          <option value="persona">Persona-scoped</option>
        </select>
        <select v-if="newScope === 'project'" class="jv-input" v-model="newProjectId">
          <option value="">— pick a project —</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-if="newScope === 'persona'" class="jv-input" v-model="newPersonaId">
          <option value="">— pick a persona —</option>
          <option v-for="p in personas" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <JvButton variant="primary" size="sm" label="Create" @click="createLexicon" :disabled="!newName.trim()" />
      </div>
    </aside>

    <section class="lex__detail">
      <div v-if="!selected" class="jv-card lex__detail-empty">
        <p class="jv-muted">Select a lexicon on the left, or import a <code>.justlex.json</code>.</p>
        <div style="margin-top:14px">
          <JvButton variant="secondary" label="⬇ Import .justlex.json" @click="chooseImportFile" />
        </div>
      </div>

      <div v-else class="jv-card lex__editor">
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
            <span v-if="selectedScope === 'project'" class="jv-pill jv-pill--ghost">project: {{ selected.project_id || '—' }}</span>
            <span v-if="selectedScope === 'persona'" class="jv-pill jv-pill--ghost">persona: {{ selected.persona_id || '—' }}</span>
          </div>
        </div>

        <div class="lex__field">
          <label>Live preview text</label>
          <input
            class="jv-input"
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
            <input class="jv-input" v-model="newGrapheme" placeholder="Beauchamp" @keydown.enter="appendEntry" />
          </label>
          <label class="lex__field">
            <span>Phoneme IPA</span>
            <input class="jv-input" v-model="newPhonemeIpa" placeholder="/ˈbiːtʃəm/" @keydown.enter="appendEntry" />
          </label>
          <label class="lex__field">
            <span>Alias (phonetic — engine reads this)</span>
            <input class="jv-input" v-model="newAlias" placeholder="bee-chum" @keydown.enter="appendEntry" />
          </label>
          <label class="lex__field">
            <span>Note (optional)</span>
            <input class="jv-input" v-model="newNote" placeholder="family name in Ch.3" />
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
    </section>

    <input ref="fileInput" type="file" accept=".justlex.json,application/json" style="display:none" @change="importFile" />
  </div>
</template>

<style scoped>
.lex {
  display: grid;
  grid-template-columns: 340px 1fr;
  height: 100%;
  gap: 0;
}

.lex__list {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--surface);
  overflow-y: auto;
}
.lex__list-h {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 14px 4px;
}
.lex__list-h h3 {
  margin: 0;
  flex: 1;
  font-size: 14px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-2);
}
.lex__list-meta { padding: 0 14px 8px; font-size: 11.5px; }
.lex__empty { padding: 16px; font-size: 13px; }

.lex__item {
  padding: 10px 14px;
  cursor: pointer;
  border-left: 3px solid transparent;
}
.lex__item:hover { background: var(--surface-2); }
.lex__item--active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
}
.lex__item-h {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
}
.lex__item-h strong { flex: 1; }
.lex__item-meta { font-size: 11.5px; margin-top: 2px; }

.lex__new {
  padding: 8px 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.lex__new-h { margin: 4px 0 6px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-3); }

.lex__detail { padding: 24px 32px; overflow-y: auto; }
.lex__detail-empty { padding: 40px; text-align: center; }
.lex__editor { max-width: 1000px; }

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
