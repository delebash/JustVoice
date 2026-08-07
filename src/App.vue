<!-- SPDX-License-Identifier: MIT -->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { initialDeepLink } from "./router/index.js";
import { useI18n } from "vue-i18n";
import { useApi } from "./stores/api.js";
import { useOnboarding } from "./stores/onboarding.js";
import { useActiveProject } from "./stores/activeProject.js";
import { useUiContext } from "./stores/uiContext.js";
import { useServerStore } from "./stores/server.js";
import AudioKeepAlive from "./components/AudioKeepAlive.vue";
import QuickSetup from "./components/QuickSetup.vue";
import KeyboardCheatsheet from "./components/KeyboardCheatsheet.vue";
import { AiSetupOffer, AiStatusButton, AiTaskStrip, BootModelLoad, HelpDrawer, HelpTrigger, LlmUiHosts, TitleBar, pushToast, useAiTasksNav, useAiTasksStore, useModelApply, warmModelId } from "@delebash/llm-ui";
import { readPref, writePref } from "./services/prefs.js";
import GlobalAudioPlayer from "./components/GlobalAudioPlayer.vue";

// View components are lazy-loaded by the router (router/index.js); App.vue holds
// only the sidebar metadata (VIEWS) keyed by route name.

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
  { id: "overview",  lane: "workflow", label: "Home",      icon: "🏠", lede: "" },
  { id: "projects",  lane: "workflow", label: "Projects",  icon: "📖", lede: "Multi-use Project library. Audiobooks, game voicelines, podcasts. Import manuscripts from JustWrite, or scripts and audio from other tools.", visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "chapter",   lane: "workflow", label: "Chapters",   icon: "📑", lede: "Multi-block chapter editor with per-block take versioning. Source-lineage chains preserved.", visibleFor: ["audiobook", "podcast", "multiple", "unset"] },
  { id: "lines",     lane: "workflow", label: "Lines",      icon: "🎮", lede: "Every line of the game project — stable ids, characters, derived take status. Re-import the writers\u2019 next sheet (only changed lines go stale), re-render exactly those, export per-line WAVs + manifest.", visibleFor: ["game", "multiple", "unset"] },
  { id: "studio",    lane: "workflow", label: "Studio",    icon: "🎬", lede: "Cast → Script → Render production environment. Three-tab flow for multi-character work. Cast assigns voices to characters; Script runs LLM speaker attribution (Phase 3 backend); Render batches the whole project.", visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "stories",   lane: "workflow", label: "Stories",   icon: "🎞️", lede: "Multi-track timeline editor. For podcasting, game-dialogue assembly, and per-chapter multi-voice arrangement.", visibleFor: ["game", "podcast", "multiple", "unset"] },
  { id: "generate",  lane: "workflow", label: "Generate",  icon: "📝", lede: "Pick a voice. Type the line. Apply delivery overlay. The server renders it. Type / for paralinguistic tags." },
  // Always visible (queue item 11): dictation is a cross-cutting utility
  // for all five audiences — the focus gate made it vanish the moment an
  // audiobook project set workspace focus (user: "where is that?").
  { id: "captures",  lane: "workflow", label: "Captures",  icon: "🎚️", lede: "Dictation pill + global hotkey. Speak into any text field. Also captures audio for cloning sample collection." },

  // ─── Library lane ──────────────────────────────────────────────────
  { id: "voices",    lane: "library", label: "Voices",    icon: "🎙️", lede: "Voice library — cloned, preset (Kokoro 54 + Qwen 9), designed (text-prompt → voice), blended. Per-voice channel routing." },
  { id: "personas",  lane: "library", label: "Personas",  icon: "🎭", lede: "Characters. Each persona has a name, bio, voice, personality (TTS delivery instruction), default delivery, effects, lexicon override. Cross-project — one Mara across many books or quests. Filter by usage in the library list.", visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "lexicons",  lane: "library", label: "Lexicons",  icon: "📚", lede: "Pronunciation dictionaries. Force \"Beauchamp\" → \"BEE-chum\", domain words → consistent phoneme-level pronunciation across a whole book. Per-character override.", visibleFor: ["audiobook", "game", "podcast", "multiple", "unset"] },
  { id: "effects",   lane: "library", label: "Effects",   icon: "🎛️", lede: "Pedalboard-backed effects chain. Apply non-destructively — creates a new generation version that preserves the original. 8 types · 4 built-in presets + custom.", visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "presets",   lane: "library", label: "Presets",   icon: "🎚️", lede: "Render presets — named bundles of voice + delivery + effects chain + master target. Studio Render binds one per scene to lock per-chapter or per-quest output consistency.", visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  // (The Voice engines page left the sidebar in the parity batch, 2026-08-06 —
  // the installed-engine catalog is the AI console's Speech engines tab now;
  // /engines redirects there.)
  // Always visible (ruling 4, 2026-08-05): the shared AI area — providers,
  // model catalog, routing by feature, usage, the AI engine console.
  { id: "ai",        lane: "library", label: "AI Settings", icon: "🤖", lede: "" },

  // ─── Tools lane ────────────────────────────────────────────────────

  // ─── Advanced lane (collapsed by default) ──────────────────────────

  // Hidden route — not in any lane; reached from the import dialog.
  { id: "importreview", lane: "hidden", label: "Import", icon: "⬆", lede: "Review what was detected — pick the chapters to import, confirm, done. Nothing imports until you confirm." },

  // ─── Settings — pinned at the very bottom, always visible ──────────
  { id: "labs",      lane: "pinned", label: "Labs",      icon: "🧪", lede: "", visibleFor: ["audiobook", "podcast", "game", "multiple", "unset"] },
  { id: "settings",  lane: "pinned", label: "Settings",  icon: "⚙️", lede: "Every tunable setting in one place — nothing is hardcoded, so you can adjust how JustVoice behaves without editing files by hand." },
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
    goView(SWITCH_KIND_META[p.project_type]?.home || "chapter");
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
  projects: "core-concepts",
  stories:  "stories",
  chapter:  "take-versioning",
  voices:   "voices",
  personas: "personas",
  lexicons: "lexicons",
  captures: "dictation",
  effects:  "effects",
  train:    "engines",
  compare:  "mastering",
  cache:    "core-concepts",
  audio:    "mastering",
  channels: "channels",
  webhooks: "webhooks",
  settings: "getting-started",
};

// Routing is vue-router (router/index.js): the active view is the route name,
// goView() navigates, and the router owns hash sync + the legacy sub-tab
// redirects. App.vue only decides which routes SHOW in the sidebar.
const router = useRouter();
const route = useRoute();
const view = computed(() => route.name || "overview");
function goView(id) { if (id && route.name !== id) router.push(`/${id}`); }

const health = ref(null);
const api = useApi();
const tasks = useAiTasksStore();

// The AI-tasks nav row (family parity): toggles the kit panel, badges the
// running count — red while there are unseen errors. Behaviour AND the
// required `data-panel-toggle` attribute come from the kit composable, so the
// row cannot be rebuilt without the one attribute that makes it work.
const aiTasksNav = useAiTasksNav();

// ── Once-ever AI setup offer (the family R3 shape; JV's moment = right after
// the FIRST project is created or opened — the recorded donor semantics).
// The once-flag persists in server-side prefs; a box that already has a
// default provider gets the flag marked silently instead of an offer.
const aiOfferOpen = ref(false);
async function maybeOfferAiSetup() {
  if (readPref("aiOfferShown", false)) return;
  try {
    const { refreshApplied, currentDefaultProviderId } = useModelApply();
    await refreshApplied();
    if (currentDefaultProviderId.value) {
      writePref("aiOfferShown", true);
      return;
    }
  } catch { /* unknown → offer; the unconfigured box is the case it serves */ }
  aiOfferOpen.value = true;
}
function closeAiOffer() {
  aiOfferOpen.value = false;
  writePref("aiOfferShown", true); // whatever path was taken, once ever
}
const onboarding = useOnboarding();
const activeProject = useActiveProject();
const uiContext = useUiContext();
const serverStore = useServerStore();
const { t } = useI18n();
// The offer's trigger — BELOW the store declarations: this watch runs at setup
// time, and referencing `activeProject` above its `const` was a
// temporal-dead-zone boot crash the vite build can't catch (found live on the
// first QC run, 2026-08-05 — only the real webview executes setup).
watch(() => activeProject.id, (id, prev) => {
  if (id && !prev) maybeOfferAiSetup();
});
// initialDeepLink is non-empty only for a real bookmarked route — the "/"
// default redirects to /overview, so first-run logic uses it to tell "user
// chose overview" from "defaulted there".
let initialTabResolved = !!initialDeepLink;

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

// State-aware lede override. Currently a no-op — the no-engine case is
// already surfaced where it matters (Overview's engine card, Studio's
// header pill, Generate's inline banner, Chapters' regen-time prompt),
// so the old "No engine in memory…" lede that fired across generate/
// studio/chapter was redundant and noisy (user feedback 2026-06-13).
// Kept as the hook for any future per-view state lede.
const stateLedeOverride = computed(() => null);
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
  initialTabResolved = true;
  // The router already placed us on the URL's route and handled legacy sub-tab
  // + bookmarked deep-links. Only first-run is left: with no explicit deep-link,
  // open the kind picker ("What are you making?") on Projects instead of Home
  // (user decision 2026-06-12: no welcome quiz — the kind picker IS onboarding).
  if (!onboarding.shown && !initialDeepLink) {
    try { window.sessionStorage?.setItem("jv.projects.createKind", ""); } catch { /* ignore */ }
    onboarding.dismiss();
    router.replace("/projects");
  }
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

// The router owns URL sync, back/forward, and deep-links now. On every route
// change, clear stale breadcrumb segments — the new view repopulates them on
// mount if it has context.
watch(() => route.name, () => { uiContext.clear(); });

// QuickSetup is opt-in only (Settings → General → Run Quick Setup, via
// the jv:quick-setup event). Its first-run role moved to the kind
// picker + the contextual RecommendCard (user decision 2026-06-12).
const showQuickSetup = ref(false);
function onQuickSetupClosed() {
  showQuickSetup.value = false;
}

onMounted(async () => {
  // Re-apply the persisted keep-running flag to the shell every boot — the
  // Rust side resets to false per launch (the family headless ruling
  // 2026-08-04; setter no-ops outside Tauri).
  if (serverStore.keepServerRunningOnClose) {
    serverStore.setKeepServerRunningOnClose(true);
  }
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
  // Refresh on tab return to foreground — covers the case where the user
  // changed engine state from another window/CLI while we were inactive.
  // The 5s background poll this replaces was hitting /v1/health every
  // 5 seconds for the lifetime of the page, even when nothing changed.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refresh();
  });
  // Instant refresh when a view knows state changed (EnginesView after
  // load/unload dispatches this). This is the primary path now.
  window.addEventListener("jv:health-refresh", refresh);
  // Re-run the QuickSetup wizard on demand (Settings → General, Home).
  window.addEventListener("jv:quick-setup", () => { showQuickSetup.value = true; });
  // The tray's renderer half (the family full-donor ruling 2026-08-04): the
  // donor's generic entries were dead emits with ZERO listeners (audit
  // 2026-08-05) — these are the listeners. dictate/MCP stay JV-specific;
  // their wiring is JV feature work, parked per the standing sequence.
  const tauriEvent = typeof window !== "undefined" ? window.__TAURI__?.event : null;
  if (tauriEvent?.listen) {
    tauriEvent.listen("tray:open-settings", () => goView("settings"));
    tauriEvent.listen("tray:about", () => goView("settings"));
    tauriEvent.listen("tray:copy-url", async (e) => {
      try {
        await navigator.clipboard.writeText(String(e.payload));
        pushToast({ message: `Server URL copied — ${e.payload}`, duration: 4000 });
      } catch {
        pushToast({ message: "Copy failed", kind: "error" });
      }
    });
  }
});
</script>

<template>
  <div class="app-shell">
    <!-- Silent looping WAV holds the macOS CoreAudio session open across idle. -->
    <AudioKeepAlive />

    <!-- Left sidebar — 4-lane structure (plan Q4). -->
    <aside class="jv-sidebar">
      <div class="jv-sidebar__brand" title="JustVoice">JV</div>

      <!-- Scrollable middle: ALL the nav scrolls together (user QC ruling
           2026-08-06 — AI tasks/Labs/Settings sat outside the scroll "for
           some reason"; the split was arbitrary). Only the brand (top) and
           the version line (foot) stay put. -->
      <div class="jv-sidebar__scroll">
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
            @click="goView(v.id)"
          >
            <span class="jv-sidebar__icon">{{ v.icon || '·' }}</span>
            <span class="jv-sidebar__label">{{ navLabel(v) }}</span>
          </a>
        </template>

        <!-- The kit AI-tasks panel toggle. v-bind carries `data-panel-toggle`:
             the kit's outside-click dismiss exempts elements holding it, so
             the click that OPENS the panel isn't also the click that closes
             it (family lesson, found live 2026-08-03). -->
        <button
          class="jv-sidebar__nav jv-sidebar__nav--btn"
          :class="{ 'jv-sidebar__nav--active': aiTasksNav.isOpen.value }"
          title="AI tasks"
          v-bind="aiTasksNav.navAttrs" @click="aiTasksNav.toggle"
        >
          <span class="jv-sidebar__icon">✨</span>
          <span class="jv-sidebar__label">AI tasks</span>
          <span
            v-if="aiTasksNav.badge.value" class="jv-sidebar__count"
            :class="{ 'jv-sidebar__count--error': aiTasksNav.hasErrors.value }"
          >{{ aiTasksNav.badge.value }}</span>
        </button>
        <a
          v-for="v in pinnedViews"
          :key="v.id"
          class="jv-sidebar__nav"
          :class="{ 'jv-sidebar__nav--active': view === v.id }"
          :title="v.label"
          @click="goView(v.id)"
        >
          <span class="jv-sidebar__icon">{{ v.icon || '·' }}</span>
          <span class="jv-sidebar__label">{{ v.label }}</span>
        </a>
      </div>

      <!-- Pinned foot — the version line only (not nav). -->
      <div class="jv-sidebar__bottom">
        <span class="jv-sidebar__version" v-if="health">v{{ health.version }}</span>
      </div>
    </aside>

    <main class="jv-main">
      <!-- The family TitleBar FRAME (user QC ruling 2026-08-06: "same back
           buttons, same title bar type as the other apps") — the kit owns the
           back/forward mechanics + the frame; everything JV sits in the slots,
           exactly like docgen's adoption. -->
      <TitleBar class="jv-topbar">
        <template #title>
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
        </template>

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
              <button type="button" class="jv-topbar__menu-item jv-topbar__menu-item--all" @click="switcherOpen = false; goView('projects')">
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
             TTS engine. Click lands on the AI console's Speech engines tab
             (the /engines redirect). -->
        <button
          v-if="health"
          type="button"
          class="jv-topbar__engine-pill"
          :class="{ 'jv-topbar__engine-pill--empty': !health.current_engine }"
          :title="health.current_engine ? `Voice engine loaded: ${health.current_engine}. Click to manage speech engines.` : 'No voice engine loaded. Click to load one.'"
          @click="goView('engines')"
        >
          <span class="jv-topbar__engine-icon">🧠</span>
          {{ health.current_engine || "No voice engine" }}
        </button>

        <button
          type="button"
          class="jv-topbar__status"
          :class="{ 'jv-topbar__status--warn': !health || health.status !== 'ok' }"
          data-panel-toggle
          :title="tasks.runningCount ? 'Open status panel' : 'Server status'"
          @click="tasks.togglePanel()"
        >
          <span class="jv-topbar__dot"></span>
          {{ health && health.status === "ok" ? "Operational" : (health ? health.status : "Offline") }}
          <span class="jv-topbar__url">· {{ api.serverUrl }}</span>
          <span v-if="tasks.runningCount" class="jv-topbar__taskcount">
            · <strong>{{ tasks.runningCount }}</strong> in flight
          </span>
        </button>
        <!-- §11 chrome: the kit's AI status button, in the frame's slot. -->
        <AiStatusButton />
        <HelpTrigger :slug="currentHelpSlug" :label="currentView?.label || 'JustVoice'" />
      </TitleBar>

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
        <!-- Global task stack (kit strips). Inline-flagged tasks are skipped —
             their surface (a Lab column, a modal) renders its own strip, and
             one run must never show twice. -->
        <AiTaskStrip v-for="task in tasks.visibleTasks.filter((t) => !t.inline)" :key="task.id" :task="task" />
        <router-view v-slot="{ Component }">
          <KeepAlive>
            <component :is="Component" :key="route.name" />
          </KeepAlive>
        </router-view>
      </div>
    </main>

    <!-- Every host element the shared UI needs, as ONE tag (Toast + AppDialog were
         hand-mounted here; the failure mode the installer kills is mounting SOME). -->
    <LlmUiHosts />
    <!-- The once-ever AI offer — fired right after the first project is
         created or opened on a box with no default provider (the flag
         persists whatever path is taken). -->
    <AiSetupOffer
      v-if="aiOfferOpen" app-name="JustVoice"
      @close="closeAiOffer"
      @quick-setup="closeAiOffer(); router.push('/ai?quicksetup=1')"
      @connect-provider="closeAiOffer(); router.push('/ai?providers=online')" />
    <QuickSetup v-if="showQuickSetup" @close="onQuickSetupClosed" />
    <KeyboardCheatsheet />
    <HelpDrawer />
    <GlobalAudioPlayer />

    <!-- Boot splash — the PAGE is this app's (the same minimal brand plate as
         index.html #app-boot — KEEP IN SYNC), the load group is the KIT's.
         `warmModelId` is set by main.js's pre-mount startWarmOnBoot(); nothing
         loading → no splash → the app just opens. JV's warm default is OFF
         (ruling 2026-08-05), so this shows only when the user turned warm on. -->
    <div v-if="warmModelId" class="splash">
      <img class="splash__logo" src="/justtts.svg" alt="" />
      <div class="splash__name">JustVoice</div>
      <div class="splash__strip">
        <BootModelLoad />
      </div>
    </div>
  </div>
</template>
