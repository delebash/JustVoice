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
import { computed, onMounted, ref, watch, nextTick } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import { UiButton, UiInput, UiTextarea } from "@delebash/llm-ui";
import EmptyState from "../components/EmptyState.vue";
import EffectsChainEditorModal from "../components/EffectsChainEditorModal.vue";
import { usePersonasStore } from "../stores/personas.js";
import { useVoicesStore } from "../stores/voices.js";
import { useEnginesStore } from "../stores/engines.js";
import { useLexiconsStore } from "../stores/lexicons.js";
import { useProjectsStore } from "../stores/projects.js";

const api = useApi();

// All five lists come from shared stores (single source of truth).
// Mutations here call loadAll() which reload()s the stores, so every
// other view (Chapters, Studio, Generate, …) reflects the change.
const personasStore = usePersonasStore();
const voicesStore = useVoicesStore();
const enginesStore = useEnginesStore();
const lexiconsStore = useLexiconsStore();
const projectsStore = useProjectsStore();
const personas = computed(() => personasStore.items);
const voices = computed(() => voicesStore.items);
const engines = computed(() => enginesStore.items);
const lexicons = computed(() => lexiconsStore.items);
const projects = computed(() => projectsStore.items);
const usage = ref({});  // { persona_id: [...] } — per-view, not shared
const selectedId = ref(null);
// `creating` opens the editor dialog for a brand-new (unsaved) persona —
// one surface, not a prompt-then-dialog (G-PERSONA-1). Save commits it.
const creating = ref(false);
const nameInput = ref(null);  // autofocus target on open
const loading = ref(false);

const FILTERS = ["all", "used", "unused", "by-project"];
const filter = ref("all");
const filterProjectId = ref("");
const search = ref("");

// Editable buffer for the selected persona — committed via "Save".
const draft = ref(null);
const dirty = ref(false);
// Declared BEFORE the immediate selectedPersona watch below — it calls
// loadUsageDetail on first run, which writes these (TDZ crash if later).
const usageDetail = ref(null);
const usageDetailBusy = ref(false);

const selectedPersona = computed(() =>
  personas.value.find((p) => p.id === selectedId.value) ?? null,
);

const filteredPersonas = computed(() => {
  let list = personas.value;
  if (filter.value === "used") list = list.filter((p) => (usage.value[p.id] || []).length > 0);
  if (filter.value === "unused") list = list.filter((p) => !(usage.value[p.id] || []).length);
  if (filter.value === "by-project" && filterProjectId.value) {
    list = list.filter((p) =>
      (usage.value[p.id] || []).some((u) => u.project_id === filterProjectId.value),
    );
  }
  const q = search.value.trim().toLowerCase();
  if (q) list = list.filter((p) =>
    (p.name || "").toLowerCase().includes(q) || (p.bio || "").toLowerCase().includes(q));
  return list;
});

function usageCount(personaId) {
  return (usage.value[personaId] || []).length;
}

// Live Personality-field verdict for the draft's voice engine — does it
// actually consume the text as an instruct/style prompt at render time?
const instructStatus = computed(() => {
  if (!draft.value) return null;
  const voice = voices.value.find((v) => v.id === draft.value.voice_id);
  if (!voice) {
    return { ok: false, text: "No voice cast yet — whether Personality reaches the TTS depends on the engine you pick." };
  }
  const eng = engines.value.find((e) => e.id === voice.engine);
  const supports = (eng?.capabilities || []).includes("instruct_field");
  return supports
    ? { ok: true, text: `✓ ${eng?.name || voice.engine} takes direction — it performs this text when rendering.` }
    : { ok: false, text: `✗ ${eng?.name || voice.engine} doesn't take direction — this text only guides Smart-assign, not the audio.` };
});

// Reload everything: the five shared stores + the per-view usage map.
// Called on mount and after every persona mutation so the change
// propagates to all consumers.
async function loadAll() {
  loading.value = true;
  try {
    const [, , , , , uRes] = await Promise.all([
      personasStore.reload(),
      voicesStore.reload(),
      enginesStore.reload(),
      lexiconsStore.reload(),
      projectsStore.reload(),
      api.safeRequest("/v1/personas/usage", { usage: {} }),
    ]);
    usage.value = uRes?.usage ?? {};
    // No auto-select: the card grid is the landing view; clicking a
    // card drills into the editor (grid pattern, user decision 2026-06-12).
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

function blankDraft() {
  return {
    id: null, name: "", voice_id: "", language: "en", avatar_path: "",
    bio: "", personality: "", engine_override: "", lexicon_id: "",
    default_delivery: {}, effects_chain: [],
    llm_rewrite_enabled: false, llm_model: "qwen-1.7b-local",
  };
}

// Open the editor directly on a blank draft (no prompt, no premature
// POST) and focus the name field. Save commits the create (G-PERSONA-1).
function createBlank() {
  draft.value = blankDraft();
  dirty.value = false;
  creating.value = true;
  usageDetail.value = null;  // a new persona has no usage to show
  nextTick(() => nameInput.value?.focus());
}

// Single close path for the editor dialog — used by Save (on success),
// Cancel, the ✕, and backdrop click. Resets create state + draft.
function closeEditor() {
  creating.value = false;
  selectedId.value = null;
  draft.value = null;
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
  const isNew = creating.value;
  try {
    if (isNew) {
      await api.request("/v1/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      await api.request(`/v1/personas/${draft.value.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }
    await loadAll();
    closeEditor();  // dialog Save closes on success (G-PERSONA-2)
    pushToast({ kind: "success", title: isNew ? "Persona created" : "Persona saved" });
  } catch (e) {
    pushToast({ kind: "error", title: "Save failed", description: String(e?.message ?? e) });
  }
}

// Single delete path — called from each list row (Delete lives on the
// row, NOT the editor footer, per G-PERSONA-4). Keeps the snapshot Undo.
async function removePersona(p) {
  const ok = await confirmDialog({
    title: "Delete persona?",
    message: `"${p.name}" will be removed. Voice and lexicon are kept (only the binding is removed).`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  // Full shape captured so Undo can re-create. The id may not be
  // reusable post-delete; we POST the body and accept the new id.
  const snapshot = { ...p };
  const personaName = snapshot.name || "Persona";
  try {
    await api.request(`/v1/personas/${snapshot.id}`, { method: "DELETE" });
    if (selectedId.value === snapshot.id) closeEditor();
    await loadAll();
    pushToast({
      kind: "success",
      message: `${personaName} deleted.`,
      duration: 6000,
      action: {
        label: "Undo",
        fn: async () => {
          try {
            await api.request("/v1/personas", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
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
              }),
            });
            await loadAll();
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
  bits.push(v?.name || (p.voice_id ? p.voice_id : "no voice yet"));
  if (p.bio) bits.push(p.bio.slice(0, 64) + (p.bio.length > 64 ? "…" : ""));
  return bits.join(" · ") || "—";
}

// Same avatar palette/hash as the Studio cast cards — one character,
// one colour, everywhere.
const AVATAR_COLORS = ["#3a7d63", "#7c5cbf", "#b3552e", "#2e7d8a", "#a8763e", "#947b2f", "#c98aa7", "#5b7a99", "#b04a3e"];
function colorFor(name) {
  let h = 0;
  for (const c of String(name || "?")) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

onMounted(loadAll);
</script>

<template>
  <div class="personas">
    <!-- ── Card grid (nothing selected) ─────────────────────────────── -->
    <template v-if="!draft">
      <div class="jv-lib-toolbar">
        <UiInput v-model="search" placeholder="Search personas…" size="small" width="name" />
        <!-- Library-mode filter chips: All / Used / Unused / By project.
             Cross-project Personas are the model — these help find them. -->
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
          class="jv-input jv-input--sm jv-w-name"
          v-model="filterProjectId"
        >
          <option value="">— pick a project —</option>
          <option v-for="pr in projects" :key="pr.id" :value="pr.id">{{ pr.name }}</option>
        </select>
        <span class="jv-spacer" />
        <UiButton intent="primary" size="small" label="+ New persona" @click="createBlank" />
      </div>

      <div v-if="loading" class="jv-muted personas__empty">Loading…</div>
      <EmptyState
        v-else-if="!filteredPersonas.length && !personas.length"
        icon="Sparkle"
        title="No characters yet"
        message="A persona pairs a name + bio + voice + personality. Audiobook cast, game NPCs, podcast hosts all live here."
        action-label="+ Create your first persona"
        @action="createBlank"
      />
      <div v-else-if="!filteredPersonas.length" class="personas__empty jv-muted">
        No personas match this filter.
      </div>
      <table v-else class="jv-table">
        <thead>
          <tr><th>Persona</th><th>Voice</th><th style="width:110px">Used in</th><th class="jv-table__actions" style="width:150px">Actions</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in filteredPersonas" :key="p.id" class="personas__row" title="Click to edit" @click="selectedId = p.id">
            <td>
              <span class="personas__card-avatar personas__avatar-sm" :style="{ background: colorFor(p.name) }">{{ (p.name || "?").charAt(0).toUpperCase() }}</span>
              <strong>{{ p.name }}</strong>
              <div v-if="p.bio" class="jv-muted" style="font-size:11.5px; margin-left:36px">{{ p.bio.slice(0, 70) }}{{ p.bio.length > 70 ? "…" : "" }}</div>
            </td>
            <td class="jv-muted">{{ voices.find((v) => v.id === p.voice_id)?.name || (p.voice_id || "no voice yet") }}</td>
            <td><span class="jv-pill" :class="usageCount(p.id) > 0 ? 'jv-pill--green' : 'jv-pill--ghost'">{{ usageCount(p.id) }} project{{ usageCount(p.id) === 1 ? '' : 's' }}</span></td>
            <td class="jv-table__actions" @click.stop>
              <UiButton intent="ghost" size="small" label="Edit" @click="selectedId = p.id" />
              <UiButton intent="danger-outline" size="small" label="Delete" @click="removePersona(p)" />
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <!-- ── Editor dialog (consolidated pattern 2026-06-12) ───────────── -->
    <div v-else class="jv-overlay" @click.self="closeEditor">
      <div class="jv-modal personas__modal">
        <header class="jv-modal__header">
          <div class="jv-modal__titleblock">
            <span class="jv-modal__eyebrow">{{ creating ? "New persona" : "Persona" }}</span>
            <h3 class="jv-modal__title">{{ draft.name || "(unnamed)" }}</h3>
          </div>
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
          <button type="button" class="jv-modal__close" title="Close" @click="closeEditor">✕</button>
        </header>

      <div class="jv-modal__body">
        <div class="personas__grid">
          <label class="personas__field">
            <span>Name</span>
            <UiInput ref="nameInput" width="name" v-model="draft.name" @input="markDirty" />
          </label>

          <label class="personas__field">
            <span>Voice</span>
            <select class="jv-input jv-w-name" v-model="draft.voice_id" @change="markDirty">
              <option value="">— no voice yet (cast later) —</option>
              <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} ({{ v.id }})</option>
            </select>
          </label>

          <label class="personas__field">
            <span>Language</span>
            <UiInput width="token" v-model="draft.language" @input="markDirty" placeholder="en" />
          </label>

          <label class="personas__field">
            <span>Avatar path</span>
            <UiInput width="path" v-model="draft.avatar_path" @input="markDirty" placeholder="(optional)" />
          </label>

          <label class="personas__field">
            <span>Engine override</span>
            <select class="jv-input jv-w-name" v-model="draft.engine_override" @change="markDirty">
              <option value="">(use voice default)</option>
              <option v-for="e in engines" :key="e.id" :value="e.id">{{ e.name || e.id }}</option>
            </select>
          </label>

          <label class="personas__field">
            <span>Lexicon override</span>
            <select class="jv-input jv-w-name" v-model="draft.lexicon_id" @change="markDirty">
              <option value="">(none — use project default)</option>
              <option v-for="lx in lexicons" :key="lx.id" :value="lx.id">{{ lx.name }}</option>
            </select>
          </label>

          <label class="personas__field personas__field--wide">
            <span>Bio (character context)</span>
            <UiTextarea
              class="personas__textarea"
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
            <UiTextarea
              class="personas__textarea"
              v-model="draft.personality"
              placeholder="Clipped, world-weary noir delivery. Dry wit. Boston accent in stressful moments. Never overshares."
              @input="markDirty"
            />
            <p class="jv-muted personas__hint">
              Passed to instruct-capable engines as the
              <code>instruct</code> / style-prompt field at render time; other
              engines ignore it. <strong>Never an LLM rewrite of the
              manuscript</strong> — the Rewrite button on Generate is the
              explicit tool for that.
            </p>
            <!-- Live verdict for THIS persona's engine (user ask: "how do
                 I know what TTS takes input from bio and personality"). -->
            <p v-if="instructStatus" class="personas__hint" :class="instructStatus.ok ? 'personas__instruct-ok' : 'jv-muted'">
              {{ instructStatus.text }}
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
              <UiButton intent="ghost" size="small" label="+ Edit" @click="openDeliveryHint" />
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
              <UiButton intent="ghost" size="small" label="+ Edit chain" @click="openEffectsEditor" />
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

      </div><!-- /.jv-modal__body -->

      <!-- Dialog footer = Save + Cancel (G-PERSONA-4). Delete lives on
           each list row, not here, so it's never a neighbour to Save. -->
      <footer class="jv-modal__footer">
        <span class="jv-spacer" />
        <UiButton intent="secondary" label="Cancel" @click="closeEditor" />
        <UiButton intent="primary" label="Save" :disabled="!dirty" @click="savePersona" />
      </footer>
      </div>
    </div>

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
  display: flex;
  flex-direction: column;
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

.personas__empty {
  padding: 40px 0;
  font-size: 13px;
  text-align: center;
}

.personas__card {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  cursor: pointer;
}
.personas__card:hover { border-color: var(--accent-line); }
.personas__card-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.personas__card-main { flex: 1; min-width: 0; }
.personas__card-row { display: flex; align-items: center; gap: 8px; }
.personas__card-row strong { flex: 1; font-size: 14.5px; }
.personas__card-meta { font-size: 11.5px; margin-top: 3px; }

.personas__row { cursor: pointer; }
.personas__row:hover td { background: var(--surface-2); }
.personas__avatar-sm { width: 26px; height: 26px; font-size: 12px; vertical-align: middle; margin-right: 8px; }
.personas__modal { width: min(820px, calc(100vw - 32px)); }

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
.personas__instruct-ok { color: var(--accent-ink); font-weight: 600; }

.personas__chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}
.personas__chip-display { font-size: 13px; }

</style>
