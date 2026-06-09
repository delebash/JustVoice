<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useCopy } from "../services/copy.js";

const api = useApi();
const copy = useCopy();
const health = ref(null);
const engines = ref([]);
const voices = ref([]);
const stats = ref(null);

async function refresh() {
  try {
    health.value = await api.request("/v1/health");
    const e = await api.request("/v1/engines");
    engines.value = e.engines;
    const v = await api.request("/v1/voices");
    voices.value = v.voices;
    stats.value = await api.request("/v1/cache/stats");
  } catch (_) {}
}

const installedCount = computed(() => engines.value.filter((e) => e.status !== "not_installed").length);

onMounted(refresh);
</script>

<template>
  <section class="block">
    <h3>Server</h3>
    <div class="stats" v-if="health">
      <div class="stat">
        <div class="k">Status</div>
        <div class="v">{{ health.status }}</div>
      </div>
      <div class="stat">
        <div class="k">Version</div>
        <div class="v">{{ health.version }}</div>
      </div>
      <div class="stat">
        <div class="k">Engines registered</div>
        <div class="v">{{ health.engines.length }}</div>
      </div>
      <div class="stat">
        <div class="k">Loaded engine</div>
        <div class="v">{{ health.current_engine || "none" }}</div>
      </div>
    </div>
  </section>

  <section class="block">
    <h3>Catalog</h3>
    <div class="stats">
      <div class="stat">
        <div class="k">{{ copy.cast.plural }}</div>
        <div class="v">{{ voices.length }}</div>
        <div v-if="!voices.length" class="x">No {{ copy.cast.plural.toLowerCase() }} yet — open Engines to install a voice pack.</div>
      </div>
      <div class="stat">
        <div class="k">Engines installed</div>
        <div class="v">{{ installedCount }} / {{ engines.length }}</div>
      </div>
      <div class="stat" v-if="stats">
        <div class="k">Cache</div>
        <div class="v">{{ (stats.total_bytes_on_disk / 1024 / 1024).toFixed(1) }} MB</div>
        <div class="x">{{ stats.total_entries_on_disk }} entries on disk</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.stats { display: flex; gap: 24px; flex-wrap: wrap; }
.stat { min-width: 140px; }
.stat .k { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); }
.stat .v { font-family: var(--font-serif); font-size: 28px; font-weight: 500; line-height: 1.2; }
.stat .x { font-size: 11px; color: var(--muted); font-family: var(--font-mono); }
</style>
