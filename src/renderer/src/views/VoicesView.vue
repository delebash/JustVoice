<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";

const api = useApi();
const voices = ref([]);
const engines = ref([]);

async function refresh() {
  const v = await api.request("/v1/voices");
  voices.value = v.voices;
  const e = await api.request("/v1/engines");
  engines.value = e.engines;
}

const orphanIds = computed(() => {
  const ids = new Set(engines.value.map((e) => e.id));
  return voices.value.filter((v) => !ids.has(v.engine)).map((v) => v.id);
});

async function deleteVoice(id) {
  const ok = await confirmDialog({
    title: "Delete voice?",
    message: `Voice "${id}" will be permanently removed.`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/voices/${id}`, { method: "DELETE" });
    await refresh();
    pushToast({ message: `Voice "${id}" deleted.` });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
</script>

<template>
  <section class="block">
    <h3>{{ voices.length }} voices</h3>
    <table v-if="voices.length">
      <thead>
        <tr>
          <th>Name</th>
          <th>Engine</th>
          <th>Source</th>
          <th>Lang</th>
          <th>Id</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="v in voices" :key="v.id" :class="{ orphan: orphanIds.includes(v.id) }">
          <td>
            <strong>{{ v.name }}</strong>
            <span v-if="orphanIds.includes(v.id)" class="tag-orphan">orphan</span>
          </td>
          <td><span class="tag">{{ v.engine }}</span></td>
          <td>{{ v.source }}</td>
          <td>{{ v.language }}</td>
          <td><span class="mono">{{ v.id }}</span></td>
          <td>
            <button v-if="v.source !== 'preset'" class="bare" @click="deleteVoice(v.id)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-else class="endnote">No voices registered. Install + load an engine to see preset voices.</p>
  </section>
</template>

<style scoped>
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; color: var(--muted); }
td { padding: 8px 10px; border-bottom: 1px solid var(--border-soft); }
.mono { font-family: var(--font-mono); font-size: 11px; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 0; background: var(--surface-3); font-size: 11px; }
.tag-orphan { display: inline-block; padding: 2px 8px; margin-left: 8px; background: #fce4e4; color: var(--danger); font-size: 11px; }
.orphan { opacity: 0.7; }
button.bare { background: none; border: none; color: var(--danger); padding: 4px 8px; cursor: pointer; }
</style>
