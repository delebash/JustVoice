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
import JvToggle from "../components/jv/JvToggle.vue";

const api = useApi();
const tasks = useRenderTasks();

// ── Lab truth surface ────────────────────────────────────────────────
// GET /v1/extraction/config returns the tier registry, the REAL prompt
// bodies, the user template, and the resolved route — so the textareas
// below display exactly what the pipeline sends instead of an empty
// "tier default" placeholder (user redline 2026-06-12: a lab that
// hides its pipeline can't be trusted).
const extractionConfig = ref(null);
const llmProviders = ref([]);
const productionCfg = ref(null); // active speaker_attribution config
const providerModels = reactive({}); // providerId → [model ids]

async function loadLabConfig() {
  try { extractionConfig.value = await api.request("/v1/extraction/config"); } catch { /* server may be older */ }
  try { llmProviders.value = (await api.request("/v1/llm-providers"))?.providers || []; } catch { /* tolerated */ }
  await refreshProductionCfg();
}
async function refreshProductionCfg() {
  try {
    const r = await api.request("/v1/production-configs");
    productionCfg.value = (r?.configs || []).find((c) => c.feature === "speaker_attribution") || null;
  } catch { /* tolerated */ }
}

function tierSpec(name) {
  return extractionConfig.value?.tiers?.find((t) => t.name === name) || null;
}
function defaultSystemFor(tierName) {
  const spec = tierSpec(tierName);
  return extractionConfig.value?.system_prompts?.[spec?.system_key || "guided"] || "";
}
function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

const resolvedProviderName = computed(() => {
  const id = extractionConfig.value?.resolved_provider_id;
  if (!id) return "no provider yet";
  return llmProviders.value.find((p) => p.id === id)?.name || id;
});

function providerById(id) {
  return llmProviders.value.find((p) => p.id === id) || null;
}
function effectiveDefaultModel(col) {
  return providerById(col.providerId)?.default_model
    || extractionConfig.value?.resolved_model
    || "";
}
function effectiveTier(col) {
  return col.tier || col.autoTier || extractionConfig.value?.resolved_tier || "guided";
}
function systemEdited(col) {
  return col.systemPrompt.trim() !== defaultSystemFor(effectiveTier(col)).trim();
}
function userEdited(col) {
  return col.userPrompt.trim() !== (extractionConfig.value?.user_template || "").trim();
}

// Write a tier's REAL prompt + floor into the column (JustWrite's
// applyTier). Overwrites edits by design — switching tier means
// "show me that tier's prompt".
function applyTier(col, tierName) {
  const name = tierName || extractionConfig.value?.resolved_tier || "guided";
  const spec = tierSpec(name);
  col.systemPrompt = defaultSystemFor(name);
  if (spec) col.confidenceFloor = spec.confidence_floor;
}
function setTier(col, tierName) {
  col.tier = tierName; // "" = auto-classify from the model
  if (tierName) applyTier(col, tierName);
  else reclassify(col);
}

// Auto tier: the server's classifier is the source of truth — ask it
// for the column's effective model and reflect its pick.
async function reclassify(col) {
  const model = col.model.trim() || effectiveDefaultModel(col);
  if (!model) {
    col.autoTier = extractionConfig.value?.resolved_tier || null;
    if (!col.tier) applyTier(col, col.autoTier);
    return;
  }
  try {
    const r = await api.request("/v1/llm-providers/classify-tier", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
    });
    col.autoTier = r?.tier || null;
    if (!col.tier && r) {
      col.systemPrompt = extractionConfig.value?.system_prompts?.[r.system_key] || col.systemPrompt;
      col.confidenceFloor = r.confidence_floor;
    }
  } catch { /* keep current prompt */ }
}

async function onProviderChange(col) {
  col.model = "";
  if (col.providerId) loadModelsFor(col.providerId);
  await reclassify(col);
}
async function loadModelsFor(pid) {
  if (!pid || providerModels[pid]) return;
  try {
    const r = await api.request(`/v1/llm-providers/${pid}/models`);
    providerModels[pid] = r?.models || [];
  } catch {
    providerModels[pid] = [];
  }
}

function resetColumn(col) {
  col.providerId = "";
  col.model = "";
  col.temperature = "";
  col.tier = "";
  col.presetName = "";
  col.userPrompt = extractionConfig.value?.user_template || "";
  col.autoTier = extractionConfig.value?.resolved_tier || null;
  applyTier(col, "");
}

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
    autoTier: null,      // server classifier's pick when tier = auto
    providerId: "",      // "" = the feature's resolved route
    model: "",           // "" = the provider's default model
    temperature: "",     // "" = pipeline default (0.2)
    systemPrompt: "",    // populated with the REAL tier body on add
    userPrompt: "",      // populated with the REAL user template on add
    confidenceFloor: 0.7,
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
  resetColumn(columns[columns.length - 1]);
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
    // Prompts ship as overrides only when edited away from the displayed
    // defaults — the defaults already live server-side, so an untouched
    // box and a null are the same prompt. What you see is what runs.
    const body = {
      text: text.value,
      characters: characters.value,
      corrections: [],
      tier: col.tier || null,
      propagate: col.propagate,
      use_floor: col.use_floor,
      provider_id: col.providerId || null,
      model: col.model.trim() || null,
      temperature: col.temperature === "" ? null : Number(col.temperature),
      system_prompt: systemEdited(col) ? col.systemPrompt : null,
      user_prompt: userEdited(col) ? col.userPrompt : null,
      confidence_floor:
        col.use_floor && col.confidenceFloor !== "" && col.confidenceFloor != null
          ? Number(col.confidenceFloor)
          : null,
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
    providerId: col.providerId,
    model: col.model,
    temperature: col.temperature,
    systemPrompt: col.systemPrompt,
    userPrompt: col.userPrompt,
    confidenceFloor: col.confidenceFloor,
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
  if (!name) {
    // "— defaults —" picked: back to the route's resolved configuration.
    const keep = col.presetName;
    resetColumn(col);
    col.presetName = keep;
    return;
  }
  const p = presets.value.find((x) => x.name === name);
  if (!p) return;
  Object.assign(col, p.config);
  // Older presets predate the prompt-truth fields — fill the gaps so
  // the textareas never show stale emptiness.
  if (!col.userPrompt) col.userPrompt = extractionConfig.value?.user_template || "";
  if (!col.systemPrompt) applyTier(col, col.tier);
  if (col.providerId) loadModelsFor(col.providerId);
}

function deletePreset(col) {
  if (!col.presetName) return;
  presets.value = presets.value.filter((p) => p.name !== col.presetName);
  persistPresets();
  col.presetName = "";
}

async function useAsProduction(col) {
  // The column's own provider pick wins; otherwise reuse the feature's
  // current route (pin) provider.
  let providerId = col.providerId || extractionConfig.value?.resolved_provider_id || null;
  let pinModel = "";
  if (!providerId) {
    try {
      const pins = await api.request("/v1/feature-pins");
      const current = (pins?.pins || []).find((p) => p.feature === "speaker_attribution");
      providerId = current?.provider_id || null;
      pinModel = current?.model || "";
    } catch { /* fall through to the warning below */ }
  }
  if (!providerId) {
    pushToast({
      message: "No LLM provider available — add one in Engines → LLM first.",
      kind: "warning",
      duration: 7000,
    });
    return;
  }
  const model = col.model.trim() || effectiveDefaultModel(col) || pinModel;
  const hasPrompts = systemEdited(col) || userEdited(col);
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
        name: col.presetName || `${model}${col.tier ? `-${col.tier}` : ""} · lab`,
        provider_id: providerId,
        model,
        tier: col.tier || null,
        temperature: col.temperature === "" ? null : Number(col.temperature),
        system_prompt: systemEdited(col) ? col.systemPrompt : null,
        user_prompt: userEdited(col) ? col.userPrompt : null,
        source: "speaker_lab",
      }),
    });
    // Keep the pin in sync for older consumers.
    await api.request("/v1/feature-pins", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        feature: "speaker_attribution",
        provider_id: providerId,
        model,
        tier: col.tier || null,
      }),
    }).catch(() => {});
    await refreshProductionCfg();
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

onMounted(async () => {
  loadProjects();
  // Config first, so the first column's prompt boxes show the real
  // bodies from the start.
  await loadLabConfig();
  if (!columns.length) addColumn(); // ONE column by default
  else columns.forEach((c) => { if (!c.systemPrompt) resetColumn(c); });
});
</script>

<template>
  <div class="splab">
    <!-- Tab title + explainer lede live in LabsView (one mechanism for
         all five labs) — no per-view header here. -->

    <!-- ── Input pane (carded — JustWrite's INPUT PASSAGE shape) ───── -->
    <section class="jv-card jv-pane-card">
      <div class="jv-pane-card__h">
        <span class="jv-eyebrow">Input passage</span>
        <span class="jv-spacer" />
        <span class="jv-muted splab__stats">{{ inputStats || "Paste a few chapters, or load one from a project." }}</span>
      </div>
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
      </div>
      <textarea
        v-model="text"
        class="jv-input jv-input--full splab__text"
        placeholder="Paste manuscript text here, or load a chapter above…"
      />
    </section>

    <!-- ── Cast pane (carded to match) ─────────────────────────────── -->
    <section class="jv-card jv-pane-card">
      <div class="jv-pane-card__h">
        <span class="jv-eyebrow">Cast</span>
        <span class="jv-spacer" />
        <span class="jv-muted splab__stats">{{ characters.length ? `${characters.length} character${characters.length === 1 ? "" : "s"}` : "empty" }}</span>
      </div>
      <p class="jv-muted jv-pane-card__hint">
        The model only attributes dialogue to ids on this list (rule 2 of the system prompt below) —
        add everyone who speaks in the passage. ✨ Sample fills the passage and this cast together.
      </p>
      <ul v-if="characters.length" class="splab__cast">
        <li v-for="(c, i) in characters" :key="c.id">
          <strong>{{ c.name }}</strong>
          <span v-if="c.aliases.length" class="jv-muted">aliases: {{ c.aliases.join(", ") }}</span>
          <button type="button" class="jv-btn jv-btn--ghost jv-btn--sm" title="Remove from cast" @click="removeCharacter(i)">✕</button>
        </li>
      </ul>
      <div class="splab__add-cast">
        <input v-model="newCharName" class="jv-input jv-w-name" placeholder="Character name" @keydown.enter="addCharacter" />
        <input v-model="newCharAliases" class="jv-input jv-w-name" placeholder="Aliases (comma-separated, optional)" @keydown.enter="addCharacter" />
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

          <!-- Presets row — JustWrite Speaker Lab parity: dropdown,
               PRODUCTION badge, promote/save actions on one line. -->
          <div class="splab__presets">
            <span class="jv-eyebrow">Presets</span>
            <select :value="col.presetName" class="jv-input jv-input--sm jv-w-name" title="Load a saved configuration" @change="loadPreset(col, $event.target.value)">
              <option value="">— defaults —</option>
              <option v-for="p in presets" :key="p.name" :value="p.name">{{ p.name }}</option>
            </select>
            <JvButton v-if="col.presetName" variant="ghost" size="sm" label="🗑" title="Delete this preset" @click="deletePreset(col)" />
            <span
              v-if="productionCfg"
              class="jv-pill jv-pill--green splab__prod"
              :title="`Studio · Script currently runs '${productionCfg.name}' (${productionCfg.model || 'route default'}). Revert in Settings → AI features.`"
            >✓ PRODUCTION · {{ productionCfg.name }}</span>
            <span class="jv-spacer" />
            <JvButton variant="secondary" size="sm" label="✓ Use as production" title="Freeze this column — model AND prompts — as Studio · Script's attribution method" @click="useAsProduction(col)" />
            <JvButton variant="secondary" size="sm" label="＋ Save as" title="Save this column's tweaks as a named preset" @click="savePreset(col)" />
          </div>

          <!-- Pipeline explainer (JustWrite parity banner) -->
          <div class="jv-banner splab__pipeline-note">
            Splits each paragraph into segments on double-quote marks (deterministic, no LLM).
            Narration outside quotes auto-attributes to the narrator; the model only attributes
            the dialogue segments. Cast: {{ characters.length }}.
            <br />
            <strong>Tier:</strong> <strong>Guided</strong> = strict rules + worked examples, for sub-12B models ·
            <strong>Direct</strong> = strict rules only, no thinking — for 12B-class non-reasoning models ·
            <strong>Reasoned</strong> = the Direct rules + reasoning enabled, for hybrid models (Qwen3 14B+).
            Auto-picked from the selected model; override if you know better.
          </div>

          <!-- Route row: provider + model + temp + reset -->
          <div class="splab__knobrow">
            <select
              v-model="col.providerId"
              class="jv-input jv-input--sm jv-w-name"
              title="Route this run through a specific LLM provider"
              @change="onProviderChange(col)"
            >
              <option value="">Route default — {{ resolvedProviderName }}</option>
              <option v-for="p in llmProviders" :key="p.id" :value="p.id">{{ p.name }}</option>
            </select>
            <input
              v-model="col.model"
              :list="`splab-models-${i}`"
              class="jv-input jv-input--sm jv-w-name splab__model"
              :placeholder="`(provider default — ${effectiveDefaultModel(col) || 'none'})`"
              title="Override the provider's default model; the tier re-derives from it"
              @change="reclassify(col)"
            />
            <datalist :id="`splab-models-${i}`">
              <option v-for="m in providerModels[col.providerId] || []" :key="m" :value="m" />
            </datalist>
            <label class="splab__knob splab__knob--inline">
              <span>temp</span>
              <input v-model="col.temperature" class="jv-input jv-input--sm splab__temp" placeholder="0.2" title="Sampling temperature" />
            </label>
            <span class="jv-spacer" />
            <JvButton variant="ghost" size="sm" label="↺ Reset" title="Back to the route's resolved configuration — provider, model, tier, prompts, floor" @click="resetColumn(col)" />
          </div>

          <!-- Tier segmented + toggles + floor value -->
          <div class="splab__column-knobs">
            <span class="jv-eyebrow">Tier</span>
            <div class="splab__tierseg">
              <button
                type="button"
                class="jv-pill"
                :class="col.tier === '' ? 'jv-pill--solid' : 'jv-pill--ghost'"
                title="Classify from the selected model"
                @click="setTier(col, '')"
              >Auto{{ col.tier === '' && col.autoTier ? ` → ${cap(col.autoTier)}` : '' }}</button>
              <button
                v-for="t in extractionConfig?.tiers || []"
                :key="t.name"
                type="button"
                class="jv-pill"
                :class="col.tier === t.name ? 'jv-pill--solid' : 'jv-pill--ghost'"
                :title="`floor ${t.confidence_floor}${t.think ? ' · reasoning on' : ''}`"
                @click="setTier(col, t.name)"
              >{{ t.label }}</button>
            </div>
            <span class="splab__knob" title="Pre-LLM: 'Tom said' anchors the adjacent quote at confidence 1.0">
              <JvToggle v-model="col.propagate" aria-label="Anchor propagation" />
              <span>Anchor propagation (pre-LLM)</span>
            </span>
            <span class="splab__knob" title="Demote LLM picks below the floor to 'unknown'">
              <JvToggle v-model="col.use_floor" aria-label="Confidence floor" />
              <span>Confidence floor</span>
              <input
                v-model="col.confidenceFloor"
                class="jv-input jv-input--sm splab__floor"
                :disabled="!col.use_floor"
                title="0–1 · below this, picks demote to 'unknown'"
              />
            </span>
          </div>

          <!-- System prompt — shows the REAL body the pipeline sends -->
          <div class="splab__prompt">
            <span class="jv-eyebrow jv-eyebrow--row">
              System prompt
              <em class="jv-muted">— exactly what the model receives; resolved from the tier</em>
              <template v-if="systemEdited(col)">
                <span class="jv-pill jv-pill--ghost splab__edited">edited</span>
                <button type="button" class="jv-btn jv-btn--ghost jv-btn--sm" title="Restore this tier's default body" @click="applyTier(col, col.tier)">↺ Tier default</button>
              </template>
            </span>
            <textarea v-model="col.systemPrompt" class="jv-input jv-input--full splab__prompt-text" />
          </div>

          <!-- User prompt — the template; tokens fill in server-side -->
          <div class="splab__prompt">
            <span class="jv-eyebrow jv-eyebrow--row">
              User prompt
              <em class="jv-muted">— template · <code>{characters}</code>, <code>{corrections}</code>, <code>{paragraphs}</code> fill in server-side</em>
              <template v-if="userEdited(col)">
                <span class="jv-pill jv-pill--ghost splab__edited">edited</span>
                <button type="button" class="jv-btn jv-btn--ghost jv-btn--sm" title="Restore the default template" @click="col.userPrompt = extractionConfig?.user_template || ''">↺ Default</button>
              </template>
            </span>
            <textarea v-model="col.userPrompt" class="jv-input jv-input--full splab__prompt-text splab__prompt-text--user" />
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

.splab__input-toolbar { display: flex; align-items: center; gap: 8px; }
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


.splab__presets { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.splab__prod { font-size: 10px; white-space: nowrap; }
.splab__pipeline-note { font-size: 12px; line-height: 1.6; }
.splab__knobrow { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.splab__model { font-family: var(--font-mono); font-size: 12px; }
.splab__temp { width: 64px; font-family: var(--font-mono); font-size: 12px; }
.splab__column-knobs { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.splab__tierseg { display: inline-flex; gap: 4px; }
.splab__tierseg .jv-pill { cursor: pointer; border: 0; font: inherit; font-size: 11.5px; }
.splab__knob { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.splab__knob--inline span { font-size: 11px; color: var(--ink-3); }
.splab__floor { width: var(--w-token); font-family: var(--font-mono); font-size: 12px; }
.splab__edited { font-size: 9px; }

.splab__prompt { display: flex; flex-direction: column; gap: 4px; }
.splab__prompt-text {
  width: 100%;
  min-height: 150px;
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.6;
  resize: vertical;
  padding: 8px 11px;
}
.splab__prompt-text--user { min-height: 90px; }

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
