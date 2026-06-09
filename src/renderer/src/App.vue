<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useApi } from "./stores/api.js";
import { useRenderTasks } from "./stores/renderTasks.js";
import { useOnboarding } from "./stores/onboarding.js";
import { pushToast } from "./services/toastBridge.js";
import Toast from "./components/Toast.vue";
import TaskStrip from "./components/TaskStrip.vue";
import AppDialog from "./components/AppDialog.vue";
import AudioKeepAlive from "./components/AudioKeepAlive.vue";
import WelcomeOnboarding from "./components/WelcomeOnboarding.vue";

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
  { id: "overview",  label: "Overview",  icon: "🏠", lede: "Current state of the server, catalogue, and cache held on disk.", component: OverviewView },
  { id: "generate",  label: "Generate",  icon: "📝", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it.", component: GenerateView },
  { id: "books",     label: "Projects",  icon: "📖", lede: "Audiobooks, game voicelines, podcasts — multi-use Project library.", component: BooksView },
  { id: "stories",   label: "Stories",   icon: "🎬", lede: "Multi-track timeline editor. Voicebox's hallmark feature ported to Vue.", component: StoriesView },
  { id: "chapter",   label: "Chapter",   icon: "📑", lede: "Multi-line script in, mastered output out. Works for audiobook chapters, podcast episodes, game dialogue batches, or any multi-line script.", component: ChapterView },
  { id: "voices",    label: "Voices",    icon: "🎙️", lede: "The full voice catalogue. Clone, design, import, or blend new voices.", component: VoicesView },
  { id: "personas",  label: "Personas",  icon: "🎭", lede: "Named characters bound to voices. Stable across sessions.", component: PersonasView },
  { id: "lexicons",  label: "Lexicons",  icon: "📚", lede: "Pronunciation dictionaries. Make character names pronounce consistently every render.", component: LexiconsView },
  { id: "captures",  label: "Captures",  icon: "🎚️", lede: "Dictation recordings + voice-sample capture. Animated pill + 6-gate readiness.", component: CapturesView },
  { id: "effects",   label: "Effects",   icon: "🎛️", lede: "Pedalboard effect chain editor. 8 effect types + 4 built-in presets + custom.", component: EffectsView },
  { id: "engines",   label: "Engines",   icon: "🧠", lede: "Install, switch, and manage TTS engines. Auto-recommended for your hardware.", component: EnginesView },
  { id: "train",     label: "Train",     icon: "🏋️", lede: "Voice fine-tuning. LoRA adapters on top of base engines. Restart-survivable jobs.", component: TrainView },
  { id: "compare",   label: "Compare",   icon: "⚖️", lede: "Two WAVs in, side-by-side report out. Format, loudness, sample-level diff.", component: CompareView },
  { id: "cache",     label: "Cache",     icon: "💾", lede: "Audio renders kept on disk so the same line costs nothing twice.", component: CacheView },
  { id: "audio",     label: "Audio",     icon: "🔧", lede: "Stand-alone WAV analyzer and one-shot mastering.", component: AudioToolsView },
  { id: "channels",  label: "Channels",  icon: "🔊", lede: "Audio output routing. Send specific voices to specific OS audio devices.", component: AudioChannelsView },
  { id: "webhooks",  label: "Webhooks",  icon: "🔔", lede: "HMAC-signed outbound event notifications for CI / integrations.", component: WebhooksView },
  { id: "settings",  label: "Settings",  icon: "⚙️", lede: "Operator knobs that take effect at runtime; some require a restart.", component: SettingsView },
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
  <div class="app-shell">
    <!-- Silent looping WAV holds the macOS CoreAudio session open across idle. -->
    <AudioKeepAlive />

    <!-- 80px left icon sidebar — preview HTML spec. -->
    <aside class="jv-sidebar">
      <div class="jv-sidebar__brand" title="JustVoice">JV</div>
      <a
        v-for="v in VIEWS"
        :key="v.id"
        class="jv-sidebar__nav"
        :class="{ 'jv-sidebar__nav--active': view === v.id }"
        :title="v.label"
        @click="view = v.id"
      >
        <span class="jv-sidebar__icon">{{ v.icon || '·' }}</span>
        <span class="jv-sidebar__label">{{ v.label }}</span>
      </a>
      <div class="jv-sidebar__spacer" />
      <span class="jv-sidebar__version" v-if="health">v{{ health.version }}</span>
    </aside>

    <main class="jv-main">
      <header class="jv-topbar">
        <h2 class="jv-topbar__title">
          {{ currentView?.label }}<span class="jv-topbar__period">.</span>
        </h2>
        <span class="jv-topbar__status" :class="{ 'jv-topbar__status--warn': !health || health.status !== 'ok' }">
          <span class="jv-topbar__dot"></span>
          {{ health && health.status === "ok" ? "Operational" : (health ? health.status : "Offline") }}
          <span class="jv-topbar__url">· {{ api.serverUrl }}</span>
        </span>
      </header>

      <div class="jv-content">
        <p class="jv-content__lede">{{ currentView?.lede }}</p>
        <TaskStrip v-for="task in tasks.running" :key="task.id" :task="task" />
        <component :is="currentView?.component" />
      </div>
    </main>

    <Toast />
    <AppDialog />
    <WelcomeOnboarding v-if="showWelcome" @close="onWelcomeClosed" />
  </div>
</template>
