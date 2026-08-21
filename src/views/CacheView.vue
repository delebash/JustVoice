<!-- SPDX-License-Identifier: MIT -->
<!--
  CacheView — disk-LRU render cache stats + granular prune actions.
  Two storage layers, two prune routes (wiring-audit W1, 2026-06-13):
  cache bins are hash-keyed so /v1/cache/clear honors ONLY scope + age
  (and 400s on identity filters); by-voice / by-engine / unfavorited
  operate on generations via DELETE /v1/generations, whose dry-run
  default lets the confirm dialog show the real count before deleting.
-->
<script setup>
import { computed, ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "@delebash/llm-ui";
import { confirmDialog, promptDialog } from "@delebash/llm-ui";
import { UiButton, UiTag, UiTable } from "@delebash/llm-ui";
import { useVoicesStore } from "../stores/voices.js";
import { useEnginesStore } from "../stores/engines.js";

const api = useApi();
const voicesStore = useVoicesStore();
const enginesStore = useEnginesStore();
const stats = ref(null);
const voices = computed(() => voicesStore.items);
const engines = computed(() => enginesStore.items);
const recent = ref([]);

// Sortable because UiTable gives it for free; `sortable` needs an accessorKey
// even where the header is blank, or getCanSort() is false and the caret never
// appears (the kit documents this).
const RECENT_COLUMNS = [
  { id: "engine", accessorKey: "engine", header: "Engine", sortable: true },
  { id: "voice", accessorKey: "voice", header: "Voice", sortable: true },
  { id: "text_preview", accessorKey: "text_preview", header: "Text preview" },
  { id: "size_bytes", accessorKey: "size_bytes", header: "Size", sortable: true },
  { id: "created_at", accessorKey: "created_at", header: "Age", sortable: true },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%", whiteSpace: "nowrap" } },
];

// `stats.scopes` is a MAP; UiTable takes an array, so the key rides along as a
// field and becomes the row key.
const scopeRows = computed(() =>
  Object.entries(stats.value?.scopes || {}).map(([scope, s]) => ({ scope, ...s })),
);
const SCOPE_COLUMNS = [
  { id: "scope", accessorKey: "scope", header: "Scope", sortable: true },
  { id: "entries_on_disk", accessorKey: "entries_on_disk", header: "Entries", sortable: true },
  { id: "bytes_on_disk", accessorKey: "bytes_on_disk", header: "Disk · MB", sortable: true },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%", whiteSpace: "nowrap" } },
];

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
    await voicesStore.ensureLoaded();
    await enginesStore.ensureLoaded();
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
    message: `Recent entries (last ${days} days) are kept. This cannot be undone.`,
    danger: true,
    confirmLabel: "Prune",
  });
  if (!ok) return;
  try {
    const r = await api.request(`/v1/cache/clear?older_than_days=${days}`, { method: "POST" });
    await loadStats();
    pushToast({ kind: "success", title: `Pruned ${r?.removed ?? 0} entries older than ${days} days` });
  } catch (e) {
    pushToast({ kind: "error", title: "Prune failed", description: String(e?.message ?? e) });
  }
}

// Generation-level prunes. DELETE /v1/generations is dry-run by default,
// so the confirm dialog shows the real count + size before anything dies.
async function pruneGenerations(query, label) {
  try {
    const dry = await api.request(`/v1/generations?${query}`, { method: "DELETE" });
    if (!dry?.deleted_count) {
      pushToast({ kind: "info", title: `Nothing to prune for ${label}` });
      return;
    }
    const ok = await confirmDialog({
      title: `Prune ${label}?`,
      message: `Removes ${dry.deleted_count} renders (${fmtMB(dry.freed_bytes || 0)} MB of audio). Cannot be undone.`,
      danger: true,
      confirmLabel: "Prune",
    });
    if (!ok) return;
    const r = await api.request(`/v1/generations?${query}&confirm=true`, { method: "DELETE" });
    await loadStats();
    await loadPickers();
    pushToast({ kind: "success", title: `Pruned ${r?.deleted_count ?? 0} renders (${label})` });
  } catch (e) {
    pushToast({ kind: "error", title: "Prune failed", description: String(e?.message ?? e) });
  }
}
async function pruneByVoice() {
  // promptDialog with a select — the native prompt() it replaces is
  // banned (returns null in the Tauri webview) and made users TYPE an id.
  const picked = await promptDialog({
    title: "Prune renders by voice",
    fields: [{
      key: "id",
      label: "Voice",
      type: "select",
      defaultValue: voices.value[0]?.id ?? "",
      // Not the id — a cloned voice's is `voice_<32 hex>` (storage/voices.py:76).
      options: voices.value.map((v) => ({ value: v.id, label: `${v.name} (${v.engine})` })),
    }],
    confirmLabel: "Continue",
  });
  const id = picked?.id;
  if (!id) return;
  const name = voices.value.find((v) => v.id === id)?.name ?? id;
  await pruneGenerations(`voice_id=${encodeURIComponent(id)}`, `voice "${name}"`);
}
async function pruneByEngine() {
  const picked = await promptDialog({
    title: "Prune renders by engine",
    fields: [{
      key: "id",
      label: "Engine",
      type: "select",
      defaultValue: engines.value[0]?.id ?? "",
      options: engines.value.map((e) => ({ value: e.id, label: `${e.name} (${e.id})` })),
    }],
    confirmLabel: "Continue",
  });
  const id = picked?.id;
  if (!id) return;
  const name = engines.value.find((e) => e.id === id)?.name ?? id;
  await pruneGenerations(`engine=${encodeURIComponent(id)}`, `engine "${name}"`);
}
async function pruneUnfavorited() {
  await pruneGenerations("favorited=false", "unfavorited renders");
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
          <UiButton intent="danger-outline" label="Purge all scopes" @click="purgeAll" />
        </div>
      </div>
    </section>

    <!-- ── Actions: granular prune (preview parity §Cache Actions) ── -->
    <section class="jv-card jv-section">
      <h3 class="jv-section__title">Actions</h3>
      <div class="cache-view__actions">
        <UiButton intent="secondary" label="Prune > 30 days" @click="pruneOlderThan(30)" />
        <UiButton intent="secondary" label="Prune by voice…" @click="pruneByVoice" />
        <UiButton intent="secondary" label="Prune by engine…" @click="pruneByEngine" />
        <UiButton intent="secondary" label="Prune unfavorited" @click="pruneUnfavorited" />
        <span class="jv-spacer" />
        <UiButton intent="danger-outline" :label="`Clear all (${totalSizeGb} GB · ${totalEntries} entries)`" @click="purgeAll" />
      </div>
      <p class="jv-muted cache-view__actions-hint">
        Every action asks for confirmation first and shows exactly how many renders it will remove. Favorited (★) renders are never touched by "Prune unfavorited".
      </p>
    </section>

    <!-- ── Recent entries (preview parity §Cache Recent entries) ── -->
    <section v-if="recent.length" class="jv-card jv-section">
      <h3 class="jv-section__title">Recent entries</h3>
      <!-- The kit grid wearing the JustVoice look (`jv-table-look`), so it is
           indistinguishable from the hand-rolled tables still to be converted.
           Sorting comes free, which this list never had. -->
      <UiTable class="jv-table-look" :data="recent" :columns="RECENT_COLUMNS" data-key="id" row-hover>
        <template #engine="{ row }"><UiTag intent="ghost">{{ row.engine }}</UiTag></template>
        <template #text_preview="{ row }">
          <span class="jv-muted">{{ row.text_preview || "—" }}</span>
        </template>
        <template #size_bytes="{ row }">{{ fmtMB(row.size_bytes || 0) }} MB</template>
        <template #created_at="{ row }">{{ fmtAge(row.created_at) }}</template>
        <template #actions="{ row }">
          <div class="jv-table__actions">
            <UiButton intent="ghost" size="small" label="✕" title="Delete this entry" @click="deleteEntry(row.id)" />
          </div>
        </template>
      </UiTable>
    </section>

    <!-- ── By scope ── -->
    <section class="jv-card jv-section">
      <h3 class="jv-section__title">By scope</h3>

      <!-- `#empty` replaces the sibling `v-else` paragraph: the grid owns its
           own empty state, so there is no second place to keep the wording. -->
      <UiTable class="jv-table-look" :data="scopeRows" :columns="SCOPE_COLUMNS" data-key="scope" row-hover>
        <template #scope="{ row }"><span class="jv-mono">{{ row.scope }}</span></template>
        <template #bytes_on_disk="{ row }">{{ fmtMB(row.bytes_on_disk) }}</template>
        <template #actions="{ row }">
          <div class="jv-table__actions">
            <UiButton intent="danger-outline" size="small" label="Purge" @click="purgeScope(row.scope)" />
          </div>
        </template>
        <template #empty>Cache is empty.</template>
      </UiTable>
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
