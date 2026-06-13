<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useApi } from "./stores/api.js";
import { useRenderTasks } from "./stores/renderTasks.js";
import { useOnboarding } from "./stores/onboarding.js";
import { useActiveProject } from "./stores/activeProject.js";
import { useUiContext } from "./stores/uiContext.js";
import Toast from "./components/Toast.vue";
import TaskStrip from "./components/TaskStrip.vue";
import TaskStatusPanel from "./components/TaskStatusPanel.vue";
import AppDialog from "./components/AppDialog.vue";
import AudioKeepAlive from "./components/AudioKeepAlive.vue";
import QuickSetup from "./components/QuickSetup.vue";
import KeyboardCheatsheet from "./components/KeyboardCheatsheet.vue";
import JvHelpDrawer from "./components/JvHelpDrawer.vue";
import HelpTrigger from "./components/HelpTrigger.vue";
import GlobalAudioPlayer from "./components/GlobalAudioPlayer.vue";

import OverviewView from "./views/OverviewView.vue";
import GenerateView from "./views/GenerateView.vue";
import ChapterView from "./views/ChapterView.vue";
import BooksView from "./views/BooksView.vue";
import ImportReviewView from "./views/ImportReviewView.vue";
import VoicesView from "./views/VoicesView.vue";
// ProfilesView removed — Persona is the sole identity layer after the
// Profile-kill (plan Q1). All voice config now lives directly on Persona.
import StudioView from "./views/StudioView.vue";
import LinesView from "./views/LinesView.vue";
import PersonasView from "./views/PersonasView.vue";
import LexiconsView from "./views/LexiconsView.vue";
import EnginesView from "./views/EnginesView.vue";
import LabsView from "./views/LabsView.vue";
import SettingsView from "./views/SettingsView.vue";
import CapturesView from "./views/CapturesView.vue";
import StoriesView from "./views/StoriesView.vue";
import EffectsView from "./views/EffectsView.vue";
import RenderPresetsView from "./views/RenderPresetsView.vue";

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
  { id: "books",     lane: "workflow", label: "Projects",  icon: "📖", lede: "Multi-use Project library. Audiobooks, game voicelines, podcasts. Import manuscripts from JustWrite, or scripts and audio from other tools.", component: BooksView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "chapter",   lane: "workflow", label: "Chapters",   icon: "📑", lede: "Multi-block chapter editor with per-block take versioning. Source-lineage chains preserved.", component: ChapterView, visibleFor: ["audiobook", "podcast", "multiple", "unset"] },
  { id: "lines",     lane: "workflow", label: "Lines",      icon: "🎮", lede: "Every line of the game project — stable ids, characters, derived take status. Re-import the writers\u2019 next sheet (only changed lines go stale), re-render exactly those, export per-line WAVs + manifest.", component: LinesView, visibleFor: ["game", "multiple", "unset"] },
  { id: "studio",    lane: "workflow", label: "Studio",    icon: "🎬", lede: "Cast → Script → Render production environment. Three-tab flow for multi-character work. Cast assigns voices to characters; Script runs LLM speaker attribution (Phase 3 backend); Render batches the whole project.", component: StudioView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "stories",   lane: "workflow", label: "Stories",   icon: "🎞️", lede: "Multi-track timeline editor. For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement.", component: StoriesView, visibleFor: ["game", "podcast", "multiple", "unset"] },
  { id: "generate",  lane: "workflow", label: "Generate",  icon: "📝", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it. Type / for paralinguistic tags.", component: GenerateView },
  // Always visible (queue item 11): dictation is a cross-cutting utility
  // for all five audiences — the focus gate made it vanish the moment an
  // audiobook project set workspace focus (user: "where is that?").
  { id: "captures",  lane: "workflow", label: "Captures",  icon: "🎚️", lede: "Dictation pill + global hotkey. Speak into any text field. Also captures audio for cloning sample collection.", component: CapturesView },

  // ─── Library lane ──────────────────────────────────────────────────
  { id: "voices",    lane: "library", label: "Voices",    icon: "🎙️", lede: "Voice library — cloned, preset (Kokoro 54 + Qwen 9), designed (text-prompt → voice), blended. Per-voice channel routing.", component: VoicesView },
  { id: "personas",  lane: "library", label: "Personas",  icon: "🎭", lede: "Characters. Each persona has a name, bio, voice, personality (TTS delivery instruction), default delivery, effects, lexicon override. Cross-project — one Mara across many books or quests. Filter by usage in the library list.", component: PersonasView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "lexicons",  lane: "library", label: "Lexicons",  icon: "📚", lede: "Pronunciation dictionaries. Force \"Beauchamp\" → \"BEE-chum\", domain words → consistent phoneme-level pronunciation across a whole book. Per-character override.", component: LexiconsView, visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "effects",   lane: "library", label: "Effects",   icon: "🎛️", lede: "Pedalboard-backed effects chain. Apply non-destructively — creates a new generation version that preserves the original. 8 types · 4 built-in presets + custom.", component: EffectsView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "presets",   lane: "library", label: "Presets",   icon: "🎚️", lede: "Render presets — named bundles of voice + delivery + effects chain + master target. Studio Render binds one per scene to lock per-chapter or per-quest output consistency.", component: RenderPresetsView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "engines",   lane: "library", label: "Engines",   icon: "🧠", lede: "Installed engine catalog. Install / load / unload models. Per-engine venv isolation (JustVoice advantage — install Chatterbox without breaking Kokoro).", component: EnginesView },

  // ─── Tools lane ────────────────────────────────────────────────────

  // ─── Advanced lane (collapsed by default) ──────────────────────────

  // Hidden route — not in any lane; reached from the import dialog.
  { id: "importreview", lane: "hidden", label: "Import", icon: "⬆", lede: "Review what was detected — pick the chapters to import, confirm, done. Nothing imports until you confirm.", component: ImportReviewView },

  // ─── Settings — pinned at the very bottom, always visible ──────────
  { id: "labs",      lane: "pinned", label: "Labs",      icon: "🧪", lede: "", component: LabsView, visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "settings",  lane: "pinned", label: "Settings",  icon: "⚙️", lede: "Every tunable setting in one place — nothing is hardcoded, so you can adjust how JustVoice behaves without editing files by hand.", component: SettingsView },
];

const LANES = [
  { id: "workflow", label: "Workflow" },
  { id: "library",  label: "Library" },
];

function isVisibleFor(viewEntry, useCase) {
  return !viewEntry.visibleFor || viewEntry.visibleFor.includes(useCase);
}

// ── Per-kind nav vocabulary (journeys-preview KIND_NAV contract) ──────
// When a project is open, the structure item swaps with its kind:
// audiobook → Chapters · game → Lines · podcast → Episodes + Timeline.
// A string = show with this label; false = hide for this kind.
const KIND_STRUCT = {
  audiobook: { chapter: "Chapters", lines: false, stories: false },
  game:      { chapter: false,      lines: "Lines", stories: false },
  podcast:   { chapter: "Episodes", lines: false, stories: "Timeline" },
  text:      { chapter: "Chapters", lines: false, stories: false },
};

// The open project's kind also drives the visibleFor filtering — the
// sidebar follows what you're MAKING, not the install-time focus.
const KIND_TO_USE_CASE = { audiobook: "audiobook", game: "game", podcast: "podcast", text: "multiple" };

// ── Topbar project switcher (JustWrite-style) ────────────────────────
const switcherOpen = ref(false);
const switcherRef = ref(null);
const switcherProjects = ref([]);
const SWITCH_KIND_META = {
  audiobook: { icon: "📖", label: "audiobook", home: "chapter" },
  game_voicelines: { icon: "🎮", label: "game", home: "lines" },
  podcast: { icon: "🎙️", label: "podcast", home: "chapter" },
  custom: { icon: "📄", label: "text", home: "chapter" },
};
async function toggleSwitcher() {
  switcherOpen.value = !switcherOpen.value;
  if (!switcherOpen.value) return;
  try {
    const r = await api.request("/v1/projects");
    switcherProjects.value = (r?.projects || [])
      .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0))
      .slice(0, 8);
  } catch { switcherProjects.value = []; }
}
function switchProject(p) {
  switcherOpen.value = false;
  if (p.id === activeProject.id) return;
  activeProject.open(p);
  // Stay put when the current view survives the kind swap; otherwise
  // land in the new kind's home base.
  if (!visibleViews.value.some((v) => v.id === view.value)) {
    view.value = SWITCH_KIND_META[p.project_type]?.home || "chapter";
  }
}
if (typeof document !== "undefined") {
  document.addEventListener("mousedown", (e) => {
    if (switcherOpen.value && switcherRef.value && !switcherRef.value.contains(e.target)) {
      switcherOpen.value = false;
    }
  });
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

// Every use case launches on Home — the journeys contract makes it the
// daily driver ("resume where you left off, catalogue at a glance, live
// tasks, loaded engine, recent generations"). Explicit hash deep-links
// still win in resolveInitialTab.
const DEFAULT_TAB_BY_USE_CASE = {
  audiobook:     "overview",
  game:          "overview",
  podcast:       "overview",
  dictation:     "overview",
  accessibility: "overview",
  multiple:      "overview",
  unset:         "overview",
};

const view = ref("overview");
const health = ref(null);
const api = useApi();
const tasks = useRenderTasks();
const onboarding = useOnboarding();
const activeProject = useActiveProject();
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

  if ((v === "generate" || v === "studio" || v === "chapter") && !hasEngine) {
    return {
      text: "No engine in memory — your first render sets one up automatically (Kokoro, ~310 MB one-time download). Prefer another engine?",
      linkLabel: "Pick it in Engines",
      linkHash: "#engines",
    };
  }
  return null;
});
// Normalized lede shape: { text, linkLabel?, linkHash? }. Static view
// ledes stay plain strings in VIEWS; state overrides may carry a link.
const effectiveLede = computed(() => {
  if (stateLedeOverride.value) return stateLedeOverride.value;
  const s = currentView.value?.lede || "";
  return s ? { text: s } : null;
});

// Sidebar gating by onboarding primary use case (plan locked decision #7).
// Universal tabs (no `visibleFor`) always render; conditional tabs only
// appear when the user's use case is in the entry's allow-list. With a
// project open, the project's kind takes over: the struct item swaps
// (Chapters / Lines / Episodes+Timeline) and visibleFor filters against
// the kind's vocabulary instead of the install-time focus.
const effectiveUseCase = computed(() =>
  KIND_TO_USE_CASE[activeProject.kind] || onboarding.primaryUseCase || "unset",
);
const visibleViews = computed(() =>
  VIEWS.filter((v) => {
    const struct = KIND_STRUCT[activeProject.kind];
    if (struct && v.id in struct) return !!struct[v.id];
    return isVisibleFor(v, effectiveUseCase.value);
  }),
);

// Sidebar label override per kind (Chapters → Episodes, Stories → Timeline).
function navLabel(v) {
  const struct = KIND_STRUCT[activeProject.kind];
  const override = struct?.[v.id];
  return typeof override === "string" ? override : localizedViewLabel(v);
}

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
  // Legacy Settings sub-tab deep links (#cache/#channels/#webhooks) —
  // only the hashchange listener handled these, so a COLD load of the
  // URL fell through to Home (user-hit: parity capture landed wrong).
  if (["cache", "channels", "webhooks"].includes(hashId)) {
    try { window.sessionStorage?.setItem("jv.settings.sub", hashId); } catch { /* ignore */ }
    view.value = "settings";
    initialTabResolved = true;
    return;
  }
  if (["compare", "train", "speakerlab", "renderlab", "audio"].includes(hashId)) {
    try { window.sessionStorage?.setItem("jv.labs.sub", hashId); } catch { /* ignore */ }
    view.value = "labs";
    initialTabResolved = true;
    return;
  }
  // First run = the real question, "What are you making?" (user decision
  // 2026-06-12: no welcome quiz, no setup wizard — the kind picker opens,
  // creating the first project sets the workspace focus, and engines
  // install themselves on first render). One-shot: offering it marks
  // onboarding shown whether or not a project gets created.
  if (!onboarding.shown) {
    try { window.sessionStorage?.setItem("jv.books.createKind", ""); } catch { /* ignore */ }
    view.value = "books";
    initialTabResolved = true;
    onboarding.dismiss();
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
  const LEGACY_SETTINGS_TABS = { cache: "cache", channels: "channels", webhooks: "webhooks" };
  const LEGACY_LABS_TABS = ["compare", "train", "speakerlab", "renderlab", "audio"];
  const routeHash = (hashId) => {
    if (LEGACY_SETTINGS_TABS[hashId]) {
      try { window.sessionStorage?.setItem("jv.settings.sub", LEGACY_SETTINGS_TABS[hashId]); } catch { /* ignore */ }
      view.value = "settings";
      return true;
    }
    if (LEGACY_LABS_TABS.includes(hashId)) {
      try { window.sessionStorage?.setItem("jv.labs.sub", hashId); } catch { /* ignore */ }
      view.value = "labs";
      return true;
    }
    return false;
  };
  window.addEventListener("hashchange", () => {
    const hashId = window.location.hash.replace(/^#/, "");
    if (routeHash(hashId)) return;
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

// QuickSetup is opt-in only (Settings → General → Run Quick Setup, via
// the jv:quick-setup event). Its first-run role moved to the kind
// picker + the contextual RecommendCard (user decision 2026-06-12).
const showQuickSetup = ref(false);
function onQuickSetupClosed() {
  showQuickSetup.value = false;
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
  // Re-run the QuickSetup wizard on demand (Settings → General, Home).
  window.addEventListener("jv:quick-setup", () => { showQuickSetup.value = true; });
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
        <div class="jv-sidebar__lane-header">
          {{ localizedLaneLabel(lane.id) }}
        </div>
        <a
          v-for="v in lane.views"
          :key="v.id"
          class="jv-sidebar__nav"
          :class="{ 'jv-sidebar__nav--active': view === v.id }"
          :title="navLabel(v)"
          @click="view = v.id"
        >
          <span class="jv-sidebar__icon">{{ v.icon || '·' }}</span>
          <span class="jv-sidebar__label">{{ navLabel(v) }}</span>
        </a>
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
          {{ currentView ? navLabel(currentView) : '' }}
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

        <!-- Active-project chips (journeys topbar contract) — Project /
             Kind / Master. Click the project chip to jump to Projects. -->
        <template v-if="activeProject.id">
          <div class="jv-topbar__switcher" ref="switcherRef">
            <button type="button" class="jv-topbar__proj" title="Active project — click to switch" @click="toggleSwitcher">
              <span class="jv-topbar__proj-k">Project</span><b>{{ activeProject.name }}</b><span class="jv-topbar__proj-chev">▾</span>
            </button>
            <div v-if="switcherOpen" class="jv-topbar__menu">
              <button
                v-for="p in switcherProjects"
                :key="p.id"
                type="button"
                class="jv-topbar__menu-item"
                :class="{ 'jv-topbar__menu-item--current': p.id === activeProject.id }"
                :title="`Switch — the sidebar re-tailors to ${SWITCH_KIND_META[p.project_type]?.label || 'this kind'}`"
                @click="switchProject(p)"
              >
                <span>{{ SWITCH_KIND_META[p.project_type]?.icon || "📄" }}</span>
                <span class="jv-topbar__menu-name">{{ p.name }}</span>
                <span v-if="p.id === activeProject.id" class="jv-topbar__menu-check">✓</span>
              </button>
              <button type="button" class="jv-topbar__menu-item jv-topbar__menu-item--all" @click="switcherOpen = false; view = 'books'">
                All projects ➜
              </button>
            </div>
          </div>
          <span class="jv-topbar__proj" :title="`Project kind — decides the sidebar vocabulary and the export pipeline`">
            <span class="jv-topbar__proj-k">Kind</span><b>{{ activeProject.kindIcon }} {{ activeProject.kindLabel }}</b>
          </span>
          <span v-if="activeProject.master" class="jv-topbar__proj" title="Mastering preset applied on render">
            <span class="jv-topbar__proj-k">Master</span><b>{{ activeProject.master }}</b>
          </span>
        </template>

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
        <p v-if="effectiveLede" class="jv-content__lede">
          {{ effectiveLede.text }}
          <template v-if="effectiveLede.linkLabel">
            <a :href="effectiveLede.linkHash">{{ effectiveLede.linkLabel }}</a>.
          </template>
        </p>
        <TaskStrip v-for="task in tasks.running" :key="task.id" :task="task" />
        <component :is="currentView?.component" />
      </div>
    </main>

    <Toast />
    <AppDialog />
    <QuickSetup v-if="showQuickSetup" @close="onQuickSetupClosed" />
    <KeyboardCheatsheet />
    <JvHelpDrawer />
    <GlobalAudioPlayer />
    <TaskStatusPanel />
  </div>
</template>
