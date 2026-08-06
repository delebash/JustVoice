<!-- SPDX-License-Identifier: MIT -->
<!--
  Speech engines — JV's ONE speech surface inside the AI console (user QC
  ruling 2026-08-06: five tabs — LLM providers · Speech engines · Routing by
  feature · Usage · AI engine console; the separate TTS-providers and
  LLM-models tabs made no sense). The normal Local/Online pair, mirroring the
  LLM providers tab one tab over:

  - LOCAL · free — the managed-engine catalog (TTS + STT) with the LLM-runner
    interaction grammar, plus the self-hosted servers you run
    (SpeechProvidersPanel scope="selfhosted" — full add/edit/test verbs):
    · install / download / load run through the kit's createDownloadTask over
      ttsJobChannel (POST → job_id → GET /v1/jobs/{id} → DELETE is exactly
      the channel contract); the kit DownloadBar renders every operation.
    · "Set as default" is a ROW ACTION on engines (settings.engines.
      default_tts_engine — one source) and on models (engine_overrides[id].
      default_variant, the user layer the manager resolves).
  - ONLINE · metered — the cloud speech APIs (SpeechProvidersPanel
    scope="cloud" — ElevenLabs, OpenAI TTS, …).

  The LLM and Embeddings sections died here in the parity batch: language
  models live on the LLM providers tab of this same console. Kept from the
  old Engines page, deliberately: the hardware card, the loaded-now rail,
  search + kind chips, fit dots, the weights-licence attribution row (a
  licence OBLIGATION — see the inline note), per-variant delete, venv
  uninstall, and the folder-tab pair itself (Engines' approved mock v7).
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { DownloadBar, UiButton, UiTag, confirmDialog, promptDialog, pushToast } from "@delebash/llm-ui";
import { makeEngineDownloadTask } from "../services/ttsJobChannel.js";
import { createDownloadTask } from "@delebash/llm-ui";
import SpeechProvidersPanel from "./SpeechProvidersPanel.vue";

// The Local/Online half switch (the folder-tab pair).
const half = ref("local");

const api = useApi();
const tasks = useRenderTasks();

// Seed from the last fetch so revisiting doesn't flash the "no engines"
// banner before the list arrives (user-hit 2026-06-12).
const ENGINES_CACHE_KEY = "jv.engines.lastList";
function _cachedEngines() {
  try { return JSON.parse(window.sessionStorage?.getItem(ENGINES_CACHE_KEY) || "[]"); }
  catch { return []; }
}
const engines = ref(_cachedEngines());
const enginesLoaded = ref(engines.value.length > 0);
const system = ref(null);

// Per-engine model variants:
//   {[engineId]: {variants: [{id, name, size_mb, vram_mb, ...}], recommended: {...}}}
const variants = reactive({});

// ── Download/load tasks (kit machinery) ───────────────────────────────
// One reactive task per in-flight operation, keyed engineId (engine-wide
// install) or engineId/variantId (per-variant download/load). DownloadBar
// renders whatever is here; terminal bars stay until dismissed.
const dlTasks = reactive({});
const _engineKey = (engineId) => engineId;
const _variantKey = (engineId, variantId) => `${engineId}/${variantId}`;
function taskRowsFor(engineId) {
  const rows = [];
  if (dlTasks[engineId]) rows.push({ key: engineId, variantId: null, task: dlTasks[engineId] });
  const prefix = `${engineId}/`;
  for (const k of Object.keys(dlTasks)) {
    if (k.startsWith(prefix)) rows.push({ key: k, variantId: k.slice(prefix.length), task: dlTasks[k] });
  }
  return rows;
}
function anyTaskRunning(engineId) {
  return taskRowsFor(engineId).some((r) => r.task.state === "running");
}
function busyAnywhere(engineId, variantId) {
  return (dlTasks[_engineKey(engineId)]?.state === "running")
    || (variantId && dlTasks[_variantKey(engineId, variantId)]?.state === "running");
}
function clearTerminalTask(key) {
  const t = dlTasks[key];
  if (t && t.state !== "running") delete dlTasks[key];
}

// ── Default engine (settings.engines.default_tts_engine — the ONE source;
// the old Settings → Generation dropdown died for this row action). ─────
const defaultEngineId = ref("");
async function loadDefaults() {
  const s = await api.safeRequest("/v1/settings", null);
  defaultEngineId.value = s?.engines?.default_tts_engine || "";
}
async function setDefaultEngine(engine) {
  try {
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engines: { default_tts_engine: engine.id } }),
    });
    defaultEngineId.value = engine.id;
    pushToast({ message: `${engine.name || engine.id} is now the default speech engine.`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Couldn't set the default: ${e?.message || e}`, kind: "error" });
  }
}

// Set-as-default MODEL (variant): the user layer over the manifest's default
// (engine_overrides[id].default_variant; the manager resolves it, so a
// no-variant load actually loads this). Read-modify-write the overrides map —
// a bare PATCH could clobber sibling overrides.
async function setDefaultVariant(engine, variantId) {
  try {
    const s = await api.request("/v1/settings");
    const overrides = { ...(s?.engines?.engine_overrides || {}) };
    overrides[engine.id] = { ...(overrides[engine.id] || {}), default_variant: variantId };
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engines: { engine_overrides: overrides } }),
    });
    pushToast({ message: `${variantNameFor(engine.id, variantId)} is now ${engine.name || engine.id}'s default model.`, kind: "success" });
    delete variants[engine.id];
    await refresh(); // the list serves the RESOLVED default — re-read the badge truth
  } catch (e) {
    pushToast({ message: `Couldn't set the default: ${e?.message || e}`, kind: "error" });
  }
}

const RUNTIME_LABELS = {
  cuda: "CUDA", metal: "Metal", coreml: "CoreML", directml: "DirectML",
  rocm: "ROCm", mlx: "MLX", vulkan: "Vulkan", cpu: "CPU",
};
const activeRuntimes = computed(() => {
  const r = system.value?.runtimes || {};
  return Object.keys(RUNTIME_LABELS).filter((k) => r[k]).map((k) => RUNTIME_LABELS[k]);
});

function fmtDisk(mb) {
  if (mb == null) return "—";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

async function refresh() {
  const e = await api.safeRequest("/v1/engines", { engines: [] });
  // Speech only: the LLM/Embeddings sections died here (they live on the LLM
  // tabs of this console).
  engines.value = (e?.engines ?? []).filter((x) => ["tts", "stt"].includes(x.kind || "tts"));
  enginesLoaded.value = true;
  try { window.sessionStorage?.setItem(ENGINES_CACHE_KEY, JSON.stringify(engines.value)); } catch { /* ignore */ }
  await Promise.all(
    engines.value.map(async (eng) => {
      if (variants[eng.id]) return;
      try {
        const [models, recommended] = await Promise.all([
          api.request(`/v1/engines/${eng.id}/models`).catch(() => ({ variants: [] })),
          api.request(`/v1/engines/${eng.id}/models/recommended`).catch(() => ({})),
        ]);
        variants[eng.id] = { variants: models.variants || [], recommended };
      } catch { /* tolerated */ }
    }),
  );
}

async function loadSystem() {
  system.value = await api.safeRequest("/v1/system/info", null);
}

function variantsFor(engineId) {
  return variants[engineId]?.variants || [];
}
function variantNameFor(engineId, variantId) {
  const v = variantsFor(engineId).find((x) => x.id === variantId);
  return v?.name || variantId || engineId;
}
function isLoadedVariant(engine, variantId) {
  return engine.status === "loaded" && engine.current_variant_id === variantId;
}
function isOnDisk(engine, variantId) {
  const rec = variants[engine.id]?.recommended;
  if (rec?.downloaded_variant_ids?.includes(variantId)) return true;
  if (engine.status === "installed" || engine.status === "loaded") return true;
  return false;
}
function modelLoaded(e, v) { return isLoadedVariant(e, v.id); }
function modelOnDisk(e, v) { return v.on_disk === true || (v.on_disk == null && isOnDisk(e, v.id)); }
function engineNeedsInstall(e) { return e.isolation === "venv" && e.status === "not_installed"; }

// ── Install (engine venv) — kit task over the job channel. ────────────
async function installEngine(engine) {
  const key = _engineKey(engine.id);
  clearTerminalTask(key);
  const task = makeEngineDownloadTask(api, engine.id, {});
  dlTasks[key] = task;
  const panel = tasks.start({
    label: `Installing · ${engine.name || engine.id}`,
    kind: "install",
    onCancel: () => task.cancel(),
  });
  await task.start();
  if (task.state === "done") {
    tasks.finish(panel.id);
    pushToast({ message: `${engine.name || engine.id} installed.`, kind: "success", duration: 4000 });
    delete variants[engine.id];
    await refresh();
  } else if (task.state === "error") {
    tasks.fail(panel.id, task.error);
  } else {
    tasks.finish(panel.id);
  }
}

// ── Load (download-if-needed, then load) — ONE task, two phases. ──────
async function runLoad(engine, variantId) {
  const key = _variantKey(engine.id, variantId);
  clearTerminalTask(key);

  const needsDownload = !modelOnDisk(engine, variantsFor(engine.id).find((x) => x.id === variantId) || { id: variantId });
  const task = needsDownload
    ? makeEngineDownloadTask(api, engine.id, { model_variant: variantId })
    : createDownloadTask({
        start: async () => {},
        statusUrl: "",
        fetch: async () => ({}),
        read: () => ({ detail: "loading" }),
        cancel: () => api.request(`/v1/engines/${engine.id}/cancel-load`, { method: "POST" }),
      });
  dlTasks[key] = task;
  const panel = tasks.start({
    label: `Loading · ${engine.name || engine.id} (${variantNameFor(engine.id, variantId)})`,
    kind: "load",
    onCancel: () => task.cancel(),
    onRetry: () => runLoad(engine, variantId),
  });

  try {
    if (needsDownload) {
      await task.start();               // phase A — the download, kit-polled
      if (task.state !== "done") {      // cancelled or failed → stop honestly
        if (task.state === "error") tasks.fail(panel.id, task.error);
        else tasks.finish(panel.id);
        return;
      }
      delete variants[engine.id];       // on_disk changed — re-read truthfully
      task.arm("Loading model");        // phase B under the same bar
    } else {
      task.arm("Loading model");
    }
    await api.request(`/v1/engines/${engine.id}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "auto", model_variant: variantId || null }),
    });
    task.apply({ terminal: "done" });
    tasks.finish(panel.id);
    window.dispatchEvent(new Event("jv:health-refresh"));
    delete variants[engine.id];
    await refresh();
    pushToast({ message: `${engine.name || engine.id} loaded.`, kind: "success", duration: 4500 });
    delete dlTasks[key];
  } catch (e) {
    if (task.state === "cancelled") { tasks.finish(panel.id); return; }
    const raw = String(e?.message || e);
    task.fail(raw);
    tasks.fail(panel.id, raw);
  }
}

function loadButtonLabel(engine, v) {
  if (modelOnDisk(engine, v)) return "Load model";
  return `⬇ Load (${fmtDisk(v.size_mb)})`;
}

async function unload(engine) {
  try {
    const resp = await api.request("/v1/engines/unload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: engine.kind || "tts" }),
    });
    await refresh();
    pushToast({
      message: resp?.previous_engine ? `${resp.previous_engine} unloaded.` : "Nothing was loaded.",
      kind: resp?.previous_engine ? "success" : "info",
      duration: 3500,
    });
  } catch (e) {
    pushToast({ message: `Unload failed: ${e.message || e}`, kind: "error" });
  }
}

async function uninstall(engine) {
  const hasPipPackages = Array.isArray(engine.pip_packages) && engine.pip_packages.length > 0;
  let uninstallDeps = false;
  if (hasPipPackages) {
    const choice = await promptDialog({
      title: `Uninstall ${engine.id}?`,
      message: "Model files will be removed from disk. You can also remove the Python packages this engine pulled in.",
      fields: [{
        key: "scope", label: "What to remove", type: "select", defaultValue: "files-only",
        options: [
          { value: "files-only", label: "Model files only" },
          { value: "files-and-deps", label: `Model files + Python packages (${engine.pip_packages.join(", ")})` },
        ],
      }],
      confirmLabel: "Uninstall", cancelLabel: "Cancel", danger: true,
    });
    if (!choice) return;
    uninstallDeps = choice.scope === "files-and-deps";
  } else {
    const ok = await confirmDialog({
      title: `Uninstall ${engine.id}?`,
      message: "Model files will be removed from disk.",
      danger: true, confirmLabel: "Uninstall",
    });
    if (!ok) return;
  }
  try {
    let path = `/v1/engines/${encodeURIComponent(engine.id)}`;
    if (uninstallDeps) path += "?uninstall_deps=true";
    await api.request(path, { method: "DELETE" });
    delete variants[engine.id];
    await refresh();
    pushToast({ message: `${engine.name || engine.id} uninstalled.`, kind: "success", duration: 4000 });
  } catch (e) {
    pushToast({ message: `Uninstall failed: ${e.message || e}`, kind: "error" });
  }
}

async function deleteModel(e, v) {
  const ok = await confirmDialog({
    title: `Delete ${v.name}?`,
    message: `Removes the downloaded weights (${fmtDisk(v.size_mb)}) from disk. The engine stays; you can download again anytime.`,
    danger: true, confirmLabel: "Delete model",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/engines/${e.id}/models/${encodeURIComponent(v.id)}`, { method: "DELETE" });
    pushToast({ message: `${v.name} deleted.`, kind: "success" });
    delete variants[e.id];
    await refresh();
  } catch (err) {
    pushToast({ message: `Delete failed: ${err.message || err}`, kind: "error" });
  }
}

// ── Search + kind chips + sections (speech kinds only). ──────────────
const q = ref("");
const capLocal = ref("all");
const expanded = reactive({});
const SECTIONS = [
  { id: "tts", title: "Voice generation", suffix: "TTS",
    note: "one model loaded at a time — loading another swaps the TTS slot" },
  { id: "stt", title: "Transcription", suffix: "STT",
    note: "powers dictation, /v1/transcribe, and agent transcription" },
];
function engineCaps(e) { return e.kinds?.length ? e.kinds : [e.kind || "tts"]; }
function searchBlob(e) {
  const vs = variantsFor(e.id).map((v) => `${v.name} ${v.description || ""}`).join(" ");
  return `${e.name} ${e.id} ${e.description || ""} ${vs}`.toLowerCase();
}
function engineVisible(e, sectionId) {
  if (engineCaps(e)[0] !== sectionId) return false;
  if (capLocal.value !== "all" && !engineCaps(e).includes(capLocal.value)) return false;
  if (q.value.trim() && !searchBlob(e).includes(q.value.trim().toLowerCase())) return false;
  return true;
}
const sectionData = computed(() =>
  SECTIONS.map((s) => {
    const list = engines.value.filter((e) => engineVisible(e, s.id));
    const rank = { loaded: 0, installed: 1, not_installed: 2 };
    list.sort((a, b) => (rank[a.status] ?? 3) - (rank[b.status] ?? 3));
    const all = engines.value.filter((e) => engineCaps(e)[0] === s.id);
    const modelCount = all.reduce((n, e) => n + variantsFor(e.id).length, 0);
    return { ...s, engines: list, engineCount: all.length, modelCount };
  }).filter((s) => s.engineCount > 0),
);
function isOpen(e) {
  if (expanded[e.id] !== undefined) return expanded[e.id];
  if (q.value.trim()) return true;
  return e.status === "loaded" || anyTaskRunning(e.id);
}
function toggleOpen(e) { expanded[e.id] = !isOpen(e); }
function groupSummary(e) {
  const vs = variantsFor(e.id);
  const onDisk = vs.filter((v) => v.on_disk === true).length;
  const parts = [`${vs.length} model${vs.length === 1 ? "" : "s"}`];
  if (vs.some((v) => v.on_disk !== null)) parts.push(onDisk ? `${onDisk} on disk` : "none on disk");
  return parts.join(" · ");
}
function loadedVariantName(e) {
  if (e.status !== "loaded") return null;
  const v = variantsFor(e.id).find((x) => x.id === e.current_variant_id);
  return v ? v.name : (e.current_variant_id || e.name);
}

// fits-your-hardware dot — needs a detected GPU VRAM figure; hidden otherwise.
const gpuVramMb = computed(() => {
  const g = (system.value?.gpus || [])[0];
  return g?.vram_mb || null;
});
function fitFor(v) {
  if (!gpuVramMb.value || !v.vram_mb) return null;
  if (v.vram_mb > gpuVramMb.value) return "no";
  if (v.vram_mb > gpuVramMb.value * 0.8) return "tight";
  return "ok";
}
const FIT_TITLES = {
  ok: "Fits your hardware",
  tight: "Tight — close other models first",
  no: "Won't fit on this card",
};

// Loaded-now rail — one slot per speech kind from server truth.
const rail = computed(() => {
  const out = {};
  for (const k of ["tts", "stt"]) {
    const e = engines.value.find((x) => x.status === "loaded" && (x.kind || "tts") === k);
    out[k] = e ? { engine: e, model: loadedVariantName(e) } : null;
  }
  return out;
});
const railVram = computed(() => {
  let mb = 0;
  for (const k of ["tts", "stt"]) {
    const slot = rail.value[k];
    if (!slot) continue;
    const v = variantsFor(slot.engine.id).find((x) => x.id === slot.engine.current_variant_id);
    mb += v?.vram_mb || 0;
  }
  return mb;
});
async function unloadKind(kind) {
  try {
    await api.request("/v1/engines/unload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind }),
    });
    window.dispatchEvent(new Event("jv:health-refresh"));
    await refresh();
  } catch (e) {
    pushToast({ message: `Unload failed: ${e.message || e}`, kind: "error" });
  }
}

const sharedEngines = computed(() => engines.value.filter((e) => e.isolation !== "venv").length);

onMounted(() => {
  refresh(); loadSystem(); loadDefaults();
  window.addEventListener("jv:health-refresh", refresh);
});
onBeforeUnmount(() => window.removeEventListener("jv:health-refresh", refresh));
</script>

<template>
  <div>
    <!-- The folder-tab pair (Engines' approved mock v7) — same split as the
         LLM providers tab one tab over. -->
    <div class="jv-toptabs">
      <button type="button" class="jv-toptab" :class="{ on: half === 'local' }" @click="half = 'local'">
        <span class="t1">Local · free</span>
        <span class="t2">Engines JustVoice installs, plus servers you run — no key, no per-use cost</span>
      </button>
      <button type="button" class="jv-toptab" :class="{ on: half === 'online' }" @click="half = 'online'">
        <span class="t1">Online · metered</span>
        <span class="t2">Cloud speech APIs — your account, billed by the provider</span>
      </button>
    </div>

    <!-- ── ONLINE half: the cloud speech-provider CRUD. ── -->
    <SpeechProvidersPanel v-if="half === 'online'" scope="cloud" />

    <!-- ── LOCAL half: managed engines + self-hosted servers. ── -->
    <template v-else>
    <div class="ev-toprow">
      <div class="jv-searchbar">
        🔍 <input v-model="q" placeholder="Search speech models and engines…" title="Filters engines and models; matching groups auto-expand">
      </div>
      <div class="ev-chips">
        <button v-for="c in ['all','tts','stt']" :key="c" type="button"
          class="ev-chip" :class="{ on: capLocal === c }" @click="capLocal = c"
        >{{ c === 'all' ? 'All' : c.toUpperCase() }}</button>
      </div>
    </div>

    <div class="jv-card ev-hw" v-if="system">
      <div class="ev-hw-cell"><div class="k">OS</div><strong>{{ system.os }}</strong></div>
      <div class="ev-hw-cell"><div class="k">CPU</div><strong>{{ system.cpu_cores }}</strong> <span class="jv-muted">threads</span></div>
      <div class="ev-hw-cell"><div class="k">Memory</div><strong>{{ Math.round(system.ram_total_mb / 1024) }} GB</strong></div>
      <div class="ev-hw-cell" v-for="(g, i) in system.gpus || []" :key="i">
        <div class="k">GPU</div><strong>{{ g.name }}</strong>
        <span class="jv-muted" v-if="g.vram_mb">{{ (g.vram_mb / 1024).toFixed(1) }} GB VRAM</span>
      </div>
      <div class="ev-hw-cell"><div class="k">Acceleration</div>
        <span><UiTag intent="ghost" v-for="r in activeRuntimes" :key="r" :label="r" /><span v-if="!activeRuntimes.length" class="jv-muted">CPU only</span></span>
      </div>
    </div>

    <!-- Loaded-now rail -->
    <div class="ev-rail">
      <div class="ev-rail-h">Loaded now</div>
      <div class="ev-slot" v-for="k in ['tts','stt']" :key="k" :class="{ empty: !rail[k] }">
        <span class="k">{{ k.toUpperCase() }}</span>
        <div v-if="rail[k]">
          <div class="nm">{{ rail[k].model || rail[k].engine.name }}</div>
          <div class="sub">{{ rail[k].engine.name }}</div>
        </div>
        <div v-else><div class="nm">— nothing loaded</div></div>
        <button v-if="rail[k]" type="button" class="ev-x" title="Free this slot — weights stay on disk" @click="unloadKind(k)">Unload</button>
      </div>
      <div class="ev-vrtotal" v-if="railVram" title="Sum of the loaded models' declared VRAM needs">
        est. VRAM <strong>{{ fmtDisk(railVram) }}</strong><span v-if="gpuVramMb"> / {{ fmtDisk(gpuVramMb) }}</span>
      </div>
    </div>

    <p v-if="enginesLoaded && !engines.length" class="jv-banner jv-banner--warn">
      No engines listed — the Python server may not be running. Check <a href="#settings">Settings → Server</a>.
    </p>

    <!-- capability sections (speech only) -->
    <div v-for="sec in sectionData" :key="sec.id">
      <div class="ev-section-h">
        <h3>{{ sec.title }} <span class="suffix">— {{ sec.suffix }}</span></h3>
        <span class="count">{{ sec.engineCount }} engine{{ sec.engineCount === 1 ? '' : 's' }} · {{ sec.modelCount }} models</span>
        <span class="note">{{ sec.note }}</span>
      </div>

      <div v-for="e in sec.engines" :key="e.id" class="ev-group">
        <div class="ev-ghead" @click="toggleOpen(e)">
          <span class="chev" :class="{ open: isOpen(e) }">▶</span>
          <span class="nm">{{ e.name }}</span><span class="id">{{ e.id }}</span>
          <span class="ev-caps">
            <span v-for="c in engineCaps(e)" :key="c" class="ev-cap" :class="c">{{ c.toUpperCase() }}</span>
            <span v-if="e.isolation === 'venv'" class="ev-cap iso" title="Runs in its own isolated environment — the same mechanism custom engines use">ISOLATED</span>
          </span>
          <span class="desc" :title="e.description">{{ e.description }}</span>
          <!-- Weights-licence attribution. NOT decorative: the Llama 3.2
               Community License §1.b requires any product built on a
               Llama-derivative model to display "Built with Llama" in the
               UI. TADA's weights are Llama-derived, so this row is a
               licence obligation for anyone shipping JustVoice. Do not
               remove without checking the weights licence first. -->
          <span v-if="e.attribution" class="ev-attrib"
            :title="`Required by the model's weights licence${e.weights_license ? ' (' + e.weights_license + ')' : ''}`"
          >{{ e.attribution }}</span>
          <span class="gsum">
            <span v-if="anyTaskRunning(e.id)" class="meta">working… · click to expand</span>
            <span v-if="!anyTaskRunning(e.id) && engineNeedsInstall(e)" class="ev-badge none">engine not installed</span>
            <UiButton v-if="!anyTaskRunning(e.id) && engineNeedsInstall(e)" intent="primary" size="small"
              label="Install engine"
              title="One-time: builds this engine's isolated venv. Models download separately afterwards."
              @click.stop="installEngine(e)" />
            <span v-if="!anyTaskRunning(e.id) && !engineNeedsInstall(e)" class="meta">{{ groupSummary(e) }}</span>
            <span v-if="!anyTaskRunning(e.id) && !engineNeedsInstall(e) && loadedVariantName(e)" class="ldd">● {{ loadedVariantName(e) }} loaded</span>
            <!-- Set-as-default (engine) — rightmost, the family position. -->
            <UiButton v-if="sec.id === 'tts'" :intent="defaultEngineId === e.id ? 'success' : 'secondary'" size="small"
              :label="defaultEngineId === e.id ? 'Default ✓' : 'Set as default'"
              title="Which engine new-voice flows and first-render auto-setup prefer"
              @click.stop="defaultEngineId === e.id ? null : setDefaultEngine(e)" />
          </span>
        </div>

        <div class="ev-gbody" v-if="isOpen(e)">
          <div v-for="v in variantsFor(e.id)" :key="v.id" class="ev-model" :class="{ dim: engineNeedsInstall(e) }">
            <span v-if="fitFor(v)" class="ev-fit" :class="fitFor(v)" :title="FIT_TITLES[fitFor(v)]"></span>
            <span class="vn">{{ v.name }}</span>
            <span class="vmeta">{{ fmtDisk(v.size_mb) }}<span v-if="v.vram_mb"> · {{ fmtDisk(v.vram_mb) }} VRAM</span></span>
            <span class="vdesc" :title="v.description">{{ v.description }}</span>
            <span class="right">
              <span v-if="modelLoaded(e, v)" class="ev-badge loaded">● Loaded</span>
              <UiButton v-if="modelLoaded(e, v)" intent="ghost" size="small" label="Unload model"
                title="Free the slot — weights stay on disk" @click="unload(e)" />
              <UiButton v-if="modelLoaded(e, v) || (modelOnDisk(e, v) && v.on_disk === true)" intent="ghost" size="small"
                label="Delete model" class="ev-danger"
                :title="`Delete the downloaded weights — frees ${fmtDisk(v.size_mb)}`"
                @click="deleteModel(e, v)" />
              <UiButton v-if="!modelLoaded(e, v)" intent="primary" size="small"
                :label="loadButtonLabel(e, v)"
                :disabled="busyAnywhere(e.id, v.id) || engineNeedsInstall(e)"
                :title="modelOnDisk(e, v) ? `Load into the ${(e.kind || 'tts').toUpperCase()} slot` : `Download (${fmtDisk(v.size_mb)}) and load — one step`"
                @click="runLoad(e, v.id)" />
              <!-- Set-as-default (model) — the user layer the manager resolves
                   over the manifest default. Rightmost, family position. -->
              <UiButton :intent="e.default_variant_id === v.id ? 'success' : 'secondary'" size="small"
                :label="e.default_variant_id === v.id ? 'Default ✓' : 'Set as default'"
                title="The model this engine loads when nothing picks one explicitly"
                @click="e.default_variant_id === v.id ? null : setDefaultVariant(e, v.id)" />
            </span>
          </div>

          <!-- THE one download bar (kit DownloadBar over the kit task) — every
               install/download/load renders identically to the LLM side. -->
          <DownloadBar v-for="row in taskRowsFor(e.id)" :key="row.key"
            :title="row.variantId ? variantNameFor(e.id, row.variantId) : `${e.name || e.id} · engine setup`"
            :task="row.task" />

          <div class="ev-gfoot" v-if="e.isolation === 'venv' && e.status !== 'not_installed'">
            isolated venv
            <UiButton intent="ghost" size="small" label="Uninstall engine" class="ev-danger ev-push-right"
              title="Remove this engine's venv and all its downloaded models" @click="uninstall(e)" />
          </div>
          <div class="ev-gfoot" v-else-if="e.isolation !== 'venv' && (e.status === 'installed' || e.status === 'loaded')">
            shared runtime · engine installed automatically
          </div>
        </div>
      </div>
    </div>

    <!-- Self-hosted servers — the user runs these; they live under Local with
         their kind, WITH their verbs (add/edit/test — the read-only teaser +
         separate tab died, user QC ruling 2026-08-06). -->
    <div class="ev-section-h">
      <h3>Self-hosted servers <span class="suffix">— speech servers you run</span></h3>
    </div>
    <SpeechProvidersPanel scope="selfhosted" />

    <p class="ev-fitnote" v-if="gpuVramMb">
      Hardware fit, against your card:
      <span class="ev-fit ok"></span> fits
      <span class="ev-fit tight"></span> tight — free a slot first
      <span class="ev-fit no"></span> won't fit in {{ fmtDisk(gpuVramMb) }}
    </p>

    <div class="ev-runtime">
      Shared runtime (torch + common deps for the {{ sharedEngines }} shared engines)
      <span class="jv-muted ev-push-right">engines install into it automatically on first use</span>
    </div>
    </template>
  </div>
</template>

<style scoped>
/* The .ev-* classes moved to styles.css with the parity batch (this tab and
   the TTS providers tab share them; scoped copies would drift). */
</style>
