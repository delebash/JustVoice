<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  ProfilesView — voice-profile management.

  Voicebox parity: matches the role of VoiceProfiles/ProfileList +
  ProfileForm. A profile bundles a name + language + preset/clone/design
  voice + personality prompt + default engine + effects chain + lexicon
  override. The Generate view's "🎭 Profile" chip selects from this list;
  the "🎲 Compose" button uses `personality` to write a fresh in-character
  line via the LLM endpoint stub.

  CRUD via /v1/profiles (api/profiles_api.py).
-->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvTextarea from "../components/jv/JvTextarea.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvField from "../components/jv/JvField.vue";

const api = useApi();

const profiles = ref([]);
const search = ref("");
const editing = ref(null); // null | "new" | profile object
const draft = ref(emptyDraft());
const saving = ref(false);

function emptyDraft() {
  return {
    name: "",
    description: "",
    language: "en",
    voice_type: "cloned",
    preset_engine: null,
    preset_voice_id: null,
    design_prompt: null,
    default_engine: null,
    effects_chain: [],
    default_lexicon_id: null,
    personality: "",
  };
}

const filtered = computed(() => {
  if (!search.value.trim()) return profiles.value;
  const q = search.value.trim().toLowerCase();
  return profiles.value.filter(
    (p) => (p.name || "").toLowerCase().includes(q) ||
           (p.description || "").toLowerCase().includes(q),
  );
});

async function load() {
  const data = await api.safeRequest("/v1/profiles", { profiles: [] });
  profiles.value = data?.profiles ?? [];
}

function openNew() {
  draft.value = emptyDraft();
  editing.value = "new";
}

function openEdit(p) {
  draft.value = {
    name: p.name,
    description: p.description || "",
    language: p.language || "en",
    voice_type: p.voice_type || "cloned",
    preset_engine: p.preset_engine || null,
    preset_voice_id: p.preset_voice_id || null,
    design_prompt: p.design_prompt || null,
    default_engine: p.default_engine || null,
    effects_chain: p.effects_chain || [],
    default_lexicon_id: p.default_lexicon_id || null,
    personality: p.personality || "",
  };
  editing.value = p;
}

function closeModal() {
  editing.value = null;
}

async function save() {
  if (!draft.value.name.trim()) {
    pushToast({ message: "Name is required.", kind: "error" });
    return;
  }
  saving.value = true;
  try {
    const body = { ...draft.value };
    if (editing.value === "new") {
      await api.request("/v1/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      pushToast({ message: "Profile created." });
    } else {
      await api.request(`/v1/profiles/${editing.value.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      pushToast({ message: "Profile updated." });
    }
    closeModal();
    await load();
  } catch (e) {
    pushToast({ message: `Save failed: ${e.message || e}`, kind: "error" });
  } finally {
    saving.value = false;
  }
}

async function remove(p) {
  const ok = await confirmDialog({
    title: "Delete profile?",
    message: `"${p.name}" will be permanently removed. Generations bound to this profile keep their audio.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/profiles/${p.id}`, { method: "DELETE" });
    await load();
    pushToast({ message: "Profile deleted." });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  }
}

async function testCompose(p) {
  try {
    const r = await api.request(`/v1/profiles/${p.id}/compose`, { method: "POST" });
    if (r?.text) pushToast({ message: `Composed: "${r.text}"`, duration: 6000 });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("501") || msg.includes("LLM service not configured")) {
      pushToast({
        message: "Compose unavailable — wire an LLM service in Settings → External.",
        kind: "warning",
        duration: 6000,
      });
    } else {
      pushToast({ message: `Compose failed: ${msg}`, kind: "error" });
    }
  }
}

onMounted(load);
</script>

<template>
  <div class="profiles-view">
    <div class="jv-row" style="margin-bottom: 14px; gap: 10px">
      <JvInput
        v-model="search"
        placeholder="Search profiles…"
        style="flex: 1; max-width: 360px"
      />
      <span class="jv-spacer" />
      <JvButton variant="primary" label="+ New profile" @click="openNew" />
    </div>

    <div v-if="!filtered.length" class="jv-card">
      <p class="jv-table__empty" v-if="!profiles.length">
        No profiles yet. Create one to bundle a voice + personality + default effects, then
        pick it from the Generate tab's <strong>🎭 Profile</strong> chip.
      </p>
      <p class="jv-table__empty" v-else>No profiles match "{{ search }}".</p>
    </div>

    <div v-else class="profiles-grid">
      <div v-for="p in filtered" :key="p.id" class="jv-card profile-card">
        <div class="profile-card__header">
          <strong class="profile-card__name">{{ p.name }}</strong>
          <span class="jv-pill jv-pill--ghost">{{ p.voice_type }}</span>
        </div>
        <p v-if="p.description" class="jv-muted profile-card__desc">{{ p.description }}</p>
        <div class="profile-card__meta">
          <span class="jv-muted">{{ p.language }}</span>
          <span v-if="p.default_engine" class="jv-muted">· {{ p.default_engine }}</span>
          <span v-if="p.generation_count" class="jv-muted">· {{ p.generation_count }} gens</span>
          <span v-if="p.sample_count" class="jv-muted">· {{ p.sample_count }} samples</span>
        </div>
        <p v-if="p.personality" class="profile-card__personality">
          🎭 <em>{{ p.personality.slice(0, 120) }}{{ p.personality.length > 120 ? "…" : "" }}</em>
        </p>
        <div class="jv-row profile-card__actions">
          <JvButton variant="ghost" size="sm" label="Edit" @click="openEdit(p)" />
          <JvButton
            v-if="p.personality"
            variant="ghost"
            size="sm"
            label="🎲 Test compose"
            @click="testCompose(p)"
          />
          <span class="jv-spacer" />
          <JvButton variant="danger-outline" size="sm" label="Delete" @click="remove(p)" />
        </div>
      </div>
    </div>

    <!-- ── Edit / create modal ──────────────────────────────────────── -->
    <div v-if="editing" class="profile-modal__backdrop" @click.self="closeModal">
      <div class="profile-modal jv-card">
        <div class="profile-modal__header">
          <h3>{{ editing === "new" ? "New profile" : `Edit ${editing.name}` }}</h3>
          <JvButton variant="ghost" size="sm" label="✕" @click="closeModal" />
        </div>

        <div class="profile-modal__grid">
          <JvField label="Name *" layout="block">
            <JvInput v-model="draft.name" :spellcheck="false" />
          </JvField>
          <JvField label="Language" layout="block">
            <JvSelect
              v-model="draft.language"
              :options="[
                { label: 'English', value: 'en' },
                { label: 'Spanish', value: 'es' },
                { label: 'French', value: 'fr' },
                { label: 'German', value: 'de' },
                { label: 'Italian', value: 'it' },
                { label: 'Japanese', value: 'ja' },
                { label: 'Chinese', value: 'zh' },
                { label: 'Korean', value: 'ko' },
                { label: 'Portuguese', value: 'pt' },
                { label: 'Russian', value: 'ru' },
              ]"
            />
          </JvField>
          <JvField label="Voice type" layout="block">
            <JvSelect
              v-model="draft.voice_type"
              :options="[
                { label: 'Cloned (from reference WAV)', value: 'cloned' },
                { label: 'Preset (engine built-in)', value: 'preset' },
                { label: 'Designed (text-prompted)', value: 'designed' },
              ]"
            />
          </JvField>
          <JvField label="Default engine" layout="block">
            <JvSelect
              v-model="draft.default_engine"
              :options="[
                { label: '(no preference)', value: null },
                { label: 'Chatterbox', value: 'chatterbox' },
                { label: 'Chatterbox Turbo', value: 'chatterbox-turbo' },
                { label: 'Chatterbox Multilingual', value: 'chatterbox-multilingual' },
                { label: 'Kokoro', value: 'kokoro' },
                { label: 'Qwen3-TTS', value: 'qwen3' },
                { label: 'LuxTTS', value: 'luxtts' },
                { label: 'TADA', value: 'tada' },
                { label: 'Higgs Audio', value: 'higgs-audio' },
                { label: 'Dia', value: 'dia' },
              ]"
            />
          </JvField>
        </div>

        <JvField label="Description" layout="block" style="margin-top: 16px">
          <JvInput v-model="draft.description" placeholder="Short note about this voice" />
        </JvField>

        <JvField label="Personality prompt" layout="block" style="margin-top: 16px">
          <JvTextarea
            v-model="draft.personality"
            autosize
            :min-height-px="80"
            :max-height-px="240"
            placeholder="e.g. 'A weary detective with a gravelly voice. Cynical, dry humor. Speaks in clipped sentences.' &#10;&#10;Drives the Compose button in Generate — when set, an LLM writes a fresh in-character line."
          />
          <span class="jv-field__hint">
            Optional. When set, the Generate tab shows the 🎲 Compose button for this profile.
          </span>
        </JvField>

        <div v-if="draft.voice_type === 'designed'" style="margin-top: 16px">
          <JvField label="Design prompt (Qwen3-style voice description)" layout="block">
            <JvTextarea
              v-model="draft.design_prompt"
              :rows="3"
              placeholder="e.g. 'Warm narrative voice, calm tempo, slight British accent'"
            />
          </JvField>
        </div>

        <div class="profile-modal__footer">
          <JvButton variant="ghost" label="Cancel" @click="closeModal" />
          <JvButton variant="primary" :loading="saving" :disabled="saving" label="Save" @click="save" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profiles-view { padding: 24px 32px 64px; }

.profiles-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.profile-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 16px;
}
.profile-card__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.profile-card__name { font-size: 15px; }
.profile-card__desc { font-size: 12.5px; margin: 0; }
.profile-card__meta { font-size: 11.5px; display: flex; gap: 6px; flex-wrap: wrap; }
.profile-card__personality {
  font-size: 12px;
  background: var(--surface-2);
  border-radius: 4px;
  padding: 8px 10px;
  margin: 4px 0 0;
}
.profile-card__actions { margin-top: auto; padding-top: 6px; gap: 6px; }

.profile-modal__backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 8000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}
.profile-modal {
  width: min(640px, 100%);
  max-height: 90vh;
  overflow-y: auto;
  padding: 20px 24px;
}
.profile-modal__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}
.profile-modal__header h3 { margin: 0; }
.profile-modal__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}
.profile-modal__footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 20px;
}
</style>
