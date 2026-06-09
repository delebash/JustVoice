<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useApi } from "./stores/api.js";
import { useRenderTasks } from "./stores/renderTasks.js";
import { useOnboarding } from "./stores/onboarding.js";
import { pushToast } from "./services/toastBridge.js";
import Toast from "./components/Toast.vue";
import TaskStrip from "./components/TaskStrip.vue";
import AppDialog from "./components/AppDialog.vue";
import WelcomeOnboarding from "./components/WelcomeOnboarding.vue";

import OverviewView from "./views/OverviewView.vue";
import GenerateView from "./views/GenerateView.vue";
import ChapterView from "./views/ChapterView.vue";
import VoicesView from "./views/VoicesView.vue";
import CompareView from "./views/CompareView.vue";
import EnginesView from "./views/EnginesView.vue";
import SettingsView from "./views/SettingsView.vue";

const VIEWS = [
  { id: "overview", label: "Overview", lede: "Current state of the server, catalogue, and cache held on disk.", component: OverviewView },
  { id: "generate", label: "Generate", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it.", component: GenerateView },
  { id: "chapter", label: "Chapter", lede: "Multi-line script in, mastered chapter out. The audiobook-production endpoint.", component: ChapterView },
  { id: "voices", label: "Voices", lede: "The full voice catalogue. Clone, design, import, or blend new voices.", component: VoicesView },
  { id: "compare", label: "Compare", lede: "Two WAVs in, side-by-side report out. Format, loudness, sample-level diff.", component: CompareView },
  { id: "engines", label: "Engines", lede: "Install, switch, and manage TTS engines. Auto-recommended for your hardware.", component: EnginesView },
  { id: "settings", label: "Settings", lede: "Operator knobs that take effect at runtime; some require a restart.", component: SettingsView },
];

// Map the onboarding primary use case → starting tab on launch. Audiobook
// and podcast both land on Chapter because that's where the multi-line
// script-in / mastered-audio-out workflow lives today. Game devs need
// the voice catalogue first. Dictation users hit the single-line
// Generate panel. Accessibility users start in Settings to dial in
// playback. "multiple" + "unset" fall back to Overview so first-time
// producers see the catalogue, engines, and cache state at a glance.
const DEFAULT_TAB_BY_USE_CASE = {
  audiobook:     "chapter",
  game:          "voices",
  podcast:       "chapter",
  dictation:     "generate",
  accessibility: "settings",
  multiple:      "overview",
  unset:         "overview",
};

const view = ref("overview");
const health = ref(null);
const api = useApi();
const tasks = useRenderTasks();
const onboarding = useOnboarding();
let initialTabResolved = false;

const currentView = computed(() => VIEWS.find((v) => v.id === view.value));
const showWelcome = computed(() => onboarding.hydrated && !onboarding.shown);

function resolveInitialTab() {
  if (initialTabResolved) return;
  // Don't override an explicit hash route — power users land where they
  // bookmarked. `#voices` / `#chapter` etc. all win over the default.
  const hash = (typeof window !== "undefined" && window.location.hash) || "";
  const hashId = hash.replace(/^#/, "");
  if (hashId && VIEWS.some((v) => v.id === hashId)) {
    view.value = hashId;
    initialTabResolved = true;
    return;
  }
  const tab = DEFAULT_TAB_BY_USE_CASE[onboarding.primaryUseCase] || "overview";
  view.value = tab;
  initialTabResolved = true;
}

async function refresh() {
  try {
    health.value = await api.request("/v1/health");
  } catch (e) {
    pushToast({ message: `Server unreachable: ${e.message || e}`, kind: "error" });
  }
}

// Once the primary-use-case selection lands (either from hydrate() or
// the welcome modal), settle on the initial tab.
watch(
  () => [onboarding.hydrated, onboarding.primaryUseCase],
  ([hydrated]) => { if (hydrated && !initialTabResolved) resolveInitialTab(); },
  { immediate: true },
);

function onWelcomeClosed() {
  // The store has already flipped shown=true and persisted; re-route
  // the default tab now that we know the producer's intent.
  if (!initialTabResolved) resolveInitialTab();
}

onMounted(async () => {
  await onboarding.hydrate();
  await refresh();
});
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

      <component :is="currentView?.component" />
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
    <WelcomeOnboarding v-if="showWelcome" @close="onWelcomeClosed" />
  </div>
</template>
