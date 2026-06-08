<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "./stores/api.js";
import { useRenderTasks } from "./stores/renderTasks.js";
import { pushToast } from "./services/toastBridge.js";
import Toast from "./components/Toast.vue";
import TaskStrip from "./components/TaskStrip.vue";
import AppDialog from "./components/AppDialog.vue";

const VIEWS = [
  { id: "overview", label: "Overview", lede: "Current state of the server, catalogue, and cache held on disk." },
  { id: "generate", label: "Generate", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it." },
  { id: "chapter", label: "Chapter", lede: "Multi-line script in, mastered chapter out. The audiobook-production endpoint." },
  { id: "voices", label: "Voices", lede: "The full voice catalogue. Clone, design, import, or blend new voices." },
  { id: "compare", label: "Compare", lede: "Two WAVs in, side-by-side report out. Format, loudness, sample-level diff." },
  { id: "engines", label: "Engines", lede: "Install, switch, and manage TTS engines. Auto-recommended for your hardware." },
  { id: "settings", label: "Settings", lede: "Operator knobs that take effect at runtime; some require a restart." },
];

const view = ref("overview");
const health = ref(null);
const api = useApi();
const tasks = useRenderTasks();

const currentView = computed(() => VIEWS.find((v) => v.id === view.value));

async function refresh() {
  try {
    health.value = await api.request("/v1/health");
  } catch (e) {
    pushToast({ message: `Server unreachable: ${e.message || e}`, kind: "error" });
  }
}

onMounted(refresh);
</script>

<template>
  <div>
    <header class="topbar">
      <span class="logo">Justtts<span class="dot">.</span></span>
      <span class="ver" v-if="health">v{{ health.version }} · API {{ health.api_version }}</span>
      <span class="ver" v-else>not connected</span>
      <span class="status" :class="{ warn: !health || health.status !== 'ok' }">
        <span class="sq"></span>
        {{ health && health.status === "ok" ? "Operational" : (health ? health.status : "Offline") }}
      </span>
    </header>

    <nav class="tabs">
      <button
        v-for="v in VIEWS"
        :key="v.id"
        class="tab"
        :class="{ active: view === v.id }"
        @click="view = v.id">
        {{ v.label }}
      </button>
    </nav>

    <main>
      <div class="page-head">
        <h2>{{ currentView?.label }}<span class="period">.</span></h2>
        <p class="lede">{{ currentView?.lede }}</p>
      </div>

      <TaskStrip v-for="task in tasks.running" :key="task.id" :task="task" />

      <section v-if="view === 'overview'" class="block">
        <h3>Welcome</h3>
        <p>
          JustTTS is a TTS server built for audiobook production. Install an engine from the
          <strong>Engines</strong> tab, then render lines from <strong>Generate</strong> or full
          chapters from <strong>Chapter</strong>.
        </p>
        <p v-if="health">
          Connected to {{ api.serverUrl }} — {{ health.engines.length }} engine(s) registered.
        </p>
      </section>

      <section v-else class="block">
        <p class="endnote">This view is wired in subsequent commits.</p>
      </section>
    </main>

    <footer class="colophon">
      <div>
        <label>Server URL</label>
        <input v-model="api.serverUrl" @blur="refresh" spellcheck="false" />
      </div>
      <div>
        <label>Bearer token</label>
        <input v-model="api.token" type="password" placeholder="optional" />
      </div>
      <div>
        <button @click="refresh">Reload</button>
      </div>
      <div class="imp">
        Tauri + Vue + Python.<br />
        Apache 2.0 · justtts
      </div>
    </footer>

    <Toast />
    <AppDialog />
  </div>
</template>
