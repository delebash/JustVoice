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

import OverviewView from "./views/OverviewView.vue";
import GenerateView from "./views/GenerateView.vue";
import ChapterView from "./views/ChapterView.vue";
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

// Per-view `visibleFor` declares which onboarding primary-use-case values
// surface this tab in the sidebar. The full set is:
//   audiobook · game · podcast · dictation · accessibility · multiple · unset
// Omit `visibleFor` to mean "always visible" (universal tabs: Home,
// Generate, Voices, Personas, Engines, Settings).
//
// `lane` groups tabs in the sidebar (plan Q4 architecture):
//   workflow — Do the work. Always-on for the current use case.
//   library  — Manage assets (voices, characters, etc.).
//   tools    — Diagnostics, comparison, training labs.
//   advanced — Cache, channels, webhooks — collapsed by default.
// Settings is its own thing — pinned at the very bottom of the sidebar
// outside the Advanced collapse.
const ALL_USE_CASES = ["audiobook", "game", "podcast", "dictation", "accessibility", "multiple", "unset"];
const VIEWS = [
  // ─── Workflow lane ─────────────────────────────────────────────────
  { id: "overview",  lane: "workflow", label: "Home",      icon: "🏠", lede: "", component: OverviewView },
  { id: "studio",    lane: "workflow", label: "Studio",    icon: "🎬", lede: "Cast → Script → Render production environment. Three-tab flow for multi-character work. Cast assigns voices to characters; Script runs LLM speaker attribution (Phase 3 backend); Render batches the whole project.", component: StudioView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "generate",  lane: "workflow", label: "Generate",  icon: "📝", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it. Type / for paralinguistic tags.", component: GenerateView },
  { id: "chapter",   lane: "workflow", label: "Chapter",   icon: "📑", lede: "Multi-block chapter editor with per-block take versioning. Source-lineage chains preserved. Pinned floating generate bar at bottom.", component: ChapterView, visibleFor: ["audiobook", "podcast", "multiple", "unset"] },
  { id: "stories",   lane: "workflow", label: "Stories",   icon: "🎞️", lede: "Multi-track timeline editor. For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement.", component: StoriesView, visibleFor: ["game", "podcast", "multiple", "unset"] },
  { id: "captures",  lane: "workflow", label: "Captures",  icon: "🎚️", lede: "Dictation pill + global hotkey. Speak into any text field. Also captures audio for cloning sample collection.", component: CapturesView, visibleFor: ["dictation", "accessibility", "multiple", "unset"] },

  // ─── Library lane ──────────────────────────────────────────────────
  { id: "books",     lane: "library", label: "Projects",  icon: "📖", lede: "Multi-use Project library. Audiobooks, game voicelines, podcasts. Imports from JustWrite via POST /v1/projects/import?source=justwrite.", component: BooksView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "voices",    lane: "library", label: "Voices",    icon: "🎙️", lede: "Voice library — cloned, preset (Kokoro 54 + Qwen 9), designed (text-prompt → voice), blended. Per-voice channel routing.", component: VoicesView },
  { id: "personas",  lane: "library", label: "Personas",  icon: "🎭", lede: "Characters. Each persona has a name, bio, voice, personality (TTS delivery instruction), default delivery, effects, lexicon override. Cross-project — one Mara across many books or quests. Filter by usage in the library list.", component: PersonasView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "lexicons",  lane: "library", label: "Lexicons",  icon: "📚", lede: "Pronunciation dictionaries. Force \"Beauchamp\" → \"BEE-chum\", domain words → consistent phoneme-level pronunciation across a whole book. Per-character override.", component: LexiconsView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "effects",   lane: "library", label: "Effects",   icon: "🎛️", lede: "Pedalboard-backed effects chain. Apply non-destructively — creates a new generation version that preserves the original. 8 types · 4 built-in presets + custom.", component: EffectsView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "presets",   lane: "library", label: "Presets",   icon: "🎚️", lede: "Render presets — named bundles of voice + delivery + effects chain + master target. Studio Render binds one per scene to lock per-chapter or per-quest output consistency.", component: RenderPresetsView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "engines",   lane: "library", label: "Engines",   icon: "🧠", lede: "Installed engine catalog. Install / load / unload models. Per-engine venv isolation (JustVoice advantage — install Chatterbox without breaking Kokoro).", component: EnginesView },

  // ─── Tools lane ────────────────────────────────────────────────────
  { id: "compare",   lane: "tools", label: "Compare",   icon: "⚖️", lede: "A/B audio comparison. Side-by-side waveforms, peak/RMS/duration diff, sample-level RMSE, verdict. Bulk compare across takes for QC pass.", component: CompareView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "audio",     lane: "tools", label: "Audio Tools", icon: "🔧", lede: "Stand-alone audio tools — analyze any 16-bit PCM WAV, or apply a mastering preset to a WAV without going through the chapter render pipeline. Useful for inspecting reference clips before cloning, or quickly mastering an external recording.", component: AudioToolsView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "speakerlab",lane: "tools", label: "Speaker Lab",icon: "🔬", lede: "Speaker-extraction testbed. Paste any text, tune model + temperature + tier + prompts per column, race configurations side-by-side, and promote the winner to production. Same backend as Studio · Script.", component: SpeakerLabView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "renderlab", lane: "tools", label: "Render Lab", icon: "🧪", lede: "Voice parameter A/B matrix. Pick a voice + sample sentence + 1-2 parameter axes; render up to 16 cells in parallel (capped at 2 concurrent). Save any cell as a render preset.", component: RenderLabView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "train",     lane: "tools", label: "Train",     icon: "🏋️", lede: "PEFT/LoRA-based fine-tuning. QC pipeline checks SNR / clipping / silence ratio per sample before accepting it.", component: TrainView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },

  // ─── Advanced lane (collapsed by default) ──────────────────────────
  { id: "cache",     lane: "advanced", label: "Cache",     icon: "💾", lede: "Disk-LRU render cache. Keyed on (engine, voice, lexicon hash, persona hash, text hash, effects hash). Engine prefix prevents cross-engine collisions.", component: CacheView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "channels",  lane: "advanced", label: "Channels",  icon: "🔊", lede: "Audio output channel configs. Route specific voices to specific OS audio devices — multi-monitor, OBS virtual mic, per-character podcast monitoring.", component: AudioChannelsView, visibleFor: ["podcast", "game", "multiple", "unset"] },
  { id: "webhooks",  lane: "advanced", label: "Webhooks",  icon: "🔔", lede: "HMAC-SHA256-signed outbound event notifications. At-least-once delivery with exponential backoff (1s → 5s → 30s → 5min).", component: WebhooksView, visibleFor: ["game", "multiple", "unset"] },

  // ─── Settings — pinned at the very bottom, always visible ──────────
  { id: "settings",  lane: "pinned", label: "Settings",  icon: "⚙️", lede: "Every operator-tunable value. Per CLAUDE.md, no value is hardcoded — every knob lives in settings.json.", component: SettingsView },
];

const LANES = [
  { id: "workflow", label: "Workflow" },
  { id: "library",  label: "Library" },
  { id: "tools",    label: "Tools" },
  { id: "advanced", label: "Advanced", collapsible: true },
];

// Advanced lane collapses by default — persist the user's choice across
// sessions via localStorage.
const ADV_KEY = "jv.sidebar.advanced.expanded";
const advancedExpanded = ref(
  typeof window !== "undefined" && window.localStorage?.getItem(ADV_KEY) === "1",
);
watch(advancedExpanded, (v) => {
  try { window.localStorage?.setItem(ADV_KEY, v ? "1" : "0"); } catch { /* ignore */ }
});

function isVisibleFor(viewEntry, useCase) {
  return !viewEntry.visibleFor || viewEntry.visibleFor.includes(useCase);
}

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
const uiContext = useUiContext();
const { t } = useI18n();
let initialTabResolved = false;

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
function localizedLaneLabel(laneId) {
  const key = `lanes.${laneId}`;
  const translated = t(key);
  return translated && translated !== key ? translated : laneId;
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
  const v = view.value;
  // `current_engine` is the engine_id of the currently-loaded TTS slot
  // (post Phase 2 / Slice 1 per-kind slots). Null = no engine OR server
  // offline; the topbar Offline indicator owns the offline messaging,
  // so we skip the lede override when health is null entirely.
  if (!health.value) return null;
  const hasEngine = !!health.value.current_engine;

  if (v === "generate" && !hasEngine) {
    return "No engine loaded yet. Open Engines → pick one → click Load. Then come back here.";
  }
  if (v === "studio" && !hasEngine) {
    return "Studio needs a loaded engine to render. Open Engines first.";
  }
  if (v === "chapter" && !hasEngine) {
    return "Chapter rendering needs a loaded engine. Open Engines first.";
  }
  return null;
});
const effectiveLede = computed(() => stateLedeOverride.value || currentView.value?.lede || "");
const showWelcome = computed(() => onboarding.hydrated && !onboarding.shown);

// Sidebar gating by onboarding primary use case (plan locked decision #7).
// Universal tabs (no `visibleFor`) always render; conditional tabs only
// appear when the user's use case is in the entry's allow-list.
const visibleViews = computed(() =>
  VIEWS.filter((v) => isVisibleFor(v, onboarding.primaryUseCase || "unset")),
);

// Sidebar grouped by lane for the 4-lane render structure.
const lanesWithViews = computed(() =>
  LANES.map((lane) => ({
    ...lane,
    views: visibleViews.value.filter((v) => v.lane === lane.id),
  })).filter((lane) => lane.views.length > 0),
);
const pinnedViews = computed(() =>
  visibleViews.value.filter((v) => v.lane === "pinned"),
);

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
  // Steady poll AFTER boot — without it the header engine pill freezes at
  // its boot value ("No engine") even after the user loads one.
  setInterval(refresh, 5000);
  // Instant refresh when a view knows state changed (EnginesView after
  // load/unload dispatches this).
  window.addEventListener("jv:health-refresh", refresh);
});
</script>

<template>
  <div class="app-shell">
    <!-- Silent looping WAV holds the macOS CoreAudio session open across idle. -->
    <AudioKeepAlive />

    <!-- Left sidebar — 4-lane structure (plan Q4). -->
    <aside class="jv-sidebar">
      <div class="jv-sidebar__brand" title="JustVoice">JV</div>

      <template v-for="lane in lanesWithViews" :key="lane.id">
        <div class="jv-sidebar__lane-header" v-if="!lane.collapsible">
          {{ localizedLaneLabel(lane.id) }}
        </div>
        <button
          v-else
          type="button"
          class="jv-sidebar__lane-header jv-sidebar__lane-header--toggle"
          @click="advancedExpanded = !advancedExpanded"
          :aria-expanded="advancedExpanded"
        >
          <span>{{ localizedLaneLabel(lane.id) }}</span>
          <span class="jv-sidebar__lane-chev">{{ advancedExpanded ? '▾' : '▸' }}</span>
        </button>
        <template v-if="!lane.collapsible || advancedExpanded">
          <a
            v-for="v in lane.views"
            :key="v.id"
            class="jv-sidebar__nav"
            :class="{ 'jv-sidebar__nav--active': view === v.id }"
            :title="localizedViewLabel(v)"
            @click="view = v.id"
          >
            <span class="jv-sidebar__icon">{{ v.icon || '·' }}</span>
            <span class="jv-sidebar__label">{{ localizedViewLabel(v) }}</span>
          </a>
        </template>
      </template>

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

        <!-- Engine pill — persistent visibility of the currently-loaded
             TTS engine. Click jumps to Engines tab. -->
        <button
          v-if="health"
          type="button"
          class="jv-topbar__engine-pill"
          :class="{ 'jv-topbar__engine-pill--empty': !health.current_engine }"
          :title="health.current_engine ? `Loaded: ${health.current_engine}. Click to manage engines.` : 'No engine loaded. Click to load one.'"
          @click="view = 'engines'"
        >
          <span class="jv-topbar__engine-icon">🧠</span>
          {{ health.current_engine || "No engine" }}
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
        <component :is="currentView?.component" />
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
