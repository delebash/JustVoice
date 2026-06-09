<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";

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
  <div class="cache-view">
    <!-- ── Total stats ── -->
    <section class="jv-card jv-section">
      <h3 class="jv-section__title">Total on disk</h3>

      <div v-if="stats" class="stats-grid">
        <div class="jv-chip-card">
          <div>
            <div class="stat-label">Entries</div>
            <strong class="stat-value">{{ stats.total_entries_on_disk }}</strong>
            <div class="jv-muted stat-sub">held across all scopes</div>
          </div>
        </div>
        <div class="jv-chip-card">
          <div>
            <div class="stat-label">Disk used</div>
            <strong class="stat-value">{{ fmtMB(stats.total_bytes_on_disk) }} <span class="stat-unit">MB</span></strong>
            <div class="jv-muted stat-sub">across scopes</div>
          </div>
        </div>
        <div class="jv-chip-card">
          <div>
            <div class="stat-label">Memory</div>
            <strong class="stat-value">{{ stats.memory_entries }}</strong>
            <div class="jv-muted stat-sub">{{ fmtMB(stats.memory_bytes) }} MB in-process</div>
          </div>
        </div>
        <div class="stat-action">
          <JvButton variant="danger-outline" label="Purge all scopes" @click="purgeAll" />
        </div>
      </div>
    </section>

    <!-- ── By scope ── -->
    <section class="jv-card jv-section">
      <h3 class="jv-section__title">By scope</h3>

      <template v-if="stats && Object.keys(stats.scopes || {}).length">
        <table class="jv-table">
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
              <td><span class="jv-mono">{{ scope }}</span></td>
              <td>{{ scopeStats.entries_on_disk }}</td>
              <td>{{ fmtMB(scopeStats.bytes_on_disk) }}</td>
              <td>
                <div class="jv-table__actions">
                  <JvButton variant="danger-outline" size="sm" label="Purge" @click="purgeScope(scope)" />
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </template>
      <p v-else class="jv-table__empty">Cache is empty.</p>
    </section>
  </div>
</template>

<style scoped>
.cache-view { padding: 32px; max-width: 860px; display: flex; flex-direction: column; gap: 24px; }
.stats-grid { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-top: 12px; }
.stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 600; color: var(--ink); }
.stat-unit { font-size: 13px; font-weight: 400; color: var(--ink-2); }
.stat-sub { font-size: 11px; margin-top: 2px; }
.stat-action { display: flex; align-items: flex-end; padding-bottom: 4px; }
</style>
