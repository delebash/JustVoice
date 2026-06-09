<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";

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

onMounted(() => {
  loadPersonas();
  loadVoices();
});
</script>

<template>
  <!-- ─── Bind a new persona ─── -->
  <section class="block stack">
    <h3>Bind a new persona</h3>
    <div class="grid-2">
      <label>
        <span>Name</span>
        <input v-model="newName" placeholder="Sarah, Mr Holmes, the narrator…" />
      </label>
      <label>
        <span>Voice</span>
        <select v-model="newVoiceId">
          <option value="" disabled>Select a voice…</option>
          <option v-for="v in voices" :key="v.id" :value="v.id">{{ v.name }} — {{ v.id }}</option>
        </select>
      </label>
    </div>
    <div>
      <button class="primary" :disabled="!newName.trim() || !newVoiceId" @click="bindPersona">Bind persona</button>
    </div>
  </section>

  <!-- ─── Personas table ─── -->
  <section class="block">
    <h3>{{ personas.length }} bound</h3>
    <table v-if="personas.length">
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
          <td><span class="em">{{ p.name }}</span></td>
          <td><span class="mono">{{ p.voice_id }}</span></td>
          <td>{{ fmtDate(p.created_at) }}</td>
          <td>
            <button class="bare" @click="releasePersona(p.id, p.name)">Release</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="empty">No personas bound.</p>
  </section>
</template>
