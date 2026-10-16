<!-- SPDX-License-Identifier: MIT -->
<!--
  AI Settings · Speech engines, Local · free — the mock (dev only: #/mock/speech-engines). The
  real tab's template (components/SpeechEnginesTab.vue) with its classes and words, on
  services/mock/speechEnginesMock.js in place of the server: every engine and model audio.cpp's
  description gives, as the server lists them since the adoption plan's slice 4 (2026-10-16) —
  the seven engines described by our own files among them, built like every other; Chatterbox
  Turbo (built-in voice only) and Pocket TTS French (cloning only) with them. Licences, statuses,
  testing, memory, Runs on and its reasons, load options, the licence and terms prompts, a
  running download and a failed load are the app's own words and states; the machine (an 8 GB
  card, what is on disk, loaded, measured) is made up. Other states: ?ai (an AI model on the
  card), ?runtime=none (no speech runtime), ?empty (no engines).

  Not drawn: the AI console around the tab (its memory strip and tab strip), the Local · free /
  Online · metered tabs, and Self-hosted servers — the providers panel's own screen.
-->
<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute } from "vue-router";
import {
  AppModal, DownloadBar, UiButton, UiMenu, UiMenuItem, UiMenuSeparator, UiNumber, UiSelect, UiTable,
  confirmDialog, fmtBytes, languageName, openExternal, openPath, pushToast,
} from "@delebash/llm-ui";
import DeliveryKnobs from "../../components/DeliveryKnobs.vue";
import { COMMERCIAL_OPTIONS, COMMERCIAL_USE, SORTS, licClass, licTitle, memoryText, reading } from "../../services/engineFacts.js";
import { directionCell } from "../../services/personaFacts.js";
import { makeEngineDownloadTask, makeEngineLoadTask, makeJobDownloadTask } from "../../services/ttsJobChannel.js";
import { fmtDisk } from "../../services/vramFeed.js";
import {
  CARD_MB, SAFETY_MARGIN_MB, createState, mockApi, refreshPlacements, scenarioOf, unloadKind,
} from "../../services/mock/speechEnginesMock.js";

const route = useRoute();
const state = createState(scenarioOf(route.query));
const api = mockApi(state);
const engines = computed(() => state.engines);
const runtime = computed(() => state.runtime);

// The tab's own tables and words (SpeechEnginesTab.vue).
const PICKING_COLUMNS = [
  { id: "want", header: "If you want…", accessorKey: "want" },
  { id: "use", header: "Use", accessorKey: "use" },
  { id: "give", header: "What you give up", accessorKey: "give" },
];
const PICKING = [
  { want: "Ready-made voices, fast, on any machine", use: "Kokoro — 54 built-in voices, 9 languages", give: "No cloning and no written direction — pace, pitch, gain and pauses only" },
  { want: "English voices made for the CPU", use: "Kitten — 8 built-in voices", give: "English only; no cloning, no written direction; the same seed does not repeat the same audio" },
  { want: "Someone's own voice on a modest machine", use: "Pocket — cloning, 20 built-in voices", give: "One language per model; no written direction" },
  { want: "To direct performances in words", use: "Qwen3 CustomVoice — 9 built-in voices, 10 languages", give: "Cannot clone" },
  { want: "Someone's own voice, in 10 languages", use: "Qwen3 Base", give: "Written direction is dropped" },
  { want: "A voice designed from a description", use: "Qwen3 VoiceDesign", give: "—" },
  { want: "Someone's own voice, with per-line emotion tags", use: "Chatterbox Turbo or Nano — 19 tags", give: "English only; no written direction" },
  { want: "Someone's own voice in another language", use: "Chatterbox Multilingual — 23 languages", give: "No written direction, no tags" },
  { want: "Cloning, designing and written direction together", use: "VoxCPM2 — 30 languages", give: "The largest download (2.8 GB at 8-bit)" },
];
const whatFor = ref(false);
const FILTERS = [
  { id: "all", label: "All" }, { id: "tts", label: "TTS" }, { id: "stt", label: "STT" },
  { id: "cloning", label: "Cloning" }, { id: "presets", label: "Built-in voices" },
];
const SECTIONS = [
  { id: "tts", title: "Voice generation", suffix: "TTS", note: "one model loaded at a time — loading another swaps the TTS slot" },
  { id: "stt", title: "Transcription", suffix: "STT", note: "powers dictation, /v1/transcribe, and agent transcription" },
];
const PLACEMENT_OPTIONS = [
  { label: "Auto", value: "auto" },
  { label: "GPU", value: "gpu" },
  { label: "CPU", value: "cpu" },
];
const WHERE = { gpu: "the graphics card", cpu: "the CPU" };
const BACKEND_LABELS = { cuda: "CUDA (NVIDIA)", vulkan: "Vulkan", cpu: "CPU", metal: "Metal (Apple GPU)" };

// ── Tasks: the app's own channels on the mock's server ───────────────────
const dlTasks = reactive({});
const taskKind = reactive({});
const RUNTIME_KEY = "__speech-runtime";
const JA_KEY = "__japanese-dictionary";
const _variantKey = (engineId, variantId) => `${engineId}/${variantId}`;
function taskRowsFor(engineId) {
  const rows = [];
  const live = (k) => dlTasks[k]?.state;
  if (live(engineId)) rows.push({ key: engineId, variantId: null, task: dlTasks[engineId] });
  for (const k of Object.keys(dlTasks)) {
    if (k.startsWith(`${engineId}/`) && live(k)) rows.push({ key: k, variantId: k.slice(engineId.length + 1), task: dlTasks[k] });
  }
  return rows;
}
const anyTaskRunning = (engineId) => taskRowsFor(engineId).some((r) => r.task.state === "running");
const busyAnywhere = (engineId, variantId) =>
  dlTasks[engineId]?.state === "running" || (variantId && dlTasks[_variantKey(engineId, variantId)]?.state === "running");
function clearTerminalTask(key) {
  const t = dlTasks[key];
  if (t && t.state !== "running") { delete dlTasks[key]; delete taskKind[key]; }
}

// ── The engine and its models ──────────────────────────────────────────
const variantsFor = (engineId) => state.engines.find((e) => e.id === engineId)?.variants || [];
const variantNameFor = (engineId, variantId) => variantsFor(engineId).find((x) => x.id === variantId)?.name || variantId || engineId;
const isLoadedVariant = (e, variantId) => e.status === "loaded" && e.current_variant_id === variantId;
const modelLoaded = (e, v) => isLoadedVariant(e, v.id);
const modelOnDisk = (v) => v.on_disk === true;
const engineNeedsInstall = (e) => e.status === "not_installed";
const osBlocked = (e) => e.supported_on_this_os === false;
const deprecated = (e) => (e.deprecated || "").trim();
const anyOnDisk = (e) => e.variants.some((v) => v.on_disk === true);

function setDefaultEngine(e) {
  state.defaultEngineId = e.id;
  pushToast({ message: `${e.name || e.id} is now the default speech engine.`, kind: "success" });
}
function setDefaultVariant(e, variantId) {
  e.default_variant_id = variantId;
  pushToast({ message: `${variantNameFor(e.id, variantId)} is now ${e.name || e.id}'s default version.`, kind: "success" });
}

// A licence that gates downloads is asked for first; Pocket's terms gate cloning only.
const asking = ref(null);
const forDownload = computed(() => asking.value?.terms?.gates === "download");
function openEngineTerms(e) {
  if (e.terms_accepted) {
    const what = e.terms.gates === "download" ? `${e.name}'s licence` : `${e.terms.owner}'s terms for ${e.name}`;
    pushToast({ message: `You have already accepted ${what}.`, kind: "info" });
    return;
  }
  asking.value = e;
}
function acceptTerms() {
  const e = asking.value;
  e.terms_accepted = true;
  pushToast({ message: forDownload.value ? `${e.name}'s models can be downloaded now.` : `${e.name} can clone voices now.`, kind: "success" });
  asking.value = null;
}
function askLicenceFirst(e, variantId) {
  if (e.terms?.gates !== "download" || e.terms_accepted) return false;
  if (variantsFor(e.id).find((v) => v.id === variantId)?.on_disk === true) return false;
  openEngineTerms(e);
  return true;
}

async function runLoad(e, variantId) {
  if (askLicenceFirst(e, variantId || e.default_variant_id)) return;
  const key = _variantKey(e.id, variantId);
  clearTerminalTask(key);
  const task = makeEngineLoadTask(api, e.id, { model_variant: variantId || null });
  dlTasks[key] = task;
  taskKind[key] = "load";
  await task.start();
  if (task.state !== "done") return;
  pushToast({ message: `${e.name || e.id} loaded.`, kind: "success", duration: 4500 });
  delete dlTasks[key];
  delete taskKind[key];
}
function unload(e) {
  const prev = unloadKind(state, e.kind);
  pushToast({ message: prev ? `${prev.id} unloaded.` : "Nothing was loaded.", kind: prev ? "success" : "info", duration: 3500 });
}
async function downloadOnly(e, variantId, extra = {}) {
  if (askLicenceFirst(e, variantId)) return;
  const key = _variantKey(e.id, variantId);
  clearTerminalTask(key);
  const task = makeEngineDownloadTask(api, e.id, { model_variant: variantId, ...extra });
  dlTasks[key] = task;
  await task.start();
  if (task.state !== "done") return;
  pushToast({ message: `${variantNameFor(e.id, variantId)} downloaded.`, kind: "success", duration: 4000 });
  refreshPlacements(state);
  delete dlTasks[key];
  delete taskKind[key];
}
async function deleteModel(v) {
  const ok = await confirmDialog({
    title: `Delete the downloaded model "${v.name}"?`,
    message: `Deletes its downloaded weights (${fmtDisk(v.size_mb)}) from disk. The engine stays; the model re-downloads on demand.`,
    danger: true, confirmLabel: "Delete downloaded model",
  });
  if (!ok) return;
  v.on_disk = false;
  v.local_dir = null;
  pushToast({ message: `${v.name} deleted.`, kind: "success" });
}
async function redownload(e, v) {
  const ok = await confirmDialog({
    title: `Re-download ${v.name}?`,
    message: `Deletes the local files, then downloads fresh (${fmtDisk(v.size_mb)}). Use this when a download looks corrupted — models downloaded before the speech cache also move onto the new layout this way.`,
    confirmLabel: "Re-download",
  });
  if (!ok) return;
  v.on_disk = false;
  await downloadOnly(e, v.id);
}
async function removeEngineModels(e) {
  const ok = await confirmDialog({
    title: `Delete every downloaded ${e.name || e.id} model?`,
    message: "Deletes this engine's model files from disk. The speech runtime stays installed, and any model downloads again when you need it.",
    danger: true, confirmLabel: "Delete downloaded models",
  });
  if (!ok) return;
  for (const v of e.variants) if (!modelLoaded(e, v)) { v.on_disk = false; v.local_dir = null; }
  pushToast({ message: `${e.name || e.id} models deleted.`, kind: "success", duration: 4000 });
}
function openModelFolder(v) {
  if (!openPath(v.local_dir)) pushToast({ message: "Open folder requires the desktop app.", kind: "warning" });
}
const viewOnHf = (v) => openExternal(`https://huggingface.co/${v.hf_repo}`);

// ── Where each model runs ──────────────────────────────────────────────
function placeText(e, v) {
  const where = WHERE[v.runs_on] || v.runs_on;
  return `${modelLoaded(e, v) ? "Running on" : "Loads on"} ${where}${v.runs_on_reason ? ` — ${v.runs_on_reason}` : ""}`;
}
async function setPlacement(e, v, placement) {
  if (placement === v.placement) return;
  v.placement = placement;
  refreshPlacements(state);
  // A loaded model that would now run elsewhere is loaded again in its new place.
  if (modelLoaded(e, v)) await runLoad(e, v.id);
}
function tryCardAgain(v) {
  v.failed_on_card = false;
  refreshPlacements(state);
}

// ── Load options ───────────────────────────────────────────────────────
async function setRuntimeOption(e, v, key, value) {
  const o = v.runtime_options.find((x) => x.key === key);
  const next = value === null || value === undefined || value === "" ? o.default : String(value);
  if (o.value === next) return;
  o.value = next;
  if (modelLoaded(e, v)) await runLoad(e, v.id);
}
const rowOptions = (v) => v.runtime_options.filter((o) => o.featured && o.type === "choice");
const foldedOptions = (v) => v.runtime_options.filter((o) => !(o.featured && o.type === "choice"));
function optionTyped(o, value) {
  if (value === null || value === undefined) return null;
  if (o.type === "switch") return value === "true";
  if (o.type === "number") return Number(value);
  return value;
}
const optionKnobs = (v) =>
  foldedOptions(v).map((o) => ({
    key: o.key, label: o.label, hint: o.hint, type: o.type, box: true, min: o.min, max: o.max, step: 1,
    choices: o.choices.map((c) => c.value), neutral: optionTyped(o, o.default),
  }));
const optionValues = (v) =>
  Object.fromEntries(foldedOptions(v).filter((o) => o.value !== o.default).map((o) => [o.key, optionTyped(o, o.value)]));

// ── The speech runtime ─────────────────────────────────────────────────
const backendOptions = computed(() => [
  { label: "Auto", value: "auto" },
  ...runtime.value.backends.map((b) => ({ label: BACKEND_LABELS[b] || b, value: b })),
]);
const gpuOptions = computed(() => runtime.value.gpus.map((name, i) => ({ label: `${i} · ${name}`, value: i })));
function runtimeSummary(r) {
  const parts = [BACKEND_LABELS[r.backend] || r.backend || "no build for this machine"];
  if (r.dev_source) parts.push(`development build from ${r.dev_source}`);
  else if (r.build && r.build !== r.backend) parts.push(r.build);
  if (r.installed) parts.push(r.running ? "running" : "stopped — starts on the first load");
  if (r.installed && r.cpu_running && r.backend !== "cpu") parts.push("CPU models running");
  return parts.join(" · ");
}
async function installRuntime(repair = false) {
  const first = state.engines[0];
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
  clearTerminalTask(RUNTIME_KEY);
  const task = makeEngineDownloadTask(api, first.id, repair ? { repair: true } : {});
  dlTasks[RUNTIME_KEY] = task;
  await task.start();
  if (task.state !== "done") return;
  pushToast({ message: repair ? "Speech runtime reinstalled." : "Speech runtime installed.", kind: "success", duration: 4000 });
  if (repair) for (const k of ["tts", "stt"]) unloadKind(state, k);
  state.runtime.installed = true;
  state.runtime.running = false;
  for (const e of state.engines) if (e.status === "not_installed") e.status = "installed";
  refreshPlacements(state);
  delete dlTasks[RUNTIME_KEY];
}
async function installJapaneseDictionary() {
  clearTerminalTask(JA_KEY);
  const task = makeJobDownloadTask(api, "/v1/speech-runtime/japanese-dictionary", {});
  dlTasks[JA_KEY] = task;
  await task.start();
  if (task.state !== "done") return;
  pushToast({ message: "Japanese dictionary installed.", kind: "success", duration: 4000 });
  state.runtime.japanese_dictionary.installed = true;
  delete dlTasks[JA_KEY];
}
function setRuntime(patch) {
  Object.assign(state.runtime, patch);
  if ("cpu_threads" in patch) state.runtime.cpu_threads_used = patch.cpu_threads || state.runtime.physical_cores;
  if ("backend" in patch) {
    state.runtime.backend_setting = patch.backend;
    state.runtime.backend = patch.backend === "auto" ? "cuda" : patch.backend;
    for (const k of ["tts", "stt"]) unloadKind(state, k);
    state.runtime.running = false;
  }
  refreshPlacements(state);
  pushToast({
    message: "cpu_threads" in patch
      ? "CPU threads changed — models on the CPU use them from their next load."
      : state.runtime.installed ? "Speech runtime changed — the next load uses it." : "Saved. Install the speech runtime to use this build.",
    kind: "success",
  });
}
function setCpuThreads(n) {
  const v = Math.max(1, Math.round(Number(n) || 0));
  if (v === state.runtime.cpu_threads_used) return;
  setRuntime({ cpu_threads: v === state.runtime.physical_cores ? 0 : v });
}
function setSpillMb(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  if (v === state.runtime.spill_mb) return;
  setRuntime({ spill_mb: v });
}

// ── Facts → chips, memory ──────────────────────────────────────────────
function langText(v) {
  if (v.languages_note) return v.languages_note;
  const ls = v.languages || [];
  if (!ls.length) return "";
  return ls.length === 1 ? languageName(ls[0]) || ls[0] : `${ls.length} languages`;
}
const langTitle = (v) => (v.languages || []).map((c) => languageName(c) || c).join(" · ");
// The card the vram reading reports — none when the server doesn't answer (?empty), as the tab.
const cardMb = computed(() => (state.scenario.empty ? null : CARD_MB));
const memoryOf = (v) => memoryText({ measuredMb: v.measured_mb, needGb: v.need_gb, runsOn: v.runs_on }, cardMb.value, SAFETY_MARGIN_MB);
const fits = (v) => memoryOf(v).fits === true;
const directed = (v) => v.directed_by === "words" || v.directed_by === "tags";
function measuredHint(e, v) {
  if (!isLoadedVariant(e, v.id)) return null;
  if ((e.resolved_device || "").toLowerCase() === "cpu") return null;
  const slot = state.loaded[e.kind];
  if (!slot?.mb) return { text: "not measured yet", title: "First load on this machine — JustVoice books the real measured footprint as soon as a probe lands" };
  return { text: `${fmtDisk(slot.mb)} measured`, title: "Measured on this machine at load" };
}

// ── Search, filters, sections ──────────────────────────────────────────
const q = ref("");
const filterId = ref("all");
const commercial = ref("all");
const onlyTested = ref(false);
const onlyDirected = ref(false);
const onlyFits = ref(false);
const sortBy = ref("name");
function variantMatchesFilter(v) {
  if (filterId.value === "cloning" && v.voice_cloning !== true) return false;
  if (filterId.value === "presets" && !((v.preset_voices || 0) > 0)) return false;
  if (onlyDirected.value && !directed(v)) return false;
  if (onlyFits.value && !fits(v)) return false;
  return true;
}
const modelFiltered = () => filterId.value === "cloning" || filterId.value === "presets" || onlyDirected.value || onlyFits.value;
function clearFilters() {
  q.value = "";
  filterId.value = "all";
  commercial.value = "all";
  onlyTested.value = onlyDirected.value = onlyFits.value = false;
}
const visibleVariantsFor = (engineId) => variantsFor(engineId).filter(variantMatchesFilter);
// Opened as if clicked: engines whose rows show this slice's states.
const expanded = reactive({ pocket: true, chatterbox: true, qwen3: true, cosyvoice3: true, moss_ttsd: true, omnivoice: true });
const engineCaps = (e) => (e.kinds?.length ? e.kinds : [e.kind || "tts"]);
function searchBlob(e) {
  const vs = e.variants.map((v) => `${v.name} ${v.description || ""}`).join(" ");
  return `${e.name} ${e.id} ${e.description || ""} ${vs}`.toLowerCase();
}
function engineVisible(e, sectionId) {
  if (engineCaps(e)[0] !== sectionId) return false;
  if (deprecated(e) && e.status === "not_installed" && !q.value.trim()) return false;
  const f = filterId.value;
  if ((f === "tts" || f === "stt") && !engineCaps(e).includes(f)) return false;
  if (modelFiltered() && !visibleVariantsFor(e.id).length) return false;
  if (commercial.value !== "all" && e.licence?.commercial !== commercial.value) return false;
  if (onlyTested.value && !e.tested) return false;
  if (q.value.trim() && !searchBlob(e).includes(q.value.trim().toLowerCase())) return false;
  return true;
}
function smallest(e, key) {
  if (!e.variants.length) return Number.POSITIVE_INFINITY;
  return Math.min(...e.variants.map((v) => (key === "size" ? v.size_mb : (memoryOf(v).gb ?? Number.POSITIVE_INFINITY))));
}
const ORDER = {
  name: (a, b) => (a.name || a.id).localeCompare(b.name || b.id),
  size: (a, b) => smallest(a, "size") - smallest(b, "size"),
  memory: (a, b) => smallest(a, "memory") - smallest(b, "memory"),
  commercial: (a, b) => COMMERCIAL_USE.indexOf(a.licence?.commercial ?? "Unclear") - COMMERCIAL_USE.indexOf(b.licence?.commercial ?? "Unclear"),
};
const sectionData = computed(() =>
  SECTIONS.map((s) => {
    const list = state.engines.filter((e) => engineVisible(e, s.id));
    list.sort((a, b) => ORDER[sortBy.value](a, b) || ORDER.name(a, b));
    const all = state.engines.filter((e) => engineCaps(e)[0] === s.id);
    const modelCount = all.reduce((n, e) => n + e.variants.length, 0);
    return { ...s, engines: list, engineCount: all.length, modelCount };
  }).filter((s) => s.engineCount > 0),
);
const nothingShown = computed(() => state.engines.length > 0 && sectionData.value.every((s) => !s.engines.length));
function isOpen(e) {
  if (expanded[e.id] !== undefined) return expanded[e.id];
  if (q.value.trim() || modelFiltered()) return true;
  return e.status === "loaded" || anyTaskRunning(e.id);
}
const toggleOpen = (e) => { expanded[e.id] = !isOpen(e); };
function groupSummary(e) {
  const onDisk = e.variants.filter((v) => v.on_disk === true).length;
  return `${e.variants.length} model${e.variants.length === 1 ? "" : "s"} · ${onDisk ? `${onDisk} on disk` : "none on disk"}`;
}
function loadedVariantName(e) {
  if (e.status !== "loaded") return null;
  return e.variants.find((x) => x.id === e.current_variant_id)?.name || e.current_variant_id || e.name;
}
const rail = computed(() => {
  const out = {};
  for (const k of ["tts", "stt"]) {
    const e = state.engines.find((x) => x.status === "loaded" && (x.kind || "tts") === k);
    out[k] = e ? { engine: e, model: loadedVariantName(e) } : null;
  }
  return out;
});

// The states a visit lands on: a download under way (Parakeet), and a load the memory check
// refused (MOSS-TTSD on the CPU) — its bar stays with Retry and Dismiss.
onMounted(() => {
  if (!state.runtime.installed || !state.engines.length) return;
  const parakeet = state.engines.find((e) => e.id === "parakeet_tdt");
  if (parakeet) void downloadOnly(parakeet, "parakeet_tdt-q8", { slow: true });
  const moss = state.engines.find((e) => e.id === "moss_ttsd");
  if (moss) void runLoad(moss, "moss_ttsd-q8");
});
</script>

<template>
  <div class="mock-engines">
    <div class="ev-toprow">
      <div class="jv-searchbar">
        🔍 <input v-model="q" placeholder="Search speech models and engines…" title="Filters engines and models; matching groups auto-expand">
      </div>
      <div class="ev-chips">
        <button v-for="f in FILTERS" :key="f.id" type="button" class="ev-chip" :class="{ on: filterId === f.id }" @click="filterId = f.id">{{ f.label }}</button>
      </div>
    </div>
    <div class="ev-toprow">
      <UiSelect v-model="commercial" :options="COMMERCIAL_OPTIONS" width="name" aria-label="Commercial use" />
      <div class="ev-chips">
        <button type="button" class="ev-chip" :class="{ on: onlyTested }" @click="onlyTested = !onlyTested">Tested by JustVoice</button>
        <button type="button" class="ev-chip" :class="{ on: onlyDirected }" @click="onlyDirected = !onlyDirected">Takes direction</button>
        <button v-if="cardMb" type="button" class="ev-chip" :class="{ on: onlyFits }" @click="onlyFits = !onlyFits">Fits this card</button>
      </div>
      <UiSelect v-model="sortBy" :options="SORTS" width="name" aria-label="Sort" />
    </div>

    <div class="ev-rail">
      <div class="ev-rail-h">Loaded now</div>
      <div v-for="k in ['tts','stt']" :key="k" class="ev-slot" :class="{ empty: !rail[k] }">
        <span class="k">{{ k.toUpperCase() }}</span>
        <div v-if="rail[k]">
          <div class="nm">{{ rail[k].model || rail[k].engine.name }}</div>
          <div class="sub">{{ rail[k].engine.name }}</div>
        </div>
        <div v-else><div class="nm">— nothing loaded</div></div>
        <button v-if="rail[k]" type="button" class="ev-x" title="Free this slot — weights stay on disk" @click="unloadKind(state, k)">Unload</button>
      </div>
    </div>

    <p v-if="!engines.length" class="jv-banner jv-banner--warn">
      No engines listed — the server may not be running. Check <a href="#settings">Settings → Server</a>.
    </p>

    <div v-if="engines.length" class="ev-group">
      <div class="ev-ghead">
        <span class="nm">Speech runtime</span><span class="id">{{ runtime.runtime }} {{ runtime.version }}</span>
        <span class="desc" title="One program runs every speech model below — one install, one download per model">Runs every speech model below</span>
        <span class="gsum">
          <template v-if="dlTasks[RUNTIME_KEY]?.state !== 'running'">
            <span v-if="!runtime.installed" class="ev-badge none">not installed</span>
            <span class="meta">{{ runtimeSummary(runtime) }}</span>
            <UiButton v-if="!runtime.installed" intent="primary" size="small" label="Install speech runtime" :disabled="!runtime.backend"
              title="One-time: downloads the speech runtime for this machine. Models download separately." @click.stop="installRuntime()" />
            <UiButton v-else-if="!runtime.dev_source" intent="ghost" size="small" label="Reinstall"
              title="Downloads the speech runtime again and replaces the installed one — for a runtime that won't start. Your models stay."
              @click.stop="installRuntime(true)" />
          </template>
          <span v-else class="meta">working…</span>
        </span>
      </div>
      <DownloadBar v-if="dlTasks[RUNTIME_KEY]?.state" :task="dlTasks[RUNTIME_KEY]" :title="`Speech runtime · ${runtime.runtime} ${runtime.version}`" />
      <div class="ev-gfoot">
        Backend
        <UiSelect :modelValue="runtime.backend_setting || 'auto'" width="id" :options="backendOptions"
          title="Which build of the runtime runs. Auto picks CUDA on NVIDIA, Vulkan on AMD and Intel, Metal on a Mac. Changing it unloads the speech models."
          @update:modelValue="(v) => setRuntime({ backend: v })" />
        <template v-if="gpuOptions.length > 1">
          GPU
          <UiSelect :modelValue="runtime.gpu || 0" width="name" :options="gpuOptions"
            title="Which GPU the runtime runs on. Changing it unloads the speech models." @update:modelValue="(v) => setRuntime({ gpu: Number(v) })" />
        </template>
        <template v-if="runtime.backend !== 'cpu'">
          CPU threads
          <UiNumber :modelValue="runtime.cpu_threads_used" :min="1" :step="1" size="small" width="token" :use-grouping="false"
            :title="`How many threads the models placed on the CPU compute with. This machine has ${runtime.physical_cores} cores; more threads, faster speech, up to that. Changing it reloads the models on the CPU.`"
            @update:modelValue="setCpuThreads" />
          <span>of {{ runtime.physical_cores }} cores</span>
          <template v-if="runtime.spill_measured">
            Card overflow limit (MB)
            <UiNumber :modelValue="runtime.spill_mb" :min="0" :step="1" size="small" width="token" :use-grouping="false"
              title="A card load that puts more than this in the computer's memory counts as not fitting; Auto then runs the model on the CPU."
              @update:modelValue="setSpillMb" />
          </template>
        </template>
      </div>
    </div>

    <div v-if="engines.length && runtime.japanese_dictionary" class="ev-group">
      <div class="ev-ghead">
        <span class="nm">Japanese dictionary</span><span class="id">UniDic {{ runtime.japanese_dictionary.version }}</span>
        <span class="desc" title="MeCab's UniDic dictionary — how the runtime reads Japanese text">For Kokoro's Japanese voices and Chatterbox in Japanese</span>
        <span class="gsum">
          <template v-if="dlTasks[JA_KEY]?.state !== 'running'">
            <span v-if="!runtime.japanese_dictionary.installed" class="ev-badge none">not installed</span>
            <span class="meta">{{ fmtBytes(runtime.japanese_dictionary.size_bytes) }}</span>
            <UiButton v-if="!runtime.japanese_dictionary.installed" intent="primary" size="small" label="Install" :disabled="!runtime.installed"
              :title="`Downloads ${fmtBytes(runtime.japanese_dictionary.download_bytes)} and unpacks it. The speech runtime restarts if it is running.`"
              @click.stop="installJapaneseDictionary" />
          </template>
          <span v-else class="meta">working…</span>
        </span>
      </div>
      <DownloadBar v-if="dlTasks[JA_KEY]?.state" :task="dlTasks[JA_KEY]" :title="`Japanese dictionary · UniDic ${runtime.japanese_dictionary.version}`" />
    </div>

    <section v-if="engines.length" class="jv-card ev-picking">
      <div class="jv-card__header"><h3 class="jv-card__title">Picking an engine is picking what a voice can do</h3></div>
      <p class="jv-lede">
        A persona's voice brings its model, and the model decides what that persona can do on every line:
        whether it can clone someone's voice, and whether it takes written direction, tags, or only pace,
        pitch and gain.
      </p>
      <UiTable class="jv-table-look" :data="PICKING" :columns="PICKING_COLUMNS" />
    </section>

    <div v-if="nothingShown" class="jv-card ev-nomatch">
      <p class="jv-lede">No engines match these filters.</p>
      <UiButton intent="secondary" size="small" label="Clear filters" @click="clearFilters" />
    </div>

    <div v-for="sec in sectionData" :key="sec.id">
      <div class="ev-section-h">
        <h3>{{ sec.title }} <span class="suffix">— {{ sec.suffix }}</span></h3>
        <span class="count">{{ sec.engineCount }} engine{{ sec.engineCount === 1 ? '' : 's' }} · {{ sec.modelCount }} models</span>
        <span class="note">{{ sec.note }}</span>
        <UiButton v-if="sec.id === 'stt'" intent="ghost" size="small" label="What for?" @click="whatFor = !whatFor" />
      </div>
      <p v-if="sec.id === 'stt' && whatFor" class="jv-hint ev-whatfor">
        Speech recognition is not a voice — nothing here speaks. It turns speech into text: Captures'
        dictation, the words of a capture you clone a voice from (they fill in its transcript), and,
        for other apps, transcripts and caption timings.
      </p>

      <div v-for="e in sec.engines" :key="e.id" class="ev-group">
        <div class="ev-ghead" @click="toggleOpen(e)">
          <span class="chev" :class="{ open: isOpen(e) }">▶</span>
          <span class="nm">{{ e.name }}</span><span class="id">{{ e.id }}</span>
          <span class="ev-caps">
            <span v-for="c in engineCaps(e)" :key="c" class="ev-cap" :class="c">{{ c.toUpperCase() }}</span>
            <span v-if="e.licence" class="ev-lic" :class="licClass(e.licence.commercial)" :title="licTitle(e.licence)">Commercial use: {{ e.licence.commercial }}</span>
            <span class="ev-cap" :class="{ tested: e.tested }" :title="e.tested?.note || 'Works as audio.cpp describes it; JustVoice hasn\'t listened to it yet'">
              {{ e.tested ? 'TESTED BY JUSTVOICE' : 'NOT TESTED BY JUSTVOICE YET' }}
            </span>
          </span>
          <span class="desc" :title="e.description">{{ e.description }}</span>
          <span class="gsum">
            <span v-if="anyTaskRunning(e.id)" class="meta">working… · click to expand</span>
            <span v-if="!anyTaskRunning(e.id) && engineNeedsInstall(e)" class="ev-badge none"
              title="Install the speech runtime on the row above — it runs every engine here. Models can download first.">needs the speech runtime</span>
            <span v-if="!anyTaskRunning(e.id)" class="meta">{{ groupSummary(e) }}</span>
            <span v-if="!anyTaskRunning(e.id) && !engineNeedsInstall(e) && loadedVariantName(e)" class="ldd">● {{ loadedVariantName(e) }} loaded<template v-if="e.resolved_device"> · {{ e.resolved_device.toUpperCase() }}</template></span>
            <UiButton v-if="sec.id === 'tts'" :intent="state.defaultEngineId === e.id ? 'success' : 'secondary'" size="small"
              :label="state.defaultEngineId === e.id ? 'Default ✓' : 'Set as default'"
              title="Which engine new-voice flows and first-render auto-setup prefer"
              @click.stop="state.defaultEngineId === e.id ? null : setDefaultEngine(e)" />
          </span>
        </div>

        <div v-if="isOpen(e)" class="ev-gbody">
          <div v-if="e.best_for?.length || e.tested || e.licence" class="ev-gnote">
            <span v-if="e.best_for?.length">Best for: {{ e.best_for.join(" · ") }}</span>
            <span v-if="e.tested">Tested by JustVoice: {{ e.tested.note }}</span>
            <span v-if="e.licence">Commercial use: {{ e.licence.summary }}
              <span class="ev-gnote-src">({{ reading(e.licence) }}<template v-if="e.licence.url"> ·
                <a href="#" @click.prevent="openExternal(e.licence.url)">read it at its source</a></template>)</span></span>
          </div>
          <template v-for="v in visibleVariantsFor(e.id)" :key="v.id">
            <div class="ev-model" :class="{ dim: osBlocked(e) }">
              <span class="vn">{{ v.name }}</span>
              <span class="ev-vchips">
                <span v-if="langText(v)" class="ev-cap" :title="langTitle(v)">{{ langText(v) }}</span>
                <span v-if="v.voice_cloning === true" class="ev-cap clone" title="Clones a voice from a short clean sample">CLONING</span>
                <span v-if="v.preset_voices > 0" class="ev-cap presets" :title="`${v.preset_voices} built-in voices — no sample needed`">BUILT-IN · {{ v.preset_voices }}</span>
                <span v-if="v.directed_by" class="ev-cap" :class="{ directed: directionCell(v.directed_by).intent === 'success' }"
                  :title="directionCell(v.directed_by).title">{{ directionCell(v.directed_by).label.toUpperCase() }}</span>
                <span v-if="e.catalog_status" class="ev-cap" title="audio.cpp's own status for this model">{{ e.catalog_status.toUpperCase() }}</span>
              </span>
              <span class="vmeta">{{ fmtDisk(v.size_mb) }}<template v-if="v.on_disk === true"> · on disk</template></span>
              <span class="vdesc" :title="v.description">{{ v.description }}</span>
              <span class="right">
                <span v-if="modelLoaded(e, v)" class="ev-badge loaded">● Loaded</span>
                <span v-if="measuredHint(e, v)" class="ev-memhint" :title="measuredHint(e, v).title">{{ measuredHint(e, v).text }}</span>
                <span v-if="!modelLoaded(e, v)" class="ev-memhint"><span :class="{ 'jv-text-warn': memoryOf(v).warn }">{{ memoryOf(v).text }}</span></span>
                <UiButton v-if="modelLoaded(e, v)" intent="ghost" size="small" label="Unload model" title="Free the slot — weights stay on disk" @click="unload(e)" />
                <UiButton v-if="!modelLoaded(e, v) && !modelOnDisk(v)" intent="primary" size="small" :label="`Download (${fmtDisk(v.size_mb)})`"
                  :disabled="busyAnywhere(e.id, v.id) || osBlocked(e)"
                  title="Download the model files. Load it from this row once it's on disk." @click="downloadOnly(e, v.id)" />
                <UiButton v-if="!modelLoaded(e, v) && modelOnDisk(v)" intent="primary" size="small" label="Load model"
                  :disabled="busyAnywhere(e.id, v.id) || engineNeedsInstall(e) || osBlocked(e)"
                  :title="engineNeedsInstall(e) ? 'Install the speech runtime first — the row at the top of this list' : `Load into the ${(e.kind || 'tts').toUpperCase()} slot`"
                  @click="runLoad(e, v.id)" />
                <UiButton :intent="e.default_variant_id === v.id ? 'success' : 'secondary'" size="small"
                  :label="e.default_variant_id === v.id ? 'Default ✓' : 'Set as default'"
                  title="The version this engine loads when nothing picks one explicitly"
                  @click="e.default_variant_id === v.id ? null : setDefaultVariant(e, v.id)" />
                <UiMenu label="More actions" trigger-class="ev-kebab" content-class="ev-menu" align="end">
                  <template #trigger>⋯</template>
                  <UiMenuItem v-if="v.on_disk === true" class="ev-menu-item" :disabled="busyAnywhere(e.id, v.id) || modelLoaded(e, v)"
                    @select="redownload(e, v)">Re-download</UiMenuItem>
                  <UiMenuItem v-if="v.local_dir" class="ev-menu-item" @select="openModelFolder(v)">Open folder</UiMenuItem>
                  <UiMenuItem v-if="v.hf_repo" class="ev-menu-item" @select="viewOnHf(v)">View on Hugging Face</UiMenuItem>
                  <template v-if="v.on_disk === true && !modelLoaded(e, v)">
                    <UiMenuSeparator class="ev-menu-sep" />
                    <UiMenuItem class="ev-menu-item danger" @select="deleteModel(v)">Delete downloaded model</UiMenuItem>
                  </template>
                </UiMenu>
              </span>
            </div>
            <div v-if="v.runs_on" class="ev-mplace" :class="{ dim: osBlocked(e) }" :data-variant="v.id">
              Runs on
              <UiSelect :modelValue="v.placement || 'auto'" width="token" size="small" :options="PLACEMENT_OPTIONS"
                :disabled="busyAnywhere(e.id, v.id) || osBlocked(e)"
                title="Auto picks from what was measured on this machine: the graphics card when the model fits in its free memory or beside the AI model, else the CPU when the model is fast enough there."
                @update:modelValue="(p) => setPlacement(e, v, p)" />
              <span class="ev-mplace__why">{{ placeText(e, v) }}</span>
              <UiButton v-if="v.failed_on_card" intent="ghost" size="small" label="Try the card again"
                :disabled="busyAnywhere(e.id, v.id) || osBlocked(e)" @click="tryCardAgain(v)" />
            </div>
            <div v-if="rowOptions(v).length" class="ev-mplace" :class="{ dim: osBlocked(e) }" :data-variant-options="v.id">
              <template v-for="o in rowOptions(v)" :key="o.key">
                {{ o.label }}
                <UiSelect :modelValue="o.value" width="id" size="small" :options="o.choices" :title="o.hint"
                  :disabled="busyAnywhere(e.id, v.id) || osBlocked(e)"
                  @update:modelValue="(val) => setRuntimeOption(e, v, o.key, val)" />
              </template>
              <span class="ev-mplace__why">Read when the model loads — a change reloads it.</span>
            </div>
            <details v-if="foldedOptions(v).length" class="ev-mfold" :class="{ dim: osBlocked(e) }" :data-variant-load-options="v.id">
              <summary>Load options ({{ foldedOptions(v).length }})</summary>
              <p v-if="!rowOptions(v).length" class="ev-mplace__why">Read when the model loads — a change reloads it.</p>
              <DeliveryKnobs :knobs="optionKnobs(v)" :values="optionValues(v)" :pauses="[]"
                :disabled="busyAnywhere(e.id, v.id) || osBlocked(e)"
                @commit="(key, val) => setRuntimeOption(e, v, key, val)"
                @reset="(key) => setRuntimeOption(e, v, key, null)" />
            </details>
          </template>

          <DownloadBar v-for="row in taskRowsFor(e.id)" :key="row.key"
            :title="row.variantId ? variantNameFor(e.id, row.variantId) : `${e.name || e.id} · engine setup`"
            :done-label="taskKind[row.key] === 'load' ? 'Loaded' : ''" :task="row.task" />

          <div v-if="anyOnDisk(e) || e.terms" class="ev-gfoot">
            <template v-if="e.terms">
              <template v-if="e.terms.gates === 'download'">
                <span v-if="e.terms_accepted">Licence accepted — downloads are on</span>
                <span v-else>Downloads wait until you accept its licence ({{ e.terms.owner }})</span>
              </template>
              <span v-else-if="e.terms_accepted">{{ e.terms.owner }}'s terms accepted — cloning is on</span>
              <template v-if="!e.terms_accepted">
                <span v-if="e.terms.gates !== 'download'">Cloning waits until you accept {{ e.terms.owner }}'s terms</span>
                <UiButton intent="secondary" size="small" label="Read and accept" @click="openEngineTerms(e)" />
              </template>
            </template>
            <UiButton v-if="anyOnDisk(e)" intent="ghost" size="small" label="Delete downloaded models" class="ev-danger ev-push-right"
              title="Delete every downloaded model of this engine — the speech runtime stays" @click="removeEngineModels(e)" />
          </div>
        </div>
      </div>
    </div>

    <!-- The licence or terms prompt (components/EngineTermsDialog.vue's words). -->
    <AppModal v-if="asking" :eyebrow="forDownload ? `Before downloading ${asking.name}` : `Before cloning with ${asking.name}`"
      :title="asking.terms.title" max-width="620px" @close="asking = null">
      <p v-if="forDownload" class="mock-engines__lede">
        {{ asking.name }}'s licence isn't a plain yes for commercial use, so it's yours to read before
        you download the model. Here it is in plain words.
      </p>
      <p v-else class="mock-engines__lede">
        JustVoice downloads {{ asking.name }} from a copy that needs no sign-in.
        {{ asking.terms.owner }}, who made it, asks everyone who clones voices with it to accept these terms.
        Built-in voices need no acceptance.
      </p>
      <div class="jv-banner mock-engines__terms">{{ asking.terms.text }}</div>
      <p v-if="forDownload" class="jv-hint">
        {{ asking.terms.reading }}. The licence text at its source is what counts — you accept once, on this install.
        <a v-if="asking.terms.url" href="#" @click.prevent="openExternal(asking.terms.url)">Read the licence at its source</a>.
      </p>
      <p v-else class="jv-hint">
        You accept once, on this install.
        <a href="#" @click.prevent="openExternal(asking.terms.url)">Read them where {{ asking.terms.owner }} publishes them</a>.
      </p>
      <template #footer>
        <UiButton intent="ghost" label="Not now" @click="asking = null" />
        <span class="jv-spacer" />
        <UiButton intent="primary" :label="forDownload ? 'Accept the licence' : `Accept ${asking.terms.owner}'s terms`" @click="acceptTerms" />
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.mock-engines { padding: 4px 0 24px; }
.mock-engines__lede { margin: 0 0 12px; max-width: 62ch; }
.mock-engines__terms { white-space: pre-wrap; margin: 0 0 12px; max-width: 62ch; }
</style>
