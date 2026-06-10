<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  StudioView — multi-character production environment for the
  audiobook + podcast + game use cases. Three-tab Cast → Script →
  Render flow ported in shape from JustWrite's StudioView.vue.

  Terminology adapts via useCopy():
    audiobook → Cast / Chapter / Render
    podcast   → Hosts / Episode / Render
    game      → NPCs / Quest / Render

  Phase 4 / Slice 1 — shell + Cast tab + VoiceParamsModal.
  Phase 4 / Slice 2 — Script tab + analyze + Smart-assign.
  Phase 6      — Render tab (Studio Render slice).
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { useCopy } from "../services/copy.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import VoiceParamsModal from "../components/VoiceParamsModal.vue";

const api = useApi();
const copy = useCopy();

const projects = ref([]);
const selectedProjectId = ref(null);
const personas = ref([]);
const voices = ref([]);
const engines = ref([]);
const tab = ref("cast");
const loading = ref(false);

const selectedCharacterId = ref(null);
const voiceParamsModalOpen = ref(false);
const tuningVoice = ref(null);  // {voiceId, name, params}
const smartAssignBusy = ref(false);

// Script tab state (Phase 4 / Slice 2)
const scenes = ref([]);
const selectedSceneId = ref(null);
const sceneText = ref("");
const analyzeBusy = ref(false);
const analyzeRows = ref([]);
const analyzeTierUsed = ref(null);
const analyzeFloor = ref(null);
const editedFlags = ref({});  // {rowIdx: true} for rows the user changed

// Render tab state (Phase 6 / Slice 1)
const renderPresets = ref([]);
const scenePresetSelections = ref({});  // {sceneId: presetId}
const sceneSelectedForRender = ref({});  // {sceneId: bool}
const renderBusyScene = ref(null);
const suggestBusyScene = ref(null);
const sceneBlockCounts = ref({});  // {sceneId: count of blocks}

// Adapt the tab labels to the project's use case via useCopy.
const TAB_LABELS = computed(() => ({
  cast:   copy.value.cast.singular === "NPC" ? "NPCs" : (copy.value.cast.plural || "Cast"),
  script: "Script",
  render: "Render",
}));

const selectedProject = computed(() =>
  projects.value.find((p) => p.id === selectedProjectId.value) || null,
);

const projectOptions = computed(() => {
  if (!projects.value.length) return [{ label: "— no projects —", value: null }];
  return projects.value.map((p) => ({ label: p.name, value: p.id }));
});

// Personas bound to the selected project via ProjectPersona m2m.
const projectPersonas = ref([]);

const narratorPersona = computed(() =>
  projectPersonas.value.find((p) => /^narrator$/i.test(p.name || "")) || null,
);
const characterPersonas = computed(() =>
  projectPersonas.value.filter((p) => p.id !== narratorPersona.value?.id),
);

const selectedCharacter = computed(() =>
  characterPersonas.value.find((p) => p.id === selectedCharacterId.value) || null,
);

const voiceLibraryByEngine = computed(() => {
  const out = {};
  for (const v of voices.value) {
    const k = v.engine || "other";
    (out[k] = out[k] || []).push(v);
  }
  return out;
});

async function loadAll() {
  loading.value = true;
  try {
    const [pr, p, v, e] = await Promise.all([
      api.safeRequest("/v1/projects", { projects: [] }),
      api.safeRequest("/v1/personas", { personas: [] }),
      api.safeRequest("/v1/voices", { voices: [] }),
      api.safeRequest("/v1/engines", { engines: [] }),
    ]);
    projects.value = pr?.projects ?? [];
    personas.value = p?.personas ?? [];
    voices.value = v?.voices ?? [];
    engines.value = e?.engines ?? [];
    // Default to the first audiobook/game/podcast project.
    if (!selectedProjectId.value && projects.value.length) {
      const first = projects.value.find(
        (p) => ["audiobook", "game_voicelines", "podcast"].includes(p.project_type),
      ) || projects.value[0];
      selectedProjectId.value = first.id;
    }
  } finally {
    loading.value = false;
  }
}

async function loadProjectPersonas(projectId) {
  if (!projectId) {
    projectPersonas.value = [];
    return;
  }
  try {
    const r = await api.safeRequest(`/v1/projects/${projectId}/cast`, { cast: [] });
    const castEntries = r?.cast || [];
    const ids = new Set(castEntries.map((c) => c.persona_id));
    projectPersonas.value = personas.value.filter((p) => ids.has(p.id));
  } catch {
    projectPersonas.value = [];
  }
}

watch(selectedProjectId, (id) => {
  loadProjectPersonas(id);
  loadScenesForProject(id);
}, { immediate: true });
watch(personas, () => loadProjectPersonas(selectedProjectId.value));

async function loadScenesForProject(projectId) {
  if (!projectId) {
    scenes.value = [];
    selectedSceneId.value = null;
    return;
  }
  try {
    const r = await api.safeRequest(`/v1/projects/${projectId}/scenes`, { scenes: [] });
    scenes.value = r?.scenes || [];
    if (!selectedSceneId.value && scenes.value.length) {
      selectedSceneId.value = scenes.value[0].id;
    }
    // Eager-fetch per-scene block counts for the Render tab's
    // "Select all unrendered" affordance.
    sceneBlockCounts.value = {};
    await Promise.all(
      scenes.value.map(async (s) => {
        try {
          const blocks = await api.safeRequest(`/v1/scenes/${s.id}/blocks`, []);
          const list = Array.isArray(blocks) ? blocks : blocks?.blocks ?? [];
          sceneBlockCounts.value = { ...sceneBlockCounts.value, [s.id]: list.length };
        } catch { /* tolerated */ }
      }),
    );
    // Load render presets — global + project-scoped.
    const presets = await api.safeRequest(`/v1/presets`, { presets: [] });
    renderPresets.value = (presets?.presets || []).filter(
      (p) => !p.project_id || p.project_id === projectId,
    );
  } catch {
    scenes.value = [];
  }
}

function presetOptions() {
  return [
    { label: "— none —", value: "" },
    ...renderPresets.value.map((p) => ({ label: p.name, value: p.id })),
  ];
}

async function suggestPresetFor(scene) {
  suggestBusyScene.value = scene.id;
  try {
    const r = await api.request(`/v1/llm/preset-suggest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ scene_id: scene.id }),
    });
    if (r?.preset_id) {
      scenePresetSelections.value = { ...scenePresetSelections.value, [scene.id]: r.preset_id };
      pushToast({
        message: `Suggested "${r.preset_name}" — ${r.reason || "no reason given"}`,
        kind: "success",
        duration: 4500,
      });
    } else if (r?.note) {
      pushToast({ message: r.note, kind: "warning", duration: 5000 });
    }
  } catch (e) {
    pushToast({
      message: e?.message?.includes("501") || e?.status === 501
        ? "Suggest unavailable — wire an LLM provider in Engines → LLM tab."
        : `Suggest failed: ${e?.message || e}`,
      kind: "warning",
      duration: 6000,
    });
  } finally {
    suggestBusyScene.value = null;
  }
}

async function renderScene(scene) {
  if (!sceneBlockCounts.value[scene.id]) {
    pushToast({ message: "Scene has no blocks to render. Analyze + Apply first.", kind: "info" });
    return;
  }
  renderBusyScene.value = scene.id;
  try {
    const body = {
      scene_id: scene.id,
      preset_id: scenePresetSelections.value[scene.id] || null,
    };
    await api.request("/v1/render_chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    pushToast({ message: `${scene.title || "Scene"} render complete.`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Render failed: ${e?.message || e}`, kind: "error", duration: 7000 });
  } finally {
    renderBusyScene.value = null;
  }
}

async function renderSelected() {
  const queue = scenes.value.filter((s) => sceneSelectedForRender.value[s.id]);
  if (!queue.length) {
    pushToast({ message: "Select at least one scene to render.", kind: "info" });
    return;
  }
  for (const s of queue) {
    await renderScene(s);
  }
}

function selectAllUnrendered() {
  // Mark every scene with blocks as selected. (No "rendered" status
  // surfaced via API yet — Render tab counts blocks as the proxy.)
  const next = {};
  for (const s of scenes.value) {
    if (sceneBlockCounts.value[s.id]) next[s.id] = true;
  }
  sceneSelectedForRender.value = next;
}

function selectedSceneCount() {
  return Object.values(sceneSelectedForRender.value).filter(Boolean).length;
}

async function loadSceneText(sceneId) {
  if (!sceneId) {
    sceneText.value = "";
    return;
  }
  try {
    const r = await api.safeRequest(`/v1/scenes/${sceneId}/blocks`, []);
    const blocks = Array.isArray(r) ? r : (r?.blocks ?? []);
    sceneText.value = blocks.map((b) => b.text).join("\n\n");
  } catch {
    sceneText.value = "";
  }
}

watch(selectedSceneId, (id) => {
  loadSceneText(id);
  analyzeRows.value = [];
  editedFlags.value = {};
}, { immediate: true });

async function runAnalyze() {
  if (!selectedSceneId.value || !sceneText.value.trim()) {
    pushToast({ message: "Pick a scene with text to analyze.", kind: "info" });
    return;
  }
  analyzeBusy.value = true;
  try {
    const r = await api.request(`/v1/scenes/${selectedSceneId.value}/analyze`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: sceneText.value }),
    });
    analyzeRows.value = r.rows || [];
    analyzeTierUsed.value = r.tier_used;
    analyzeFloor.value = r.confidence_floor;
    editedFlags.value = {};
    pushToast({
      message: `Analyzed ${analyzeRows.value.length} segment${analyzeRows.value.length === 1 ? "" : "s"} using ${r.tier_used} tier.`,
      kind: "success",
      duration: 3500,
    });
  } catch (e) {
    pushToast({
      message: e?.message?.includes("501") || e?.status === 501
        ? "Analyze unavailable — wire an LLM provider in Engines → LLM tab."
        : `Analyze failed: ${e?.message || e}`,
      kind: "warning",
      duration: 6000,
    });
  } finally {
    analyzeBusy.value = false;
  }
}

function setRowSpeaker(idx, speaker) {
  if (!analyzeRows.value[idx]) return;
  analyzeRows.value[idx] = { ...analyzeRows.value[idx], speaker, source: "manual" };
  editedFlags.value = { ...editedFlags.value, [idx]: true };
}

async function applyAnalyzed() {
  if (!selectedSceneId.value || !analyzeRows.value.length) return;
  // Bulk-create blocks from the attribution rows. We assume the
  // scene is empty before Apply (caller can confirm in a follow-up).
  let created = 0;
  let failed = 0;
  for (let i = 0; i < analyzeRows.value.length; i += 1) {
    const row = analyzeRows.value[i];
    const persona_id = row.speaker !== "narrator" && row.speaker !== "unknown" ? row.speaker : null;
    try {
      await api.request(`/v1/scenes/${selectedSceneId.value}/blocks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          position: i,
          text: row.text,
          persona_id,
          metadata: {},
          extraction_confidence: row.confidence,
          source: row.source || "llm",
        }),
      });
      created += 1;
    } catch (_) {
      failed += 1;
    }
  }
  pushToast({
    message: failed
      ? `Applied ${created}, failed ${failed}.`
      : `Applied ${created} blocks.`,
    kind: failed ? "warning" : "success",
    duration: 5000,
  });
}

function speakerLabel(spk) {
  if (!spk || spk === "unknown") return "unknown";
  if (spk === "narrator") return narratorPersona.value?.name || "Narrator";
  const persona = projectPersonas.value.find((p) => p.id === spk);
  return persona?.name || spk;
}

function speakerOptions() {
  const opts = [
    { label: "— narrator —", value: "narrator" },
    { label: "— unknown —", value: "unknown" },
  ];
  for (const p of projectPersonas.value) {
    if (p.id !== narratorPersona.value?.id) {
      opts.push({ label: p.name, value: p.id });
    }
  }
  return opts;
}

function sourceChipClass(source) {
  return {
    tag: "studio__source-chip studio__source-chip--tag",
    propagated: "studio__source-chip studio__source-chip--propagated",
    llm: "studio__source-chip studio__source-chip--llm",
    floored: "studio__source-chip studio__source-chip--floored",
    narration: "studio__source-chip studio__source-chip--narration",
    manual: "studio__source-chip studio__source-chip--manual",
  }[source] || "studio__source-chip";
}

function voiceById(voiceId) {
  return voices.value.find((v) => v.id === voiceId) || null;
}

async function assignVoice(personaId, voiceId) {
  try {
    // PUT persona with updated voice_id. Personas API takes the same shape
    // as CreatePersonaRequest — fetch the existing persona, change voice_id,
    // PUT it back.
    const persona = personas.value.find((p) => p.id === personaId);
    if (!persona) return;
    const body = {
      name: persona.name,
      voice_id: voiceId,
      language: persona.language,
      avatar_path: persona.avatar_path,
      bio: persona.bio,
      personality: persona.personality,
      default_delivery: persona.default_delivery || {},
      effects_chain: persona.effects_chain || [],
      lexicon_id: persona.lexicon_id,
      engine_override: persona.engine_override,
      llm_rewrite_enabled: persona.llm_rewrite_enabled,
      llm_model: persona.llm_model,
    };
    await api.request(`/v1/personas/${personaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await loadAll();
    pushToast({ message: `Assigned ${voiceById(voiceId)?.name || voiceId} to ${persona.name}.`, kind: "success", duration: 3000 });
  } catch (e) {
    pushToast({ message: `Assign failed: ${e?.message || e}`, kind: "error" });
  }
}

function openVoiceTuner(persona) {
  if (!persona?.voice_id) {
    pushToast({ message: "Assign a voice first.", kind: "info" });
    return;
  }
  tuningVoice.value = {
    voiceId: persona.voice_id,
    name: voiceById(persona.voice_id)?.name || persona.voice_id,
    params: { ...(persona.default_delivery || {}) },
    personaId: persona.id,
  };
  voiceParamsModalOpen.value = true;
}

async function onVoiceParamsSaved(newParams) {
  const t = tuningVoice.value;
  if (!t) return;
  const persona = personas.value.find((p) => p.id === t.personaId);
  if (!persona) return;
  const body = {
    name: persona.name,
    voice_id: persona.voice_id,
    language: persona.language,
    avatar_path: persona.avatar_path,
    bio: persona.bio,
    personality: persona.personality,
    default_delivery: newParams,
    effects_chain: persona.effects_chain || [],
    lexicon_id: persona.lexicon_id,
    engine_override: persona.engine_override,
    llm_rewrite_enabled: persona.llm_rewrite_enabled,
    llm_model: persona.llm_model,
  };
  try {
    await api.request(`/v1/personas/${t.personaId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    voiceParamsModalOpen.value = false;
    tuningVoice.value = null;
    await loadAll();
    pushToast({ message: `Voice params saved.`, kind: "success", duration: 2500 });
  } catch (e) {
    pushToast({ message: `Save failed: ${e?.message || e}`, kind: "error" });
  }
}

async function smartAssignCast() {
  if (!characterPersonas.value.length) {
    pushToast({ message: "No characters in this project to assign.", kind: "info" });
    return;
  }
  if (!voices.value.length) {
    pushToast({ message: "No voices available to assign from.", kind: "info" });
    return;
  }
  smartAssignBusy.value = true;
  try {
    const r = await api.request("/v1/llm/smart-assign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characters: characterPersonas.value.map((p) => ({
          id: p.id,
          name: p.name,
          bio: p.bio,
          personality: p.personality,
        })),
        voices: voices.value.map((v) => ({
          id: v.id,
          name: v.name,
          gender: v.gender,
          language: v.language,
        })),
      }),
    });
    const proposed = r?.assignments || {};
    let applied = 0;
    for (const [characterId, voiceId] of Object.entries(proposed)) {
      const persona = characterPersonas.value.find((p) => p.id === characterId);
      const voice = voices.value.find((v) => v.id === voiceId);
      if (persona && voice) {
        await assignVoice(characterId, voiceId);
        applied += 1;
      }
    }
    pushToast({
      message: applied
        ? `Smart-assign applied ${applied} assignment${applied === 1 ? "" : "s"}.`
        : "Smart-assign returned no matches.",
      kind: applied ? "success" : "warning",
      duration: 4500,
    });
  } catch (e) {
    pushToast({
      message: e?.message?.includes("501") || e?.status === 501
        ? "Smart-assign unavailable — wire an LLM provider in Engines → LLM tab."
        : `Smart-assign failed: ${e?.message || e}`,
      kind: "warning",
      duration: 6000,
    });
  } finally {
    smartAssignBusy.value = false;
  }
}

onMounted(loadAll);
</script>

<template>
  <div class="studio">
    <!-- ── Project picker ───────────────────────────────────────────── -->
    <div class="jv-section studio__project-bar">
      <label class="studio__project-label">{{ copy.book.singular }}:</label>
      <select v-model="selectedProjectId" class="jv-input studio__project-select">
        <option v-for="o in projectOptions" :key="o.value || 'none'" :value="o.value">{{ o.label }}</option>
      </select>
      <span class="jv-spacer" />
      <span v-if="selectedProject" class="jv-pill jv-pill--ghost">{{ selectedProject.project_type }}</span>
    </div>

    <!-- ── Tabs ─────────────────────────────────────────────────────── -->
    <div class="studio__tabs">
      <button
        v-for="(label, key) in TAB_LABELS"
        :key="key"
        type="button"
        class="studio__tab"
        :class="{ 'studio__tab--active': tab === key }"
        @click="tab = key"
      >{{ label }}</button>
    </div>

    <!-- ── Cast tab ─────────────────────────────────────────────────── -->
    <section v-if="tab === 'cast'" class="studio__cast">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to manage its {{ copy.cast.plural.toLowerCase() }}.
      </div>

      <template v-else>
        <header class="studio__cast-toolbar">
          <h3 class="jv-section__title" style="margin: 0">
            {{ copy.cast.plural }} — {{ characterPersonas.length }}
          </h3>
          <span class="jv-spacer" />
          <JvButton
            variant="secondary"
            size="sm"
            label="🪄 Smart-assign"
            :loading="smartAssignBusy"
            :disabled="smartAssignBusy"
            @click="smartAssignCast"
          />
        </header>

        <div class="studio__cast-grid">
          <!-- Narrator card -->
          <article v-if="narratorPersona" class="jv-card studio__char-card studio__char-card--narrator">
            <div class="studio__char-h">
              <div class="studio__char-portrait studio__char-portrait--narrator">📖</div>
              <div class="studio__char-name">{{ narratorPersona.name }}</div>
              <span class="jv-pill jv-pill--ghost">Narrator</span>
            </div>
            <div v-if="!narratorPersona.voice_id" class="jv-banner jv-banner--warn studio__char-warn">
              No voice assigned.
            </div>
            <div v-else class="studio__char-voice">
              <strong>{{ voiceById(narratorPersona.voice_id)?.name || narratorPersona.voice_id }}</strong>
              <span class="jv-muted">{{ voiceById(narratorPersona.voice_id)?.engine || "" }}</span>
            </div>
            <footer class="studio__char-actions">
              <JvButton variant="ghost" size="sm" label="⚙ Tune" @click="openVoiceTuner(narratorPersona)" />
            </footer>
          </article>

          <!-- Character cards -->
          <article
            v-for="p in characterPersonas"
            :key="p.id"
            class="jv-card studio__char-card"
            :class="{ 'studio__char-card--selected': selectedCharacterId === p.id }"
            @click="selectedCharacterId = p.id"
          >
            <div class="studio__char-h">
              <div class="studio__char-portrait">{{ (p.name || "?").charAt(0).toUpperCase() }}</div>
              <div class="studio__char-name">{{ p.name }}</div>
            </div>
            <div v-if="!p.voice_id" class="jv-banner jv-banner--warn studio__char-warn">
              No voice assigned.
            </div>
            <div v-else class="studio__char-voice">
              <strong>{{ voiceById(p.voice_id)?.name || p.voice_id }}</strong>
              <span class="jv-muted">{{ voiceById(p.voice_id)?.engine || "" }}</span>
            </div>
            <footer class="studio__char-actions">
              <JvButton variant="ghost" size="sm" label="⚙ Tune" @click.stop="openVoiceTuner(p)" />
            </footer>
          </article>
        </div>

        <!-- Voice library sidebar (becomes a panel below the cast on narrow viewports). -->
        <aside class="studio__voice-library">
          <h4 class="studio__voice-library-h">Voice library</h4>
          <div v-if="!voices.length" class="jv-muted">No voices yet — load an engine in Engines tab.</div>
          <template v-else>
            <div v-for="(group, engineId) in voiceLibraryByEngine" :key="engineId" class="studio__voice-group">
              <div class="studio__voice-group-h">{{ engineId }}</div>
              <button
                v-for="v in group"
                :key="v.id"
                type="button"
                class="studio__voice-row"
                :disabled="!selectedCharacter"
                :title="selectedCharacter ? `Assign ${v.name} to ${selectedCharacter.name}` : 'Pick a character to assign'"
                @click="selectedCharacter && assignVoice(selectedCharacter.id, v.id)"
              >
                <strong>{{ v.name }}</strong>
                <span v-if="v.gender" class="jv-pill jv-pill--ghost">{{ v.gender }}</span>
                <span class="jv-muted">{{ v.language || "" }}</span>
              </button>
            </div>
          </template>
        </aside>
      </template>
    </section>

    <!-- ── Script tab — Phase 4 / Slice 2 ───────────────────────────── -->
    <section v-if="tab === 'script'" class="studio__script">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to attribute its script.
      </div>
      <template v-else>
        <header class="studio__script-toolbar">
          <label class="studio__script-label">{{ copy.chapter.singular }}:</label>
          <select v-model="selectedSceneId" class="jv-input studio__script-select">
            <option v-if="!scenes.length" :value="null">— no {{ copy.chapter.plural.toLowerCase() }} —</option>
            <option v-for="s in scenes" :key="s.id" :value="s.id">{{ s.title || `${copy.chapter.singular} ${s.position + 1}` }}</option>
          </select>
          <span class="jv-spacer" />
          <JvButton
            variant="primary"
            size="sm"
            :loading="analyzeBusy"
            :disabled="analyzeBusy || !sceneText.trim()"
            label="🔍 Analyze"
            @click="runAnalyze"
          />
          <JvButton
            v-if="analyzeRows.length"
            variant="secondary"
            size="sm"
            label="✓ Apply"
            @click="applyAnalyzed"
          />
        </header>

        <p v-if="analyzeTierUsed" class="jv-muted studio__script-meta">
          Routed to <strong>{{ analyzeTierUsed }}</strong> tier · confidence floor {{ analyzeFloor }} · {{ analyzeRows.length }} segments
        </p>

        <textarea
          v-if="!analyzeRows.length"
          class="jv-input studio__script-text"
          v-model="sceneText"
          :placeholder="`Paste the ${copy.chapter.singular.toLowerCase()} text here, then click Analyze.`"
        />

        <table v-else class="jv-table studio__script-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Kind</th>
              <th>Speaker</th>
              <th>Source</th>
              <th>Confidence</th>
              <th>Text</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, i) in analyzeRows" :key="i">
              <td class="jv-muted">{{ i + 1 }}</td>
              <td><span class="jv-pill jv-pill--ghost">{{ row.kind }}</span></td>
              <td>
                <select
                  v-if="row.kind === 'dialogue'"
                  :value="row.speaker"
                  class="jv-input jv-input--sm"
                  @change="setRowSpeaker(i, $event.target.value)"
                >
                  <option
                    v-for="o in speakerOptions()"
                    :key="o.value"
                    :value="o.value"
                  >{{ o.label }}</option>
                </select>
                <span v-else>{{ speakerLabel(row.speaker) }}</span>
                <span v-if="editedFlags[i]" class="studio__edited">✎</span>
              </td>
              <td>
                <span :class="sourceChipClass(row.source)">{{ row.source }}</span>
                <span v-if="row.source === 'floored' && row.floored_from" class="jv-muted">
                  from {{ speakerLabel(row.floored_from) }}
                </span>
              </td>
              <td class="jv-mono">{{ (row.confidence * 100).toFixed(0) }}%</td>
              <td class="studio__script-text-cell">{{ row.text }}</td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <!-- ── Render tab — Phase 6 / Slice 1 ───────────────────────────── -->
    <section v-if="tab === 'render'" class="studio__render">
      <div v-if="!selectedProject" class="jv-banner">
        Pick a {{ copy.book.singular.toLowerCase() }} above to render its {{ copy.chapter.plural.toLowerCase() }}.
      </div>
      <template v-else>
        <header class="studio__render-toolbar">
          <JvButton variant="secondary" size="sm" label="Select all with blocks" @click="selectAllUnrendered" />
          <span class="jv-muted">{{ selectedSceneCount() }} selected</span>
          <span class="jv-spacer" />
          <JvButton
            variant="primary"
            size="sm"
            :disabled="!selectedSceneCount() || renderBusyScene !== null"
            :label="`▶ Render selected (${selectedSceneCount()})`"
            @click="renderSelected"
          />
        </header>

        <table class="jv-table studio__render-table">
          <thead>
            <tr>
              <th class="studio__render-check"></th>
              <th>#</th>
              <th>{{ copy.chapter.singular }}</th>
              <th>{{ copy.line.plural }}</th>
              <th>Render preset</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(s, i) in scenes" :key="s.id">
              <td class="studio__render-check">
                <input
                  type="checkbox"
                  :checked="!!sceneSelectedForRender[s.id]"
                  @change="sceneSelectedForRender = { ...sceneSelectedForRender, [s.id]: $event.target.checked }"
                />
              </td>
              <td class="jv-muted">{{ i + 1 }}</td>
              <td>
                <strong>{{ s.title || `${copy.chapter.singular} ${s.position + 1}` }}</strong>
              </td>
              <td class="jv-mono">{{ sceneBlockCounts[s.id] || 0 }}</td>
              <td>
                <select
                  :value="scenePresetSelections[s.id] || ''"
                  class="jv-input jv-input--sm"
                  @change="scenePresetSelections = { ...scenePresetSelections, [s.id]: $event.target.value }"
                >
                  <option v-for="o in presetOptions()" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </td>
              <td class="studio__render-actions">
                <JvButton
                  variant="ghost"
                  size="sm"
                  :loading="suggestBusyScene === s.id"
                  :disabled="suggestBusyScene === s.id"
                  label="💡 Suggest"
                  @click="suggestPresetFor(s)"
                />
                <JvButton
                  variant="secondary"
                  size="sm"
                  :loading="renderBusyScene === s.id"
                  :disabled="renderBusyScene !== null"
                  label="▶ Render"
                  @click="renderScene(s)"
                />
              </td>
            </tr>
          </tbody>
        </table>
      </template>
    </section>

    <!-- Voice params modal — Tier-2 voice tuning. -->
    <VoiceParamsModal
      v-if="tuningVoice"
      :open="voiceParamsModalOpen"
      :voice-id="tuningVoice.voiceId"
      :voice-name="tuningVoice.name"
      :model-value="tuningVoice.params"
      @save="onVoiceParamsSaved"
      @cancel="voiceParamsModalOpen = false; tuningVoice = null"
    />
  </div>
</template>

<style scoped>
.studio { padding: 0; display: flex; flex-direction: column; gap: 16px; }

.studio__project-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  background: var(--surface-2);
  border-radius: 6px;
  border: 1px solid var(--border-soft);
}
.studio__project-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.studio__project-select { flex: 1 1 260px; max-width: 480px; }

.studio__tabs {
  display: flex;
  gap: 4px;
  border-bottom: 1px solid var(--border-soft);
}
.studio__tab {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 10px 18px;
  font: inherit;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.studio__tab:hover { color: var(--ink); }
.studio__tab--active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

.studio__cast {
  display: grid;
  grid-template-columns: 1fr 280px;
  gap: 18px;
}
@media (max-width: 900px) { .studio__cast { grid-template-columns: 1fr; } }

.studio__cast-toolbar {
  grid-column: 1 / -1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.studio__cast-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.studio__char-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 14px;
  cursor: pointer;
  transition: border-color 0.15s;
}
.studio__char-card:hover { border-color: var(--border-strong, var(--accent-line, var(--accent))); }
.studio__char-card--narrator { background: var(--accent-soft); }
.studio__char-card--selected { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent) inset; }

.studio__char-h { display: flex; align-items: center; gap: 10px; }
.studio__char-portrait {
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: var(--surface-2);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 16px;
}
.studio__char-portrait--narrator { background: var(--accent); color: var(--surface); }
.studio__char-name { font-weight: 600; font-size: 14px; flex: 1; }

.studio__char-warn { padding: 6px 8px; font-size: 11.5px; margin: 0; }
.studio__char-voice { display: flex; flex-direction: column; font-size: 12.5px; }

.studio__char-actions { display: flex; gap: 6px; padding-top: 6px; border-top: 1px solid var(--border-soft); }

.studio__voice-library {
  padding: 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  max-height: 70vh;
  overflow-y: auto;
}
.studio__voice-library-h {
  margin: 0 0 10px;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.studio__voice-group { margin-bottom: 12px; }
.studio__voice-group-h {
  font-size: 10.5px;
  text-transform: uppercase;
  color: var(--ink-3);
  margin-bottom: 4px;
  font-family: var(--font-mono);
}
.studio__voice-row {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 6px 8px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  margin-bottom: 4px;
  font: inherit;
  font-size: 12px;
  color: var(--ink);
}
.studio__voice-row:hover:not(:disabled) {
  background: var(--accent-soft);
  border-color: var(--accent);
}
.studio__voice-row:disabled { opacity: 0.55; cursor: not-allowed; }

/* ── Script tab ───────────────────────────────────────────────────── */
.studio__script-toolbar {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 6px;
}
.studio__script-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.studio__script-select { flex: 1 1 240px; max-width: 360px; }

.studio__script-meta {
  font-size: 11.5px;
  margin: 0 0 8px;
}

.studio__script-text {
  width: 100%;
  min-height: 240px;
  font-family: var(--font-serif, Georgia, serif);
  font-size: 13.5px;
  line-height: 1.55;
  resize: vertical;
  padding: 12px 14px;
}

.studio__script-table { font-size: 12px; width: 100%; }
.studio__script-table th { white-space: nowrap; }
.studio__script-text-cell {
  max-width: 480px;
  white-space: pre-wrap;
  word-break: break-word;
}

.studio__edited { color: var(--accent); margin-left: 6px; font-size: 11px; }

.studio__source-chip {
  font-size: 10px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  background: var(--surface-2);
  color: var(--ink-2);
  border: 1px solid var(--border-soft);
}
.studio__source-chip--tag         { background: var(--accent-soft); color: var(--accent); border-color: var(--accent); }
.studio__source-chip--propagated  { background: var(--accent-soft); color: var(--ink-2); }
.studio__source-chip--llm         { color: var(--ink-3); }
.studio__source-chip--floored     { background: var(--warn-bg, var(--surface-2)); color: var(--warn, var(--ink-2)); border-color: var(--warn, var(--border-soft)); }
.studio__source-chip--narration   { color: var(--muted); border-style: dashed; }
.studio__source-chip--manual      { background: var(--surface); }

/* ── Render tab ───────────────────────────────────────────────────── */
.studio__render-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}
.studio__render-table { font-size: 12.5px; }
.studio__render-check { width: 32px; }
.studio__render-actions {
  display: flex;
  gap: 6px;
  white-space: nowrap;
}
</style>
