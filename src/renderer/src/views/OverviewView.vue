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
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { useOnboarding } from "../stores/onboarding.js";
import { useActiveProject } from "../stores/activeProject.js";
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
const engines = ref([]);
const voices = ref([]);
const personas = ref([]);
const projects = ref([]);
const lexicons = ref([]);
const captures = ref([]);
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

async function refresh() {
  const [h, e, v, p, pr, lx, ca, s, g, ce, sy, st] = await Promise.all([
    safeRequest("/v1/health", null),
    safeRequest("/v1/engines", { engines: [] }),
    safeRequest("/v1/voices", { voices: [] }),
    safeRequest("/v1/personas", { personas: [] }),
    safeRequest("/v1/projects", { projects: [] }),
    safeRequest("/v1/lexicons", { lexicons: [] }),
    safeRequest("/v1/captures?limit=1", { captures: [], total: null }),
    safeRequest("/v1/cache/stats", null),
    safeRequest("/v1/takes/recent?limit=4", { takes: [] }),
    safeRequest("/v1/engines/current", { engine: null }),
    safeRequest("/v1/system/info", null),
    safeRequest("/v1/settings", null),
  ]);
  health.value = h;
  engines.value = e.engines || [];
  voices.value = v.voices || [];
  personas.value = p.personas || [];
  projects.value = pr.projects || [];
  lexicons.value = lx.lexicons || [];
  captures.value = ca.captures || [];
  captures.totalCount = ca.total ?? (ca.captures?.length ?? null);
  stats.value = s;
  recentGenerations.value = g.takes || [];
  loadedEngine.value = ce.engine || null;
  system.value = sy;
  settings.value = st;
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
const captureCount = computed(() => captures.totalCount ?? captures.value.length ?? 0);

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

onMounted(refresh);
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

    <!-- Row 1 — Continue + Start something -->
    <div class="home__row home__row--top">
      <div v-if="continueProject" class="jv-card home__continue">
        <div class="home__portrait" :title="continueMeta.label">{{ (continueProject.name || "?").slice(0, 1).toUpperCase() }}</div>
        <div class="home__continue-main">
          <div class="home__eyebrow">Continue</div>
          <div class="home__display">{{ continueProject.name }}</div>
          <div class="jv-muted home__substat">{{ continueStatus }}</div>
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
</style>
