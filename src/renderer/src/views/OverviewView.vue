<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useOnboarding } from "../stores/onboarding.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import JvTag from "../components/jv/JvTag.vue";
import { useCopy } from "../services/copy.js";

const onboarding = useOnboarding();

// Use-case quick-actions — small clickable cards that jump to the most
// likely entry point for each audience. The card matching the user's
// onboarded primary use case is visually highlighted so repeat users
// see "their" workflow first.
const QUICK_ACTIONS = [
  { id: "audiobook", icon: "📖", title: "Render an audiobook chapter",  href: "#chapter",  desc: "Long-form narration with take versioning + ACX mastering" },
  { id: "game",      icon: "🎮", title: "Generate a game dialogue line", href: "#generate", desc: "Single-line render with per-line WAV + JSON export" },
  { id: "podcast",   icon: "🎬", title: "Build a podcast in Stories",    href: "#stories",  desc: "Multi-track timeline with named tracks + effects" },
  { id: "dictation", icon: "🎙️", title: "Dictate into any app",          href: "#captures", desc: "Push-to-talk → Whisper → LLM refine → paste" },
];

const copy = useCopy();
const api = useApi();
const tasks = useRenderTasks();

const health = ref(null);
const engines = ref([]);
const voices = ref([]);
const personas = ref([]);
const projects = ref([]);
const lexicons = ref([]);
const captures = ref([]);
const stats = ref(null);
const recentGenerations = ref([]);
const loadedEngine = ref(null);

async function safeRequest(path, fallback) {
  // Silent fallback — when offline, the topbar Offline indicator + empty
  // cards already communicate the state. Don't fire a redundant toast on
  // boot (was the unstyled-toast-spam bug from 2026-06-09).
  try {
    return await api.request(path);
  } catch {
    return fallback;
  }
}

async function refresh() {
  // Run every catalogue probe in parallel; any failure just leaves the
  // relevant stat empty rather than nuking the whole view with a fatal.
  const [h, e, v, p, pr, lx, ca, s, g, ce] = await Promise.all([
    safeRequest("/v1/health", null),
    safeRequest("/v1/engines", { engines: [] }),
    safeRequest("/v1/voices", { voices: [] }),
    safeRequest("/v1/personas", { personas: [] }),
    safeRequest("/v1/projects", { projects: [] }),
    safeRequest("/v1/lexicons", { lexicons: [] }),
    safeRequest("/v1/captures?limit=1", { captures: [], total: null }),
    safeRequest("/v1/cache/stats", null),
    safeRequest("/v1/generations/recent?limit=5", { generations: [] }),
    safeRequest("/v1/engines/current", { engine: null }),
  ]);
  health.value = h;
  engines.value = e.engines || [];
  voices.value = v.voices || [];
  personas.value = p.personas || [];
  projects.value = pr.projects || [];
  lexicons.value = lx.lexicons || [];
  captures.value = ca.captures || [];
  // Total may come back as null when the server is down; treat as "—".
  captures.totalCount = ca.total ?? (ca.captures?.length ?? null);
  stats.value = s;
  recentGenerations.value = g.generations || [];
  loadedEngine.value = ce.engine || null;
}

const voicesByEngine = computed(() => {
  const map = {};
  for (const v of voices.value) {
    const k = v.engine || "unknown";
    map[k] = (map[k] || 0) + 1;
  }
  return map;
});

const projectsByType = computed(() => {
  const map = {};
  for (const p of projects.value) {
    const k = p.project_type || "custom";
    map[k] = (map[k] || 0) + 1;
  }
  return map;
});

const projectsSummary = computed(() => {
  const m = projectsByType.value;
  const parts = [];
  if (m.audiobook) parts.push(`${m.audiobook} audiobook`);
  if (m.game_voicelines) parts.push(`${m.game_voicelines} game`);
  if (m.podcast) parts.push(`${m.podcast} podcast`);
  if (m.custom) parts.push(`${m.custom} custom`);
  return parts.length ? parts.join(" · ") : "—";
});

const lexiconEntriesSummary = computed(() => {
  if (!lexicons.value.length) return "—";
  const total = lexicons.value.reduce((s, lx) => s + (lx.entry_count ?? 0), 0);
  return `${total} entries`;
});

const cacheMB = computed(() => {
  if (!stats.value) return "—";
  return (stats.value.total_bytes_on_disk / 1024 / 1024).toFixed(1);
});

const cacheHitRate = computed(() => {
  if (!stats.value || !stats.value.hits || !stats.value.requests) return "—";
  return Math.round((stats.value.hits / stats.value.requests) * 100) + "%";
});

const captureCount = computed(() => captures.totalCount ?? captures.value.length ?? 0);

function fmtAgo(iso) {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  const ago = Date.now() - t;
  if (ago < 60_000) return Math.floor(ago / 1000) + "s ago";
  if (ago < 3_600_000) return Math.floor(ago / 60_000) + "m ago";
  if (ago < 86_400_000) return Math.floor(ago / 3_600_000) + "h ago";
  return Math.floor(ago / 86_400_000) + "d ago";
}

function fmtDur(sec) {
  if (sec == null) return "—";
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const runningTasks = computed(() => tasks.running || []);

// State-aware Next-step card — plan Q4 / Slice 1. Drives the user from
// whatever state they're in to the next concrete action. Order of
// precedence reflects priority: nothing else matters until an engine is
// loaded, no work can happen without a project, no render preview until
// blocks exist, etc. Returns null when the user is past the bootstrap
// arc and there's no specific "do this next" prompt.
const nextStep = computed(() => {
  const useCase = onboarding.primaryUseCase || "unset";

  if (!loadedEngine.value) {
    return {
      eyebrow: "Step 1",
      title: "Load your first engine",
      body: "JustVoice ships with 7 engines. Kokoro runs on CPU in realtime — a good first install.",
      cta: { label: "Open Engines", href: "#engines" },
    };
  }

  // Dictation / accessibility: engine + voice is all the user needs.
  if (useCase === "dictation") {
    return captures.value?.length
      ? null
      : {
          eyebrow: "Next step",
          title: "Bind your dictation hotkey",
          body: "Open Captures, set a global hotkey, then speak into any text field.",
          cta: { label: "Open Captures", href: "#captures" },
        };
  }
  if (useCase === "accessibility") {
    return null;
  }

  // Script-producing use cases need a project, then a scene, then blocks.
  if (!projects.value.length) {
    return {
      eyebrow: "Step 2",
      title: `Create your first ${copy.value.book.singular.toLowerCase()}`,
      body: useCase === "audiobook"
        ? "Import from JustWrite, paste a manuscript chapter, or start blank. Studio walks you from cast → script → render."
        : `Open ${copy.value.book.plural} → Create new to start.`,
      cta: { label: `Open ${copy.value.book.plural}`, href: "#books" },
    };
  }

  // Has project, no cast — Studio Cast tab.
  if (!personas.value.length) {
    return {
      eyebrow: "Step 3",
      title: `Add ${copy.value.cast.plural.toLowerCase()} to your ${copy.value.book.singular.toLowerCase()}`,
      body: `Each ${copy.value.cast.singular.toLowerCase()} pairs a name with a voice. Studio's Cast tab handles the assignment.`,
      cta: { label: "Open Studio", href: "#studio" },
    };
  }

  // Active work in progress — nothing to suggest.
  if (runningTasks.value.length) return null;

  // Steady-state: prompt to keep producing.
  return {
    eyebrow: "Pick up",
    title: recentGenerations.value.length
      ? "Pick up where you left off"
      : "Open Studio to start producing",
    body: recentGenerations.value.length
      ? "Your last renders are listed below. Studio's Script tab is where multi-line work lives."
      : "Studio walks you from cast → script → render. Generate is the single-line workbench for one-offs.",
    cta: { label: "Open Studio", href: "#studio" },
  };
});

onMounted(refresh);
</script>

<template>
  <div class="overview-view">
    <!-- ── Intro band + quick-actions ─────────────────────────────────
         Centered display title "JustVoice." + tagline + 4 use-case
         quick-actions. The card matching the user's onboarded primary
         use case is highlighted with the brand accent. -->
    <section class="overview-view__intro">
      <h1 class="overview-view__hero">JustVoice</h1>
      <p class="overview-view__tagline">
        A voice production studio for audiobook producers, game developers, podcasters, dictation, and accessibility.
      </p>

      <!-- State-aware Next-step card. Drives first-run + bootstrap arc. -->
      <a
        v-if="nextStep"
        class="overview-view__next-step"
        :href="nextStep.cta.href"
      >
        <span class="overview-view__next-step-eyebrow">{{ nextStep.eyebrow }}</span>
        <strong class="overview-view__next-step-title">{{ nextStep.title }}</strong>
        <p class="overview-view__next-step-body">{{ nextStep.body }}</p>
        <span class="overview-view__next-step-cta">{{ nextStep.cta.label }} →</span>
      </a>

      <div class="overview-view__quick-actions" v-if="!recentGenerations.length">
        <a
          v-for="q in QUICK_ACTIONS"
          :key="q.id"
          class="overview-view__quick-action"
          :class="{ 'overview-view__quick-action--active': onboarding.primaryUseCase === q.id }"
          :href="q.href"
        >
          <span class="overview-view__quick-action-icon">{{ q.icon }}</span>
          <div class="overview-view__quick-action-body">
            <strong class="overview-view__quick-action-title">{{ q.title }}</strong>
            <span class="overview-view__quick-action-desc">{{ q.desc }}</span>
          </div>
        </a>
      </div>
    </section>

    <!-- ── Catalogue: 6 stat tiles per preview HTML §Overview ─────────── -->
    <div class="jv-section">
      <h3 class="jv-section__title">Catalogue</h3>
      <div class="overview-view__stats">
        <div class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">Voices</div>
          <div class="overview-view__stat-value">{{ voices.length || 0 }}</div>
          <div class="overview-view__stat-sub jv-muted">
            across {{ Object.keys(voicesByEngine).length || 0 }} engine{{ Object.keys(voicesByEngine).length === 1 ? "" : "s" }}
          </div>
        </div>
        <div class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">{{ copy.cast.plural }}</div>
          <div class="overview-view__stat-value">{{ personas.length || 0 }}</div>
          <div class="overview-view__stat-sub jv-muted">named &amp; bound</div>
        </div>
        <div class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">{{ copy.book.plural }}</div>
          <div class="overview-view__stat-value">{{ projects.length || 0 }}</div>
          <div class="overview-view__stat-sub jv-muted">{{ projectsSummary }}</div>
        </div>
        <div class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">Lexicons</div>
          <div class="overview-view__stat-value">{{ lexicons.length || 0 }}</div>
          <div class="overview-view__stat-sub jv-muted">{{ lexiconEntriesSummary }}</div>
        </div>
        <div class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">Cache</div>
          <div class="overview-view__stat-value">
            <template v-if="stats && Number.isFinite(parseFloat(cacheMB))">{{ cacheMB }}<span class="overview-view__unit">MB</span></template>
            <template v-else>—</template>
          </div>
          <div class="overview-view__stat-sub jv-muted">
            <template v-if="stats">{{ stats.total_entries_on_disk ?? 0 }} entries<span v-if="cacheHitRate !== '—'"> · {{ cacheHitRate }} hit</span></template>
            <template v-else>server offline</template>
          </div>
        </div>
        <div class="jv-card overview-view__stat">
          <div class="overview-view__stat-label">Captures</div>
          <div class="overview-view__stat-value">{{ captureCount }}</div>
          <div class="overview-view__stat-sub jv-muted">last 30 days</div>
        </div>
      </div>
    </div>

    <!-- ── Loaded engine card per preview HTML §Overview ──────────────── -->
    <div class="jv-section">
      <h3 class="jv-section__title">
        Loaded engine
        <JvTag v-if="loadedEngine" variant="success" label="ready" />
        <JvTag v-else variant="default" label="none" />
      </h3>
      <div class="jv-card overview-view__loaded">
        <template v-if="loadedEngine">
          <div class="overview-view__loaded-cell">
            <div class="overview-view__loaded-k">Engine</div>
            <strong class="overview-view__loaded-v">{{ loadedEngine.name }}</strong>
          </div>
          <div class="overview-view__loaded-cell">
            <div class="overview-view__loaded-k">Backend</div>
            <span class="jv-muted">{{ loadedEngine.backend || loadedEngine.device || "—" }}</span>
          </div>
          <div class="overview-view__loaded-cell" v-if="loadedEngine.vram_total_mb">
            <div class="overview-view__loaded-k">VRAM</div>
            <span class="jv-muted">{{ (loadedEngine.vram_used_mb || 0) / 1024 | 0 }} / {{ (loadedEngine.vram_total_mb / 1024).toFixed(0) }} GB</span>
          </div>
          <div class="jv-spacer" />
          <JvButton variant="secondary" size="sm" label="Unload" />
          <JvButton variant="primary" size="sm" label="Switch" />
        </template>
        <template v-else>
          <p class="jv-muted" style="margin: 4px 0">No engine loaded. <a href="#engines">Go to Engines → Load</a> to pick one.</p>
        </template>
      </div>
    </div>

    <!-- ── Active tasks card — always shown, empty state when nothing in flight. -->
    <div class="jv-section">
      <h3 class="jv-section__title">
        Active tasks
        <JvTag v-if="runningTasks.length" variant="warn" :label="`${runningTasks.length} in flight`" />
        <JvTag v-else variant="default" label="idle" />
      </h3>
      <div class="jv-card">
        <template v-if="runningTasks.length">
          <div v-for="t in runningTasks" :key="t.id" class="overview-view__task">
            <span class="jv-pill jv-pill--solid">● {{ t.kind || "Render" }}</span>
            <strong>{{ t.label }}</strong>
            <span class="jv-muted">{{ t.statsLine || "" }}</span>
            <div class="jv-spacer" />
            <div class="overview-view__task-bar">
              <div
                class="overview-view__task-fill"
                :style="{ width: ((t.progress ?? 0) * 100) + '%' }"
              />
            </div>
            <JvButton variant="danger-outline" size="sm" label="Cancel" @click="t.onCancel?.()" />
          </div>
        </template>
        <p v-else class="jv-muted overview-view__empty">
          Nothing in flight. Renders started from <a href="#generate">Generate</a>, <a href="#chapter">Chapter</a>, or batch renders from <a href="#books">{{ copy.book.plural }}</a> show up here with a live progress bar + cancel.
        </p>
      </div>
    </div>

    <!-- ── Recent generations table — always shown, empty state when no history. -->
    <div class="jv-section">
      <h3 class="jv-section__title">
        Recent generations
        <JvTag v-if="recentGenerations.length" variant="default" :label="`last ${recentGenerations.length}`" />
      </h3>
      <div class="jv-card jv-card--flat">
        <table v-if="recentGenerations.length" class="jv-table">
          <thead>
            <tr><th>When</th><th>Voice</th><th>Text</th><th>Duration</th><th class="jv-table__actions">Actions</th></tr>
          </thead>
          <tbody>
            <tr v-for="g in recentGenerations" :key="g.id">
              <td class="jv-muted">{{ fmtAgo(g.created_at) }}</td>
              <td>
                <strong>{{ g.voice_name || g.voice_id }}</strong>
                <span v-if="g.engine" class="jv-pill jv-pill--ghost" style="margin-left: 6px">{{ g.engine }}</span>
              </td>
              <td class="jv-muted" style="max-width: 480px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">
                "{{ (g.text || "").slice(0, 80) }}{{ (g.text || "").length > 80 ? "…" : "" }}"
              </td>
              <td>{{ fmtDur(g.duration_sec) }}</td>
              <td class="jv-table__actions">
                <JvButton variant="ghost" size="sm" label="▶" />
                <JvButton variant="ghost" size="sm" label="★" />
                <JvButton variant="ghost" size="sm" label="↻" />
              </td>
            </tr>
          </tbody>
        </table>
        <p v-else class="jv-muted overview-view__empty">
          No renders yet. Open <a href="#generate">Generate</a> to produce your first line, or import a manuscript from <a href="#books">{{ copy.book.plural }}</a>. Recent generations appear here with replay / favorite / re-render actions.
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* No outer padding — `.jv-content` already pads `24px 32px 64px`.
   Double-padding pushed the hero ~48px below the topbar; this drops
   the duplicate so the hero sits close to the section title. */
.overview-view { padding: 0; }

/* Intro band — big centered "JustVoice." display title + tagline +
   4 use-case quick-action cards. This is the first thing a user sees
   on the dashboard, so the title gets the brand-period treatment
   (matches the topbar's `JustVoice.` pattern) and outsized type. */
.overview-view__intro {
  /* Negative top margin tightens against the `.jv-content` 24px
     top padding — pulls the JustVoice hero up close to the topbar
     without dropping the padding for other views. */
  margin: -12px 0 24px;
  text-align: center;
}
.overview-view__hero {
  margin: 0;
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.025em;
  line-height: 1;
  color: var(--ink);
}
.overview-view__tagline {
  margin: 8px auto 18px;
  max-width: var(--w-prose);
  color: var(--ink-2);
  font-size: 14px;
  line-height: 1.5;
}

.overview-view__quick-actions {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 10px;
  text-align: left;        /* cards stay left-aligned even though the band is centered */
  max-width: var(--shell-page);
  margin: 0 auto;
}

/* State-aware Next-step card — sits above quick-actions when there's
   a concrete "do this next" prompt. Uses brand accent to read as the
   primary CTA on the page. */
.overview-view__next-step {
  display: block;
  max-width: 560px;
  margin: 0 auto 18px;
  padding: 16px 20px;
  border-radius: 10px;
  background: var(--accent);
  color: #fff;
  text-decoration: none;
  text-align: left;
  box-shadow: var(--shadow-2);
  transition: transform 0.12s, box-shadow 0.12s;
}
.overview-view__next-step:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-3);
  text-decoration: none;
}
.overview-view__next-step-eyebrow {
  display: block;
  font-size: 10px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.85;
  font-weight: 600;
}
.overview-view__next-step-title {
  display: block;
  font-size: 18px;
  font-weight: 600;
  margin: 4px 0 6px;
  color: #fff;
}
.overview-view__next-step-body {
  margin: 0 0 10px;
  font-size: 13px;
  line-height: 1.5;
  opacity: 0.92;
}
.overview-view__next-step-cta {
  display: inline-block;
  font-size: 12px;
  font-weight: 600;
  padding: 4px 10px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 4px;
}
.overview-view__quick-action {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px 16px;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: var(--r-card);
  text-decoration: none;
  transition: border-color 0.12s, background 0.12s, transform 0.05s;
}
.overview-view__quick-action:hover {
  border-color: var(--line-strong);
  background: var(--surface-2);
  text-decoration: none;
}
.overview-view__quick-action:active { transform: translateY(1px); }
.overview-view__quick-action--active {
  border-color: var(--accent);
  background: var(--accent-soft);
}
.overview-view__quick-action--active:hover {
  border-color: var(--accent);
  background: var(--accent-soft);
}

.overview-view__quick-action-icon {
  font-size: 22px;
  line-height: 1;
  flex-shrink: 0;
}
.overview-view__quick-action-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.overview-view__quick-action-title {
  font-size: 13px;
  color: var(--ink);
  font-weight: 600;
  line-height: 1.3;
}
.overview-view__quick-action-desc {
  font-size: 11.5px;
  color: var(--ink-3);
  line-height: 1.4;
}

.overview-view__stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.overview-view__stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.overview-view__stat-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}

.overview-view__stat-value {
  font-size: 30px;            /* matches preview .stat .v */
  font-weight: 700;
  line-height: 1.05;
  color: var(--ink);
  letter-spacing: -0.02em;
}


.overview-view__unit {
  font-size: 16px;
  font-weight: 500;
  margin-left: 4px;
  color: var(--ink-2);
}

.overview-view__stat-sub {
  font-size: 12px;
}

.overview-view__loaded {
  display: flex;
  align-items: center;
  gap: 24px;
  flex-wrap: wrap;
}
.overview-view__loaded-cell { min-width: 0; }
.overview-view__loaded-k {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
  margin-bottom: 2px;
}
.overview-view__loaded-v {
  font-size: 16px;
  font-weight: 600;
  color: var(--ink);
}

.overview-view__task {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 4px 0;
}
.overview-view__task + .overview-view__task {
  border-top: 1px solid var(--line);
  padding-top: 12px;
  margin-top: 8px;
}
.overview-view__task-bar {
  width: 220px;
  height: 8px;
  background: var(--surface-3);
  border-radius: var(--r-pill);
  overflow: hidden;
}
.overview-view__task-fill {
  height: 100%;
  background: var(--accent);
  border-radius: var(--r-pill);
  transition: width 0.3s ease;
}

.overview-view__empty {
  margin: 0;
  padding: 6px 0;
  font-size: 13px;
}
.overview-view__empty a {
  color: var(--accent);
  text-decoration: underline;
}
</style>
