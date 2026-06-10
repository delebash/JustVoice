<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useApi } from "./stores/api.js";
import { useRenderTasks } from "./stores/renderTasks.js";
import { useOnboarding } from "./stores/onboarding.js";
import Toast from "./components/Toast.vue";
import TaskStrip from "./components/TaskStrip.vue";
import TaskStatusPanel from "./components/TaskStatusPanel.vue";
import AppDialog from "./components/AppDialog.vue";
import AudioKeepAlive from "./components/AudioKeepAlive.vue";
import WelcomeOnboarding from "./components/WelcomeOnboarding.vue";
import JvHelpDrawer from "./components/JvHelpDrawer.vue";
import HelpTrigger from "./components/HelpTrigger.vue";
import GlobalAudioPlayer from "./components/GlobalAudioPlayer.vue";

import OverviewView from "./views/OverviewView.vue";
import GenerateView from "./views/GenerateView.vue";
import ChapterView from "./views/ChapterView.vue";
import BooksView from "./views/BooksView.vue";
import VoicesView from "./views/VoicesView.vue";
// ProfilesView removed — Persona is the sole identity layer after the
// Profile-kill (plan Q1). All voice config now lives directly on Persona.
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
  { id: "overview",  label: "Overview",  icon: "🏠", lede: "", component: OverviewView },
  { id: "generate",  label: "Generate",  icon: "📝", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it. Type / for paralinguistic tags.", component: GenerateView },
  { id: "books",     label: "Projects",  icon: "📖", lede: "Multi-use Project library. Audiobooks, game voicelines, podcasts. Imports from JustWrite via POST /v1/projects/import?source=justwrite.", component: BooksView },
  { id: "stories",   label: "Stories",   icon: "🎬", lede: "Multi-track timeline editor. For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement.", component: StoriesView },
  { id: "chapter",   label: "Chapter",   icon: "📑", lede: "Multi-block chapter editor with per-block take versioning. Source-lineage chains preserved. Pinned floating generate bar at bottom.", component: ChapterView },
  { id: "voices",    label: "Voices",    icon: "🎙️", lede: "Voice library — cloned, preset (Kokoro 54 + Qwen 9), designed (text-prompt → voice), blended. Per-voice channel routing.", component: VoicesView },
  { id: "personas",  label: "Personas",  icon: "🎭", lede: "Characters. Each persona has a name, bio, voice, personality (TTS delivery instruction), default delivery, effects, lexicon override. Cross-project — one Mara across many books or quests. Filter by usage in the library list.", component: PersonasView },
  { id: "lexicons",  label: "Lexicons",  icon: "📚", lede: "Pronunciation dictionaries. Force \"Beauchamp\" → \"BEE-chum\", domain words → consistent phoneme-level pronunciation across a whole book. Per-character override.", component: LexiconsView },
  { id: "captures",  label: "Captures",  icon: "🎚️", lede: "Dictation pill + global hotkey. Speak into any text field. Also captures audio for cloning sample collection.", component: CapturesView },
  { id: "effects",   label: "Effects",   icon: "🎛️", lede: "Pedalboard-backed effects chain. Apply non-destructively — creates a new generation version that preserves the original. 8 types · 4 built-in presets + custom.", component: EffectsView },
  { id: "engines",   label: "Engines",   icon: "🧠", lede: "Installed engine catalog. Install / load / unload models. Per-engine venv isolation (JustVoice advantage — install Chatterbox without breaking Kokoro).", component: EnginesView },
  { id: "train",     label: "Train",     icon: "🏋️", lede: "PEFT/LoRA-based fine-tuning. QC pipeline checks SNR / clipping / silence ratio per sample before accepting it.", component: TrainView },
  { id: "compare",   label: "Compare",   icon: "⚖️", lede: "A/B audio comparison. Side-by-side waveforms, peak/RMS/duration diff, sample-level RMSE, verdict. Bulk compare across takes for QC pass.", component: CompareView },
  { id: "cache",     label: "Cache",     icon: "💾", lede: "Disk-LRU render cache. Keyed on (engine, voice, lexicon hash, persona hash, text hash, effects hash). Engine prefix prevents cross-engine collisions.", component: CacheView },
  { id: "audio",     label: "Audio",     icon: "🔧", lede: "Stand-alone audio tools — analyze any 16-bit PCM WAV, or apply a mastering preset to a WAV without going through the chapter render pipeline. Useful for inspecting reference clips before cloning, or quickly mastering an external recording.", component: AudioToolsView },
  { id: "channels",  label: "Channels",  icon: "🔊", lede: "Audio output channel configs. Route specific voices to specific OS audio devices — multi-monitor, OBS virtual mic, per-character podcast monitoring.", component: AudioChannelsView },
  { id: "webhooks",  label: "Webhooks",  icon: "🔔", lede: "HMAC-SHA256-signed outbound event notifications. At-least-once delivery with exponential backoff (1s → 5s → 30s → 5min).", component: WebhooksView },
  { id: "settings",  label: "Settings",  icon: "⚙️", lede: "Every operator-tunable value. Per CLAUDE.md, no value is hardcoded — every knob lives in settings.json.", component: SettingsView },
];

// Map each view id → docs/<slug>.md for the topbar HelpTrigger.
// Views without a dedicated doc fall back to getting-started.
const HELP_SLUG_BY_VIEW = {
  overview: "getting-started",
  generate: "generate",
  books:    "core-concepts",
  stories:  "stories",
  chapter:  "take-versioning",
  voices:   "voices",
  personas: "personas",
  lexicons: "lexicons",
  captures: "dictation",
  effects:  "effects",
  engines:  "engines",
  train:    "engines",
  compare:  "mastering",
  cache:    "core-concepts",
  audio:    "mastering",
  channels: "channels",
  webhooks: "webhooks",
  settings: "getting-started",
};

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
const currentHelpSlug = computed(() => HELP_SLUG_BY_VIEW[view.value] || "getting-started");
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
  // Silent on failure — the topbar Offline indicator communicates the
  // state without a boot-time toast. (Redundant toast was annoying on
  // every dev reload before the server was up.)
  try {
    health.value = await api.request("/v1/health");
  } catch {
    health.value = null;
  }
}

// Once the primary-use-case selection lands (either from hydrate() or
// the welcome modal), settle on the initial tab.
watch(
  () => [onboarding.hydrated, onboarding.primaryUseCase],
  ([hydrated]) => { if (hydrated && !initialTabResolved) resolveInitialTab(); },
  { immediate: true },
);

// Hash routing: keep the URL in sync both directions.
//   - Hash change (back/forward, bookmarked URL) updates the active view.
//   - Active view change writes the hash so deep-linking works.
if (typeof window !== "undefined") {
  window.addEventListener("hashchange", () => {
    const hashId = window.location.hash.replace(/^#/, "");
    if (hashId && VIEWS.some((v) => v.id === hashId) && view.value !== hashId) {
      view.value = hashId;
    }
  });
}
watch(view, (v) => {
  if (typeof window !== "undefined" && v && window.location.hash.replace(/^#/, "") !== v) {
    window.history.replaceState(null, "", "#" + v);
  }
});

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
        <h2 class="jv-topbar__title">{{ currentView?.label }}</h2>
        <button
          type="button"
          class="jv-topbar__status"
          :class="{ 'jv-topbar__status--warn': !health || health.status !== 'ok' }"
          data-task-panel-toggle
          :title="tasks.activeCount ? 'Open status panel' : 'Server status'"
          @click="tasks.togglePanel()"
        >
          <span class="jv-topbar__dot"></span>
          {{ health && health.status === "ok" ? "Operational" : (health ? health.status : "Offline") }}
          <span class="jv-topbar__url">· {{ api.serverUrl }}</span>
          <span v-if="tasks.activeCount" class="jv-topbar__taskcount">
            · <strong>{{ tasks.activeCount }}</strong> in flight
          </span>
        </button>
        <HelpTrigger :slug="currentHelpSlug" :label="currentView?.label || 'JustVoice'" />
      </header>

      <div class="jv-content">
        <p v-if="currentView?.lede" class="jv-content__lede">{{ currentView.lede }}</p>
        <TaskStrip v-for="task in tasks.running" :key="task.id" :task="task" />
        <component :is="currentView?.component" />
      </div>
    </main>

    <Toast />
    <AppDialog />
    <WelcomeOnboarding v-if="showWelcome" @close="onWelcomeClosed" />
    <JvHelpDrawer />
    <GlobalAudioPlayer />
    <TaskStatusPanel />
  </div>
</template>
