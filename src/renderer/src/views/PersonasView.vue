<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  PersonasView — Personas are the sole identity layer after the Profile-kill
  (see plan: voice + delivery + effects + personality all live here directly).

  Layout:
    Left:  library list with filter chips (All / Used / Unused / By project)
           and a "Used in N project(s)" badge per persona card.
    Right: rich editor for the selected persona.

  Persona vs Voice: Voice is the TTS artifact (engine preset or cloned WAV).
  Persona is the character that USES a voice + adds bio, personality,
  delivery overrides, effects, lexicon overrides. No Profile layer in between.
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import EmptyState from "../components/EmptyState.vue";
import EffectsChainEditorModal from "../components/EffectsChainEditorModal.vue";

const api = useApi();

const personas = ref([]);
const voices = ref([]);
const engines = ref([]);
const lexicons = ref([]);
const projects = ref([]);
const usage = ref({});  // { persona_id: [{project_id, project_name}, ...] }
const selectedId = ref(null);
const loading = ref(false);

const FILTERS = ["all", "used", "unused", "by-project"];
const filter = ref("all");
const filterProjectId = ref("");

// Editable buffer for the selected persona — committed via "Save".
const draft = ref(null);
const dirty = ref(false);

const selectedPersona = computed(() =>
  personas.value.find((p) => p.id === selectedId.value) ?? null,
);

const filteredPersonas = computed(() => {
  if (filter.value === "all") return personas.value;
  if (filter.value === "used") return personas.value.filter((p) => (usage.value[p.id] || []).length > 0);
  if (filter.value === "unused") return personas.value.filter((p) => !(usage.value[p.id] || []).length);
  if (filter.value === "by-project" && filterProjectId.value) {
    return personas.value.filter((p) =>
      (usage.value[p.id] || []).some((u) => u.project_id === filterProjectId.value),
    );
  }
  return personas.value;
});

function usageCount(personaId) {
  return (usage.value[personaId] || []).length;
}

async function loadAll() {
  loading.value = true;
  try {
    const [pRes, vRes, eRes, lRes, prRes, uRes] = await Promise.all([
      api.safeRequest("/v1/personas",       { personas: [] }),
      api.safeRequest("/v1/voices",         { voices: [] }),
      api.safeRequest("/v1/engines",        { engines: [] }),
      api.safeRequest("/v1/lexicons",       { lexicons: [] }),
      api.safeRequest("/v1/projects",       { projects: [] }),
      api.safeRequest("/v1/personas/usage", { usage: {} }),
    ]);
    personas.value = pRes?.personas ?? [];
    voices.value   = vRes?.voices   ?? [];
    engines.value  = eRes?.engines  ?? [];
    lexicons.value = lRes?.lexicons ?? [];
    projects.value = prRes?.projects ?? [];
    usage.value    = uRes?.usage    ?? {};
    if (!selectedId.value && personas.value.length) {
      selectedId.value = personas.value[0].id;
    }
  } finally {
    loading.value = false;
  }
}

function bufferFor(persona) {
  if (!persona) return null;
  return {
    id: persona.id,
    name: persona.name ?? "",
    voice_id: persona.voice_id ?? "",
    language: persona.language ?? "en",
    avatar_path: persona.avatar_path ?? "",
    bio: persona.bio ?? "",
    personality: persona.personality ?? "",
    engine_override: persona.engine_override ?? "",
    lexicon_id: persona.lexicon_id ?? "",
    default_delivery: { ...(persona.default_delivery ?? {}) },
    effects_chain: [...(persona.effects_chain ?? [])],
    // Legacy fields kept on disk; not surfaced in the UI now that Rewrite
    // is an explicit Generate-tab button. Round-tripped on save.
    llm_rewrite_enabled: !!persona.llm_rewrite_enabled,
    llm_model: persona.llm_model ?? "qwen-1.7b-local",
  };
}

watch(selectedPersona, (p) => {
  draft.value = bufferFor(p);
  dirty.value = false;
  loadUsageDetail(p?.id || null);
}, { immediate: true });

function markDirty() { dirty.value = true; }

async function createBlank() {
  const name = await promptDialog({ title: "New persona", label: "Persona name (e.g. Mara, Narrator)", confirmLabel: "Create" });
  if (!name) return;
  if (!voices.value.length) {
    pushToast({ kind: "error", title: "Add a voice first", description: "Personas bind to a voice — go to Voices and create one." });
    return;
  }
  try {
    const created = await api.request("/v1/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, voice_id: voices.value[0].id, default_delivery: {} }),
    });
    await loadAll();
    selectedId.value = created.id;
  } catch (e) {
    pushToast({ kind: "error", title: "Failed to create persona", description: String(e?.message ?? e) });
  }
}

async function savePersona() {
  if (!draft.value) return;
  const body = {
    name: draft.value.name,
    voice_id: draft.value.voice_id,
    language: draft.value.language || "en",
    avatar_path: draft.value.avatar_path || null,
    bio: draft.value.bio || null,
    personality: draft.value.personality || null,
    default_delivery: draft.value.default_delivery,
    effects_chain: draft.value.effects_chain || [],
    engine_override: draft.value.engine_override || null,
    lexicon_id: draft.value.lexicon_id || null,
    llm_rewrite_enabled: draft.value.llm_rewrite_enabled,
    llm_model: draft.value.llm_model || null,
  };
  try {
    await api.request(`/v1/personas/${draft.value.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await loadAll();
    dirty.value = false;
    pushToast({ kind: "success", title: "Persona saved" });
  } catch (e) {
    pushToast({ kind: "error", title: "Save failed", description: String(e?.message ?? e) });
  }
}

async function deletePersona() {
  if (!draft.value) return;
  const ok = await confirmDialog({
    title: "Delete persona?",
    message: `"${draft.value.name}" will be removed. Voice and lexicon are kept (only the binding is removed).`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  // Save the persona's full shape so the Undo action can re-create it.
  // The id may not be reusable (post-delete some backends accept it,
  // others assign a new one); we hand the full body to /v1/personas
  // POST and accept whatever id comes back.
  const snapshot = { ...draft.value };
  const personaName = snapshot.name || "Persona";
  try {
    await api.request(`/v1/personas/${snapshot.id}`, { method: "DELETE" });
    selectedId.value = null;
    await loadAll();
    pushToast({
      kind: "success",
      message: `${personaName} deleted.`,
      duration: 6000,
      action: {
        label: "Undo",
        fn: async () => {
          try {
            const body = {
              name: snapshot.name,
              voice_id: snapshot.voice_id,
              bio: snapshot.bio,
              personality: snapshot.personality,
              language: snapshot.language,
              avatar_path: snapshot.avatar_path,
              default_delivery: snapshot.default_delivery || {},
              effects_chain: snapshot.effects_chain || [],
              lexicon_id: snapshot.lexicon_id,
              engine_override: snapshot.engine_override,
            };
            const restored = await api.request("/v1/personas", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            await loadAll();
            selectedId.value = restored?.id || snapshot.id;
            pushToast({ kind: "success", message: `${personaName} restored.` });
          } catch (e) {
            pushToast({ kind: "error", message: `Undo failed: ${e?.message || e}` });
          }
        },
      },
    });
  } catch (e) {
    pushToast({ kind: "error", message: `Delete failed: ${e?.message ?? e}` });
  }
}

const effectsEditorOpen = ref(false);
const usageDetail = ref(null);
const usageDetailBusy = ref(false);

function openEffectsEditor() {
  effectsEditorOpen.value = true;
}

async function loadUsageDetail(personaId) {
  if (!personaId) {
    usageDetail.value = null;
    return;
  }
  usageDetailBusy.value = true;
  try {
    const r = await api.safeRequest(`/v1/personas/${personaId}/usage-detail`, null);
    usageDetail.value = r;
  } finally {
    usageDetailBusy.value = false;
  }
}

function onEffectsSaved(newChain) {
  draft.value.effects_chain = newChain;
  effectsEditorOpen.value = false;
  markDirty();
}

function openDeliveryHint() {
  pushToast({
    kind: "info",
    title: "Edit delivery in Generate",
    description: "Tune Speed / Pitch / Pause-after on the Generate tab, then save as the persona default.",
  });
}

function deliveryChipLabel(key) {
  return ({
    speed: "Speed",
    pitch: "Pitch",
    pause_after_ms: "Pause after",
    gain_db: "Gain",
    temperature: "Temperature",
  })[key] || key;
}
function deliveryChipValue(key, value) {
  if (value == null) return "—";
  if (key === "speed") return `${Number(value).toFixed(2)}×`;
  if (key === "pitch") return `${value > 0 ? "+" : ""}${value} st`;
  if (key === "pause_after_ms") return `${value} ms`;
  if (key === "gain_db") return `${value > 0 ? "+" : ""}${value} dB`;
  return String(value);
}

function listMeta(p) {
  const bits = [];
  const v = voices.value.find((x) => x.id === p.voice_id);
  if (v?.name) bits.push(v.name);
  if (p.bio) bits.push(p.bio.slice(0, 64) + (p.bio.length > 64 ? "…" : ""));
  return bits.join(" · ") || "—";
}

onMounted(loadAll);
</script>

<template>
  <div class="personas">
    <aside class="personas__list">
      <header class="personas__list-h">
        <h3>Personas</h3>
        <JvButton variant="primary" size="sm" label="+ New" @click="createBlank" />
      </header>

      <!-- Library-mode filter chips: All / Used / Unused / By project.
           The "by project" chip reveals a project dropdown. Cross-project
           Personas are the model — these chips help you find them. -->
      <div class="personas__filter">
        <button
          v-for="f in FILTERS"
          :key="f"
          type="button"
          class="jv-chip-card personas__chip"
          :class="{ 'personas__chip--active': filter === f }"
          @click="filter = f"
        >{{ f === 'by-project' ? 'By project' : (f.charAt(0).toUpperCase() + f.slice(1)) }}</button>
        <select
          v-if="filter === 'by-project'"
          class="jv-input personas__filter-select"
          v-model="filterProjectId"
        >
          <option value="">— pick a project —</option>
          <option v-for="pr in projects" :key="pr.id" :value="pr.id">{{ pr.name }}</option>
        </select>
      </div>

      <div v-if="loading" class="jv-muted personas__empty">Loading…</div>
      <EmptyState
        v-else-if="!filteredPersonas.length && !personas.length"
        icon="Sparkle"
        title="No characters yet"
        message="A persona pairs a name + bio + voice + personality. Audiobook cast, game NPCs, podcast hosts all live here."
        action-label="+ Create your first persona"
        compact
        @action="createBlank"
      />
      <div v-else-if="!filteredPersonas.length" class="personas__empty jv-muted">
        No personas match this filter.
      </div>
      <div
        v-for="p in filteredPersonas"
        :key="p.id"
        class="personas__item"
        :class="{ 'personas__item--active': p.id === selectedId }"
        @click="selectedId = p.id"
      >
        <div class="personas__item-row">
          <div class="personas__item-name">{{ p.name }}</div>
          <span
            class="jv-pill"
            :class="usageCount(p.id) > 0 ? 'jv-pill--green' : 'jv-pill--ghost'"
          >
            {{ usageCount(p.id) }} project{{ usageCount(p.id) === 1 ? '' : 's' }}
          </span>
        </div>
        <div class="personas__item-meta jv-muted">{{ listMeta(p) }}</div>
      </div>
    </aside>

    <section class="personas__detail">
      <div v-if="!draft" class="jv-card personas__detail-empty">
        <p class="jv-muted">Select a persona on the left, or create one with <strong>+ New</strong>.</p>
      </div>

      <div v-else class="jv-card personas__editor">
        <header class="personas__editor-h">
          <h2>{{ draft.name || "(unnamed)" }}</h2>
          <span v-if="dirty" class="jv-pill jv-pill--warn">Unsaved changes</span>
          <span v-if="selectedPersona?.imported_from" class="jv-pill jv-pill--ghost">
            imported from {{ selectedPersona.imported_from }}
          </span>
          <span
            v-if="usageCount(draft.id) > 0"
            class="jv-pill jv-pill--green"
          >
            Used in {{ usageCount(draft.id) }} project{{ usageCount(draft.id) === 1 ? '' : 's' }}
          </span>
        </header>

        <div class="personas__grid">
          <label class="personas__field">
            <span>Name</span>
            <input class="jv-input" v-model="draft.name" @input="markDirty" />
          </label>

          <label class="personas__field">
            <span>Voice</span>
            <select class="jv-input" v-model="draft.voice_id" @change="markDirty">
              <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} ({{ v.id }})</option>
            </select>
          </label>

          <label class="personas__field">
            <span>Language</span>
            <input class="jv-input" v-model="draft.language" @input="markDirty" placeholder="en" />
          </label>

          <label class="personas__field">
            <span>Avatar path</span>
            <input class="jv-input" v-model="draft.avatar_path" @input="markDirty" placeholder="(optional)" />
          </label>

          <label class="personas__field">
            <span>Engine override</span>
            <select class="jv-input" v-model="draft.engine_override" @change="markDirty">
              <option value="">(use voice default)</option>
              <option v-for="e in engines" :key="e.id" :value="e.id">{{ e.name || e.id }}</option>
            </select>
          </label>

          <label class="personas__field">
            <span>Lexicon override</span>
            <select class="jv-input" v-model="draft.lexicon_id" @change="markDirty">
              <option value="">(none — use project default)</option>
              <option v-for="lx in lexicons" :key="lx.id" :value="lx.id">{{ lx.name }}</option>
            </select>
          </label>

          <label class="personas__field personas__field--wide">
            <span>Bio (character context)</span>
            <textarea
              class="jv-input jv-input--full personas__textarea"
              v-model="draft.bio"
              placeholder="A retired racetrack tout with three teeth and four lies for every truth. Speaks in fragments. Calls everyone &quot;boss.&quot; Suspicious of cops. Comfortable with silence…"
              @input="markDirty"
            />
            <p class="jv-muted personas__hint">
              Character backstory: age, history, mannerisms. Read by Smart-assign
              to match voices to characters. Up to 2000 characters. Not used as a
              TTS instruction — that's the Personality field below.
            </p>
          </label>

          <label class="personas__field personas__field--wide">
            <span>Personality (TTS delivery instruction)</span>
            <textarea
              class="jv-input jv-input--full personas__textarea"
              v-model="draft.personality"
              placeholder="Clipped, world-weary noir delivery. Dry wit. Boston accent in stressful moments. Never overshares."
              @input="markDirty"
            />
            <p class="jv-muted personas__hint">
              Passed to engines that accept freeform delivery instructions
              (Qwen3-TTS, LuxTTS) as the engine's <code>instruct</code> /
              style-prompt field at render time. Engines that don't accept it
              ignore it. <strong>Never an LLM rewrite of the manuscript</strong> —
              the Rewrite button on Generate is the explicit tool for that.
            </p>
          </label>

          <div class="personas__field personas__field--wide">
            <span>Default delivery overlay (Tier-2)</span>
            <div class="personas__chips">
              <span v-if="!Object.keys(draft.default_delivery || {}).length" class="jv-muted">
                No defaults set — uses the engine + voice defaults at render time.
              </span>
              <span
                v-for="(value, key) in draft.default_delivery"
                :key="key"
                class="jv-chip-card personas__chip-display"
              >
                {{ deliveryChipLabel(key) }}: <strong>{{ deliveryChipValue(key, value) }}</strong>
              </span>
              <button
                class="jv-btn jv-btn--ghost jv-btn--sm"
                type="button"
                @click="openDeliveryHint"
              >+ Edit</button>
            </div>
          </div>

          <div class="personas__field personas__field--wide">
            <span>Effects chain</span>
            <div class="personas__chips">
              <span v-if="!(draft.effects_chain || []).length" class="jv-muted">
                No effects. Reverb, EQ, compressor, pitch shift, etc. apply after TTS — Slice 7 builds the editor.
              </span>
              <span
                v-for="(ef, i) in draft.effects_chain"
                :key="i"
                class="jv-chip-card personas__chip-display"
              >
                {{ ef.type || '?' }}
              </span>
              <button
                class="jv-btn jv-btn--ghost jv-btn--sm"
                type="button"
                @click="openEffectsEditor"
              >+ Edit chain</button>
            </div>
          </div>
        </div>

        <!-- Cross-project usage detail panel (Phase 7 / Slice 1). -->
        <div
          v-if="usageDetail && usageDetail.projects && usageDetail.projects.length"
          class="jv-divider"
        />
        <section
          v-if="usageDetail && usageDetail.projects && usageDetail.projects.length"
          class="personas__cross-project"
        >
          <h4 class="personas__section-h">
            Across projects
            <span class="jv-pill jv-pill--ghost">{{ usageDetail.total_lines }} line{{ usageDetail.total_lines === 1 ? "" : "s" }}</span>
          </h4>
          <table class="jv-table personas__cross-project-table">
            <thead>
              <tr>
                <th>Project</th>
                <th>Type</th>
                <th class="jv-mono">Scenes</th>
                <th class="jv-mono">Lines</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in usageDetail.projects" :key="p.project_id">
                <td><strong>{{ p.project_name }}</strong></td>
                <td><span class="jv-pill jv-pill--ghost">{{ p.project_type }}</span></td>
                <td class="jv-mono">{{ p.scene_count }}</td>
                <td class="jv-mono">{{ p.line_count }}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <div class="jv-divider" />

        <div class="personas__actions">
          <span class="personas__spacer" />
          <JvButton variant="primary" label="Save" :disabled="!dirty" @click="savePersona" />
          <button class="jv-btn jv-btn--danger-outline" type="button" @click="deletePersona">Delete</button>
        </div>
      </div>
    </section>

    <!-- Effects chain editor — opens from the Effects chain row above. -->
    <EffectsChainEditorModal
      v-if="draft"
      :open="effectsEditorOpen"
      v-model="draft.effects_chain"
      :context-label="draft.name || 'Persona'"
      @save="onEffectsSaved"
      @cancel="effectsEditorOpen = false"
    />
  </div>
</template>

<style scoped>
.personas {
  display: grid;
  grid-template-columns: 340px 1fr;
  height: 100%;
  gap: 0;
}

.personas__list {
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--line);
  background: var(--surface);
}
.personas__list-h {
  display: flex;
  align-items: center;
  padding: 14px 14px 10px;
  gap: 8px;
}
.personas__list-h h3 {
  margin: 0;
  flex: 1;
  font-size: 14px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--ink-2);
}

.personas__filter {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 14px 10px;
  align-items: center;
}
.personas__chip {
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
  user-select: none;
  border: 1px solid var(--border-soft);
}
.personas__chip--active {
  background: var(--accent);
  color: var(--surface);
  border-color: var(--accent);
}
.personas__filter-select {
  flex: 1 1 100%;
  margin-top: 6px;
}

.personas__empty {
  padding: 24px 16px;
  font-size: 13px;
}
.personas__item {
  padding: 10px 14px;
  cursor: pointer;
  border-left: 3px solid transparent;
}
.personas__item:hover { background: var(--surface-2); }
.personas__item--active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
}
.personas__item-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.personas__item-name { font-weight: 600; font-size: 14px; flex: 1; }
.personas__item-meta { font-size: 11.5px; margin-top: 2px; }

.personas__detail {
  padding: 24px 32px;
  overflow-y: auto;
}

.personas__detail-empty {
  padding: 40px;
  text-align: center;
}

.personas__editor {
  max-width: 920px;
}
.personas__editor-h {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}
.personas__editor-h h2 { margin: 0; font-size: 22px; }

.personas__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 24px;
}
.personas__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.personas__field > span {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.personas__field--wide { grid-column: 1 / -1; }

.personas__textarea {
  min-height: 100px;
  font-family: inherit;
  resize: vertical;
}

.personas__hint { font-size: 11.5px; margin: 0; }

.personas__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.personas__chip-display { font-size: 13px; }

.personas__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.personas__spacer { flex: 1; }
</style>
