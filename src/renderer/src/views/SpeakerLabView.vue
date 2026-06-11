<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  SpeakerLabView — speaker-extraction testbed (design v5, mock #splab/1).

  One column by default — a complete run config (model override, temp,
  tier, anchor propagation, confidence floor, editable system prompt)
  with its own results filling in beneath it (Raw / Parsed tabs).
  "＋ Add column" races a second config against the same input; no
  Run-all — each column runs itself. Presets save/load locally;
  "Use as production" writes the speaker_attribution feature pin so
  Studio · Script uses the tuned combination from then on.

  Calls the same backend Studio Script uses (/v1/extraction/analyze-text)
  so the lab and production can't drift (CONCEPTS §16).
-->
<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";
import { promptDialog, confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";

const api = useApi();
const tasks = useRenderTasks();

const text = ref("");
const characters = ref([]);  // [{id, name, aliases}]
const newCharName = ref("");
const newCharAliases = ref("");
const projects = ref([]);
const scenes = ref([]);
const loadingScene = ref(false);
const selectedProjectId = ref(null);
const selectedSceneId = ref(null);

const columns = reactive([]);
const MAX_COLUMNS = 4;

const PRESETS_KEY = "jv.splab.presets";
const presets = ref([]);  // [{name, config}]
try { presets.value = JSON.parse(localStorage.getItem(PRESETS_KEY) || "[]"); } catch { presets.value = []; }
function persistPresets() {
  try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets.value)); } catch { /* ignore */ }
}

const SAMPLE_TEXT = `Mara stood at the rail. The fog clawed at her ankles.

"Where are you going?" Sarah asked.

"Down," Mara said. "There's something in the cellar."

Sarah didn't move. "Are you sure?"

"No."`;

const SAMPLE_CAST = [
  { id: "c_mara", name: "Mara", aliases: [] },
  { id: "c_sarah", name: "Sarah", aliases: [] },
];

const inputStats = computed(() => {
  const t = text.value;
  if (!t.trim()) return "";
  const words = t.trim().split(/\s+/).length;
  return `${words.toLocaleString()} words · ${t.length.toLocaleString()} chars · ~${Math.round(t.length / 4).toLocaleString()} tokens`;
});

function newColumn() {
  const tag = String.fromCharCode(65 + columns.length);
  return {
    label: `Run ${tag}`,
    tier: "",            // "" = auto-classify from the model
    model: "",           // "" = the feature pin's model
    temperature: "",     // "" = pipeline default (0.2)
    systemPrompt: "",    // "" = tier default body
    propagate: true,
    use_floor: true,
    busy: false,
    result: null,
    error: null,
    outTab: "parsed",   // "raw" | "parsed"
    presetName: "",
  };
}
function addColumn() {
  if (columns.length >= MAX_COLUMNS) return;
  columns.push(newColumn());
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
    const r = await api.safeRequest(`/v1/projects/${selectedProjectId.value}/scenes`, []);
    scenes.value = Array.isArray(r) ? r : r?.scenes || [];
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
  const ctrl = new AbortController();
  const wordCount = text.value.trim().split(/\s+/).length;
  const task = tasks.start({
    kind: "extract",
    feature: "speaker_attribution",
    label: `Speaker Lab · ${col.label}`,
    onCancel: () => ctrl.abort(),
    onRetry: () => runColumn(col),
    statsFn: (t) => {
      const out = [`${wordCount} words in`];
      if (t.meta?.rows != null) out.push(`${t.meta.rows} segments`);
      if (t.meta?.tier) out.push(`${t.meta.tier} tier`);
      return out;
    },
  });
  try {
    const body = {
      text: text.value,
      characters: characters.value,
      corrections: [],
      tier: col.tier || null,
      propagate: col.propagate,
      use_floor: col.use_floor,
      model: col.model.trim() || null,
      temperature: col.temperature === "" ? null : Number(col.temperature),
      system_prompt: col.systemPrompt.trim() || null,
    };
    const r = await api.request("/v1/extraction/analyze-text", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    col.result = r;
    tasks.update(task.id, { meta: { rows: r?.rows?.length || 0, tier: r?.tier_used } });
    tasks.finish(task.id);
  } catch (e) {
    if (ctrl.signal.aborted) {
      col.error = "Cancelled.";
    } else {
      col.error = e?.message || String(e);
      if (col.error.includes("501")) {
        col.error += " (wire an LLM provider in Engines → LLM tab)";
      }
      tasks.fail(task.id, col.error);
    }
  } finally {
    col.busy = false;
  }
}

// ── Presets — save / load locally; promote writes the feature pin. ──

function columnConfig(col) {
  return {
    tier: col.tier,
    model: col.model,
    temperature: col.temperature,
    systemPrompt: col.systemPrompt,
    propagate: col.propagate,
    use_floor: col.use_floor,
  };
}

async function savePreset(col) {
  const name = await promptDialog({
    title: "Save tweaks as preset",
    message: "Name this configuration — it appears in every column's preset picker.",
    placeholder: "e.g. qwen14b · tight floor",
  });
  if (!name) return;
  presets.value = [
    ...presets.value.filter((p) => p.name !== name),
    { name, config: columnConfig(col) },
  ];
  persistPresets();
  col.presetName = name;
  pushToast({ message: `Preset "${name}" saved.`, kind: "success", duration: 2500 });
}

function loadPreset(col, name) {
  col.presetName = name;
  const p = presets.value.find((x) => x.name === name);
  if (!p) return;
  Object.assign(col, p.config);
}

function deletePreset(col) {
  if (!col.presetName) return;
  presets.value = presets.value.filter((p) => p.name !== col.presetName);
  persistPresets();
  col.presetName = "";
}

async function useAsProduction(col) {
  // Pinning needs a provider; reuse the existing speaker_attribution pin's
  // provider (the lab tunes model/tier on top of it).
  let pins;
  try {
    pins = await api.request("/v1/feature-pins");
  } catch (e) {
    pushToast({ message: `Couldn't read feature pins: ${e?.message || e}`, kind: "error" });
    return;
  }
  const current = (pins?.pins || []).find((p) => p.feature === "speaker_attribution");
  if (!current) {
    pushToast({
      message: "No LLM provider pinned yet — add one in Engines → LLM, pin it to speaker_attribution in Settings → AI Features, then promote.",
      kind: "warning",
      duration: 7000,
    });
    return;
  }
  const model = col.model.trim() || current.model;
  const hasPrompts = !!(col.systemPrompt.trim() || col.userPrompt?.trim?.());
  const ok = await confirmDialog({
    title: "Use as production?",
    message: `Studio · Script will run speaker extraction EXACTLY as this column: ${model}${col.tier ? ` (${col.tier} tier)` : " (auto tier)"}${hasPrompts ? " with this column's prompts" : ""}. Revert anytime in Settings → AI features.`,
    confirmLabel: "Use as production",
  });
  if (!ok) return;
  try {
    // Full freeze — model AND prompts (engines redesign: production
    // configs beat pins/roles; Settings → AI features shows + reverts it).
    await api.request("/v1/production-configs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: "speaker_attribution",
        name: `${model}${col.tier ? `-${col.tier}` : ""} · lab`,
        provider_id: current.provider_id,
        model,
        tier: col.tier || null,
        temperature: col.temperature ?? null,
        system_prompt: col.systemPrompt?.trim() || null,
        user_prompt: col.userPrompt?.trim?.() || null,
        source: "speaker_lab",
      }),
    });
    // Keep the pin in sync for older consumers.
    await api.request("/v1/feature-pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: "speaker_attribution",
        provider_id: current.provider_id,
        model,
        tier: col.tier || null,
      }),
    }).catch(() => {});
    pushToast({ message: `Production config saved — ${model}${hasPrompts ? " + prompts" : ""}. Manage it in Settings → AI features.`, kind: "success", duration: 5000 });
  } catch (e) {
    pushToast({ message: `Promote failed: ${e?.message || e}`, kind: "error" });
  }
}

// ── Result rendering helpers ─────────────────────────────────────────

function disagrees(colIdx, rowIdx) {
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

onMounted(() => {
  loadProjects();
  if (!columns.length) addColumn();  // ONE column by default
});
</script>

<template>
  <div class="splab">
    <header class="splab__header">
      <h2 class="splab__title">Speaker Lab</h2>
      <p class="jv-muted splab__lede">
        Speaker-extraction testbed. Paste any text — chapters optional — then tune the
        run: model, temperature, tier, floors, and the system prompt. Add a column to
        race a second configuration on the same input. Same backend as Studio · Script.
      </p>
    </header>

    <!-- ── Input pane ─────────────────────────────────────────────── -->
    <section class="jv-section">
      <div class="splab__input-toolbar">
        <select v-model="selectedProjectId" class="jv-input splab__input-select" title="Optional — load a chapter from a project" @change="loadScenes">
          <option :value="null">Load from chapter…</option>
          <option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
        <select v-if="selectedProjectId" v-model="selectedSceneId" class="jv-input splab__input-select" @change="loadSceneText">
          <option :value="null">— pick a chapter —</option>
          <option v-for="s in scenes" :key="s.id" :value="s.id">{{ s.title || `Scene ${s.position + 1}` }}</option>
        </select>
        <JvButton variant="ghost" size="sm" label="✕ Clear" title="Clear the text box" @click="text = ''" />
        <JvButton variant="secondary" size="sm" label="✨ Sample" title="Load a small sample passage + cast" @click="loadSample" />
        <span class="jv-spacer" />
        <span class="jv-muted splab__stats">{{ inputStats }}</span>
      </div>
      <textarea
        v-model="text"
        class="jv-input jv-input--full splab__text"
        placeholder="Paste manuscript text here, or load a chapter above…"
      />
    </section>

    <!-- ── Cast pane ──────────────────────────────────────────────── -->
    <section class="jv-section">
      <h3 class="jv-section__title">Cast</h3>
      <ul v-if="characters.length" class="splab__cast">
        <li v-for="(c, i) in characters" :key="c.id">
          <strong>{{ c.name }}</strong>
          <span v-if="c.aliases.length" class="jv-muted">aliases: {{ c.aliases.join(", ") }}</span>
          <button type="button" class="jv-btn jv-btn--ghost jv-btn--sm" title="Remove from cast" @click="removeCharacter(i)">✕</button>
        </li>
      </ul>
      <div class="splab__add-cast">
        <input v-model="newCharName" class="jv-input" placeholder="Character name" @keydown.enter="addCharacter" />
        <input v-model="newCharAliases" class="jv-input" placeholder="Aliases (comma-separated, optional)" @keydown.enter="addCharacter" />
        <JvButton variant="ghost" size="sm" label="＋ Add" @click="addCharacter" />
      </div>
    </section>

    <!-- ── Columns (one by default) ──────────────────────────────── -->
    <section class="jv-section">
      <div class="splab__columns-toolbar">
        <JvButton variant="secondary" size="sm" :disabled="columns.length >= MAX_COLUMNS" label="＋ Add column" title="Race another configuration on the same input" @click="addColumn" />
      </div>
      <div class="splab__columns" :class="{ 'splab__columns--single': columns.length === 1 }">
        <article v-for="(col, i) in columns" :key="i" class="jv-card splab__column">
          <header class="splab__column-h">
            <input v-model="col.label" class="jv-input jv-input--sm splab__column-name" title="Run name" />
            <span class="jv-spacer" />
            <JvButton variant="primary" size="sm" :loading="col.busy" :disabled="col.busy" label="▶ Run" @click="runColumn(col)" />
            <button v-if="columns.length > 1" type="button" class="jv-btn jv-btn--ghost jv-btn--sm" title="Remove this column" @click="removeColumn(i)">🗑 Delete column</button>
          </header>

          <!-- Presets row -->
          <div class="splab__presets">
            <span class="splab__eyebrow">Presets</span>
            <select :value="col.presetName" class="jv-input jv-input--sm" title="Load a saved configuration" @change="loadPreset(col, $event.target.value)">
              <option value="">— defaults —</option>
              <option v-for="p in presets" :key="p.name" :value="p.name">{{ p.name }}</option>
            </select>
            <JvButton variant="ghost" size="sm" label="＋ Save as" title="Save this column's tweaks as a named preset" @click="savePreset(col)" />
            <JvButton v-if="col.presetName" variant="ghost" size="sm" label="🗑" title="Delete this preset" @click="deletePreset(col)" />
            <span class="jv-spacer" />
            <JvButton variant="secondary" size="sm" label="✓ Use as production" title="Pin this model + tier as Studio · Script's attribution method" @click="useAsProduction(col)" />
          </div>

          <!-- Engine row: model + temp -->
          <div class="splab__knobrow">
            <input v-model="col.model" class="jv-input jv-input--sm splab__model" placeholder="model — pin default (e.g. qwen3:14b)" title="Override the pinned model; tier auto-derives from it" />
            <label class="splab__knob splab__knob--inline">
              <span>temp</span>
              <input v-model="col.temperature" class="jv-input jv-input--sm splab__temp" placeholder="0.2" title="Sampling temperature" />
            </label>
          </div>

          <!-- Tier + toggles -->
          <div class="splab__column-knobs">
            <label class="splab__knob">
              <span>Tier</span>
              <select v-model="col.tier" class="jv-input jv-input--sm" title="auto = classify from the model id">
                <option value="">auto</option>
                <option value="guided">guided</option>
                <option value="direct">direct</option>
                <option value="reasoned">reasoned</option>
              </select>
            </label>
            <label class="splab__knob splab__knob--check" title="Pre-LLM: 'Tom said' anchors the adjacent quote at confidence 1.0">
              <input type="checkbox" v-model="col.propagate" />
              <span>Anchor propagation (pre-LLM)</span>
            </label>
            <label class="splab__knob splab__knob--check" title="Demote below-floor LLM picks to 'unknown'">
              <input type="checkbox" v-model="col.use_floor" />
              <span>Confidence floor</span>
            </label>
          </div>

          <!-- System prompt -->
          <div class="splab__prompt">
            <span class="splab__eyebrow">System prompt <em class="jv-muted">— empty = tier default · user prompt is templated server-side (&#123;&#123;characters&#125;&#125;, &#123;&#123;paragraphs&#125;&#125;)</em></span>
            <textarea
              v-model="col.systemPrompt"
              class="jv-input jv-input--full splab__prompt-text"
              placeholder="Leave empty to use the tier's default prompt body — or paste a tweak here…"
            />
          </div>

          <p v-if="col.error" class="splab__error">{{ col.error }}</p>

          <!-- Results — Raw / Parsed under THIS column -->
          <div v-if="col.result" class="splab__out">
            <div class="splab__out-tabs">
              <button type="button" class="jv-pill" :class="col.outTab === 'raw' ? 'jv-pill--solid' : 'jv-pill--ghost'" @click="col.outTab = 'raw'">Raw</button>
              <button type="button" class="jv-pill" :class="col.outTab === 'parsed' ? 'jv-pill--solid' : 'jv-pill--ghost'" @click="col.outTab = 'parsed'">Parsed ({{ col.result.rows?.length || 0 }})</button>
              <span class="jv-spacer" />
              <span class="jv-muted splab__out-meta">{{ col.result.tier_used }} tier · floor {{ col.result.confidence_floor }}</span>
            </div>
            <pre v-if="col.outTab === 'raw'" class="splab__raw">{{ col.result.raw_llm || "(no LLM call — anchors/narration only)" }}</pre>
            <div v-else class="splab__parsed">
              <div v-for="(row, ri) in col.result.rows" :key="ri" class="splab__parsed-row">
                <span class="jv-mono jv-muted splab__parsed-n">{{ ri + 1 }}</span>
                <span class="splab__parsed-who">
                  <strong :class="{ splab__disagree: disagrees(i, ri) }">{{ speakerLabel(row.speaker) }}</strong>
                  <span :class="sourceChipClass(row.source)">{{ row.source }}</span>
                  <span class="jv-mono jv-muted">{{ (row.confidence * 100).toFixed(0) }}%</span>
                </span>
                <span class="splab__parsed-text">{{ row.text }}</span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  </div>
</template>

<style scoped>
.splab { padding: 0; display: flex; flex-direction: column; gap: 18px; }
.splab__header { margin-bottom: 4px; }
.splab__title { margin: 0; font-size: 22px; }
.splab__lede { margin: 6px 0 0; font-size: 13px; max-width: 820px; }

.splab__input-toolbar { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.splab__input-select { width: var(--w-name); }
.splab__stats { font-size: 11.5px; }

.splab__text {
  width: 100%;
  min-height: 180px;
  font-family: var(--font-serif, Georgia, serif);
  font-size: 13.5px;
  line-height: 1.7;
  resize: vertical;
  padding: 12px 14px;
}

.splab__cast { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.splab__cast li {
  display: inline-flex; align-items: center; gap: 8px;
  border: 1px solid var(--line); border-radius: 999px;
  padding: 3px 6px 3px 12px; font-size: 12.5px; background: var(--surface);
}
.splab__add-cast { display: flex; gap: 8px; max-width: 640px; }

.splab__columns-toolbar { display: flex; margin-bottom: 10px; }
.splab__columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(420px, 1fr)); gap: 12px; }
.splab__columns--single { grid-template-columns: 1fr; }
.splab__column { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; }
.splab__column-h { display: flex; align-items: center; gap: 8px; }
.splab__column-name { max-width: 150px; font-weight: 600; }

.splab__eyebrow {
  font-size: 10px; font-weight: 700; letter-spacing: 0.06em;
  text-transform: uppercase; color: var(--ink-3); flex: none;
}
.splab__eyebrow em { text-transform: none; letter-spacing: 0; font-weight: 400; font-style: normal; }

.splab__presets { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.splab__knobrow { display: flex; align-items: center; gap: 10px; }
.splab__model { flex: 1; font-family: var(--font-mono); font-size: 12px; }
.splab__temp { width: 64px; font-family: var(--font-mono); font-size: 12px; }
.splab__column-knobs { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.splab__knob { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.splab__knob--check { cursor: pointer; }
.splab__knob--inline span { font-size: 11px; color: var(--ink-3); }

.splab__prompt { display: flex; flex-direction: column; gap: 4px; }
.splab__prompt-text {
  width: 100%;
  min-height: 120px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  resize: vertical;
  padding: 8px 11px;
}

.splab__error {
  margin: 0; font-size: 12px; color: var(--danger-ink, #7a2f1f);
  background: var(--danger-bg, #fbecea); border: 1px solid var(--danger-line, #e3b6ac);
  border-radius: 6px; padding: 7px 10px;
}

.splab__out { display: flex; flex-direction: column; gap: 8px; }
.splab__out-tabs { display: flex; align-items: center; gap: 6px; }
.splab__out-tabs .jv-pill { cursor: pointer; border: 0; font: inherit; font-size: 11.5px; }
.splab__out-meta { font-size: 11px; }
.splab__raw {
  margin: 0; background: #23272b; color: #d6dde3; border-radius: 8px;
  padding: 12px 14px; font-size: 11.5px; line-height: 1.65;
  white-space: pre-wrap; word-break: break-word;
  max-height: 420px; overflow-y: auto;
}
.splab__parsed { border: 1px solid var(--line); border-radius: 8px; max-height: 420px; overflow-y: auto; }
.splab__parsed-row {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 8px 12px; border-bottom: 1px dashed var(--line); font-size: 12.5px;
}
.splab__parsed-row:last-child { border-bottom: 0; }
.splab__parsed-n { flex: none; width: 18px; font-size: 10.5px; padding-top: 2px; }
.splab__parsed-who { flex: none; width: 190px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.splab__parsed-text { flex: 1; color: var(--ink-2); line-height: 1.5; }

.splab__chip {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.04em; text-transform: uppercase;
  border: 1px solid var(--line-strong); border-radius: 4px; padding: 0 5px;
  color: var(--ink-3); background: var(--surface);
}
.splab__chip--tag        { background: var(--accent-soft); color: var(--accent-ink); border-color: var(--accent-line); }
.splab__chip--propagated { background: var(--surface-2); }
.splab__chip--llm        { background: var(--info-soft, #eaf2fa); color: var(--info-blue, #2f74b5); border-color: var(--info-blue, #2f74b5); }
.splab__chip--narration  { border-style: dashed; }
.splab__chip--floored    { background: var(--warn-bg, var(--surface-2)); color: var(--warn-ink, var(--ink-2)); border-color: var(--warn-line, var(--border-soft)); }

.splab__disagree { color: var(--danger, #a8442e); text-decoration: underline wavy; text-underline-offset: 3px; }
</style>
