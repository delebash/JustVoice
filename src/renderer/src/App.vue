<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useApi } from "./stores/api.js";
import { useRenderTasks } from "./stores/renderTasks.js";
import { useOnboarding } from "./stores/onboarding.js";
import { useUiContext } from "./stores/uiContext.js";
import Toast from "./components/Toast.vue";
import TaskStrip from "./components/TaskStrip.vue";
import TaskStatusPanel from "./components/TaskStatusPanel.vue";
import AppDialog from "./components/AppDialog.vue";
import AudioKeepAlive from "./components/AudioKeepAlive.vue";
import WelcomeOnboarding from "./components/WelcomeOnboarding.vue";
import QuickSetup from "./components/QuickSetup.vue";
import KeyboardCheatsheet from "./components/KeyboardCheatsheet.vue";
import JvHelpDrawer from "./components/JvHelpDrawer.vue";
import HelpTrigger from "./components/HelpTrigger.vue";
import GlobalAudioPlayer from "./components/GlobalAudioPlayer.vue";

import GenerateView from "./views/GenerateView.vue";
import BooksView from "./views/BooksView.vue";
import VoicesView from "./views/VoicesView.vue";
// ProfilesView removed — Persona is the sole identity layer after the
// Profile-kill (plan Q1). All voice config now lives directly on Persona.
import StudioView from "./views/StudioView.vue";
import SpeakerLabView from "./views/SpeakerLabView.vue";
import RenderLabView from "./views/RenderLabView.vue";
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
import RenderPresetsView from "./views/RenderPresetsView.vue";
import AudioChannelsView from "./views/AudioChannelsView.vue";
import WebhooksView from "./views/WebhooksView.vue";
import TabShellView from "./views/TabShellView.vue";

// Nav consolidation (plan D3): 8 flat items, nothing hidden by use case
// — the per-use-case `visibleFor` gating mechanism is deleted entirely
// (onboarding still sets terminology via useCopy). Library, Labs, and
// Settings are TabShellView shells hosting the existing views unchanged;
// sub-tabs deep-link as #library/voices etc.
//
// `hidden: true` = routable by hash but not in the sidebar (Projects is
// reached from Studio's "Manage projects" link, plan D2).
const LIBRARY_TABS = [
  { id: "voices",   label: "Voices",   icon: "🎙️", component: VoicesView },
  { id: "personas", label: "Personas", icon: "🎭", component: PersonasView },
  { id: "lexicons", label: "Lexicons", icon: "📚", component: LexiconsView },
  { id: "effects",  label: "Effects",  icon: "🎛️", component: EffectsView },
  { id: "presets",  label: "Presets",  icon: "🎚️", component: RenderPresetsView },
];
const LABS_TABS = [
  { id: "compare",    label: "Compare",     icon: "⚖️", component: CompareView },
  { id: "audio",      label: "Audio Tools", icon: "🔧", component: AudioToolsView },
  { id: "renderlab",  label: "Render Lab",  icon: "🧪", component: RenderLabView },
  { id: "speakerlab", label: "Speaker Lab", icon: "🔬", component: SpeakerLabView },
  { id: "train",      label: "Train",       icon: "🏋️", component: TrainView },
];
const SETTINGS_TABS = [
  { id: "general",  label: "General",  icon: "⚙️", component: SettingsView },
  { id: "cache",    label: "Cache",    icon: "💾", component: CacheView },
  { id: "channels", label: "Channels", icon: "🔊", component: AudioChannelsView },
  { id: "webhooks", label: "Webhooks", icon: "🔔", component: WebhooksView },
];

const VIEWS = [
  // Project-first home (plan D2): Studio is the workspace the app opens
  // into. Chapter's block/take editor lives inside Studio as the Takes
  // tab (#chapter redirects). Overview is gone — its stat cards' job is
  // covered by the engine pill + task strip + Studio's empty state.
  { id: "studio",   label: "Home",       icon: "🏠", lede: "Your production workspace. Cast assigns voices to characters; Script runs speaker attribution; Render batches the project (grouped by engine — one swap per engine); Takes is the per-block re-roll editor.", component: StudioView },
  { id: "generate", label: "Scratchpad", icon: "✏️", lede: "Quick one-off lines — try a voice, test a delivery, render a sentence. Any voice is pickable; rendering with a cold engine asks before swapping. Type / for paralinguistic tags.", component: GenerateView },
  { id: "stories",  label: "Stories",    icon: "🎞️", lede: "Multi-track timeline editor. For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement.", component: StoriesView },
  { id: "captures", label: "Captures",   icon: "🎚️", lede: "Dictation pill + global hotkey. Speak into any text field. Also captures audio for cloning sample collection.", component: CapturesView },
  { id: "library",  label: "Library",    icon: "🗂️", lede: "", component: TabShellView, props: { baseId: "library", tabs: LIBRARY_TABS } },
  { id: "labs",     label: "Labs",       icon: "🧪", lede: "", component: TabShellView, props: { baseId: "labs", tabs: LABS_TABS } },
  { id: "engines",  label: "Engines",    icon: "🧠", lede: "Installed engine catalog. Install / load / unload models per kind slot (TTS · STT · LLM) — loading Whisper never evicts your TTS engine. Register online providers below the engine list.", component: EnginesView },
  { id: "settings", label: "Settings",   icon: "⚙️", lede: "Every operator-tunable value. Per CLAUDE.md, no value is hardcoded — every knob lives in settings.json.", component: TabShellView, props: { baseId: "settings", tabs: SETTINGS_TABS }, pinned: true },

  // Routable but not in the sidebar:
  { id: "books",    label: "Projects",   icon: "📖", lede: "Multi-use Project library — metadata, QC, M4B export. Day-to-day production lives in Home (Studio).", component: BooksView, hidden: true },
];

// Map each view id → docs/<slug>.md for the topbar HelpTrigger.
// Views without a dedicated doc fall back to getting-started.
const HELP_SLUG_BY_VIEW = {
  studio:   "core-concepts",
  generate: "generate",
  books:    "core-concepts",
  stories:  "stories",
  captures: "dictation",
  library:  "voices",
  labs:     "mastering",
  engines:  "engines",
  settings: "getting-started",
};

// Project-first landing (plan D2): every use case opens into Studio —
// with a project, that's the work in progress; without one, Studio's
// empty state offers the three entry actions (Import · New project ·
// "Just try a line" → Scratchpad). Dictation is the one exception:
// those users live in Captures.
const DEFAULT_TAB_BY_USE_CASE = {
  audiobook:     "studio",
  game:          "studio",
  podcast:       "studio",
  dictation:     "captures",
  multiple:      "studio",
  unset:         "studio",
};

// Old hash routes → their new homes. Chapter merged into Studio's Takes
// tab; Overview retired; the former standalone views now live as
// sub-tabs of Library / Labs / Settings. Keeps bookmarks + in-app
// <a href="#voices"> style links working.
const HASH_REDIRECTS = {
  chapter:    "studio",
  overview:   "studio",
  voices:     "library/voices",
  personas:   "library/personas",
  lexicons:   "library/lexicons",
  effects:    "library/effects",
  presets:    "library/presets",
  compare:    "labs/compare",
  audio:      "labs/audio",
  renderlab:  "labs/renderlab",
  speakerlab: "labs/speakerlab",
  train:      "labs/train",
  cache:      "settings/cache",
  channels:   "settings/channels",
  webhooks:   "settings/webhooks",
};

// Resolve a raw hash (no '#') to { full, base }: apply legacy redirects,
// then split off the sub-tab segment (#library/voices → base "library").
function resolveHashTarget(raw) {
  const full = HASH_REDIRECTS[raw] || raw;
  return { full, base: full.split("/")[0] };
}

const view = ref("studio");
const health = ref(null);
const api = useApi();
const tasks = useRenderTasks();
const onboarding = useOnboarding();
const uiContext = useUiContext();
const { t } = useI18n();
let initialTabResolved = false;

// Any engine load/swap task in flight — the topbar pill pulses while
// true (swaps triggered by renders show up here via the shared
// engineSwap helper's task, same as manual Engines-tab loads).
const swapInFlight = computed(() =>
  tasks.running.some((t) => t.status === "running" && t.kind === "load"),
);

// Localized sidebar labels — proves the i18n scaffold is live. VIEWS
// holds the English defaults so the data lookup stays static; this
// computed swaps to the locale's keys when a translation exists.
function localizedViewLabel(viewEntry) {
  const key = `sidebar.${viewEntry.id}`;
  const translated = t(key);
  // vue-i18n returns the key itself when no match — fall back to the
  // English default in that case so we never render a path string.
  return translated && translated !== key ? translated : viewEntry.label;
}

const currentView = computed(() => VIEWS.find((v) => v.id === view.value));
const currentHelpSlug = computed(() => HELP_SLUG_BY_VIEW[view.value] || "getting-started");

// State-aware lede override (plan Q4 / Slice 1). When a view's
// preconditions aren't met, swap the static lede for a concrete
// next-action prompt that points the user where they need to go. The
// static lede acts as a fallback once the view is in a usable state.
const stateLedeOverride = computed(() => {
  // We don't load engine / project / persona state at the App level —
  // each view owns its own data. For the lede we infer state from a
  // few signals that ARE available here: health (server up) and the
  // last engine load that flowed through the api store.
  // Post swap-at-render there is no "load an engine first" prerequisite:
  // every voice is pickable cold, and the first render offers the swap.
  // The old no-engine ledes ("Open Engines first") are gone — they
  // contradicted that model. Slot kept for future state-aware prompts.
  if (!health.value) return null;
  return null;
});
const effectiveLede = computed(() => stateLedeOverride.value || currentView.value?.lede || "");
const showWelcome = computed(() => onboarding.hydrated && !onboarding.shown);

// Flat 8-item sidebar (plan D3) — no lanes, no use-case gating.
// Settings stays pinned at the bottom; hidden views (Projects) are
// routable by hash only.
const navViews = VIEWS.filter((v) => !v.hidden && !v.pinned);
const pinnedViews = VIEWS.filter((v) => v.pinned);

function resolveInitialTab() {
  if (initialTabResolved) return;
  // Don't override an explicit hash route — power users land where they
  // bookmarked. `#voices` / `#chapter` etc. all win over the default.
  const hash = (typeof window !== "undefined" && window.location.hash) || "";
  const { full, base } = resolveHashTarget(hash.replace(/^#/, ""));
  if (base && VIEWS.some((v) => v.id === base)) {
    if (`#${full}` !== hash) window.history.replaceState(null, "", `#${full}`);
    view.value = base;
    initialTabResolved = true;
    return;
  }
  const tab = DEFAULT_TAB_BY_USE_CASE[onboarding.primaryUseCase] || "studio";
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

// Boot banner — the Python server takes a few seconds to come up on
// fresh launch. Without any signal, the UI looks broken (empty stores,
// no engine, no voices). Track elapsed time-since-mount; if no health
// response by 1s, show "Server starting…" until it lands. Hides as
// soon as health.value populates.
const bootElapsedMs = ref(0);
const showBootBanner = computed(() =>
  !health.value && bootElapsedMs.value > 1000,
);

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
    const raw = window.location.hash.replace(/^#/, "");
    const { full, base } = resolveHashTarget(raw);
    if (!base || !VIEWS.some((v) => v.id === base)) return;
    // Rewrite legacy hashes in place so TabShellView reads the sub-tab.
    if (full !== raw) window.history.replaceState(null, "", `#${full}`);
    if (view.value !== base) view.value = base;
  });
}
watch(view, (v) => {
  if (typeof window !== "undefined" && v && window.location.hash.replace(/^#/, "").split("/")[0] !== v) {
    window.history.replaceState(null, "", "#" + v);
  }
  // Clear stale breadcrumb segments when navigating between top-level
  // views — the new view repopulates them on mount if it has context.
  uiContext.clear();
});

// QuickSetup shows once, the first time the user picks a real use case
// (skipped for "unset" / "multiple" — the user signaled they want to
// explore manually). Persists "quick_setup_seen" in localStorage so the
// wizard doesn't re-prompt on every launch.
const QUICK_SETUP_KEY = "jv.quickSetup.seen";
const showQuickSetup = ref(false);

function maybeShowQuickSetup() {
  if (typeof window === "undefined") return;
  if (window.localStorage?.getItem(QUICK_SETUP_KEY) === "1") return;
  const useCase = onboarding.primaryUseCase;
  if (!useCase || useCase === "unset" || useCase === "multiple") return;
  showQuickSetup.value = true;
}
function onQuickSetupClosed() {
  showQuickSetup.value = false;
  try { window.localStorage?.setItem(QUICK_SETUP_KEY, "1"); } catch { /* ignore */ }
}

function onWelcomeClosed() {
  // The store has already flipped shown=true and persisted; re-route
  // the default tab now that we know the producer's intent.
  if (!initialTabResolved) resolveInitialTab();
  // Then chain the QuickSetup wizard for hardware-aware engine recommendations.
  maybeShowQuickSetup();
}

onMounted(async () => {
  const start = performance.now();
  const tick = setInterval(() => { bootElapsedMs.value = performance.now() - start; }, 200);
  // Polling loop until the server comes up — every 1.5s while health is
  // still null. Stops as soon as health.value populates (or the user
  // navigates away).
  await onboarding.hydrate();
  await refresh();
  if (!health.value) {
    const poll = setInterval(async () => {
      await refresh();
      if (health.value) {
        clearInterval(poll);
        clearInterval(tick);
        bootElapsedMs.value = 0;
      }
    }, 1500);
  } else {
    clearInterval(tick);
  }
});
</script>

<template>
  <div class="app-shell">
    <!-- Silent looping WAV holds the macOS CoreAudio session open across idle. -->
    <AudioKeepAlive />

    <!-- Left sidebar — 8 flat items (plan D3), Settings pinned bottom. -->
    <aside class="jv-sidebar">
      <div class="jv-sidebar__brand" title="JustVoice">JV</div>

      <a
        v-for="v in navViews"
        :key="v.id"
        class="jv-sidebar__nav"
        :class="{ 'jv-sidebar__nav--active': view === v.id }"
        :title="localizedViewLabel(v)"
        @click="view = v.id"
      >
        <span class="jv-sidebar__icon">{{ v.icon || '·' }}</span>
        <span class="jv-sidebar__label">{{ localizedViewLabel(v) }}</span>
      </a>

      <div class="jv-sidebar__spacer" />

      <!-- Settings pinned at bottom — outside the Advanced collapse. -->
      <a
        v-for="v in pinnedViews"
        :key="v.id"
        class="jv-sidebar__nav"
        :class="{ 'jv-sidebar__nav--active': view === v.id }"
        :title="v.label"
        @click="view = v.id"
      >
        <span class="jv-sidebar__icon">{{ v.icon || '·' }}</span>
        <span class="jv-sidebar__label">{{ v.label }}</span>
      </a>

      <span class="jv-sidebar__version" v-if="health">v{{ health.version }}</span>
    </aside>

    <main class="jv-main">
      <header class="jv-topbar">
        <h2 class="jv-topbar__title">
          {{ currentView?.label }}
          <template v-for="(seg, i) in uiContext.breadcrumb" :key="i">
            <span class="jv-topbar__crumb-sep">›</span>
            <a
              v-if="seg.href"
              class="jv-topbar__crumb"
              :href="seg.href"
            >{{ seg.label }}</a>
            <span v-else class="jv-topbar__crumb jv-topbar__crumb--current">{{ seg.label }}</span>
          </template>
        </h2>

        <!-- Engine pill — swap-status pill (plan WS3): shows the loaded
             TTS engine · variant, pulses while an engine load/swap task
             runs. Click jumps to Engines tab. -->
        <button
          v-if="health"
          type="button"
          class="jv-topbar__engine-pill"
          :class="{
            'jv-topbar__engine-pill--empty': !health.current_engine && !swapInFlight,
            'jv-topbar__engine-pill--swapping': swapInFlight,
          }"
          :title="swapInFlight ? 'Engine swap in progress…' : (health.current_engine ? `Loaded: ${health.current_engine}. Click to manage engines.` : 'No engine loaded. Voices stay pickable — rendering loads the engine (with a prompt).')"
          @click="view = 'engines'"
        >
          <span class="jv-topbar__engine-icon">{{ swapInFlight ? "⇄" : "🧠" }}</span>
          <template v-if="swapInFlight">Swapping…</template>
          <template v-else>
            {{ health.current_engine || "No engine" }}<span v-if="health.current_variant" class="jv-topbar__engine-variant"> · {{ health.current_variant }}</span>
          </template>
        </button>

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
        <div v-if="showBootBanner" class="jv-banner jv-banner--warn jv-boot-banner">
          <span class="jv-boot-banner__spinner" />
          <span>Server starting… The Python sidecar is spinning up. Engine and voice catalogues will populate when it's ready.</span>
        </div>
        <p v-if="effectiveLede" class="jv-content__lede">{{ effectiveLede }}</p>
        <TaskStrip v-for="task in tasks.running" :key="task.id" :task="task" />
        <component :is="currentView?.component" v-bind="currentView?.props || {}" />
      </div>
    </main>

    <Toast />
    <AppDialog />
    <WelcomeOnboarding v-if="showWelcome" @close="onWelcomeClosed" />
    <QuickSetup v-if="showQuickSetup" @close="onQuickSetupClosed" />
    <KeyboardCheatsheet />
    <JvHelpDrawer />
    <GlobalAudioPlayer />
    <TaskStatusPanel />
  </div>
</template>
