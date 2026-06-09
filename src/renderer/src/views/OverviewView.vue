<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { pushToast } from "../services/toastBridge.js";

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
  <section class="block">
    <h3>Catalogue</h3>
    <div class="stats">
      <div class="stat">
        <div class="k">Voices</div>
        <div class="v">{{ voices.length }}</div>
        <div class="x">
          across {{ Object.keys(voicesByEngine).length }} engine{{ Object.keys(voicesByEngine).length === 1 ? "" : "s" }}
        </div>
      </div>
      <div class="stat">
        <div class="k">Personas</div>
        <div class="v">{{ personas.length }}</div>
        <div class="x">named &amp; bound</div>
      </div>
      <div class="stat" v-if="stats">
        <div class="k">Cache</div>
        <div class="v">
          {{ (stats.total_bytes_on_disk / 1024 / 1024).toFixed(1) }}<span class="unit">MB</span>
        </div>
        <div class="x">{{ stats.total_entries_on_disk }} entries on disk</div>
      </div>
    </div>
  </section>

  <section class="block" v-if="health && health.engines && health.engines.length">
    <h3>Engines</h3>
    <div class="engines">
      <div v-for="e in health.engines" :key="e.id" class="engine">
        <div class="name">
          {{ e.name }}<span class="qual" v-if="e.id && e.id.includes('stub')"> — stub</span>
        </div>
        <div class="be">{{ e.backend }}</div>
        <div class="st" :class="{ off: !e.ready }">{{ e.ready ? "Ready" : "Not loaded" }}</div>
      </div>
    </div>
    <p class="endnote" style="margin-top: 14px">
      {{ installedCount }} of {{ engines.length }} installed. One engine is loaded at a time.
    </p>
  </section>
</template>
