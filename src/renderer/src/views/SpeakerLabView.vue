<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  SpeakerLabView — advanced-user attribution tuning workbench.

  Phase 4.5 of the Profile-kill plan. Tools-lane view (gated visibleFor
  audiobook + game + podcast + multiple + unset; hidden for dictation
  + accessibility per the locked sidebar decision).

  Affordances:
    - Input: paste, load from a scene, or load a sample fixture.
    - Cast: multi-add character ids + names + optional aliases.
    - Multi-column A/B: up to 4 columns. Each column has its own
      tier override / propagate toggle / floor slider / Run button.
      "Run all" fires them in parallel.
    - Per-column result table with source chips + confidence + a
      disagreement badge "this column disagrees with column A on D3"
      computed against column A's picks.

  Mirrors JustWrite's SpeakerLabView in concept; built fresh against
  JustVoice's analyze-text endpoint.
-->
<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";

const api = useApi();

const text = ref("");
const characters = ref([]);  // [{id, name, aliases}]
const newCharName = ref("");
const newCharAliases = ref("");
const projects = ref([]);
const scenes = ref([]);
const loadingScene = ref(false);
const selectedProjectId = ref(null);
const selectedSceneId = ref(null);

const columns = reactive([]);  // [{label, tier, propagate, use_floor, busy, result, error}]
const MAX_COLUMNS = 4;

const SAMPLE_TEXT = `Mara stood at the rail. The fog clawed at her ankles.

"Where are you going?" Sarah asked.

"Down," Mara said. "There's something in the cellar."

Sarah didn't move. "Are you sure?"

"No."`;

const SAMPLE_CAST = [
  { id: "c_mara", name: "Mara", aliases: [] },
  { id: "c_sarah", name: "Sarah", aliases: [] },
];

function addColumn() {
  if (columns.length >= MAX_COLUMNS) return;
  const tag = String.fromCharCode(65 + columns.length);
  columns.push({
    label: `Column ${tag}`,
    tier: "",  // empty = auto-classify
    propagate: true,
    use_floor: true,
    busy: false,
    result: null,
    error: null,
  });
}
function removeColumn(idx) {
  if (columns.length <= 1) return;
  columns.splice(idx, 1);
}

function loadSample() {
  text.value = SAMPLE_TEXT;
  characters.value = JSON.parse(JSON.stringify(SAMPLE_CAST));
}

function addCharacter() {
  const name = (newCharName.value || "").trim();
  if (!name) return;
  const aliases = (newCharAliases.value || "")
    .split(",")
    .map((a) => a.trim())
    .filter(Boolean);
  characters.value.push({
    id: `c_${name.toLowerCase().replace(/\s+/g, "_")}_${characters.value.length}`,
    name,
    aliases,
  });
  newCharName.value = "";
  newCharAliases.value = "";
}

function removeCharacter(idx) {
  characters.value.splice(idx, 1);
}

async function loadProjects() {
  try {
    const r = await api.safeRequest("/v1/projects", { projects: [] });
    projects.value = r?.projects || [];
  } catch (_) { /* tolerated */ }
}

async function loadScenes() {
  scenes.value = [];
  if (!selectedProjectId.value) return;
  try {
    const r = await api.safeRequest(`/v1/projects/${selectedProjectId.value}/scenes`, { scenes: [] });
    scenes.value = r?.scenes || [];
  } catch (_) { /* tolerated */ }
}

async function loadSceneText() {
  if (!selectedSceneId.value) return;
  loadingScene.value = true;
  try {
    const r = await api.safeRequest(`/v1/scenes/${selectedSceneId.value}/blocks`, []);
    const blocks = Array.isArray(r) ? r : r?.blocks ?? [];
    text.value = blocks.map((b) => b.text).join("\n\n");
  } finally {
    loadingScene.value = false;
  }
}

async function runColumn(col) {
  if (!text.value.trim()) {
    pushToast({ message: "Paste some text first.", kind: "info" });
    return;
  }
  col.busy = true;
  col.error = null;
  try {
    const body = {
      text: text.value,
      characters: characters.value,
      corrections: [],
      tier: col.tier || null,
      propagate: col.propagate,
      use_floor: col.use_floor,
    };
    const r = await api.request("/v1/extraction/analyze-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    col.result = r;
  } catch (e) {
    col.error = e?.message || String(e);
    if (col.error.includes("501")) {
      col.error += " (wire an LLM provider in Engines → LLM tab)";
    }
  } finally {
    col.busy = false;
  }
}

async function runAll() {
  await Promise.all(columns.map(runColumn));
}

function disagrees(colIdx, rowIdx) {
  // Disagreement = column N's speaker for row rowIdx differs from column A's.
  if (colIdx === 0) return false;
  const a = columns[0]?.result?.rows?.[rowIdx]?.speaker;
  const c = columns[colIdx]?.result?.rows?.[rowIdx]?.speaker;
  if (!a || !c) return false;
  return a !== c;
}

function speakerLabel(spk) {
  if (!spk || spk === "unknown") return "unknown";
  if (spk === "narrator") return "Narrator";
  const persona = characters.value.find((c) => c.id === spk);
  return persona?.name || spk;
}

function sourceChipClass(source) {
  return {
    tag: "splab__chip splab__chip--tag",
    propagated: "splab__chip splab__chip--propagated",
    llm: "splab__chip splab__chip--llm",
    floored: "splab__chip splab__chip--floored",
    narration: "splab__chip splab__chip--narration",
  }[source] || "splab__chip";
}

const dialogueIndices = computed(() => {
  // Indices of dialogue rows in the first column with a result; the table
  // renders rows in this order across all columns for side-by-side compare.
  const first = columns[0]?.result?.rows;
  if (!first) return [];
  return first.map((r, i) => i);
});

onMounted(() => {
  loadProjects();
  if (!columns.length) addColumn();
});
</script>

<template>
  <div class="splab">
    <header class="splab__header">
      <h2 class="splab__title">Speaker Lab</h2>
      <p class="jv-muted splab__lede">
        Advanced attribution tuning. Compare up to 4 prompt + tier
        configurations against the same scene; disagreement badges flag
        where they diverge. Calls the same backend the Studio Script tab
        uses.
      </p>
    </header>

    <!-- ── Input pane ─────────────────────────────────────────────── -->
    <section class="jv-section">
      <h3 class="jv-section__title">Input</h3>
      <div class="splab__input-toolbar">
        <JvButton variant="secondary" size="sm" label="Load sample" @click="loadSample" />
        <span class="jv-spacer" />
        <select v-model="selectedProjectId" class="jv-input splab__input-select" @change="loadScenes">
          <option :value="null">— pick a project —</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-model="selectedSceneId" class="jv-input splab__input-select">
          <option :value="null">— pick a scene —</option>
          <option v-for="s in scenes" :key="s.id" :value="s.id">{{ s.title || `Scene ${s.position + 1}` }}</option>
        </select>
        <JvButton
          variant="ghost"
          size="sm"
          :disabled="!selectedSceneId || loadingScene"
          label="Load scene"
          @click="loadSceneText"
        />
      </div>
      <textarea
        v-model="text"
        class="jv-input splab__text"
        placeholder="Paste the scene text here (or load a sample)…"
      />
    </section>

    <!-- ── Cast pane ──────────────────────────────────────────────── -->
    <section class="jv-section">
      <h3 class="jv-section__title">Cast</h3>
      <ul v-if="characters.length" class="splab__cast">
        <li v-for="(c, i) in characters" :key="c.id">
          <strong>{{ c.name }}</strong>
          <span class="jv-muted">id={{ c.id }}</span>
          <span v-if="c.aliases.length" class="jv-muted">aliases: {{ c.aliases.join(", ") }}</span>
          <button type="button" class="jv-btn jv-btn--ghost jv-btn--sm" @click="removeCharacter(i)">✕</button>
        </li>
      </ul>
      <div class="splab__add-cast">
        <input v-model="newCharName" class="jv-input" placeholder="Character name" />
        <input v-model="newCharAliases" class="jv-input" placeholder="Aliases (comma-separated, optional)" />
        <JvButton variant="ghost" size="sm" label="Add" @click="addCharacter" />
      </div>
    </section>

    <!-- ── Columns + Run all ─────────────────────────────────────── -->
    <section class="jv-section">
      <h3 class="jv-section__title">
        Columns
        <span class="jv-pill jv-pill--ghost">{{ columns.length }} / {{ MAX_COLUMNS }}</span>
      </h3>
      <div class="splab__columns">
        <article
          v-for="(col, i) in columns"
          :key="i"
          class="jv-card splab__column"
        >
          <header class="splab__column-h">
            <strong>{{ col.label }}</strong>
            <span class="jv-spacer" />
            <button v-if="columns.length > 1" type="button" class="jv-btn jv-btn--ghost jv-btn--sm" @click="removeColumn(i)">remove</button>
          </header>
          <div class="splab__column-knobs">
            <label class="splab__knob">
              <span>Tier</span>
              <select v-model="col.tier" class="jv-input jv-input--sm">
                <option value="">auto</option>
                <option value="guided">guided</option>
                <option value="direct">direct</option>
                <option value="reasoned">reasoned</option>
              </select>
            </label>
            <label class="splab__knob splab__knob--check">
              <input type="checkbox" v-model="col.propagate" />
              <span>Anchor propagation</span>
            </label>
            <label class="splab__knob splab__knob--check">
              <input type="checkbox" v-model="col.use_floor" />
              <span>Confidence floor</span>
            </label>
          </div>
          <footer class="splab__column-actions">
            <span class="jv-spacer" />
            <JvButton variant="primary" size="sm" :loading="col.busy" :disabled="col.busy" label="▶ Run" @click="runColumn(col)" />
          </footer>
          <p v-if="col.error" class="splab__error">{{ col.error }}</p>
        </article>
      </div>
      <div class="splab__columns-toolbar">
        <JvButton variant="ghost" size="sm" :disabled="columns.length >= MAX_COLUMNS" label="+ Add column" @click="addColumn" />
        <span class="jv-spacer" />
        <JvButton variant="primary" size="sm" label="🚀 Run all" @click="runAll" />
      </div>
    </section>

    <!-- ── Side-by-side results ──────────────────────────────────── -->
    <section v-if="dialogueIndices.length" class="jv-section">
      <h3 class="jv-section__title">Results</h3>
      <div class="splab__results-wrap">
        <table class="jv-table splab__results">
          <thead>
            <tr>
              <th>#</th>
              <th>Text</th>
              <th v-for="(col, i) in columns" :key="i">{{ col.label }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="i in dialogueIndices" :key="i">
              <td class="jv-muted">{{ i + 1 }}</td>
              <td class="splab__results-text">{{ columns[0]?.result?.rows?.[i]?.text || "" }}</td>
              <td v-for="(col, colIdx) in columns" :key="colIdx">
                <template v-if="col.result?.rows?.[i]">
                  <span :class="sourceChipClass(col.result.rows[i].source)">{{ col.result.rows[i].source }}</span>
                  <strong :class="{ 'splab__disagree': disagrees(colIdx, i) }">
                    {{ speakerLabel(col.result.rows[i].speaker) }}
                  </strong>
                  <span class="jv-mono jv-muted">{{ (col.result.rows[i].confidence * 100).toFixed(0) }}%</span>
                </template>
                <span v-else class="jv-muted">—</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>

<style scoped>
.splab { padding: 0; display: flex; flex-direction: column; gap: 18px; }
.splab__header { margin-bottom: 4px; }
.splab__title { margin: 0; font-size: 22px; }
.splab__lede { margin: 6px 0 0; font-size: 13px; max-width: 760px; }

.splab__input-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}
.splab__input-select { width: 200px; }

.splab__text {
  width: 100%;
  min-height: 200px;
  font-family: var(--font-serif, Georgia, serif);
  font-size: 13.5px;
  line-height: 1.55;
  resize: vertical;
  padding: 12px 14px;
}

.splab__cast {
  list-style: none;
  margin: 0 0 8px;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.splab__cast li {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  font-size: 12px;
}
.splab__add-cast {
  display: flex;
  gap: 8px;
  align-items: center;
}
.splab__add-cast > input { max-width: 240px; }

.splab__columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}
.splab__column {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
}
.splab__column-h {
  display: flex;
  align-items: center;
  gap: 8px;
}
.splab__column-knobs {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.splab__knob {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.splab__knob > span {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.splab__knob--check {
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.splab__knob--check > span {
  text-transform: none;
  letter-spacing: 0;
  font-size: 12px;
  color: var(--ink-2);
  font-weight: 400;
}
.splab__column-actions { display: flex; padding-top: 6px; border-top: 1px solid var(--border-soft); }
.splab__columns-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 10px;
}

.splab__error {
  margin: 4px 0 0;
  font-size: 11px;
  color: var(--danger);
}

.splab__results-wrap { overflow-x: auto; }
.splab__results { font-size: 12px; min-width: 600px; }
.splab__results-text {
  max-width: 360px;
  white-space: pre-wrap;
  word-break: break-word;
}
.splab__disagree {
  color: var(--warn, var(--accent));
  text-decoration: underline dotted;
}

.splab__chip {
  display: inline-block;
  font-size: 9.5px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--ink-2);
  border: 1px solid var(--border-soft);
  margin-right: 4px;
}
.splab__chip--tag         { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.splab__chip--propagated  { background: var(--accent-soft); color: var(--ink-2); }
.splab__chip--llm         { color: var(--ink-3); }
.splab__chip--floored     { background: var(--warn-bg, var(--surface-2)); color: var(--warn, var(--ink-2)); border-color: var(--warn, var(--border-soft)); }
.splab__chip--narration   { color: var(--muted); border-style: dashed; }
</style>
