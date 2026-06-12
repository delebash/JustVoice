<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  CacheView — disk-LRU render cache stats + granular prune actions.
  Preview parity: 4 prune buttons (by-date / by-voice / by-engine /
  unfavorited) sit above the existing by-scope table. Destructive
  actions confirm via prompt; the backend filter params land per the
  `/v1/cache/clear` server-side dispatch.
-->
<script setup>
import { computed, ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";

const api = useApi();
const stats = ref(null);
const voices = ref([]);
const engines = ref([]);
const recent = ref([]);

function fmtMB(bytes) {
  return (bytes / 1024 / 1024).toFixed(1);
}
function fmtAge(iso) {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

const totalSizeGb = computed(() => stats.value ? (stats.value.total_bytes_on_disk / 1024 / 1024 / 1024).toFixed(2) : "0");
const totalEntries = computed(() => stats.value?.total_entries_on_disk ?? 0);

async function loadStats() {
  stats.value = await api.safeRequest("/v1/cache/stats", { total_bytes_on_disk: 0, total_entries_on_disk: 0, scopes: {} });
}
async function loadPickers() {
  try {
    const v = await api.safeRequest("/v1/voices", { voices: [] });
    voices.value = v?.voices ?? [];
    const e = await api.safeRequest("/v1/engines", { engines: [] });
    engines.value = e?.engines ?? [];
    const r = await api.safeRequest("/v1/cache/recent", { entries: [] });
    recent.value = r?.entries ?? [];
  } catch { /* fail silent */ }
}

async function purgeAll() {
  const ok = await confirmDialog({
    title: "Purge all cache?",
    message: `This will delete every cached render across all scopes (${totalEntries.value} entries, ${totalSizeGb.value} GB). Cannot be undone.`,
    danger: true,
    confirmLabel: "Purge all",
  });
  if (!ok) return;
  try {
    await api.request("/v1/cache/clear", { method: "POST" });
    await loadStats();
    pushToast({ kind: "success", title: "Cache purged" });
  } catch (e) {
    pushToast({ kind: "error", title: "Purge failed", description: String(e?.message ?? e) });
  }
}

async function purgeScope(scope) {
  try {
    await api.request(`/v1/cache/clear?scope=${encodeURIComponent(scope)}`, { method: "POST" });
    await loadStats();
    pushToast({ kind: "success", title: `Scope "${scope}" purged` });
  } catch (e) {
    pushToast({ kind: "error", title: "Purge failed", description: String(e?.message ?? e) });
  }
}

async function pruneOlderThan(days) {
  const ok = await confirmDialog({
    title: `Prune entries older than ${days} days?`,
    message: "Recent entries (last 30 days) are kept. This cannot be undone.",
    danger: true,
    confirmLabel: "Prune",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/cache/clear?older_than_days=${days}`, { method: "POST" });
    await loadStats();
    pushToast({ kind: "success", title: `Pruned entries older than ${days} days` });
  } catch (e) {
    pushToast({ kind: "error", title: "Prune failed", description: String(e?.message ?? e) });
  }
}
async function pruneByVoice() {
  // promptDialog with a select — the native prompt() it replaces is
  // banned (returns null in the Tauri webview) and made users TYPE an id.
  const picked = await promptDialog({
    title: "Prune cache by voice",
    fields: [{
      key: "id",
      label: "Voice",
      type: "select",
      defaultValue: voices.value[0]?.id ?? "",
      options: voices.value.map((v) => ({ value: v.id, label: `${v.name} (${v.id})` })),
    }],
    confirmLabel: "Prune",
  });
  const id = picked?.id;
  if (!id) return;
  try {
    await api.request(`/v1/cache/clear?voice_id=${encodeURIComponent(id)}`, { method: "POST" });
    await loadStats();
    pushToast({ kind: "success", title: `Pruned voice "${id}"` });
  } catch (e) {
    pushToast({ kind: "error", title: "Prune failed", description: String(e?.message ?? e) });
  }
}
async function pruneByEngine() {
  const picked = await promptDialog({
    title: "Prune cache by engine",
    fields: [{
      key: "id",
      label: "Engine",
      type: "select",
      defaultValue: engines.value[0]?.id ?? "",
      options: engines.value.map((e) => ({ value: e.id, label: `${e.name} (${e.id})` })),
    }],
    confirmLabel: "Prune",
  });
  const id = picked?.id;
  if (!id) return;
  try {
    await api.request(`/v1/cache/clear?engine=${encodeURIComponent(id)}`, { method: "POST" });
    await loadStats();
    pushToast({ kind: "success", title: `Pruned engine "${id}"` });
  } catch (e) {
    pushToast({ kind: "error", title: "Prune failed", description: String(e?.message ?? e) });
  }
}
async function pruneUnfavorited() {
  const ok = await confirmDialog({
    title: "Prune unfavorited?",
    message: "Removes all cached renders not pinned as favorites. Favorited entries (★) are preserved.",
    danger: true,
    confirmLabel: "Prune unfavorited",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/cache/clear?favorited=false`, { method: "POST" });
    await loadStats();
    pushToast({ kind: "success", title: "Pruned unfavorited entries" });
  } catch (e) {
    pushToast({ kind: "error", title: "Prune failed", description: String(e?.message ?? e) });
  }
}

async function deleteEntry(id) {
  try {
    await api.request(`/v1/generations/${encodeURIComponent(id)}`, { method: "DELETE" });
    recent.value = recent.value.filter((r) => r.id !== id);
    await loadStats();
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

onMounted(async () => {
  await loadStats();
  await loadPickers();
});
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

    <!-- ── Actions: granular prune (preview parity §Cache Actions) ── -->
    <section class="jv-card jv-section">
      <h3 class="jv-section__title">Actions</h3>
      <div class="cache-view__actions">
        <button class="jv-btn jv-btn--secondary" @click="pruneOlderThan(30)">Prune &gt; 30 days</button>
        <button class="jv-btn jv-btn--secondary" @click="pruneByVoice">Prune by voice…</button>
        <button class="jv-btn jv-btn--secondary" @click="pruneByEngine">Prune by engine…</button>
        <button class="jv-btn jv-btn--secondary" @click="pruneUnfavorited">Prune unfavorited</button>
        <span class="jv-spacer" />
        <JvButton variant="danger-outline" :label="`Clear all (${totalSizeGb} GB · ${totalEntries} entries)`" @click="purgeAll" />
      </div>
      <p class="jv-muted cache-view__actions-hint">
        All destructive actions require confirmation. Filtered prune uses the <code>/v1/cache/clear</code> endpoint with <code>older_than_days</code> / <code>voice_id</code> / <code>engine</code> / <code>favorited</code> query params.
      </p>
    </section>

    <!-- ── Recent entries (preview parity §Cache Recent entries) ── -->
    <section v-if="recent.length" class="jv-card jv-section">
      <h3 class="jv-section__title">Recent entries</h3>
      <table class="jv-table">
        <thead>
          <tr>
            <th>Engine</th>
            <th>Voice</th>
            <th>Text preview</th>
            <th>Size</th>
            <th>Age</th>
            <th class="right"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in recent" :key="r.id">
            <td><span class="jv-pill jv-pill--ghost">{{ r.engine }}</span></td>
            <td>{{ r.voice }}</td>
            <td class="jv-muted">{{ r.text_preview || "—" }}</td>
            <td>{{ fmtMB(r.size_bytes || 0) }} MB</td>
            <td>{{ fmtAge(r.created_at) }}</td>
            <td class="right">
              <button class="jv-btn jv-btn--ghost jv-btn--sm" @click="deleteEntry(r.id)" title="Delete this entry">✕</button>
            </td>
          </tr>
        </tbody>
      </table>
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
.cache-view { padding: 32px; max-width: var(--shell-form); display: flex; flex-direction: column; gap: 24px; }
.stats-grid { display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end; margin-top: 12px; }
.stat-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3); margin-bottom: 4px; }
.stat-value { font-size: 22px; font-weight: 600; color: var(--ink); }
.stat-unit { font-size: 13px; font-weight: 400; color: var(--ink-2); }
.stat-sub { font-size: 11px; margin-top: 2px; }
.stat-action { display: flex; align-items: flex-end; padding-bottom: 4px; }

.cache-view__actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.cache-view__actions-hint { font-size: 11.5px; margin: 10px 0 0; }
</style>
