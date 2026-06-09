<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";

const api = useApi();
const stats = ref(null);

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}

async function loadStats() {
  try {
    stats.value = await api.request("/v1/cache/stats");
  } catch (e) {
    pushToast({ message: `Failed: ${e.message || e}`, kind: "error" });
  }
}

async function purgeAll() {
  const ok = await confirmDialog({
    title: "Purge all cache?",
    message: "This will delete every cached render across all scopes. This cannot be undone.",
    danger: true,
    confirmLabel: "Purge",
  });
  if (!ok) return;
  try {
    await api.request("/v1/cache/clear", { method: "POST" });
    await loadStats();
    pushToast({ message: "Cache purged." });
  } catch (e) {
    pushToast({ message: `Failed: ${e.message || e}`, kind: "error" });
  }
}

async function purgeScope(scope) {
  try {
    await api.request(`/v1/cache/clear?scope=${encodeURIComponent(scope)}`, { method: "POST" });
    await loadStats();
    pushToast({ message: `Scope "${scope}" purged.` });
  } catch (e) {
    pushToast({ message: `Failed: ${e.message || e}`, kind: "error" });
  }
}

onMounted(loadStats);
</script>

<template>
  <section class="block">
    <h3>Total on disk</h3>
    <div class="stats" v-if="stats">
      <div class="stat">
        <div class="k">Entries</div>
        <div class="v">{{ stats.total_entries_on_disk }}</div>
        <div class="x">held across all scopes</div>
      </div>
      <div class="stat">
        <div class="k">Disk used</div>
        <div class="v">{{ fmtMB(stats.total_bytes_on_disk) }}<span class="unit"> MB</span></div>
        <div class="x">across scopes</div>
      </div>
      <div class="stat">
        <div class="k">Memory</div>
        <div class="v">{{ stats.memory_entries }}</div>
        <div class="x">{{ fmtMB(stats.memory_bytes) }} MB in-process</div>
      </div>
      <div class="stat stat--action">
        <button class="danger" @click="purgeAll">Purge all scopes</button>
      </div>
    </div>
  </section>

  <section class="block">
    <h3>By scope</h3>
    <template v-if="stats && Object.keys(stats.scopes || {}).length">
      <table>
        <thead>
          <tr>
            <th>Scope</th>
            <th>Entries</th>
            <th>Disk · MB</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(scopeStats, scope) in stats.scopes" :key="scope">
            <td><span class="mono">{{ scope }}</span></td>
            <td>{{ scopeStats.entries_on_disk }}</td>
            <td>{{ fmtMB(scopeStats.bytes_on_disk) }}</td>
            <td>
              <button class="bare danger" @click="purgeScope(scope)">Purge</button>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
    <p class="empty" v-else>Cache is empty.</p>
  </section>
</template>

<style scoped>
.stat--action { display: flex; align-items: flex-end; }
</style>
