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
  OBLIGATION when one applies), per-variant delete, and the folder-tab pair
  itself (Engines' approved mock v7). The fit dots died 2026-08-14 with the
  invented per-variant vram_mb column.

  Since the 2026-10-01 switch every engine here runs in the ONE speech runtime
  (audio.cpp): the runtime row at the top installs it and picks its backend;
  the per-engine Install, Device select and environment Uninstall went with
  the per-engine Python environments.

  CPU placement (2026-10-02, docs/plans/2026-10-02-cpu-placement.md §8): every model
  runs on the graphics card or the CPU — Auto / GPU / CPU on its own line under the
  model, which says where it runs (or would load) and why; the runtime row sets the CPU
  process's threads. An engine with its own terms (Pocket TTS) says on its foot whether
  they are accepted, and opens them (services/engineTerms.js).
-->
<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { useApi } from "../stores/api.js";
import { DownloadBar, UiButton, confirmDialog, fmtBytes, languageName, openExternal, openPath, promptDialog, pushToast } from "@delebash/llm-ui";
import { makeEngineDownloadTask, makeEngineLoadTask, makeJobDownloadTask } from "../services/ttsJobChannel.js";
import { setDefaultVariant as setEngineDefault } from "../services/engineDefaults.js";
// The row's three-dot menu — reka-ui's DropdownMenu, the same import shape
// as the kit's LuModelCatalog (the portal escapes the group's overflow clip).
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuPortal,
  DropdownMenuRoot, DropdownMenuSeparator, DropdownMenuTrigger,
} from "reka-ui";

import SpeechProvidersPanel from "./SpeechProvidersPanel.vue";
import { UiNumber, UiSelect } from "@delebash/llm-ui";
import { openEngineTerms } from "../services/engineTerms.js";

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
    // The one door, shared with the persona page's Version choice (2026-10-05).
    await setEngineDefault(api, engine.id, variantId);
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
  // tabs of this console). Managed only: external providers (cloud and the
  // servers you run) list on SpeechProvidersPanel with their own verbs — here
  // they used to get an Install that 404'd and a Device select that did nothing.
  engines.value = (e?.engines ?? []).filter(
    (x) => ["tts", "stt"].includes(x.kind || "tts") && x.backend === "managed");
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
  return Promise.all([refresh(), refreshRuntime()]);
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
// "not installed" means the shared speech runtime is missing — its install
// lives on the runtime row, not on the engine (the 2026-10-01 switch).
function engineNeedsInstall(e) { return e.status === "not_installed"; }

// ── The speech runtime (docs/plans/2026-10-01-audiocpp-switch.md §3.1) ──
// ONE audio.cpp program runs every engine on this tab: its
// version, the build this machine runs (CUDA, Vulkan, CPU, Metal), and the
// GPU. Installing it is any engine's install job (the server installs
// the runtime once for all of them); changing the backend or GPU is
// PUT /v1/speech-runtime, which frees the speech slots and stops the server
// so the next load starts the chosen build. Under `npm run dev` the runtime is
// our audio.cpp checkout's own build (`dev_source` names the checkout): its
// version is "dev · <commit>", there is no update, and its backend is fixed
// when it is built (docs/dev/TASKS.md, "`npm run dev` always runs the latest
// audio.cpp", D4).
const runtime = ref(null);
const RUNTIME_KEY = "__speech-runtime";
const BACKEND_LABELS = { cuda: "CUDA (NVIDIA)", vulkan: "Vulkan", cpu: "CPU", metal: "Metal (Apple GPU)" };
const backendOptions = computed(() => [
  { label: "Auto", value: "auto" },
  ...(runtime.value?.backends || []).map((b) => ({ label: BACKEND_LABELS[b] || b, value: b })),
]);
const gpuOptions = computed(() => (runtime.value?.gpus || []).map((name, i) => ({ label: `${i} · ${name}`, value: i })));
function runtimeSummary(r) {
  const parts = [BACKEND_LABELS[r.backend] || r.backend || "no build for this machine"];
  if (r.dev_source) parts.push(`development build from ${r.dev_source}`);
  else if (r.build && r.build !== r.backend) parts.push(r.build);
  if (r.installed) parts.push(r.running ? "running" : "stopped — starts on the first load");
  if (r.installed && r.cpu_running && r.backend !== "cpu") parts.push("CPU models running");
  return parts.join(" · ");
}
async function refreshRuntime() {
  runtime.value = await api.safeRequest("/v1/speech-runtime", null);
}
// Install, or — over an older pinned build — update: the same job (the server installs the
// pinned build and, after an update, stops the old processes so the next load starts it).
// `repair` downloads it again over the installed one — Reinstall, for a build that won't start
// or a file an antivirus took (audit 2026-10-04 §5 E6).
async function installRuntime(repair = false) {
  const first = engines.value[0];
  if (!first) return;
  if (repair) {
    const ok = await confirmDialog({
      title: "Reinstall the speech runtime?",
      message: "It downloads the speech runtime and eSpeak NG again and replaces the installed ones. "
        + "The speech models unload while it does; they load again on their next use.",
      confirmLabel: "Reinstall",
    });
    if (!ok) return;
  }
  const updateTo = runtime.value?.installed && !repair ? runtime.value.update_to : null;
  clearTerminalTask(RUNTIME_KEY);
  const task = makeEngineDownloadTask(api, first.id, repair ? { repair: true } : {});
  dlTasks[RUNTIME_KEY] = task;
  try {
    await task.start();
    if (task.state !== "done") return;  // error/cancelled — the bar says which
    pushToast({
      message: repair ? "Speech runtime reinstalled."
        : updateTo ? `Speech runtime updated to ${updateTo}.` : "Speech runtime installed.",
      kind: "success", duration: 4000,
    });
    if (updateTo || repair) window.dispatchEvent(new Event("jv:health-refresh"));  // the slots were freed
    for (const e of engines.value) delete variants[e.id];
    await Promise.all([refresh(), refreshRuntime()]);
    delete dlTasks[RUNTIME_KEY]; delete taskKind[RUNTIME_KEY];
  } catch {
    // The bar carries the error (failed lingers until dismissed).
  }
}
// The optional Japanese dictionary (gap 7, decided 2026-10-03): its own row under the runtime
// row, in the runtime row's grammar. Kokoro's Japanese voices and Chatterbox in Japanese read it;
// a Japanese line without it is refused with a message pointing here. Installing it restarts the
// speech runtime if it is running, so the next load reads it.
const JA_KEY = "__japanese-dictionary";
async function installJapaneseDictionary() {
  clearTerminalTask(JA_KEY);
  const task = makeJobDownloadTask(api, "/v1/speech-runtime/japanese-dictionary", {});
  dlTasks[JA_KEY] = task;
  try {
    await task.start();
    if (task.state !== "done") return;  // error/cancelled — the bar says which
    pushToast({ message: "Japanese dictionary installed.", kind: "success", duration: 4000 });
    window.dispatchEvent(new Event("jv:health-refresh"));  // the runtime restarted
    await refreshRuntime();
    delete dlTasks[JA_KEY]; delete taskKind[JA_KEY];
  } catch {
    // The bar carries the error (failed lingers until dismissed).
  }
}
async function setRuntime(patch) {
  const cur = runtime.value || {};
  try {
    runtime.value = await api.request("/v1/speech-runtime", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      // Every field this row shows, every time; the server keeps a field left out.
      body: JSON.stringify({
        backend: cur.backend_setting || "auto", gpu: cur.gpu || 0,
        cpu_threads: cur.cpu_threads || 0, cpu_min_realtime: cur.cpu_min_realtime || 2,
        ...patch,
      }),
    });
    // The slots were freed server-side — every surface re-reads.
    window.dispatchEvent(new Event("jv:health-refresh"));
    pushToast({
      message: "cpu_threads" in patch
        ? "CPU threads changed — models on the CPU use them from their next load."
        : runtime.value.installed
          ? "Speech runtime changed — the next load uses it."
          : "Saved. Install the speech runtime to use this build.",
      kind: "success",
    });
  } catch (e) {
    pushToast({ message: `Couldn't change the speech runtime: ${e?.message || e}`, kind: "error" });
  }
}
// The CPU process's threads: the field shows what it runs with; typing the physical
// core count back stores 0, so it keeps following this machine.
function setCpuThreads(n) {
  const v = Math.max(1, Math.round(Number(n) || 0));
  if (!runtime.value || v === runtime.value.cpu_threads_used) return;
  setRuntime({ cpu_threads: v === runtime.value.physical_cores ? 0 : v });
}

// ── Where each model runs (CPU placement, 2026-10-02) ──────────────────
// Auto / GPU / CPU per model; the server says where it runs — or where a load would
// put it now — and why. Changing a loaded model's place reloads it there.
const PLACEMENT_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "GPU", value: "gpu" },
  { label: "CPU", value: "cpu" },
];
const WHERE = { gpu: "the graphics card", cpu: "the CPU" };
function placeText(e, v) {
  const where = WHERE[v.runs_on] || v.runs_on;
  const verb = modelLoaded(e, v) ? "Running on" : "Loads on";
  return `${verb} ${where}${v.runs_on_reason ? ` — ${v.runs_on_reason}` : ""}`;
}
async function setPlacement(e, v, placement) {
  if (placement === v.placement) return;
  try {
    const r = await api.request(
      `/v1/engines/${encodeURIComponent(e.id)}/models/${encodeURIComponent(v.id)}/placement`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ placement }),
      });
    delete variants[e.id];
    await refresh();
    // A loaded model that would now run elsewhere moves: the load door unloads it and
    // loads it in its new place, on the row's own bar.
    if (r?.moves) await runLoad(e, v.id);
  } catch (err) {
    pushToast({ message: `Couldn't change where ${v.name} runs: ${err?.message || err}`, kind: "error" });
  }
}

// The speech runtime's per-model options (audit 2026-10-04 §13.5): saved per model. The
// runtime reads them at load, so the server unloads a loaded model whose options changed
// and it is loaded again here, on the row's own bar.
async function setRuntimeOption(e, v, key, value) {
  const cur = Object.fromEntries((v.runtime_options || []).map((o) => [o.key, o.value]));
  if (cur[key] === value) return;
  try {
    const r = await api.request(
      `/v1/engines/${encodeURIComponent(e.id)}/models/${encodeURIComponent(v.id)}/runtime-options`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ options: { ...cur, [key]: value } }),
      });
    delete variants[e.id];
    await refresh();
    if (r?.reload) await runLoad(e, v.id);
  } catch (err) {
    pushToast({ message: `Couldn't change ${v.name}'s options: ${err?.message || err}`, kind: "error" });
  }
}

// Delete every downloaded model of one engine — the engine-level removal
// now that there is no environment to uninstall (the runtime stays).
async function removeEngineModels(engine) {
  const ok = await confirmDialog({
    title: `Delete every downloaded ${engine.name || engine.id} model?`,
    message: "Deletes this engine's model files from disk. The speech runtime stays installed, and any model downloads again when you need it.",
    danger: true, confirmLabel: "Delete downloaded models",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/engines/${encodeURIComponent(engine.id)}`, { method: "DELETE" });
    delete variants[engine.id];
    window.dispatchEvent(new Event("jv:health-refresh"));
    await refresh();
    pushToast({ message: `${engine.name || engine.id} models deleted.`, kind: "success", duration: 4000 });
  } catch (e) {
    pushToast({ message: `Delete failed: ${e.message || e}`, kind: "error" });
  }
}
function anyOnDisk(e) { return variantsFor(e.id).some((v) => v.on_disk === true); }
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
  return ls.length === 1 ? languageName(ls[0]) || ls[0] : `${ls.length} languages`;
}
function langTitle(v) {
  return (v.languages || []).map((c) => languageName(c) || c).join(" · ");
}
// Weights-licence chip — the kit's use-limited warn pattern, retold
// honestly for JV: every bundled engine's weights permit commercial output
// (Higgs died for that in 2026-06), so a gold ⚠ means an OBLIGATION rides the
// licence (NOTICE.md has the authoritative copy). Pocket TTS (CC-BY-4.0,
// added 2026-10-02) carries one — a credit to Kyutai; TADA's "Built with
// Llama" left on 2026-10-01.
const PERMISSIVE_LICENSES = new Set(["mit", "apache-2.0", "bsd-2-clause", "bsd-3-clause"]);
function licenseWarn(v) {
  return !!v.weights_license && !PERMISSIVE_LICENSES.has(v.weights_license.toLowerCase());
}
function licenseTitle(v) {
  if (!v.weights_license) return "";
  if (!licenseWarn(v)) return `${v.weights_license} — permissive; publishing your generated audio commercially is fine.`;
  return `${v.weights_license} — commercial output is permitted, but an obligation rides this licence. See NOTICE.md.`;
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
  { id: "presets", label: "Built-in voices" },
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

onMounted(() => {
  refresh(); refreshRuntime(); loadDefaults();
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

    <!-- The speech runtime — ONE audio.cpp program runs every engine below
         (the 2026-10-01 switch). Same group grammar as an engine row: name ·
         id · description · status + the one verb on the head, settings on the
         foot. Install here replaces each engine's old Install. -->
    <div v-if="runtime && engines.length" class="ev-group">
      <div class="ev-ghead">
        <span class="nm">Speech runtime</span><span class="id">{{ runtime.runtime }} {{ runtime.version }}</span>
        <span class="desc" title="One program runs every speech model below — one install, one download per model">Runs every speech model below</span>
        <span class="gsum">
          <template v-if="dlTasks[RUNTIME_KEY]?.state !== 'running'">
            <span v-if="!runtime.installed" class="ev-badge none">not installed</span>
            <span class="meta">{{ runtimeSummary(runtime) }}</span>
            <UiButton v-if="!runtime.installed" intent="primary" size="small"
              label="Install speech runtime" :disabled="!runtime.backend"
              title="One-time: downloads the speech runtime for this machine. Models download separately."
              @click.stop="installRuntime()" />
            <UiButton v-else-if="runtime.update_to" intent="primary" size="small"
              :label="`Update to ${runtime.update_to}`"
              title="Downloads the newer speech runtime. The one installed keeps working until the download finishes; the speech models then load again on their next use."
              @click.stop="installRuntime()" />
            <UiButton v-else-if="!runtime.dev_source" intent="ghost" size="small" label="Reinstall"
              title="Downloads the speech runtime again and replaces the installed one — for a runtime that won't start. Your models stay."
              @click.stop="installRuntime(true)" />
          </template>
          <span v-else class="meta">working…</span>
        </span>
      </div>
      <DownloadBar v-if="dlTasks[RUNTIME_KEY]?.state" :task="dlTasks[RUNTIME_KEY]"
        :title="`Speech runtime · ${runtime.runtime} ${runtime.update_to || runtime.version}`" />
      <div class="ev-gfoot">
        Backend
        <UiSelect :modelValue="runtime.backend_setting || 'auto'" width="id"
          :options="backendOptions" :disabled="!!runtime.dev_source"
          :title="runtime.dev_source
            ? 'The development build runs. Its backend is the one it was built with.'
            : 'Which build of the runtime runs. Auto picks CUDA on NVIDIA, Vulkan on AMD and Intel, Metal on a Mac. Changing it unloads the speech models.'"
          @update:modelValue="(v) => setRuntime({ backend: v })" />
        <template v-if="gpuOptions.length > 1">
          GPU
          <UiSelect :modelValue="runtime.gpu || 0" width="name" :options="gpuOptions"
            title="Which GPU the runtime runs on. Changing it unloads the speech models."
            @update:modelValue="(v) => setRuntime({ gpu: Number(v) })" />
        </template>
        <template v-if="runtime.backend !== 'cpu'">
          CPU threads
          <UiNumber :modelValue="runtime.cpu_threads_used" :min="1" :step="1" size="small" width="token"
            :use-grouping="false"
            :title="`How many threads the models placed on the CPU compute with. This machine has ${runtime.physical_cores} cores; more threads, faster speech, up to that. Changing it reloads the models on the CPU.`"
            @update:modelValue="setCpuThreads" />
          <span>of {{ runtime.physical_cores }} cores</span>
        </template>
      </div>
    </div>

    <!-- The optional Japanese dictionary (gap 7) — precedent: the runtime row just above
         (.ev-group: name · version · description · status + the one verb, DownloadBar under). -->
    <div v-if="runtime && engines.length && runtime.japanese_dictionary" class="ev-group">
      <div class="ev-ghead">
        <span class="nm">Japanese dictionary</span><span class="id">UniDic {{ runtime.japanese_dictionary.version }}</span>
        <span class="desc" title="MeCab's UniDic dictionary — how the runtime reads Japanese text">For Kokoro's Japanese voices and Chatterbox in Japanese</span>
        <span class="gsum">
          <template v-if="dlTasks[JA_KEY]?.state !== 'running'">
            <span v-if="!runtime.japanese_dictionary.installed" class="ev-badge none">not installed</span>
            <span class="meta">{{ fmtBytes(runtime.japanese_dictionary.size_bytes) }}</span>
            <UiButton v-if="!runtime.japanese_dictionary.installed" intent="primary" size="small"
              label="Install" :disabled="!runtime.installed"
              :title="`Downloads ${fmtBytes(runtime.japanese_dictionary.download_bytes)} and unpacks it. The speech runtime restarts if it is running.`"
              @click.stop="installJapaneseDictionary" />
          </template>
          <span v-else class="meta">working…</span>
        </span>
      </div>
      <DownloadBar v-if="dlTasks[JA_KEY]?.state" :task="dlTasks[JA_KEY]"
        :title="`Japanese dictionary · UniDic ${runtime.japanese_dictionary.version}`" />
    </div>

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
          </span>
          <span class="desc" :title="e.description">{{ e.description }}</span>
          <span class="gsum">
            <span v-if="anyTaskRunning(e.id)" class="meta">working… · click to expand</span>
            <!-- The OS gate (2026-08-17): listed rather than hidden, so a
                 user learns the engine exists and why it is not offered. -->
            <span v-if="!anyTaskRunning(e.id) && osBlocked(e)" class="ev-badge none"
              :title="osBlockedTitle(e)">not available on this OS · {{ (e.supported_oses || []).join(" · ") || "none" }}</span>
            <span v-if="!anyTaskRunning(e.id) && deprecated(e)" class="ev-badge none"
              :title="deprecated(e)">⚠ marked for removal</span>
            <span v-if="!anyTaskRunning(e.id) && !osBlocked(e) && engineNeedsInstall(e)" class="ev-badge none"
              title="Install the speech runtime on the row above — it runs every engine here. Models can download first.">needs the speech runtime</span>
            <span v-if="!anyTaskRunning(e.id)" class="meta">{{ groupSummary(e) }}</span>
            <span v-if="!anyTaskRunning(e.id) && !engineNeedsInstall(e) && loadedVariantName(e)" class="ldd">● {{ loadedVariantName(e) }} loaded<template v-if="e.resolved_device"> · {{ e.resolved_device.toUpperCase() }}</template></span>
            <!-- Set-as-default (engine) — rightmost, the family position. -->
            <UiButton v-if="sec.id === 'tts'" :intent="defaultEngineId === e.id ? 'success' : 'secondary'" size="small"
              :label="defaultEngineId === e.id ? 'Default ✓' : 'Set as default'"
              title="Which engine new-voice flows and first-render auto-setup prefer"
              @click.stop="defaultEngineId === e.id ? null : setDefaultEngine(e)" />
          </span>
        </div>

        <div class="ev-gbody" v-if="isOpen(e)">
          <template v-for="v in visibleVariantsFor(e.id)" :key="v.id">
          <div class="ev-model" :class="{ dim: osBlocked(e) }">
            <span class="vn">{{ v.name }}</span>
            <!-- The facts chips (§6): languages · Cloning · Presets · N ·
                 licence — read straight off the ②c manifest facts the wire
                 serves; nothing here is typed twice. -->
            <span class="ev-vchips">
              <span v-if="langText(v)" class="ev-cap" :title="langTitle(v)">{{ langText(v) }}</span>
              <span v-if="v.voice_cloning === true" class="ev-cap clone"
                title="Clones a voice from a short clean sample">CLONING</span>
              <span v-if="v.preset_voices > 0" class="ev-cap presets"
                :title="`${v.preset_voices} built-in voices — no sample needed`">BUILT-IN · {{ v.preset_voices }}</span>
              <span v-if="v.weights_license" class="ev-lic" :class="{ 'ev-lic--warn': licenseWarn(v) }"
                :title="licenseTitle(v)"><template v-if="licenseWarn(v)">⚠ </template>{{ v.weights_license }}</span>
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
                :disabled="busyAnywhere(e.id, v.id) || osBlocked(e)"
                :title="osBlocked(e) ? osBlockedTitle(e) : 'Download the model files. Load it from this row once it\'s on disk.'"
                @click="downloadOnly(e, v.id)" />
              <UiButton v-if="!modelLoaded(e, v) && modelOnDisk(e, v)" intent="primary" size="small"
                label="Load model"
                :disabled="busyAnywhere(e.id, v.id) || engineNeedsInstall(e) || osBlocked(e)"
                :title="osBlocked(e) ? osBlockedTitle(e)
                  : engineNeedsInstall(e) ? 'Install the speech runtime first — the row at the top of this list'
                  : `Load into the ${(e.kind || 'tts').toUpperCase()} slot`"
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
          <!-- Where it runs (CPU placement, 2026-10-02): the choice, and the server's
               answer in words — visible, never only on hover. -->
          <div v-if="v.runs_on" class="ev-mplace" :class="{ dim: osBlocked(e) }" :data-variant="v.id">
            Runs on
            <UiSelect :modelValue="v.placement || 'auto'" width="token" size="small" :options="PLACEMENT_OPTIONS"
              :disabled="busyAnywhere(e.id, v.id) || osBlocked(e)"
              title="Auto picks from what was measured on this machine: the graphics card when nothing else is on it or the model fits beside the AI model, else the CPU when the model is fast enough there."
              @update:modelValue="(p) => setPlacement(e, v, p)" />
            <span class="ev-mplace__why">{{ placeText(e, v) }}</span>
          </div>
          <!-- The speech runtime's options for this model (audit 2026-10-04 §13.5): only
               those whose effect was measured; read when the model loads. -->
          <div v-if="v.runtime_options?.length" class="ev-mplace" :class="{ dim: osBlocked(e) }"
            :data-variant-options="v.id">
            <template v-for="o in v.runtime_options" :key="o.key">
              {{ o.label }}
              <UiSelect :modelValue="o.value" width="id" size="small" :options="o.choices"
                :title="o.hint"
                :disabled="busyAnywhere(e.id, v.id) || osBlocked(e)"
                @update:modelValue="(val) => setRuntimeOption(e, v, o.key, val)" />
            </template>
            <span class="ev-mplace__why">Read when the model loads — a change reloads it.</span>
          </div>
          </template>

          <!-- THE one download bar (kit DownloadBar over the kit task) — every
               install/download/load renders identically to the LLM side. -->
          <DownloadBar v-for="row in taskRowsFor(e.id)" :key="row.key"
            :title="row.variantId ? variantNameFor(e.id, row.variantId) : `${e.name || e.id} · engine setup`"
            :done-label="taskKind[row.key] === 'load' ? 'Loaded' : ''"
            :task="row.task" />

          <!-- No Device select: every model runs where the speech runtime
               runs (the Backend select on the runtime row). -->
          <div class="ev-gfoot" v-if="anyOnDisk(e) || e.terms">
            <template v-if="e.terms">
              <span v-if="e.terms_accepted">{{ e.terms.owner }}'s terms accepted — cloning is on</span>
              <template v-else>
                <span>Cloning waits until you accept {{ e.terms.owner }}'s terms</span>
                <UiButton intent="secondary" size="small" label="Read and accept"
                  @click="openEngineTerms(e.id)" />
              </template>
            </template>
            <UiButton v-if="anyOnDisk(e)" intent="ghost" size="small" label="Delete downloaded models" class="ev-danger ev-push-right"
              title="Delete every downloaded model of this engine — the speech runtime stays" @click="removeEngineModels(e)" />
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

    </template>
  </div>
</template>

<style scoped>
/* The .ev-* classes moved to styles.css with the parity batch (this tab and
   the TTS providers tab share them; scoped copies would drift). */
</style>
