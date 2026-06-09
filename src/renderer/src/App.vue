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
import CapturesView from "./views/CapturesView.vue";
import StoriesView from "./views/StoriesView.vue";
import EffectsView from "./views/EffectsView.vue";
import AudioChannelsView from "./views/AudioChannelsView.vue";
import WebhooksView from "./views/WebhooksView.vue";

const VIEWS = [
  { id: "overview", label: "Overview", icon: "🏠", lede: "Current state of the server, catalogue, and cache held on disk.", component: OverviewView },
  { id: "generate", label: "Generate", icon: "📝", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it.", component: GenerateView },
  { id: "books", label: "Books", icon: "📖", lede: "Audiobooks, game voicelines, podcasts — multi-use Project library.", component: BooksView },
  { id: "stories", label: "Stories", icon: "🎬", lede: "Multi-track timeline editor. Voicebox's hallmark feature ported to Vue.", component: StoriesView },
  { id: "chapter", label: "Chapter", icon: "📑", lede: "Multi-line script in, mastered chapter out. The audiobook-production endpoint.", component: ChapterView },
  { id: "voices", label: "Voices", icon: "🎙️", lede: "The full voice catalogue. Clone, design, import, or blend new voices.", component: VoicesView },
  { id: "personas", label: "Personas", icon: "🎭", lede: "Named characters bound to voices. Stable across sessions.", component: PersonasView },
  { id: "lexicons", label: "Lexicons", icon: "📚", lede: "Pronunciation dictionaries. Make character names pronounce consistently every render.", component: LexiconsView },
  { id: "captures", label: "Captures", icon: "🎚️", lede: "Dictation recordings + voice-sample capture. Animated pill + 6-gate readiness.", component: CapturesView },
  { id: "effects", label: "Effects", icon: "🎛️", lede: "Pedalboard effect chain editor. 8 effect types + 4 built-in presets + custom.", component: EffectsView },
  { id: "engines", label: "Engines", icon: "🧠", lede: "Install, switch, and manage TTS engines. Auto-recommended for your hardware.", component: EnginesView },
  { id: "train", label: "Train", icon: "🏋️", lede: "Voice fine-tuning. LoRA adapters on top of base engines. Restart-survivable jobs.", component: TrainView },
  { id: "compare", label: "Compare", icon: "⚖️", lede: "Two WAVs in, side-by-side report out. Format, loudness, sample-level diff.", component: CompareView },
  { id: "cache", label: "Cache", icon: "💾", lede: "Audio renders kept on disk so the same line costs nothing twice.", component: CacheView },
  { id: "audio-tools", label: "Audio tools", icon: "🔧", lede: "Stand-alone WAV analyzer and one-shot mastering. Bring your own audio in, take a report or a mastered file out.", component: AudioToolsView },
  { id: "channels", label: "Channels", icon: "🔊", lede: "Audio output routing. Send specific voices to specific OS audio devices.", component: AudioChannelsView },
  { id: "webhooks", label: "Webhooks", icon: "🔔", lede: "HMAC-signed outbound event notifications for CI / integrations.", component: WebhooksView },
  { id: "settings", label: "Settings", icon: "⚙️", lede: "Operator knobs that take effect at runtime; some require a restart.", component: SettingsView },
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

    <!-- 80px left icon sidebar (voicebox shape — DESIGN_FREEZE §6). -->
    <aside class="sidebar">
      <div class="sidebar__brand" title="JustVoice">JV</div>
      <a
        v-for="v in VIEWS"
        :key="v.id"
        class="sidebar__nav"
        :class="{ 'sidebar__nav--active': view === v.id }"
        :title="v.label"
        @click="view = v.id"
      >
        <span class="sidebar__icon">{{ v.icon || '·' }}</span>
        <span class="sidebar__label">{{ v.label }}</span>
      </a>
      <div class="sidebar__spacer" />
      <span class="sidebar__version" v-if="health">v{{ health.version }}</span>
    </aside>

    <main class="main">
      <header class="topbar">
        <h2 class="topbar__title">{{ currentView?.label }}<span class="period">.</span></h2>
        <span class="topbar__status" :class="{ warn: !health || health.status !== 'ok' }">
          <span class="topbar__dot"></span>
          {{ health && health.status === "ok" ? "Operational" : (health ? health.status : "Offline") }}
          <span class="topbar__url">· {{ api.serverUrl }}</span>
        </span>
      </header>

      <div class="main-inner">
        <p class="lede">{{ currentView?.lede }}</p>
        <TaskStrip v-for="task in tasks.running" :key="task.id" :task="task" />
        <component :is="currentView?.component" />
      </div>
    </main>

    <Toast />
    <AppDialog />
  </div>
</template>

<style scoped>
.app-shell {
  display: grid;
  grid-template-columns: 80px 1fr;
  height: 100vh;
  overflow: hidden;
}
.sidebar {
  background: var(--surface, #ffffff);
  border-right: 1px solid var(--line, #e3e1dc);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 18px 0 12px;
  gap: 4px;
  overflow-y: auto;
  overflow-x: hidden;
}
.sidebar__brand {
  width: 44px;
  height: 44px;
  border-radius: 10px;
  background: var(--accent, #3a7d63);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 16px;
  margin-bottom: 12px;
  letter-spacing: -0.5px;
}
.sidebar__nav {
  width: 56px;
  height: 56px;
  border-radius: 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  cursor: pointer;
  text-decoration: none;
  color: var(--ink-2, #4a4a4a);
  transition: background-color 0.1s;
  margin: 1px 0;
  user-select: none;
}
.sidebar__nav:hover {
  background: var(--surface-2, #fbfaf7);
  color: var(--ink, #1a1a1a);
}
.sidebar__nav--active {
  background: var(--accent, #3a7d63);
  color: #fff;
}
.sidebar__icon {
  font-size: 18px;
  line-height: 1;
}
.sidebar__label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  font-weight: 500;
  text-align: center;
  white-space: nowrap;
  max-width: 56px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.sidebar__spacer { flex: 1; }
.sidebar__version {
  font-size: 10px;
  color: var(--ink-3, #888);
  padding-bottom: 8px;
}

.main {
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.topbar {
  display: flex;
  align-items: baseline;
  padding: 18px 32px 0;
  gap: 16px;
  border-bottom: 1px solid var(--line, #e3e1dc);
  padding-bottom: 12px;
}
.topbar__title {
  font-size: 22px;
  font-weight: 600;
  margin: 0;
  letter-spacing: -0.01em;
}
.period { color: var(--accent, #3a7d63); }
.topbar__status {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--ink-2, #4a4a4a);
}
.topbar__status.warn { color: var(--warn, #c89a3a); }
.topbar__dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: var(--accent, #3a7d63);
  box-shadow: 0 0 0 3px rgba(58, 125, 99, 0.15);
}
.topbar__status.warn .topbar__dot {
  background: var(--warn, #c89a3a);
  box-shadow: 0 0 0 3px rgba(200, 154, 58, 0.15);
}
.topbar__url {
  margin-left: 8px;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px;
  color: var(--ink-3, #888);
}
.main-inner {
  flex: 1;
  padding: 16px 32px 32px;
  overflow-y: auto;
}
.lede {
  color: var(--ink-2, #4a4a4a);
  font-size: 13px;
  margin: 0 0 16px;
}
</style>
