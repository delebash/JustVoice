<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  PersonasView — Character bios + voice mapping. Per preview Personas §:
  left pane lists characters, right pane is a rich editor with:
    • Name, Voice profile, Engine override, Lexicon override
    • LLM-rewrite toggle + LLM model picker
    • Personality (free-form textarea, drives the LLM-rewrite + Compose actions)
    • Default delivery overlay (chip-card row of Speed/Pitch/Pause-after)
    • Auto-create from JustWrite character roster button
    • Save / Delete actions

  Persona vs Profile note: a profile is a reusable voice config (cross-project),
  a persona is a named character in one project's cast bound to a profile.
  Two characters can share a profile; one profile can back many personas.
-->
<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvToggle from "../components/jv/JvToggle.vue";

const api = useApi();

const personas = ref([]);
const voices = ref([]);
const engines = ref([]);
const lexicons = ref([]);
const selectedId = ref(null);
const loading = ref(false);

// Editable buffer for the selected persona — committed via "Save".
const draft = ref(null);
const dirty = ref(false);

const LLM_MODELS = [
  { id: "qwen-1.7b-local", label: "local Qwen 1.7B" },
  { id: "qwen-4b-local",   label: "local Qwen 4B" },
  { id: "openai-mini",     label: "OpenAI (cloud) — gpt-4o-mini" },
  { id: "anthropic-haiku", label: "Anthropic (cloud) — Claude Haiku 4.5" },
];

const selectedPersona = computed(() =>
  personas.value.find((p) => p.id === selectedId.value) ?? null,
);

async function loadAll() {
  loading.value = true;
  try {
    const [pRes, vRes, eRes, lRes] = await Promise.all([
      api.safeRequest("/v1/personas",  { personas: [] }),
      api.safeRequest("/v1/voices",    { voices: [] }),
      api.safeRequest("/v1/engines",   { engines: [] }),
      api.safeRequest("/v1/lexicons",  { lexicons: [] }),
    ]);
    personas.value = pRes?.personas ?? [];
    voices.value   = vRes?.voices   ?? [];
    engines.value  = eRes?.engines  ?? [];
    lexicons.value = lRes?.lexicons ?? [];
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
    engine_override: persona.engine_override ?? "",
    lexicon_id: persona.lexicon_id ?? "",
    llm_rewrite_enabled: !!persona.llm_rewrite_enabled,
    llm_model: persona.llm_model ?? "qwen-1.7b-local",
    bio: persona.bio ?? "",
    default_delivery: { ...(persona.default_delivery ?? {}) },
  };
}

watch(selectedPersona, (p) => {
  draft.value = bufferFor(p);
  dirty.value = false;
}, { immediate: true });

function markDirty() { dirty.value = true; }

async function createBlank() {
  const name = prompt("Persona name (e.g. Old Crow):");
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
    default_delivery: draft.value.default_delivery,
    bio: draft.value.bio || null,
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
  try {
    await api.request(`/v1/personas/${draft.value.id}`, { method: "DELETE" });
    selectedId.value = null;
    await loadAll();
    pushToast({ kind: "success", title: "Persona deleted" });
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

async function autoCreateFromJustWrite() {
  pushToast({
    kind: "info",
    title: "Auto-create from JustWrite",
    description: "Will pull the character roster from the active JustWrite project and create one persona per character (POST /v1/personas/import?source=justwrite).",
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
      <div v-if="loading" class="jv-muted personas__empty">Loading…</div>
      <div v-else-if="!personas.length" class="personas__empty jv-muted">
        No personas yet. Use <strong>+ New</strong> or <strong>Auto-create from JustWrite</strong> below.
      </div>
      <div
        v-for="p in personas"
        :key="p.id"
        class="personas__item"
        :class="{ 'personas__item--active': p.id === selectedId }"
        @click="selectedId = p.id"
      >
        <div class="personas__item-name">{{ p.name }}</div>
        <div class="personas__item-meta jv-muted">{{ listMeta(p) }}</div>
      </div>
    </aside>

    <section class="personas__detail">
      <div v-if="!draft" class="jv-card personas__detail-empty">
        <p class="jv-muted">Select a persona on the left, or create one with <strong>+ New</strong>.</p>
        <div style="margin-top:14px">
          <JvButton variant="secondary" label="Auto-create from JustWrite character roster" @click="autoCreateFromJustWrite" />
        </div>
      </div>

      <div v-else class="jv-card personas__editor">
        <header class="personas__editor-h">
          <h2>{{ draft.name || "(unnamed)" }}</h2>
          <span v-if="dirty" class="jv-pill jv-pill--warn">Unsaved changes</span>
          <span v-if="selectedPersona?.imported_from" class="jv-pill jv-pill--ghost">imported_from = {{ selectedPersona.imported_from }}</span>
        </header>

        <div class="personas__grid">
          <label class="personas__field">
            <span>Name</span>
            <input class="jv-input" v-model="draft.name" @input="markDirty" />
          </label>

          <label class="personas__field">
            <span>Voice profile</span>
            <select class="jv-input" v-model="draft.voice_id" @change="markDirty">
              <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} ({{ v.id }})</option>
            </select>
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

          <div class="personas__field">
            <span>LLM rewrite</span>
            <div class="personas__toggle-row">
              <JvToggle v-model="draft.llm_rewrite_enabled" @update:modelValue="markDirty" />
              <span class="jv-muted personas__toggle-hint">Rewrite each generation in character before TTS.</span>
            </div>
          </div>

          <label class="personas__field">
            <span>LLM model</span>
            <select
              class="jv-input"
              v-model="draft.llm_model"
              :disabled="!draft.llm_rewrite_enabled"
              @change="markDirty"
            >
              <option v-for="m in LLM_MODELS" :key="m.id" :value="m.id">{{ m.label }}</option>
            </select>
          </label>

          <label class="personas__field personas__field--wide">
            <span>Personality</span>
            <textarea
              class="jv-input personas__textarea"
              v-model="draft.bio"
              placeholder="A retired racetrack tout with three teeth and four lies for every truth. Speaks in fragments. Calls everyone &quot;boss.&quot; Suspicious of cops. Comfortable with silence…"
              @input="markDirty"
            />
            <p class="jv-muted personas__hint">Used by the <strong>🎲 Compose</strong> action in Generate and by the LLM-rewrite path when the toggle above is on. Up to 2000 characters.</p>
          </label>

          <div class="personas__field personas__field--wide">
            <span>Default delivery overlay</span>
            <div class="personas__chips">
              <span v-if="!Object.keys(draft.default_delivery || {}).length" class="jv-muted">No defaults set — uses the engine + voice defaults at render time.</span>
              <span
                v-for="(value, key) in draft.default_delivery"
                :key="key"
                class="jv-chip-card personas__chip"
              >
                {{ deliveryChipLabel(key) }}: <strong>{{ deliveryChipValue(key, value) }}</strong>
              </span>
              <button
                class="jv-btn jv-btn--ghost jv-btn--sm"
                type="button"
                @click="pushToast({ kind: 'info', title: 'Open delivery overlay', description: 'Edit Speed / Pitch / Pause-after in the Generate tab and click “Save as default delivery”.' })"
              >+ Edit</button>
            </div>
          </div>
        </div>

        <div class="jv-divider" />

        <div class="personas__actions">
          <JvButton variant="secondary" label="Auto-create from JustWrite character roster" @click="autoCreateFromJustWrite" />
          <span class="personas__spacer" />
          <JvButton variant="primary" label="Save" :disabled="!dirty" @click="savePersona" />
          <button class="jv-btn jv-btn--danger-outline" type="button" @click="deletePersona">Delete</button>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.personas {
  display: grid;
  grid-template-columns: 320px 1fr;
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
.personas__item-name { font-weight: 600; font-size: 14px; }
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

.personas__toggle-row {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}
.personas__toggle-hint { font-size: 12px; }

.personas__textarea {
  min-height: 140px;
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
.personas__chip { font-size: 13px; }

.personas__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.personas__spacer { flex: 1; }
</style>
