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
  search + kind chips, the weights-licence attribution row (a licence
  OBLIGATION — see the inline note), per-variant delete, venv uninstall, and
  the folder-tab pair itself (Engines' approved mock v7). The fit dots died
  2026-08-14 with the invented per-variant vram_mb column.
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useApi } from "../stores/api.js";
import { DownloadBar, UiButton, UiTag, confirmDialog, openExternal, promptDialog, pushToast, withAiTask } from "@delebash/llm-ui";
import { makeEngineDownloadTask } from "../services/ttsJobChannel.js";
import { createDownloadTask } from "@delebash/llm-ui";
// The row's three-dot menu — reka-ui's DropdownMenu, the same import shape
// as the kit's LuModelCatalog (the portal escapes the group's overflow clip).
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal,
  DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger,
} from "reka-ui";

// Mirror the job-channel task's live numbers into the kit strip's progress —
// the bar computes from done/total (bytes) and the TEXT is the ONE shared
// caption ("Downloading · 42% · 512 MB of 1.2 GB · 24 MB/s"), so the strip and
// the Engines card can never disagree (the install-progress bridge,
// 2026-08-08 — before it the strip showed a bare label while the card had the
// percent). Returns the stop handle; the caller stops it when the phase ends.
function bridgeJobProgress(panel, task) {
  return watch(
    () => [task.done, task.total, task.label],
    () => panel.setProgress(task.done || 0, task.total || 0, task.label),
    { immediate: true },
  );
}
import SpeechProvidersPanel from "./SpeechProvidersPanel.vue";
import { UiSelect } from "@delebash/llm-ui";

// The Local/Online half switch (the folder-tab pair).
const half = ref("local");

const api = useApi();

// ── The memory budget strip (the 2026-08-13 VRAM wiring, Q3/Q4) ────────
// ONE endpoint (`/v1/engines/vram`) reads the shared arbiter: the box's
// budget pool (a card's VRAM on discrete boxes, the one shared pool on
// integrated/unified — the label follows mem_arch), each resident booking
// with its provenance, the on-demand LLM claim, and eviction events the
// poller turns into toasts (Q3: event-driven honesty — a swap is named
// when it HAPPENS; there are no predictive load-time warnings).
const vram = ref(null);
let vramTimer = null;
let lastEventSeq = 0;
let vramPrimed = false; // absorb pre-mount events silently on the first poll
async function pollVram() {
  const v = await api.safeRequest(`/v1/engines/vram?events_since=${lastEventSeq}`, null);
  if (!v) return;
  for (const ev of v.events || []) {
    lastEventSeq = Math.max(lastEventSeq, ev.seq);
    if (vramPrimed) {
      pushToast({
        message: `${ev.victim_key} was unloaded to make room${ev.reason ? ` — ${ev.reason}` : ""}.`,
        kind: "info", duration: 6000,
      });
    }
  }
  vramPrimed = true;
  vram.value = v;
}
const memLabel = computed(() => (vram.value?.mem_arch === "discrete" ? "VRAM" : "Memory"));
function _kindMb(kinds) {
  return (vram.value?.reservations || [])
    .filter((r) => kinds.includes(r.kind))
    .reduce((n, r) => n + (r.vram_mb || 0), 0);
}
// The 2026-08-13/14 redesign: the strip shows MEASURED reality — used/free
// are what nvidia-smi would print (used_mb; None on an unmeasurable box
// falls back to the ledger's remaining), and each loaded speech engine is
// its own cell with its measured take. There is no pre-load estimate any
// more: an engine whose footprint hasn't been measured on this machine says
// "not measured yet" until its first load/render lands a number; a "~"
// number is the device-delta fallback (boxes with no per-process probe),
// approximate by construction.
const freeMb = computed(() => {
  const v = vram.value;
  if (!v) return 0;
  if (v.used_mb != null) return Math.max(0, v.total_mb - v.used_mb);
  return v.remaining_mb;
});
const speechRows = computed(() => {
  const v = vram.value;
  if (!v) return [];
  const res = v.reservations || [];
  const rows = [];
  const claimed = new Set();
  for (const e of engines.value) {
    if (e.status !== "loaded") continue;
    const kind = e.kind || "tts";
    if (kind !== "tts" && kind !== "stt") continue;
    // CPU-placed engines on discrete boxes hold no VRAM by policy — no cell.
    if (v.mem_arch === "discrete" && (e.resolved_device || "").toLowerCase() === "cpu") continue;
    const r = res.find((x) => x.key === `${kind}:${e.id}`);
    if (r) {
      claimed.add(r.key);
      const est = r.source !== "measured";
      rows.push({
        key: r.key,
        label: e.name || e.id,
        text: est ? `~${fmtDisk(r.vram_mb)}` : fmtDisk(r.vram_mb),
        title: est
          ? "Approximate — read from the device-wide change during load; a real per-process measurement replaces it when one becomes possible"
          : `Measured (${kind.toUpperCase()})`,
      });
    } else {
      rows.push({
        key: `${kind}:${e.id}`,
        label: e.name || e.id,
        text: "not measured yet",
        title: "First load on this machine — JustVoice books the real measured footprint as soon as a probe lands; until then nothing is reserved for this engine",
      });
    }
  }
  // A booking with no live engine row (e.g. a crashed engine's lingering
  // reservation) still shows — the ledger is truth about what is booked.
  for (const r of res) {
    if ((r.kind === "tts" || r.kind === "stt") && !claimed.has(r.key)) {
      const id = r.key.split(":").slice(1).join(":");
      const est = r.source !== "measured";
      rows.push({
        key: r.key,
        label: engines.value.find((e) => e.id === id)?.name || id,
        text: est ? `~${fmtDisk(r.vram_mb)}` : fmtDisk(r.vram_mb),
        title: est ? "Approximate (device-delta)" : `Measured (${r.kind.toUpperCase()})`,
      });
    }
  }
  return rows;
});
const llmCell = computed(() => {
  const v = vram.value;
  if (!v) return null;
  const llmMb = _kindMb(["llm"]);
  if (llmMb > 0) return { label: "AI model (loaded)", text: fmtDisk(llmMb), title: "" };
  const c = v.claim;
  if (c) {
    return {
      label: "AI model (loads on demand)",
      text: `~${fmtDisk(c.vram_mb)}`,
      title: `${c.model} — ${c.source}${c.matches ? ` (${c.matches} measured loads)` : ""}`
        + (c.ram_mb ? ` · RAM ~${fmtDisk(c.ram_mb)} (display-only)` : ""),
    };
  }
  if (v.claim_reason === "cloud-routed") {
    return { label: "AI model", text: "cloud-routed",
      title: "Your AI features run on a cloud provider — no local memory needed" };
  }
  return { label: "AI model", text: "—", title: "" };
});
const budgetTitle = computed(() => {
  const v = vram.value;
  const rows = v?.reservations || [];
  const lines = rows.map((r) => `${r.key}: ${fmtDisk(r.vram_mb)} (${r.source})`);
  if (v?.other_mb > 0) lines.push(`other apps / OS: ${fmtDisk(v.other_mb)}`);
  return lines.length ? lines.join("\n") : "Nothing loaded holds memory right now.";
});

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
//   {[engineId]: {variants: [{id, name, size_mb, languages, on_disk, ...}]}}
// (No vram_mb — the 2026-08-14 redesign: memory is measured at load, never
// declared per catalog row. The /models/recommended fetch died with it.)
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
// engine_id → the operator's Device choice (settings.engines.
// engine_overrides[id].device — Q2's decided setting; "" = auto).
const deviceOverrides = reactive({});
async function loadDefaults() {
  const s = await api.safeRequest("/v1/settings", null);
  defaultEngineId.value = s?.engines?.default_tts_engine || "";
  const ov = s?.engines?.engine_overrides || {};
  for (const [id, o] of Object.entries(ov)) deviceOverrides[id] = o?.device || "auto";
}

// The per-engine Device select (Q2, decided 2026-08-08 round 2): a REAL
// setting, resolved at the one load door — never a hidden torch default.
// Read-modify-write the overrides map (a bare PATCH could clobber siblings).
async function setDeviceOverride(engine, value) {
  try {
    const s = await api.request("/v1/settings");
    const overrides = { ...(s?.engines?.engine_overrides || {}) };
    overrides[engine.id] = { ...(overrides[engine.id] || {}), device: value };
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ engines: { engine_overrides: overrides } }),
    });
    deviceOverrides[engine.id] = value;
    const note = engine.status === "loaded" ? " Takes effect on the next load." : "";
    pushToast({ message: `${engine.name || engine.id} device set to ${value}.${note}`, kind: "success" });
  } catch (e) {
    pushToast({ message: `Couldn't set the device: ${e?.message || e}`, kind: "error" });
  }
}
const DEVICE_OPTIONS = [
  { label: "Auto (recommended)", value: "auto" },
  { label: "CUDA (GPU)", value: "cuda" },
  { label: "CPU", value: "cpu" },
];
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
        const models = await api.request(`/v1/engines/${eng.id}/models`).catch(() => ({ variants: [] }));
        variants[eng.id] = { variants: models.variants || [] };
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
function modelLoaded(e, v) { return isLoadedVariant(e, v.id); }
function modelOnDisk(e, v) {
  return v.on_disk === true
    || (v.on_disk == null && (e.status === "installed" || e.status === "loaded"));
}
function engineNeedsInstall(e) { return e.isolation === "venv" && e.status === "not_installed"; }

// ── Install (engine venv) — kit task over the job channel. ────────────
// The runner owns the panel lifecycle. The job task decides the OUTCOME by
// state, not by exception, so the callback translates: done → return (the
// runner finishes) · error → throw (the runner fails, the row keeps the
// error) · cancelled → panel.cancel() + return (first-outcome-wins makes the
// runner's finish a no-op). Download PERCENT does not reach the strip yet —
// bridging it is the user's named next task (with the VRAM arbiter).
async function installEngine(engine) {
  const key = _engineKey(engine.id);
  clearTerminalTask(key);
  const task = makeEngineDownloadTask(api, engine.id, {});
  dlTasks[key] = task;
  try {
    await withAiTask({
      feature: "install",
      label: `Installing · ${engine.name || engine.id}`,
    }, async (panel) => {
      // Bridge the strip's ✕ to the job-channel task so it stops the install.
      panel.signal.addEventListener("abort", () => {
        if (task.state === "running") task.cancel();
      }, { once: true });
      const stopBridge = bridgeJobProgress(panel, task);
      try {
        await task.start();
      } finally {
        stopBridge();
      }
      if (task.state === "error") throw new Error(task.error || "install failed");
      if (task.state !== "done") { panel.cancel(); return; }
      pushToast({ message: `${engine.name || engine.id} installed.`, kind: "success", duration: 4000 });
      delete variants[engine.id];
      await refresh();
    });
  } catch {
    // The task row carries the error (failed lingers until dismissed) — the
    // pre-conversion code surfaced no toast here either.
  }
}

// ── Load (weights already on disk — the Download verb is separate now:
// the LLM-catalog split, user ruling 2026-08-14). ─────────────────────
async function runLoad(engine, variantId) {
  const key = _variantKey(engine.id, variantId);
  clearTerminalTask(key);

  const task = createDownloadTask({
    start: async () => {},
    statusUrl: "",
    fetch: async () => ({}),
    read: () => ({ detail: "loading" }),
    cancel: () => api.request(`/v1/engines/${engine.id}/cancel-load`, { method: "POST" }),
  });
  dlTasks[key] = task;
  try {
    await withAiTask({
      feature: "load",
      label: `Loading · ${engine.name || engine.id} (${variantNameFor(engine.id, variantId)})`,
      onRetry: () => runLoad(engine, variantId),
    }, async (panel) => {
      // Bridge the kit handle's Cancel to the job-channel task (see installEngine).
      panel.signal.addEventListener("abort", () => {
        if (task.state === "running") task.cancel();
      }, { once: true });
      const stopBridge = bridgeJobProgress(panel, task);
      try {
        task.arm("Loading model");
        try {
          await api.request(`/v1/engines/${engine.id}/load`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ device: "auto", model_variant: variantId || null }),
          });
        } catch (e) {
          if (task.state === "cancelled") { panel.cancel(); return; }
          task.fail(String(e?.message || e));   // the CARD's job bar, not the panel
          throw e;
        }
        task.apply({ terminal: "done" });
        window.dispatchEvent(new Event("jv:health-refresh"));
        delete variants[engine.id];
        await refresh();
        pushToast({ message: `${engine.name || engine.id} loaded.`, kind: "success", duration: 4500 });
        delete dlTasks[key];
      } finally {
        stopBridge();
      }
    });
  } catch {
    // The task row carries the error (failed lingers until dismissed).
  }
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

// ── Per-variant facts → row chips (phase ③, the §4 cloning ruling) ────
function langText(v) {
  const ls = v.languages || [];
  if (!ls.length) return "";
  return ls.length === 1 ? ls[0] : `${ls.length} langs`;
}
function langTitle(v) {
  return (v.languages || []).join(" · ");
}
// Weights-licence chip — the kit's use-limited warn pattern, retold
// honestly for JV: every bundled engine's weights permit commercial output
// (Higgs died for that in 2026-06), so here the gold ⚠ means an OBLIGATION
// rides the licence — TADA's Llama-3.2-Community requires "Built with
// Llama" in your published credits (NOTICE.md has the authoritative copy).
const PERMISSIVE_LICENSES = new Set(["mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause"]);
function licenseWarn(v) {
  return !!v.weights_license && !PERMISSIVE_LICENSES.has(v.weights_license.toLowerCase());
}
function licenseTitle(e, v) {
  if (!v.weights_license) return "";
  if (!licenseWarn(v)) return `${v.weights_license} — permissive; publishing your generated audio commercially is fine.`;
  return `${v.weights_license} — commercial output is permitted, but an obligation rides this licence`
    + (e.attribution ? `: display "${e.attribution}" in your published credits.` : ".")
    + " See NOTICE.md.";
}

// Per-row measured-memory hint (§13): joins the vram endpoint's
// reservations the same way the strip's speechRows does. Only the LOADED
// variant can carry a number — memory is measured, never declared.
function measuredHint(e, v) {
  if (!isLoadedVariant(e, v.id)) return null;
  // CPU-placed engines on discrete boxes hold no VRAM by policy — no hint.
  if (vram.value?.mem_arch === "discrete" && (e.resolved_device || "").toLowerCase() === "cpu") return null;
  const kind = e.kind || "tts";
  const r = (vram.value?.reservations || []).find((x) => x.key === `${kind}:${e.id}`);
  if (!r) {
    return { text: "not measured yet",
      title: "First load on this machine — JustVoice books the real measured footprint as soon as a probe lands" };
  }
  const est = r.source !== "measured";
  return {
    text: est ? `~${fmtDisk(r.vram_mb)} in memory` : `${fmtDisk(r.vram_mb)} measured`,
    title: est
      ? "Approximate — read from the device-wide change during load; a real per-process measurement replaces it when one becomes possible"
      : "Measured on this machine at load",
  };
}

// ── The three-dot menu's verbs (§6: Re-download · Delete files · Open
// folder · View on Hugging Face) ──────────────────────────────────────
async function redownload(e, v) {
  const ok = await confirmDialog({
    title: `Re-download ${v.name}?`,
    message: `Deletes the local files, then downloads fresh (${fmtDisk(v.size_mb)}). Use this when a download looks corrupted — models downloaded before the speech cache also move onto the new layout this way.`,
    confirmLabel: "Re-download",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/engines/${e.id}/models/${encodeURIComponent(v.id)}`, { method: "DELETE" });
  } catch (err) {
    pushToast({ message: `Couldn't delete the old files: ${err.message || err}`, kind: "error" });
    return;
  }
  delete variants[e.id];
  await refresh();
  await downloadOnly(e, v.id);
}

// Download WITHOUT loading — Re-download's second half. Same job-channel
// task and DownloadBar as everything else (the one-mechanism rule).
async function downloadOnly(engine, variantId) {
  const key = _variantKey(engine.id, variantId);
  clearTerminalTask(key);
  const task = makeEngineDownloadTask(api, engine.id, { model_variant: variantId });
  dlTasks[key] = task;
  try {
    await withAiTask({
      feature: "install",
      label: `Downloading · ${variantNameFor(engine.id, variantId)}`,
    }, async (panel) => {
      panel.signal.addEventListener("abort", () => {
        if (task.state === "running") task.cancel();
      }, { once: true });
      const stopBridge = bridgeJobProgress(panel, task);
      try {
        await task.start();
      } finally {
        stopBridge();
      }
      if (task.state === "error") throw new Error(task.error || "download failed");
      if (task.state !== "done") { panel.cancel(); return; }
      pushToast({ message: `${variantNameFor(engine.id, variantId)} downloaded.`, kind: "success", duration: 4000 });
      delete variants[engine.id];
      await refresh();
    });
  } catch {
    // The task row carries the error (failed lingers until dismissed).
  }
}

// Desktop-only, the log-opener precedent (SettingsView): the SERVER
// resolved local_dir (speech cache / legacy HF cache / tarball dir), so
// the layout knowledge never leaks into the client.
function openModelFolder(v) {
  const tauri = typeof window !== "undefined" ? window.__TAURI__ : null;
  if (!tauri?.shell?.open) {
    pushToast({ message: "Open folder requires the desktop app.", kind: "warning" });
    return;
  }
  tauri.shell.open(v.local_dir).catch((err) =>
    pushToast({ message: `Couldn't open the folder: ${err?.message || err}`, kind: "error" }));
}

function viewOnHf(v) {
  openExternal(`https://huggingface.co/${v.hf_repo}`);
}

// ── Search + the filter row + sections (speech kinds only). ───────────
// ONE chip row (§6's decided filters merged with the pre-existing kind
// chips — two side-by-side "All" chips would be worse than either row):
// TTS/STT filter by engine kind; Cloning/Preset voices filter by the
// per-variant capability FACTS the ②c manifests serve (v.voice_cloning,
// v.preset_voices) — an engine with no matching variant drops out.
const q = ref("");
const filterId = ref("all");
const FILTERS = [
  { id: "all", label: "All" },
  { id: "tts", label: "TTS" },
  { id: "stt", label: "STT" },
  { id: "cloning", label: "Cloning" },
  { id: "presets", label: "Preset voices" },
];
function variantMatchesFilter(v) {
  if (filterId.value === "cloning") return v.voice_cloning === true;
  if (filterId.value === "presets") return (v.preset_voices || 0) > 0;
  return true;
}
function visibleVariantsFor(engineId) {
  return variantsFor(engineId).filter(variantMatchesFilter);
}
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
  const f = filterId.value;
  if ((f === "tts" || f === "stt") && !engineCaps(e).includes(f)) return false;
  if ((f === "cloning" || f === "presets") && !visibleVariantsFor(e.id).length) return false;
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
  // A capability filter is a question about VARIANTS — show them.
  if (q.value.trim() || filterId.value === "cloning" || filterId.value === "presets") return true;
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

// The fits-your-hardware dots died 2026-08-14 with the per-variant vram_mb
// column they compared against (scaffold-invented conclusions) — real fit
// truth is the budget strip's measured numbers.

// Loaded-now rail — one slot per speech kind from server truth.
const rail = computed(() => {
  const out = {};
  for (const k of ["tts", "stt"]) {
    const e = engines.value.find((x) => x.status === "loaded" && (x.kind || "tts") === k);
    out[k] = e ? { engine: e, model: loadedVariantName(e) } : null;
  }
  return out;
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
  refresh(); loadSystem(); loadDefaults(); pollVram();
  vramTimer = setInterval(pollVram, 4000);
  window.addEventListener("jv:health-refresh", refresh);
});
onBeforeUnmount(() => {
  window.removeEventListener("jv:health-refresh", refresh);
  if (vramTimer) clearInterval(vramTimer);
});
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
        <button v-for="f in FILTERS" :key="f.id" type="button"
          class="ev-chip" :class="{ on: filterId === f.id }" @click="filterId = f.id"
        >{{ f.label }}</button>
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

    <!-- The memory budget strip (Q4: ONE strip, one endpoint) — since the
         2026-08-13 redesign it shows MEASURED reality: used/free match what
         nvidia-smi (or Task Manager) says, each loaded speech engine is its
         own cell with its measured take, and anything not yet measured is
         drawn as an estimate (~). The label follows the box's memory
         architecture: "VRAM" on a discrete card, "Memory" on one-pool
         (iGPU/unified) machines where CPU and GPU share the same bytes.
         Hover lists every holder, including other apps. -->
    <div class="jv-card ev-hw" v-if="vram" :title="budgetTitle">
      <div class="ev-hw-cell"><div class="k">{{ memLabel }}</div>
        <strong v-if="vram.used_mb != null">{{ fmtDisk(vram.used_mb) }} <span class="jv-muted">of {{ fmtDisk(vram.total_mb) }} used</span></strong>
        <strong v-else>{{ fmtDisk(vram.total_mb) }} <span class="jv-muted">budget</span></strong>
      </div>
      <div class="ev-hw-cell"><div class="k">Free</div><strong>{{ fmtDisk(freeMb) }}</strong></div>
      <div class="ev-hw-cell" v-for="r in speechRows" :key="r.key">
        <div class="k">{{ r.label }}</div>
        <strong :title="r.title">{{ r.text }}</strong>
      </div>
      <div class="ev-hw-cell" v-if="llmCell"><div class="k">{{ llmCell.label }}</div>
        <strong :title="llmCell.title">{{ llmCell.text }}</strong>
      </div>
      <div class="ev-hw-cell" v-if="vram.other_mb > 256"><div class="k">Other apps</div>
        <strong title="Memory held by processes JustVoice doesn't manage (browser, OS, games)">{{ fmtDisk(vram.other_mb) }}</strong>
      </div>
      <div class="ev-hw-cell" v-if="vram.busy_kinds?.length"><div class="k">Busy</div>
        <span><UiTag v-for="k in vram.busy_kinds" :key="k" intent="ghost" :label="k.toUpperCase()"
          title="Work in flight — this kind's resident model can't be evicted right now" /></span>
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
      <!-- The old client-guessed "est. VRAM" total died with the 2026-08-13
           wiring, and its "booked" successor died with the 2026-08-14
           measured redesign — the budget strip above is the ONE memory
           surface (measured, provenance-tagged). -->
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
            <span v-if="!anyTaskRunning(e.id) && !engineNeedsInstall(e) && loadedVariantName(e)" class="ldd">● {{ loadedVariantName(e) }} loaded<template v-if="e.resolved_device"> · {{ e.resolved_device.toUpperCase() }}</template></span>
            <!-- Set-as-default (engine) — rightmost, the family position. -->
            <UiButton v-if="sec.id === 'tts'" :intent="defaultEngineId === e.id ? 'success' : 'secondary'" size="small"
              :label="defaultEngineId === e.id ? 'Default ✓' : 'Set as default'"
              title="Which engine new-voice flows and first-render auto-setup prefer"
              @click.stop="defaultEngineId === e.id ? null : setDefaultEngine(e)" />
          </span>
        </div>

        <div class="ev-gbody" v-if="isOpen(e)">
          <div v-for="v in visibleVariantsFor(e.id)" :key="v.id" class="ev-model" :class="{ dim: engineNeedsInstall(e) }">
            <span class="vn">{{ v.name }}</span>
            <!-- The facts chips (§6): languages · Cloning · Presets · N ·
                 licence — read straight off the ②c manifest facts the wire
                 serves; nothing here is typed twice. -->
            <span class="ev-vchips">
              <span v-if="langText(v)" class="ev-cap" :title="langTitle(v)">{{ langText(v) }}</span>
              <span v-if="v.voice_cloning === true" class="ev-cap clone"
                title="Clones a voice from a short clean sample">CLONING</span>
              <span v-if="v.preset_voices > 0" class="ev-cap presets"
                :title="`${v.preset_voices} ready-made voices — no sample needed`">PRESETS · {{ v.preset_voices }}</span>
              <span v-if="v.weights_license" class="ev-lic" :class="{ 'ev-lic--warn': licenseWarn(v) }"
                :title="licenseTitle(e, v)"><template v-if="licenseWarn(v)">⚠ </template>{{ v.weights_license }}</span>
            </span>
            <!-- Download size only — no memory claim. The footprint is
                 measured at load (the budget strip shows it); a number
                 typed here would be an invention (the 2026-08-14 ruling). -->
            <span class="vmeta">{{ fmtDisk(v.size_mb) }}<template v-if="v.on_disk === true"> · on disk</template></span>
            <span class="vdesc" :title="v.description">{{ v.description }}</span>
            <span class="right">
              <span v-if="modelLoaded(e, v)" class="ev-badge loaded">● Loaded</span>
              <span v-if="measuredHint(e, v)" class="ev-memhint" :title="measuredHint(e, v).title">{{ measuredHint(e, v).text }}</span>
              <UiButton v-if="modelLoaded(e, v)" intent="ghost" size="small" label="Unload model"
                title="Free the slot — weights stay on disk" @click="unload(e)" />
              <!-- The LLM-catalog verb split (user ruling 2026-08-14): a
                   not-downloaded model gets a DOWNLOAD button (download only,
                   same as the kit's 'available' rows) — Load appears once the
                   files are on disk. The old one-step "⬇ Load (N GB)" died. -->
              <UiButton v-if="!modelLoaded(e, v) && !modelOnDisk(e, v)" intent="primary" size="small"
                :label="`Download (${fmtDisk(v.size_mb)})`"
                :disabled="busyAnywhere(e.id, v.id) || engineNeedsInstall(e)"
                title="Download the model files. Load it from this row once it's on disk."
                @click="downloadOnly(e, v.id)" />
              <UiButton v-if="!modelLoaded(e, v) && modelOnDisk(e, v)" intent="primary" size="small"
                label="Load model"
                :disabled="busyAnywhere(e.id, v.id) || engineNeedsInstall(e)"
                :title="`Load into the ${(e.kind || 'tts').toUpperCase()} slot`"
                @click="runLoad(e, v.id)" />
              <!-- Set-as-default (model) — the user layer the manager resolves
                   over the manifest default. Rightmost, family position. -->
              <UiButton :intent="e.default_variant_id === v.id ? 'success' : 'secondary'" size="small"
                :label="e.default_variant_id === v.id ? 'Default ✓' : 'Set as default'"
                title="The model this engine loads when nothing picks one explicitly"
                @click="e.default_variant_id === v.id ? null : setDefaultVariant(e, v.id)" />
              <!-- The three-dot menu (§6) — Delete moved in here from the
                   old inline button; the reka portal escapes the group's
                   overflow clip (the kit LuModelCatalog pattern). -->
              <DropdownMenuRoot>
                <DropdownMenuTrigger class="ev-kebab" aria-label="More actions" title="More actions">⋯</DropdownMenuTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuContent class="ev-menu" align="end" :side-offset="4" :collision-padding="8">
                    <DropdownMenuItem v-if="v.on_disk === true" class="ev-menu-item"
                      :disabled="busyAnywhere(e.id, v.id) || modelLoaded(e, v)"
                      @select="redownload(e, v)">Re-download</DropdownMenuItem>
                    <DropdownMenuItem v-if="v.local_dir" class="ev-menu-item"
                      @select="openModelFolder(v)">Open folder</DropdownMenuItem>
                    <DropdownMenuItem v-if="v.hf_repo" class="ev-menu-item"
                      @select="viewOnHf(v)">View on Hugging Face</DropdownMenuItem>
                    <template v-if="v.on_disk === true && !modelLoaded(e, v)">
                      <DropdownMenuSeparator class="ev-menu-sep" />
                      <DropdownMenuItem class="ev-menu-item danger"
                        @select="deleteModel(e, v)">Delete files</DropdownMenuItem>
                    </template>
                  </DropdownMenuContent>
                </DropdownMenuPortal>
              </DropdownMenuRoot>
            </span>
          </div>

          <!-- THE one download bar (kit DownloadBar over the kit task) — every
               install/download/load renders identically to the LLM side. -->
          <DownloadBar v-for="row in taskRowsFor(e.id)" :key="row.key"
            :title="row.variantId ? variantNameFor(e.id, row.variantId) : `${e.name || e.id} · engine setup`"
            :task="row.task" />

          <!-- The Device select (Q2, decided): a real setting the ONE load
               door resolves — auto follows the engine's cpu_adequate fact,
               an explicit choice always wins. The engine's hidden torch
               "auto" (greedy-cuda) no longer decides anything. -->
          <div class="ev-gfoot">
            Device
            <UiSelect :modelValue="deviceOverrides[e.id] || 'auto'" width="name"
              :options="DEVICE_OPTIONS"
              title="Where this engine's model loads. Auto picks CPU for CPU-fast engines, otherwise your GPU."
              @update:modelValue="(v) => setDeviceOverride(e, v)" />
            <span v-if="e.resolved_device" class="jv-muted">loaded on {{ e.resolved_device.toUpperCase() }}</span>
          </div>

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
