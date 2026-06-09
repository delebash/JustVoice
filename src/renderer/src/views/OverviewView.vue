<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";
import JvTag from "../components/jv/JvTag.vue";

const api = useApi();
const health = ref(null);
const engines = ref([]);
const voices = ref([]);
const personas = ref([]);
const stats = ref(null);

async function refresh() {
  try {
    const [h, e, v, p, s] = await Promise.all([
      api.request("/v1/health"),
      api.request("/v1/engines"),
      api.request("/v1/voices"),
      api.request("/v1/personas"),
      api.request("/v1/cache/stats"),
    ]);
    health.value = h;
    engines.value = e.engines;
    voices.value = v.voices;
    personas.value = p.personas || [];
    stats.value = s;
  } catch (err) {
    pushToast({ message: `Server unreachable: ${err.message || err}`, kind: "error" });
  }
}

const installedCount = computed(() => engines.value.filter((e) => e.status !== "not_installed").length);
const voicesByEngine = computed(() => {
  const map = {};
  for (const v of voices.value) {
    const k = v.engine || "unknown";
    map[k] = (map[k] || 0) + 1;
  }
  return map;
});

onMounted(refresh);
</script>

<template>
  <div class="overview-view">
    <!-- ── Catalogue stats ──────────────────────────────────────────────── -->
    <div class="jv-section">
      <h3 class="jv-section__title">Catalogue</h3>
      <div class="overview-view__stats">
        <div class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">Voices</div>
          <div class="overview-view__stat-value">{{ voices.length }}</div>
          <div class="overview-view__stat-sub jv-muted">
            across {{ Object.keys(voicesByEngine).length }}
            engine{{ Object.keys(voicesByEngine).length === 1 ? "" : "s" }}
          </div>
        </div>
        <div class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">Personas</div>
          <div class="overview-view__stat-value">{{ personas.length }}</div>
          <div class="overview-view__stat-sub jv-muted">named &amp; bound</div>
        </div>
        <div v-if="stats" class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">Cache</div>
          <div class="overview-view__stat-value">
            {{ (stats.total_bytes_on_disk / 1024 / 1024).toFixed(1) }}<span class="overview-view__unit">MB</span>
          </div>
          <div class="overview-view__stat-sub jv-muted">{{ stats.total_entries_on_disk }} entries on disk</div>
        </div>
      </div>
    </div>

    <!-- ── Engines ─────────────────────────────────────────────────────── -->
    <div class="jv-section" v-if="health && health.engines && health.engines.length">
      <h3 class="jv-section__title">Engines</h3>

      <div class="jv-card jv-card--flat">
        <table class="jv-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Backend</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in health.engines" :key="e.id">
              <td>
                <strong>{{ e.name }}</strong>
                <span v-if="e.id && e.id.includes('stub')" class="jv-muted"> — stub</span>
              </td>
              <td>{{ e.backend }}</td>
              <td>
                <JvTag
                  :label="e.ready ? 'Ready' : 'Not loaded'"
                  :variant="e.ready ? 'success' : 'default'"
                />
              </td>
            </tr>
          </tbody>
        </table>
        <p class="jv-muted" style="font-size: 12px; margin-top: 12px">
          {{ installedCount }} of {{ engines.length }} installed. One engine is loaded at a time.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overview-view {
  padding: 24px 32px 64px;
}

.overview-view__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.overview-view__stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overview-view__stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}

.overview-view__stat-value {
  font-size: 32px;
  font-weight: 700;
  line-height: 1.1;
  color: var(--ink);
  letter-spacing: -0.02em;
}

.overview-view__unit {
  font-size: 16px;
  font-weight: 500;
  margin-left: 4px;
  color: var(--ink-2);
}

.overview-view__stat-sub {
  font-size: 12px;
}
</style>
