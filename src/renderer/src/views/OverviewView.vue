<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  Home — the daily driver (journeys-preview, Library journey step 1).
  "Everything the old Overview did well, reorganized: resume where you
  left off, catalogue at a glance, live tasks, loaded engine, recent
  generations."

  Layout contract, top to bottom:
    row 1 — Continue/Resume card (active project) · Start-something card
    row 2 — six stat cards (Projects/Voices/Personas/Lexicons/Cache/Captures)
    row 3 — Active tasks panel · Loaded engine card
    row 4 — Recent generations list
    footer — global hotkey banner

  The bootstrap arc (no engine yet / no project yet) keeps a single
  compact next-step banner above row 1; the mock assumes a warmed-up
  install, the real app has to drive a cold one to that state first.
-->
<script setup>
import { ref, onMounted, computed, watch } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useOnboarding } from "../stores/onboarding.js";
import { useActiveProject } from "../stores/activeProject.js";
import { useProjectsStore } from "../stores/projects.js";
import { usePersonasStore } from "../stores/personas.js";
import { useVoicesStore } from "../stores/voices.js";
import { useLexiconsStore } from "../stores/lexicons.js";
import { useEnginesStore } from "../stores/engines.js";
import { useAudioPlayer } from "../stores/audioPlayer.js";
import { pushToast } from "../services/toastBridge.js";
import JvButton from "../components/jv/JvButton.vue";
import RecommendCard from "../components/RecommendCard.vue";

const onboarding = useOnboarding();
const api = useApi();
const tasks = useRenderTasks();
const activeProject = useActiveProject();
const audioPlayer = useAudioPlayer();

const health = ref(null);
// The five shared lists come from stores (single source of truth);
// their own caching replaces the snapshot for these fields. The
// non-list dashboard data (captures/stats/recent/system/settings)
// keeps the snapshot for instant paint.
const projectsStore = useProjectsStore();
const personasStore = usePersonasStore();
const voicesStore = useVoicesStore();
const lexiconsStore = useLexiconsStore();
const enginesStore = useEnginesStore();
const engines = computed(() => enginesStore.items);
const voices = computed(() => voicesStore.items);
const personas = computed(() => personasStore.items);
const projects = computed(() => projectsStore.items);
const lexicons = computed(() => lexiconsStore.items);
const captures = ref([]);
// Total-count is its own ref (was bolted onto the captures ref object as a
// non-reactive `.totalCount`, which didn't update the stat from the snapshot).
const capturesTotal = ref(null);
const stats = ref(null);
const recentGenerations = ref([]);
const loadedEngine = ref(null);
const system = ref(null);
const settings = ref(null);

async function safeRequest(path, fallback) {
  // Silent fallback — when offline, the topbar Offline indicator + empty
  // cards already communicate the state.
  try {
    return await api.request(path);
  } catch {
    return fallback;
  }
}

// Session snapshot — Home paints instantly from the last visit's data
// and refreshes silently (same pattern as the Engines-list cache;
// user-hit: 'first looks like no project, then project info loads').
// health stays live-only so we never claim reachability from cache.
const HOME_CACHE_KEY = "jv.home.snapshot";
function hydrateFromSnapshot() {
  try {
    const snap = JSON.parse(window.sessionStorage?.getItem(HOME_CACHE_KEY) || "null");
    if (!snap) return;
    // The five lists now come from stores; only the non-list dashboard
    // fields are hydrated from the snapshot.
    capturesTotal.value = snap.capturesTotal ?? null;
    stats.value = snap.stats ?? null;
    recentGenerations.value = snap.recentGenerations || [];
    loadedEngine.value = snap.loadedEngine ?? null;
    system.value = snap.system ?? null;
    settings.value = snap.settings ?? null;
    if (snap.miniStatus && snap.miniStatusProjectId === continueProject.value?.id) {
      miniStatus.value = snap.miniStatus;
    }
  } catch { /* corrupt snapshot — fresh fetch covers it */ }
}
function writeSnapshot() {
  try {
    window.sessionStorage?.setItem(HOME_CACHE_KEY, JSON.stringify({
      capturesTotal: capturesTotal.value ?? null,
      stats: stats.value,
      recentGenerations: recentGenerations.value,
      loadedEngine: loadedEngine.value,
      system: system.value,
      settings: settings.value,
      miniStatus: miniStatus.value,
      miniStatusProjectId: continueProject.value?.id ?? null,
    }));
  } catch { /* storage full — next visit just fetches */ }
}

async function refresh() {
  // Five shared lists via stores; the rest are this view's own fetches.
  const [h, , , , , , ca, s, g, ce, sy, st] = await Promise.all([
    safeRequest("/v1/health", null),
    enginesStore.reload(),
    voicesStore.reload(),
    personasStore.reload(),
    projectsStore.reload(),
    lexiconsStore.reload(),
    safeRequest("/v1/captures?limit=1", { captures: [], total: null }),
    safeRequest("/v1/cache/stats", null),
    safeRequest("/v1/takes/recent?limit=4", { takes: [] }),
    safeRequest("/v1/engines/current", { engine: null }),
    safeRequest("/v1/system/info", null),
    safeRequest("/v1/settings", null),
  ]);
  health.value = h;
  captures.value = ca.captures || [];
  capturesTotal.value = ca.total ?? (ca.captures?.length ?? null);
  stats.value = s;
  recentGenerations.value = g.takes || [];
  loadedEngine.value = ce.engine || null;
  system.value = sy;
  settings.value = st;
  writeSnapshot();
}

// ── Continue card (active project) ───────────────────────────────────
const continueProject = computed(() => {
  if (activeProject.id) {
    const rec = projects.value.find((p) => p.id === activeProject.id);
    if (rec) return rec;
  }
  // Fall back to the most recently updated project so a fresh session
  // still gets a Resume affordance.
  return [...projects.value].sort(
    (a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0),
  )[0] || null;
});

const KIND_META = {
  audiobook:       { icon: "📖", label: "audiobook", unit: "chapters", home: "#chapter" },
  game_voicelines: { icon: "🎮", label: "game",      unit: "quests",   home: "#lines" },
  podcast:         { icon: "🎙️", label: "podcast",   unit: "episodes", home: "#chapter" },
  custom:          { icon: "📄", label: "text",      unit: "sections", home: "#chapter" },
};
const continueMeta = computed(() => KIND_META[continueProject.value?.project_type] || KIND_META.custom);

const continueStatus = computed(() => {
  const p = continueProject.value;
  if (!p) return "";
  const bits = [`${continueMeta.value.icon} ${continueMeta.value.label}`];
  if (p.scene_count != null) bits.push(`${p.scene_count} ${continueMeta.value.unit}`);
  const render = tasks.running.find((t) => t.status === "running");
  if (render) bits.push(render.label);
  if (p.updated_at) bits.push(`last open ${fmtAgo(p.updated_at)}`);
  return bits.join(" · ");
});

// Mini workflow status for the Continue card — one cache-stats call +
// one cast call for the single continue project (cheap; no per-scene
// block walks on Home).
const miniStatus = ref(null);  // { rendered, total, castTotal, castVoiced }
async function loadMiniStatus() {
  miniStatus.value = null;
  const p = continueProject.value;
  if (!p) return;
  const out = { rendered: 0, total: 0, castTotal: 0, castVoiced: 0 };
  try {
    const cs = await api.request(`/v1/render/cache-stats?project_id=${p.id}`);
    out.total = (cs?.scenes || []).length;
    out.rendered = (cs?.scenes || []).filter((sc) => sc.total > 0 && sc.cached === sc.total).length;
  } catch { /* zero-chapter projects 404 here — strip shows import-first */ }
  try {
    const c = await api.request(`/v1/projects/${p.id}/cast`);
    const cast = c?.cast || [];
    out.castTotal = cast.length;
    // Voiced state comes from the personas list refresh() already
    // fetched — the old per-persona GET fan-out (≤16 requests) was the
    // slow part of the Home fill.
    const byId = new Map(personas.value.map((x) => [x.id, x]));
    out.castVoiced = cast.filter((x) => byId.get(x.persona_id)?.voice_id).length;
  } catch { /* no cast yet */ }
  miniStatus.value = out;
  writeSnapshot();
}
watch(continueProject, loadMiniStatus);

const miniSteps = computed(() => {
  const m = miniStatus.value;
  const p = continueProject.value;
  if (!m || !p) return [];
  const n = p.scene_count ?? m.total;
  return [
    { label: `1 Import`, sub: n ? `${n} ${continueMeta.value.unit}` : "no text yet", done: n > 0 },
    { label: `2 Cast`, sub: m.castTotal ? `${m.castVoiced}/${m.castTotal} voiced` : "—", done: m.castTotal > 0 && m.castVoiced === m.castTotal },
    { label: `3 Render`, sub: n ? `${m.rendered}/${n} rendered` : "—", done: n > 0 && m.rendered === n },
  ];
});

function resumeProject() {
  const p = continueProject.value;
  if (!p) return;
  activeProject.open(p);
  window.location.hash = continueMeta.value.home;
}

// ── Start something (kind pills → Projects create flow) ──────────────
const KIND_PILLS = [
  { kind: "audiobook",       label: "📖 Audiobook" },
  { kind: "game_voicelines", label: "🎮 Game" },
  { kind: "podcast",         label: "🎙️ Podcast" },
  { kind: "custom",          label: "📄 Text" },
];
function startKind(kind) {
  // Projects view consumes this on mount and opens the create flow with
  // the kind preselected (journeys kind-picker step).
  try { window.sessionStorage?.setItem("jv.books.createKind", kind || ""); } catch { /* ignore */ }
  window.location.hash = "#books";
}

// ── Stat cards ────────────────────────────────────────────────────────
const projectKindCount = computed(() => {
  const kinds = new Set(projects.value.map((p) => p.project_type || "custom"));
  return kinds.size;
});
const lexiconEntries = computed(() =>
  lexicons.value.reduce((s, lx) => s + (lx.entry_count ?? 0), 0),
);
const cacheGB = computed(() => {
  if (!stats.value?.total_bytes_on_disk) return null;
  return (stats.value.total_bytes_on_disk / 1024 / 1024 / 1024).toFixed(1);
});
const cacheSub = computed(() => {
  if (!stats.value) return "—";
  const bits = [];
  if (stats.value.entry_count != null) bits.push(`${stats.value.entry_count} takes`);
  if (stats.value.hits && stats.value.requests) {
    bits.push(`${Math.round((stats.value.hits / stats.value.requests) * 100)}% hit`);
  }
  return bits.join(" · ") || "—";
});
const captureCount = computed(() => capturesTotal.value ?? captures.value.length ?? 0);

const statCards = computed(() => [
  { label: "Projects", value: projects.value.length, sub: projectKindCount.value ? `${projectKindCount.value} kind${projectKindCount.value === 1 ? "" : "s"}` : "create one to start", href: "#books" },
  { label: "Voices", value: voices.value.length, sub: `across ${new Set(voices.value.map((v) => v.engine || "?")).size} engines`, href: "#voices" },
  { label: "Personas", value: personas.value.length, sub: "cross-project characters", href: "#personas" },
  { label: "Lexicons", value: lexicons.value.length, sub: `${lexiconEntries.value} entries`, href: "#lexicons" },
  { label: "Cache", value: cacheGB.value ? `${cacheGB.value} GB` : "0", sub: cacheSub.value, href: "#cache" },
  { label: "Captures", value: captureCount.value, sub: "dictation + TTS history", href: "#captures" },
]);

// ── Active tasks ──────────────────────────────────────────────────────
const liveTasks = computed(() => tasks.running.filter((t) => t.status === "running"));
function taskKind(t) {
  const l = (t.label || "").toLowerCase();
  if (l.includes("render")) return "render";
  if (l.includes("extract") || l.includes("script") || l.includes("analy")) return "extract";
  if (l.includes("clone") || l.includes("train")) return "train";
  return "task";
}
function cancelTask(t) {
  try { t.onCancel?.(); } catch { /* task may have just finished */ }
  tasks.cancel?.(t.id);
}

// ── Loaded engine card ────────────────────────────────────────────────
const gpu = computed(() => system.value?.gpus?.[0] || null);
const deviceLabel = computed(() => gpu.value ? `CUDA · ${gpu.value.name}` : (system.value ? "CPU" : ""));
const externalCount = computed(() => (settings.value?.engines?.external || []).length);
const unloading = ref(false);
async function unloadEngine() {
  unloading.value = true;
  try {
    await api.request("/v1/engines/unload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "tts" }),
    });
    window.dispatchEvent(new Event("jv:health-refresh"));
    await refresh();
    pushToast({ message: "Engine unloaded.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Unload failed: ${e?.message || e}`, kind: "error" });
  } finally {
    unloading.value = false;
  }
}

// ── Recent generations ────────────────────────────────────────────────
function playGen(g) {
  if (!g?.audio_url) return;
  audioPlayer.play({
    url: `${api.serverUrl}${g.audio_url}`,
    title: g.voice || "Take",
    subtitle: (g.text || "").slice(0, 80),
  });
}
function genDownloadUrl(g) {
  return g?.audio_url ? `${api.serverUrl}${g.audio_url}` : "#";
}
function fmtAgo(iso) {
  if (!iso) return "—";
  const ago = Date.now() - new Date(iso).getTime();
  if (ago < 60_000) return "just now";
  if (ago < 3_600_000) return Math.floor(ago / 60_000) + " min";
  if (ago < 86_400_000) return Math.floor(ago / 3_600_000) + " h";
  return Math.floor(ago / 86_400_000) + " d";
}

// ── Hotkey banner ─────────────────────────────────────────────────────
const hotkeyEnabled = computed(() => !!settings.value?.captures?.hotkey_enabled);
function chordLabel(keys) {
  return (keys || []).map((k) => k.replace(/Right|Left/, "")).join("+") || "—";
}
const speakChord = computed(() => chordLabel(settings.value?.captures?.chord_toggle_to_talk_keys));
const dictateChord = computed(() => chordLabel(settings.value?.captures?.chord_push_to_talk_keys));

// ── Bootstrap banner (cold install — mock assumes a warmed-up state) ──
const nextStep = computed(() => {
  if (health.value && !loadedEngine.value && !health.value.current_engine) {
    return { title: "Load your first engine", body: "Kokoro runs on CPU in realtime — a good first pick.", href: "#engines", cta: "Open Engines" };
  }
  if (health.value && !projects.value.length) {
    return { title: "Create your first project", body: "Pick what you're making — the whole app reshapes around it.", href: "#books", cta: "Open Projects" };
  }
  return null;
});

function goEngines() { window.location.hash = "#engines"; }

onMounted(() => {
  hydrateFromSnapshot();  // instant paint from the last visit
  refresh();              // silent live replace
});
</script>

<template>
  <div class="home">
    <!-- Bootstrap arc — one compact banner, gone once warmed up. -->
    <a v-if="nextStep" class="jv-banner jv-banner--info home__next" :href="nextStep.href">
      <strong>{{ nextStep.title }}</strong>
      <span class="jv-muted">{{ nextStep.body }}</span>
      <span class="jv-spacer" />
      <span class="home__next-cta">{{ nextStep.cta }} ➜</span>
    </a>

    <RecommendCard />

    <!-- Zero projects — the welcome hero IS row 1 (no modal ambush;
         the auto-picker only fires on true first run). -->
    <div v-if="health && !projects.length" class="jv-card home__hero">
      <div class="home__eyebrow">Welcome to JustVoice</div>
      <h2 class="home__hero-title">What are you making?</h2>
      <p class="jv-muted home__hero-sub">Pick a kind — the whole app reshapes around it. Same voices, personas, and lexicons either way.</p>
      <div class="home__hero-pills">
        <button v-for="k in KIND_PILLS" :key="k.kind" type="button" class="jv-pill home__pill home__pill--hero"
          :title="`Create a ${k.kind === 'game_voicelines' ? 'game dialogue' : k.kind} project`"
          @click="startKind(k.kind)">{{ k.label }}</button>
      </div>
      <p class="jv-muted home__hero-foot">
        …or <a href="#books">import a manuscript / CSV</a> · not making projects?
        <a href="#captures">set up dictation</a>
      </p>
    </div>

    <!-- Row 1 — Continue + Start something -->
    <div v-if="projects.length" class="home__row home__row--top">
      <div v-if="continueProject" class="jv-card home__continue">
        <div class="home__portrait" :title="continueMeta.label">{{ (continueProject.name || "?").slice(0, 1).toUpperCase() }}</div>
        <div class="home__continue-main">
          <div class="home__eyebrow">Continue</div>
          <div class="home__display">{{ continueProject.name }}</div>
          <div class="jv-muted home__substat">{{ continueStatus }}</div>
          <div v-if="miniSteps.length" class="home__mini">
            <span v-for="st in miniSteps" :key="st.label" class="home__mini-step" :class="{ 'home__mini-step--done': st.done }" :title="st.sub">
              {{ st.done ? "✓" : "" }} {{ st.label }} <i>{{ st.sub }}</i>
            </span>
          </div>
        </div>
        <JvButton variant="primary" label="Resume ➜" title="Open this project's home base" @click="resumeProject" />
      </div>
      <div class="jv-card home__start">
        <div class="home__eyebrow" style="margin-bottom:8px">Start something</div>
        <div class="home__pills">
          <button v-for="k in KIND_PILLS" :key="k.kind" type="button" class="jv-pill home__pill"
            :title="`New ${k.kind === 'game_voicelines' ? 'game dialogue' : k.kind} project`"
            @click="startKind(k.kind)">{{ k.label }}</button>
        </div>
        <JvButton variant="secondary" size="sm" label="＋ New project" style="margin-top:10px" @click="startKind('')" />
      </div>
    </div>

    <!-- Row 2 — six stat cards -->
    <div class="home__stats">
      <a v-for="c in statCards" :key="c.label" class="jv-card home__stat" :href="c.href" :title="`Open ${c.label}`">
        <div class="home__eyebrow">{{ c.label }}</div>
        <div class="home__display home__display--num">{{ c.value }}</div>
        <div class="jv-muted home__substat">{{ c.sub }}</div>
      </a>
    </div>

    <!-- Row 3 — Active tasks + Loaded engine -->
    <div class="home__row">
      <div class="jv-card home__tasks">
        <div class="home__cardhead">
          <span class="home__eyebrow">Active tasks</span>
          <span v-if="liveTasks.length" class="jv-pill jv-pill--warn">{{ liveTasks.length }} in flight</span>
          <span class="jv-spacer" />
          <button type="button" class="jv-btn jv-btn--ghost jv-btn--sm" data-task-panel-toggle @click="tasks.togglePanel()">open panel ➜</button>
        </div>
        <p v-if="!liveTasks.length" class="jv-muted home__empty">Nothing running. Renders, script analysis, and clones show up here with live progress.</p>
        <div v-for="t in liveTasks" :key="t.id" class="home__task">
          <span class="jv-pill home__task-kind" :class="`home__task-kind--${taskKind(t)}`">{{ taskKind(t) }}</span>
          <strong class="home__task-label">{{ t.label }}</strong>
          <span class="jv-muted home__task-stats">{{ t.statsFn ? t.statsFn(t) : "" }}</span>
          <div class="home__prog"><div class="home__prog-fill" :style="{ width: (t.percent ?? 30) + '%' }" /></div>
          <button v-if="t.onCancel" type="button" class="jv-btn jv-btn--ghost jv-btn--sm home__task-x" title="Cancel" @click="cancelTask(t)">✕</button>
        </div>
      </div>

      <div class="jv-card home__engine">
        <div class="home__cardhead">
          <span class="home__eyebrow">Loaded engine</span>
          <span class="jv-pill" :class="health?.current_engine ? 'jv-pill--green' : ''">{{ health?.current_engine ? "ready" : "none" }}</span>
        </div>
        <template v-if="health?.current_engine">
          <div class="home__engine-line">
            <strong>{{ health.current_engine }}</strong>
            <span class="jv-muted">{{ deviceLabel }}</span>
            <span class="jv-spacer" />
            <span v-if="gpu?.vram_mb" class="jv-mono jv-muted home__vram">VRAM {{ (gpu.vram_used_mb / 1024).toFixed(1) }} / {{ (gpu.vram_mb / 1024).toFixed(0) }} GB</span>
          </div>
          <div v-if="gpu?.vram_mb" class="home__prog home__prog--vram"><div class="home__prog-fill" :style="{ width: Math.round(((gpu.vram_used_mb || 0) / gpu.vram_mb) * 100) + '%' }" /></div>
        </template>
        <p v-else class="jv-muted home__empty">No TTS engine in memory. Loading happens on first use, or pick one now.</p>
        <div class="home__engine-foot">
          <span class="jv-muted home__substat" style="flex:1">
            {{ externalCount ? `● ${externalCount} external provider${externalCount === 1 ? "" : "s"} registered` : "no external providers" }}
          </span>
          <JvButton v-if="health?.current_engine" variant="ghost" size="sm" label="Unload" :loading="unloading" title="Free the model's memory — next render reloads it" @click="unloadEngine" />
          <JvButton variant="secondary" size="sm" label="Switch ▾" title="Open Engines to load a different model" @click="goEngines" />
        </div>
      </div>
    </div>

    <!-- Row 4 — Recent generations -->
    <div class="jv-card home__recent">
      <div class="home__cardhead">
        <span class="home__eyebrow">Recent generations</span>
        <span class="jv-spacer" />
        <a class="jv-btn jv-btn--ghost jv-btn--sm" href="#generate" title="Full history lives on Generate">all history ➜</a>
      </div>
      <p v-if="!recentGenerations.length" class="jv-muted home__empty">Render something — your latest takes land here for one-click replay.</p>
      <div v-for="g in recentGenerations" :key="g.id" class="home__gen">
        <button type="button" class="jv-btn jv-btn--ghost jv-btn--sm" title="Play" @click="playGen(g)">▶</button>
        <span class="home__gen-text">{{ g.text || "—" }}</span>
        <span class="jv-muted home__gen-who">{{ g.voice || "?" }}</span>
        <span class="jv-mono jv-muted home__gen-meta">{{ g.take ? g.take + " · " : "" }}{{ fmtAgo(g.when) }}</span>
        <a class="jv-btn jv-btn--ghost jv-btn--sm" :href="genDownloadUrl(g)" download title="Download WAV">⬇</a>
      </div>
    </div>

    <!-- Hotkey banner -->
    <div class="jv-banner jv-banner--info home__hotkeys" v-if="hotkeyEnabled">
      Press <span class="jv-mono">{{ speakChord }}</span> anywhere to speak · hold <span class="jv-mono">{{ dictateChord }}</span> to dictate — no project needed.
    </div>
    <div class="jv-banner home__hotkeys" v-else>
      Global speak/dictate hotkeys are off — flip them on in <a href="#captures">Captures</a> to talk from anywhere in the OS.
    </div>
  </div>
</template>

<style scoped>
.home { display: flex; flex-direction: column; gap: 12px; }
.home__row { display: flex; gap: 10px; align-items: stretch; }
.home__row > .jv-card { margin: 0; }
.home__row--top .home__continue { flex: 2; display: flex; align-items: center; gap: 14px; padding: 14px 18px; }
.home__row--top .home__start { flex: 1; padding: 14px 18px; }
.home__portrait {
  width: 52px; height: 52px; border-radius: 50%;
  background: var(--accent); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 18px; font-weight: 700; flex: none;
}
.home__continue-main { min-width: 0; flex: 1; }
.home__eyebrow {
  font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
  text-transform: uppercase; color: var(--ink-3);
}
.home__display { font-size: 19px; font-weight: 700; color: var(--ink); }
.home__display--num { font-size: 21px; margin: 2px 0; }
.home__substat { font-size: 11.5px; }
.home__pills { display: flex; gap: 6px; flex-wrap: wrap; }
.home__pill { cursor: pointer; }
.home__pill:hover { border-color: var(--accent); color: var(--accent-ink); }
.home__stats { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; }
.home__stat { padding: 11px 14px; cursor: pointer; text-decoration: none; color: inherit; margin: 0; }
.home__stat:hover { border-color: var(--accent-line); }
.home__tasks { flex: 1.4; padding: 12px 16px; }
.home__engine { flex: 1; padding: 12px 16px; }
.home__cardhead { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.home__empty { font-size: 12px; margin: 4px 0; }
.home__task { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 4px 0; }
.home__task-kind { text-transform: uppercase; font-size: 9.5px; }
.home__task-kind--render { background: var(--accent); color: #fff; border-color: var(--accent); }
.home__task-kind--extract { background: #eaf0f8; color: #3a5a8c; border-color: #c8d4e8; }
.home__task-label { flex: none; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home__task-stats { font-size: 11px; flex: none; }
.home__prog { flex: 1; height: 6px; border-radius: 3px; background: var(--surface-3); overflow: hidden; }
.home__prog--vram { margin: 8px 0; }
.home__prog-fill { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width .4s; }
.home__task-x { color: var(--danger); }
.home__engine-line { display: flex; align-items: center; gap: 8px; font-size: 12.5px; }
.home__vram { font-size: 11px; }
.home__engine-foot { display: flex; align-items: center; gap: 8px; margin-top: 8px; }
.home__recent { padding: 12px 16px; margin: 0; }
.home__gen { display: flex; align-items: center; gap: 8px; font-size: 12px; padding: 6px 0; border-bottom: 1px dashed var(--line); }
.home__gen:last-child { border-bottom: 0; }
.home__gen-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.home__gen-who { flex: none; font-size: 11px; }
.home__gen-meta { flex: none; font-size: 10.5px; }
.home__next { display: flex; gap: 10px; align-items: center; text-decoration: none; }
.home__next-cta { color: var(--accent-ink); font-weight: 600; }
.home__hotkeys { font-size: 11.5px; }
.home__hotkeys .jv-mono { font-size: 10.5px; background: var(--surface-3); padding: 1px 6px; border-radius: 4px; }

.home__hero { padding: 26px 30px; margin: 0; text-align: left; }
.home__hero-title { font-size: 24px; margin: 6px 0 4px; }
.home__hero-sub { font-size: 13px; max-width: 560px; }
.home__hero-pills { display: flex; gap: 10px; margin: 16px 0 12px; flex-wrap: wrap; }
.home__pill--hero { font-size: 14px; padding: 10px 20px; }
.home__hero-foot { font-size: 12px; }
.home__mini { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
.home__mini-step {
  font-size: 10.5px; font-weight: 700; color: var(--ink-3);
  border: 1px solid var(--line); border-radius: 999px;
  padding: 2px 9px; background: var(--surface);
}
.home__mini-step i { font-style: normal; font-weight: 500; color: var(--ink-3); }
.home__mini-step--done { border-color: var(--accent-line); background: var(--accent-soft); color: var(--accent-ink); }
.home__mini-step--done i { color: var(--accent-ink); }
</style>
