<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "./stores/api.js";
import { useRenderTasks } from "./stores/renderTasks.js";
import { pushToast } from "./services/toastBridge.js";
import Toast from "./components/Toast.vue";
import TaskStrip from "./components/TaskStrip.vue";
import AppDialog from "./components/AppDialog.vue";
import AudioKeepAlive from "./components/AudioKeepAlive.vue";

import OverviewView from "./views/OverviewView.vue";
import GenerateView from "./views/GenerateView.vue";
import ChapterView from "./views/ChapterView.vue";
import BooksView from "./views/BooksView.vue";
import VoicesView from "./views/VoicesView.vue";
import CompareView from "./views/CompareView.vue";
import TrainView from "./views/TrainView.vue";
import PersonasView from "./views/PersonasView.vue";
import LexiconsView from "./views/LexiconsView.vue";
import EnginesView from "./views/EnginesView.vue";
import CacheView from "./views/CacheView.vue";
import AudioToolsView from "./views/AudioToolsView.vue";
import SettingsView from "./views/SettingsView.vue";

const VIEWS = [
  { id: "overview", label: "Overview", lede: "Current state of the server, catalogue, and cache held on disk.", component: OverviewView },
  { id: "generate", label: "Generate", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it.", component: GenerateView },
  { id: "books", label: "Books", lede: "Audiobooks, game voicelines, podcasts — multi-use Project library.", component: BooksView },
  { id: "chapter", label: "Chapter", lede: "Multi-line script in, mastered chapter out. The audiobook-production endpoint.", component: ChapterView },
  { id: "voices", label: "Voices", lede: "The full voice catalogue. Clone, design, import, or blend new voices.", component: VoicesView },
  { id: "personas", label: "Personas", lede: "Named characters bound to voices. Stable across sessions.", component: PersonasView },
  { id: "lexicons", label: "Lexicons", lede: "Pronunciation dictionaries. Make character names pronounce consistently every render.", component: LexiconsView },
  { id: "engines", label: "Engines", lede: "Install, switch, and manage TTS engines. Auto-recommended for your hardware.", component: EnginesView },
  { id: "train", label: "Train", lede: "Voice fine-tuning. LoRA adapters on top of base engines. Restart-survivable jobs.", component: TrainView },
  { id: "compare", label: "Compare", lede: "Two WAVs in, side-by-side report out. Format, loudness, sample-level diff.", component: CompareView },
  { id: "cache", label: "Cache", lede: "Audio renders kept on disk so the same line costs nothing twice.", component: CacheView },
  { id: "audio-tools", label: "Audio tools", lede: "Stand-alone WAV analyzer and one-shot mastering. Bring your own audio in, take a report or a mastered file out.", component: AudioToolsView },
  { id: "settings", label: "Settings", lede: "Operator knobs that take effect at runtime; some require a restart.", component: SettingsView },
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
  <div class="app-shell">
    <!-- Silent looping WAV holds the macOS CoreAudio session open across idle. -->
    <AudioKeepAlive />

    <header class="topbar">
      <span class="logo">Justtts<span class="dot">.</span></span>
      <span class="ver" v-if="health">v{{ health.version }} · API {{ health.api_version }}</span>
      <span class="ver" v-else>not connected</span>
      <span class="status" :class="{ warn: !health || health.status !== 'ok' }">
        <span class="sq"></span>
        {{ health && health.status === "ok" ? "Operational" : (health ? health.status : "Offline") }}
        <span class="topbar-url mono">· {{ api.serverUrl }}</span>
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
      <div class="main-inner">
        <div class="page-head">
          <h2>{{ currentView?.label }}<span class="period">.</span></h2>
          <p class="lede">{{ currentView?.lede }}</p>
        </div>

        <TaskStrip v-for="task in tasks.running" :key="task.id" :task="task" />

        <component :is="currentView?.component" />
      </div>
    </main>

    <Toast />
    <AppDialog />
  </div>
</template>

<style scoped>
.topbar-url {
  margin-left: 12px;
  color: var(--muted);
  font-weight: 400;
  letter-spacing: 0;
  font-size: 11px;
  text-transform: none;
}
</style>
