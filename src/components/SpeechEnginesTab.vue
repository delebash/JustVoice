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
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useApi } from "../stores/api.js";
import { DownloadBar, UiButton, confirmDialog, openExternal, openPath, promptDialog, pushToast } from "@delebash/llm-ui";
import { makeEngineDownloadTask, makeEngineLoadTask } from "../services/ttsJobChannel.js";
// The row's three-dot menu — reka-ui's DropdownMenu, the same import shape
// as the kit's LuModelCatalog (the portal escapes the group's overflow clip).
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal,
  DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger,
} from "reka-ui";

import SpeechProvidersPanel from "./SpeechProvidersPanel.vue";
import { UiSelect } from "@delebash/llm-ui";

// The Local/Online half switch (the folder-tab pair).
const half = ref("local");

const api = useApi();

// ── Memory truth (the 2026-08-15 one-strip consolidation) ──────────────
// The budget strip DIED from this tab: the kit's top strip (AiModelsArea)
// is the one memory surface, fed by `services/vramFeed.js` — the shared
// poller over `/v1/engines/vram` (AiView passes its cells up). This tab
// keeps the raw snapshot only for the per-row measured hints below.
import { fmtDisk, subscribeVramFeed, vram } from "../services/vramFeed.js";
let unsubscribeVram = null;

// The engine list is SERVER state and is never cached in the browser (the
// 2026-08-14 audit: a browser copy of server-owned state is the shape behind
// the progress-bar bug). The "no engines" banner it used to guard against is
// already gated on `enginesLoaded`, which stays false until the first fetch
// resolves — so nothing flashes and there is no second copy to go stale.
const engines = ref([]);
const enginesLoaded = ref(false);

// Per-engine model variants:
//   {[engineId]: {variants: [{id, name, size_mb, languages, on_disk, ...}]}}
// (No vram_mb — the 2026-08-14 redesign: memory is measured at load, never
// declared per catalog row. The /models/recommended fetch died with it.)
const variants = reactive({});

// ── Download/load tasks (kit machinery) ───────────────────────────────
// One reactive task per in-flight operation, keyed engineId (engine-wide
// install) or engineId/variantId (per-variant download/load). DownloadBar
// renders whatever is here; done bars are reaped on success (the LLM
// catalog's rule — the row flipping to "on disk"/"loaded" is the evidence),
// error/cancelled bars linger for Retry/Dismiss.
const dlTasks = reactive({});
// Which verb made each task, so the bar's finished word is honest: a download
// ends "Ready", a load ends "Loaded" (user, 2026-08-21: "instead of saying
// ready say loaded, be consistant").
const taskKind = reactive({});
const _engineKey = (engineId) => engineId;
const _variantKey = (engineId, variantId) => `${engineId}/${variantId}`;
function taskRowsFor(engineId) {
  const rows = [];
  // A task with no state is a DISMISSED one: dismiss() resets it in place and
  // leaves it in the map, and an unguarded bar then renders a titled nothing.
  const live = (k) => dlTasks[k]?.state;
  if (live(engineId)) rows.push({ key: engineId, variantId: null, task: dlTasks[engineId] });
  const prefix = `${engineId}/`;
  for (const k of Object.keys(dlTasks)) {
    if (k.startsWith(prefix) && live(k)) rows.push({ key: k, variantId: k.slice(prefix.length), task: dlTasks[k] });
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
  if (t && t.state !== "running") { delete dlTasks[key]; delete taskKind[key]; }
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
// What this MACHINE can run — /v1/system's runtime map (cuda, mps,
// coreml, directml, rocm, mlx, cpu…). Fetched once; the per-engine
// options below intersect it with what the ENGINE declares, so the menu
// never offers Metal on Windows or CUDA on a Mac. (It used to be a
// hardcoded Auto/CUDA/CPU triple whatever the platform or engine.)
const machineRuntimes = reactive({});
(async () => {
  const s = await api.safeRequest("/v1/system", null);
  Object.assign(machineRuntimes, s?.runtimes || {});
})();

const RUNTIME_LABELS = {
  cuda: "CUDA (NVIDIA)",
  rocm: "ROCm (AMD)",
  mps: "Metal (Apple GPU)",
  metal: "Metal (Apple GPU)",
  coreml: "CoreML (Apple)",
  directml: "DirectML (Windows GPU)",
  mlx: "MLX (Apple Silicon)",
  cpu: "CPU",
};

function deviceOptionsFor(e) {
  const declared = e?.prerequisites?.gpu_runtimes || [];
  const usable = declared.filter(
    (r) => r !== "cpu" && machineRuntimes[r],
  );
  return [
    { label: "Auto", value: "auto" },
    ...usable.map((r) => ({ label: RUNTIME_LABELS[r] || r.toUpperCase(), value: r })),
    { label: "CPU", value: "cpu" },
  ];
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


async function refresh() {
  const e = await api.safeRequest("/v1/engines", { engines: [] });
  // Speech only: the LLM/Embeddings sections died here (they live on the LLM
  // tabs of this console).
  engines.value = (e?.engines ?? []).filter((x) => ["tts", "stt"].includes(x.kind || "tts"));
  enginesLoaded.value = true;
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

// An EXTERNAL refresh has to drop the variant rows first. `refresh()` skips any
// engine whose variants are already cached, and every in-component mutation
// pairs its own `delete variants[id]` with the call — but the `jv:health-refresh`
// listener had no such pairing, and Settings fires that event precisely to flip
// rows back to Download after clearing the speech cache
// (SettingsView.vue:828-829). Without this the catalog went on advertising
// "· on disk" and offering Load for files that had just been deleted.
function refreshAll() {
  for (const k of Object.keys(variants)) delete variants[k];
  return refresh();
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
// The OS gate's verdict, computed SERVER-side (`EngineInfo.supported_on_this_os`)
// — never re-derived here, because the renderer can be a browser on a
// different machine than the server. False means `install_engine` refuses,
// so the row says why instead of offering a button that raises.
function osBlocked(e) { return e.supported_on_this_os === false; }
// Non-empty manifest DEPRECATED string = marked for removal; the string is the
// user-facing reason. Server-owned, never re-derived here.
function deprecated(e) { return (e.deprecated || "").trim(); }
function osBlockedTitle(e) {
  const list = (e.supported_oses || []).join(", ") || "no platforms";
  return `${e.name || e.id} declares support for ${list}, and this server is not running one of them. Installing it would fail.`;
}

// ── Install (engine venv) — kit job-channel task, row bar only. ───────
// No global task strip: that strip is the AI task panel, for runs that QUERY
// a model. Moving bytes and building an environment belongs on the row's
// DownloadBar, which is what the kit's own llama.cpp engine install does
// (`engineInstallChannel()` → `engineGateTask`) — see `runLoad` for the full
// note. The job task decides the OUTCOME by state, not by exception.
async function installEngine(engine) {
  const key = _engineKey(engine.id);
  clearTerminalTask(key);
  const task = makeEngineDownloadTask(api, engine.id, {});
  dlTasks[key] = task;
  try {
    await task.start();
    if (task.state !== "done") return;  // error/cancelled — the row's bar says which
    pushToast({ message: `${engine.name || engine.id} installed.`, kind: "success", duration: 4000 });
    delete variants[engine.id];
    await refresh();
    delete dlTasks[key]; delete taskKind[key]; // done bars are reaped (the LLM catalog's rule) — error/cancelled linger for Retry/Dismiss
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

  // ONE factory, shared with the Voices page (services/ttsJobChannel.js). It
  // used to be built inline here AND there, and both copies faked `start()`,
  // so the bar's Retry re-armed a poll over a stub instead of retrying the
  // load. `start()` is now the load request itself.
  const task = makeEngineLoadTask(api, engine.id, { model_variant: variantId || null });
  dlTasks[key] = task;
  taskKind[key] = "load";
  // NO global task strip (user ruling 2026-08-15). That strip is the AI task
  // panel — the kit opens it from ONE place, `services/aiFeature.js`, for
  // runs against `/v1/ai/run|stream`, i.e. QUERYING a model. The kit's own
  // LLM model load pointedly does not use it: `useRunnerModels.retryLoad`
  // drives a DownloadBar on the row and nothing else.
  //
  // Loading a speech model landed there by accident of history. It was on
  // JustVoice's own `renderTasks.js` ("Render-task store — any long-running
  // TTS operation"), and the 2026-08-07 task-queue conversion swept all 17
  // sites onto the kit's AI queue in one move — so a model load started
  // announcing itself in a queue built for model queries, on top of the row
  // it already owns. The row's DownloadBar (rendered from `taskRowsFor`)
  // carries progress, cancel and the error, exactly as it does for the LLM
  // catalog. Long TTS RENDER jobs keep their strip; that is what it is for.
  // The task announces `jv:health-refresh` itself now (see engineLoadChannel),
  // so a Retry from the row's bar reaches every surface too; this function no
  // longer dispatches it a second time.
  await task.start();
  if (task.state !== "done") return;   // error/cancelled — the row's bar says which, and offers Retry
  delete variants[engine.id];
  await refresh();
  pushToast({ message: `${engine.name || engine.id} loaded.`, kind: "success", duration: 4500 });
  delete dlTasks[key];
  delete taskKind[key];   // a later DOWNLOAD reuses this key; a stale "load" would mislabel its bar
}

async function unload(engine) {
  try {
    const resp = await api.request("/v1/engines/unload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: engine.kind || "tts" }),
    });
    // Announce like load (:330) and unloadKind (:620) — this door
    // refreshed only itself, so every other surface kept a stale copy
    // until an alt-tab (the 2026-08-20 finding).
    window.dispatchEvent(new Event("jv:health-refresh"));
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
    // Same words as the kit catalog's freeDownload confirm — the menu item and
    // the button that finishes the act must not say two different things.
    title: `Delete the downloaded model "${v.name}"?`,
    message: `Deletes its downloaded weights (${fmtDisk(v.size_mb)}) from disk. The engine stays; the model re-downloads on demand.`,
    danger: true, confirmLabel: "Delete downloaded model",
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
// reservations the same way vramFeed's hostCells does. Only the LOADED
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

// ── The three-dot menu's verbs (§6, family-aligned 2026-08-14: Re-download ·
// Open folder · View on Hugging Face · Delete downloaded model — the SAME
// words, in the same order, as the kit's LLM model catalog) ───────────
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
    await task.start();
    if (task.state !== "done") return;  // error/cancelled — the row's bar says which
    pushToast({ message: `${variantNameFor(engine.id, variantId)} downloaded.`, kind: "success", duration: 4000 });
    delete variants[engine.id];
    await refresh();
    delete dlTasks[key]; delete taskKind[key]; // done bars are reaped — the row itself now says "on disk"
  } catch {
    // The task row carries the error (failed lingers until dismissed).
  }
}

// Desktop-only: the SERVER resolved local_dir (speech cache / legacy HF
// cache / tarball dir), so the layout knowledge never leaks into the client.
// The OPENER is the kit's (configureExternal's openPath, wired once in
// main.js) — the same door the LLM catalog's Open folder uses, one
// implementation for the family. It was `window.__TAURI__.shell.open` here,
// which never fired: JV doesn't set `withGlobalTauri`, so that global is
// undefined even in the desktop app and this item only ever toasted.
function openModelFolder(v) {
  if (!openPath(v.local_dir)) {
    pushToast({ message: "Open folder requires the desktop app.", kind: "warning" });
  }
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
  // Marked for removal (manifest DEPRECATED, 2026-08-17). HIDE it while it is
  // uninstalled — nobody new should pick it up — but KEEP the row for anyone
  // who already installed it, badged with the reason, because the user's
  // ruling was "dont remove them now": their install must keep working and
  // must be able to say why it is going away. Search still finds it, so a
  // deliberate lookup is never a dead end.
  if (deprecated(e) && e.status === "not_installed" && !q.value.trim()) return false;
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
  refresh(); loadDefaults();
  unsubscribeVram = subscribeVramFeed();
  window.addEventListener("jv:health-refresh", refreshAll);
});
onBeforeUnmount(() => {
  window.removeEventListener("jv:health-refresh", refreshAll);
  if (unsubscribeVram) unsubscribeVram();
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

    <!-- The hardware card AND the memory budget strip both live ONCE per
         page, on the kit's top strip (user, 2026-08-14 for hardware;
         2026-08-15 one-strip consolidation for memory — AiView feeds this
         tab's old cells into AiModelsArea via services/vramFeed.js). What
         this tab keeps is the per-row measured hint and the rail below. -->

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
           measured redesign — the kit's top strip is the ONE memory
           surface (measured, provenance-tagged; fed by vramFeed.js). -->
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
            <!-- The OS gate (2026-08-17). Shown for ANY blocked engine, not
                 just venv ones: a shared engine has no Install button, its
                 door is the per-variant Download — so the badge has to carry
                 the explanation on its own. Listed rather than hidden, so a
                 Mac user learns MOSS-TTSD exists and why it is not
                 offered. -->
            <span v-if="!anyTaskRunning(e.id) && osBlocked(e)" class="ev-badge none"
              :title="osBlockedTitle(e)">not available on this OS · {{ (e.supported_oses || []).join(" · ") || "none" }}</span>
            <span v-if="!anyTaskRunning(e.id) && deprecated(e)" class="ev-badge none"
              :title="deprecated(e)">⚠ marked for removal</span>
            <span v-if="!anyTaskRunning(e.id) && !osBlocked(e) && engineNeedsInstall(e)" class="ev-badge none">engine not installed</span>
            <UiButton v-if="!anyTaskRunning(e.id) && !osBlocked(e) && engineNeedsInstall(e)" intent="primary" size="small"
              label="Install engine"
              title="One-time: builds the Python environment this engine runs in. Models download separately afterwards."
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
          <div v-for="v in visibleVariantsFor(e.id)" :key="v.id" class="ev-model" :class="{ dim: engineNeedsInstall(e) || osBlocked(e) }">
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
                :disabled="busyAnywhere(e.id, v.id) || engineNeedsInstall(e) || osBlocked(e)"
                :title="osBlocked(e) ? osBlockedTitle(e) : 'Download the model files. Load it from this row once it\'s on disk.'"
                @click="downloadOnly(e, v.id)" />
              <UiButton v-if="!modelLoaded(e, v) && modelOnDisk(e, v)" intent="primary" size="small"
                label="Load model"
                :disabled="busyAnywhere(e.id, v.id) || engineNeedsInstall(e) || osBlocked(e)"
                :title="osBlocked(e) ? osBlockedTitle(e) : `Load into the ${(e.kind || 'tts').toUpperCase()} slot`"
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
                        @select="deleteModel(e, v)">Delete downloaded model</DropdownMenuItem>
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
            :done-label="taskKind[row.key] === 'load' ? 'Loaded' : ''"
            :task="row.task" />

          <!-- The Device select (Q2, decided): a real setting the ONE load
               door resolves — auto follows the engine's cpu_adequate fact,
               an explicit choice always wins. The engine's hidden torch
               "auto" (greedy-cuda) no longer decides anything. -->
          <div class="ev-gfoot">
            Device
            <UiSelect :modelValue="deviceOverrides[e.id] || 'auto'" width="name"
              :options="deviceOptionsFor(e)"
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
