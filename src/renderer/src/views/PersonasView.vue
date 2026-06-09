<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvSelect from "../components/jv/JvSelect.vue";
import JvField from "../components/jv/JvField.vue";

const api = useApi();

const personas = ref([]);
const voices = ref([]);

const newName = ref("");
const newVoiceId = ref("");

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString();
}

async function loadPersonas() {
  const data = await api.request("/v1/personas");
  personas.value = data.personas;
}

async function loadVoices() {
  const data = await api.request("/v1/voices");
  voices.value = data.voices;
}

async function bindPersona() {
  if (!newName.value.trim() || !newVoiceId.value) return;
  try {
    await api.request("/v1/personas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: newName.value.trim(),
        voice_id: newVoiceId.value,
        default_delivery: {},
      }),
    });
    newName.value = "";
    newVoiceId.value = "";
    await loadPersonas();
    pushToast({ message: "Persona bound." });
  } catch (e) {
    pushToast({ message: `Failed to bind persona: ${e.message || e}`, kind: "error" });
  }
}

async function releasePersona(id, name) {
  const ok = await confirmDialog({
    title: "Release persona?",
    message: `"${name}" will be unbound.`,
    danger: true,
    confirmLabel: "Release",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/personas/${id}`, { method: "DELETE" });
    await loadPersonas();
    pushToast({ message: "Persona released." });
  } catch (e) {
    pushToast({ message: `Failed to release persona: ${e.message || e}`, kind: "error" });
  }
}

const voiceOptions = () =>
  voices.value.map((v) => ({ label: `${v.name} — ${v.id}`, value: v.id }));

onMounted(() => {
  loadPersonas();
  loadVoices();
});
</script>

<template>
  <!-- ─── Bind a new persona ─── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">Bind a new persona</h3>
      </div>
      <div class="bind-grid">
        <JvField label="Name" layout="block">
          <JvInput v-model="newName" placeholder="Sarah, Mr Holmes, the narrator…" />
        </JvField>
        <JvField label="Voice" layout="block">
          <JvSelect
            v-model="newVoiceId"
            :options="voiceOptions()"
            placeholder="Select a voice…"
          />
        </JvField>
      </div>
      <div style="margin-top: 14px;">
        <JvButton
          variant="primary"
          :disabled="!newName.trim() || !newVoiceId"
          @click="bindPersona"
        >Bind persona</JvButton>
      </div>
    </div>
  </div>

  <!-- ─── Personas table ─── -->
  <div class="jv-section">
    <div class="jv-card">
      <div class="jv-card__header">
        <h3 class="jv-card__title">{{ personas.length }} bound</h3>
      </div>
      <table v-if="personas.length" class="jv-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Voice</th>
            <th>Bound</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in personas" :key="p.id">
            <td><strong>{{ p.name }}</strong></td>
            <td><code class="jv-mono">{{ p.voice_id }}</code></td>
            <td class="jv-muted">{{ fmtDate(p.created_at) }}</td>
            <td class="jv-table__actions">
              <JvButton variant="danger-outline" size="sm" @click="releasePersona(p.id, p.name)">Release</JvButton>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-else class="jv-muted" style="padding: 16px 0; font-style: italic;">No personas bound.</p>
    </div>
  </div>
</template>

<style scoped>
.bind-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}
</style>
