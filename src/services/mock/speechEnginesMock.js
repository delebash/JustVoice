// SPDX-License-Identifier: MIT
// The Speech engines mock's server (#/mock/speech-engines, dev only) — production minus the
// plumbing (decided 2026-10-04: no server, no real downloads, no persistence).
//
// What the server says about every engine and model — its name, description, licence in plain
// words, audio.cpp's status, testing, best for, terms, its downloads, languages, voices, cloning,
// design, how it is directed, its memory estimate and its load options — is the server's own
// answer, copied into speechEnginesSnapshot.json (/v1/engines and /v1/engines/{id}/models,
// computed from the code at the adoption plan's slice 4). Made up: this machine — an 8 GB card,
// which models are on disk, loaded, measured or remembered as failed on the card, which licences
// are accepted, and what other programs hold on the card. Where a model runs and why is the
// server's rule in the server's words (engines/manager.js `placementFor`), worked out here for
// that machine, so a pin, a load or "Try the card again" answers as the app does. A download or
// a load runs through the app's own task channels (services/ttsJobChannel.js) on `mockApi`, so
// its bar behaves as the app's: progress, Cancel, a failure with Retry and Dismiss.
//
// Other states, as query parameters (the Personas mock's `?empty`):
//   ?ai           an AI model holds 6.7 GB of the card — Auto's AI-model reasons;
//   ?runtime=none the speech runtime isn't installed — every engine "needs the speech runtime";
//   ?empty        the server answers no engines.

import { reactive } from "vue";
import SNAPSHOT from "./speechEnginesSnapshot.json";

/** This machine's graphics card: RTX 2070 SUPER, 8 GB. */
export const CARD_MB = 8192;
/** The kit's default safety margin (DEFAULT_SAFETY_MARGIN_MB; /v1/engines/vram `safety_margin_mb`). */
export const SAFETY_MARGIN_MB = 1024;
/** Auto's bar for the CPU (`speech_runtime.cpu_min_realtime`). */
const CPU_MIN_REALTIME = 2;
/** The AI model on the card under `?ai` (Gemma 4 26B-A4B QAT measured 6,844 MB — RESEARCH §2.2). */
const AI_MODEL_MB = 6844;

// ── The machine's made-up state, per model ───────────────────────────────────
// on_disk · measured_mb (an earlier card load here) · cpu_here (a CPU speed measured here) ·
// placement (the user's pin) · failed_on_card · runtime option values set.
const ON_DISK = new Set([
  "kokoro-82m-q8", "kitten-mini-0.8", "pocket-en-q8", "qwen3-cv-1.7b-q8", "qwen3-vd-1.7b-q8",
  "chatterbox-multilingual-v2-q8", "chatterbox-turbo-q8", "chatterbox-nano-q8", "voxcpm2-q8",
  "qwen3-asr-1.7b-q8", "cosyvoice3-q8", "index_tts2-indextts25-q8", "moss_ttsd-q8",
]);
const MEASURED_MB = { "kokoro-82m-q8": 612, "qwen3-cv-1.7b-q8": 4057, "qwen3-vd-1.7b-q8": 7300 };
const CPU_HERE = { "kokoro-82m-q8": 3.2, "pocket-en-q8": 4.1 };
const PINNED = { "kitten-mini-0.8": "cpu", "chatterbox-nano-q8": "cpu" };
const FAILED_ON_CARD = new Set(["cosyvoice3-q8"]);
const OPTIONS_SET = { "qwen3-cv-1.7b-q8": { "qwen3_tts.perf_mode": "flash_attention" } };
const ACCEPTED = new Set(["index_tts2"]);
// Loaded now: Kokoro in the speech slot, Qwen3-ASR in the recognition slot.
const LOADED = { tts: ["kokoro", "kokoro-82m-q8"], stt: ["asr", "qwen3-asr-1.7b-q8"] };

/** The scenario the query asks for. */
export function scenarioOf(query = {}) {
  return {
    aiOnCard: query.ai !== undefined,
    runtimeInstalled: query.runtime !== "none",
    empty: query.empty !== undefined,
    // What other programs hold on the card (a game, a browser): JustVoice's own idle processes
    // alone under `?ai`, else 2.5 GB.
    othersMb: query.ai !== undefined ? 200 : 2560,
  };
}

const gbWords = (v) => (v < 10 ? String(Math.round(v * 10) / 10) : String(Math.round(v)));
const xWords = (v) => (v < 10 ? `${v.toFixed(1)}×` : `${v.toFixed(0)}×`);

/** A model's CPU speed: measured here, else the reference machine's — [x, here]. */
function cpuSpeed(v) {
  if (v.cpu_here) return [v.cpu_here, true];
  return v.cpu_realtime ? [v.cpu_realtime, false] : [null, false];
}

/**
 * Where a load of this model goes now, and why — `placementFor` (engines/manager.js), its order
 * and its words, for this machine. → [runsOn, why].
 */
export function placementFor(state, engine, v) {
  const sc = state.scenario;
  if (state.runtime.backend === "cpu") return ["cpu", "this machine's speech runtime is the CPU build"];
  const [x, here] = cpuSpeed(v);
  const speed = x ? `${xWords(x)} real time ${here ? "here" : "on the reference machine"}` : "";
  const slow = speed || "this may be slow on the CPU";
  if (v.placement === "gpu") return ["gpu", "your choice"];
  if (v.placement === "cpu") return ["cpu", `your choice${speed ? ` — ${speed}` : ""}`];
  const prior = v.measured_mb || 0;
  const card = CARD_MB;
  const margin = SAFETY_MARGIN_MB;
  if (v.failed_on_card) return ["cpu", `it didn't load on the graphics card — ${slow}`];
  if (prior && prior + margin > card) {
    return ["cpu", `it took about ${gbWords(prior / 1024)} GB on this card before, more than it holds with the ${gbWords(margin / 1024)} GB safety margin — ${slow}`];
  }
  const need = v.need_gb ? { gb: v.need_gb, by: v.need_gb > (v.min_vram_gb || 0) ? "files" : "estimate" } : null;
  const files = v.size_mb / 1024;
  let cardFirst = "";
  if (need && !prior && need.gb * 1024 > card) {
    if (need.by === "estimate" && files * 1024 + margin <= card) {
      cardFirst = `audio.cpp says it needs about ${need.gb} GB, but its files are about ${gbWords(files)} GB, so it tries the graphics card first; if it doesn't fit, Load runs it on the CPU`;
    } else {
      const why = need.by === "files"
        ? `its files are about ${Math.round(need.gb)} GB, more than this card's ${Math.round(card / 1024)} GB`
        : `audio.cpp says it needs about ${need.gb} GB, more than this card's ${Math.round(card / 1024)} GB`;
      return ["cpu", `${why} — ${slow}`];
    }
  }
  let size = prior || null;
  if (size === null && need) size = (cardFirst ? files : need.gb) * 1024;
  const others = size !== null && size + margin <= card ? sc.othersMb : null;
  if (others !== null && !prior && !cardFirst && need?.by === "estimate" && size + margin + others > card) {
    if (files * 1024 + margin + others <= card) {
      cardFirst = `audio.cpp says it needs about ${need.gb} GB, but its files are about ${gbWords(files)} GB, so it tries the graphics card first; if it doesn't fit, Load runs it on the CPU`;
      size = files * 1024;
    }
  }
  if (others !== null && size + margin + others > card) {
    return ["cpu", `other programs are using about ${gbWords(others / 1024)} GB of the graphics card — ${slow}`];
  }
  const unchecked = size === null || (size + margin <= card && others === null);
  const fits = others !== null ? "it fits in the card's free memory" : unchecked ? "memory not measured yet" : "";
  if (!sc.aiOnCard) return ["gpu", cardFirst || fits];
  // Beside the AI model (`_freeCardMb`): the card less what is on it — the AI model, other
  // programs, each slot's model on the card — and the safety margin, plus what this kind's
  // occupant gives back when it is another engine.
  let free = card - AI_MODEL_MB - sc.othersMb - margin;
  for (const [kind, slot] of Object.entries(state.loaded)) {
    if (!slot || slot.device === "cpu") continue;
    free -= slot.mb;
    if (kind === engine.kind && slot.engineId !== engine.id) free += slot.mb;
  }
  if (prior && prior <= free) return ["gpu", `it fits beside the AI model (${prior} MB)`];
  if (x !== null && x >= CPU_MIN_REALTIME) return ["cpu", `${speed}, which keeps the graphics card for the AI model`];
  const slowWords = x ? `only ${speed} on the CPU` : "it has no usable speed on the CPU";
  return ["gpu", cardFirst || `${slowWords}, so the AI model makes room`];
}

/** Every not-loaded model's Runs on line, after anything that changes it. */
export function refreshPlacements(state) {
  for (const e of state.engines) {
    for (const v of e.variants) {
      if (state.isLoaded(e, v)) continue;
      [v.runs_on, v.runs_on_reason] = placementFor(state, e, v);
    }
  }
}

/** A model's load options at the values set — the server's `runtime_options` (RuntimeOption). */
function optionsOf(v) {
  const set = OPTIONS_SET[v.id] || {};
  return SNAPSHOT.load_option_sets[v.runtime_options].map((o) => ({ ...o, value: set[o.key] ?? o.value }));
}

/** The mock's server state, reactive: the engines with their models, the runtime row, the slots. */
export function createState(scenario) {
  const state = reactive({
    scenario,
    defaultEngineId: "kokoro",
    // The kind → {engineId, variantId, device, mb} of each slot.
    loaded: { tts: null, stt: null },
    runtime: {
      runtime: "audio.cpp",
      version: "v0.9.0-jv.5",
      installed: scenario.runtimeInstalled,
      update_to: null,
      backend: "cuda",
      build: "cuda12",
      dev_source: null,
      backend_setting: "auto",
      backends: ["cuda", "vulkan", "cpu"],
      gpu: 0,
      gpus: ["NVIDIA GeForce RTX 2070 SUPER"],
      running: scenario.runtimeInstalled,
      cpu_threads: 0,
      cpu_threads_used: 8,
      physical_cores: 8,
      cpu_min_realtime: CPU_MIN_REALTIME,
      spill_mb: 256,
      spill_measured: true,
      cpu_running: scenario.runtimeInstalled,
      japanese_dictionary: { installed: false, version: "1.0.8", size_bytes: 260_467_176, download_bytes: 47_356_746 },
    },
    engines: scenario.empty ? [] : SNAPSHOT.engines.map((e) => ({
      ...e,
      status: scenario.runtimeInstalled ? "installed" : "not_installed",
      current_variant_id: null,
      resolved_device: null,
      terms_accepted: ACCEPTED.has(e.id),
      variants: e.variants.map((v) => ({
        ...v,
        on_disk: ON_DISK.has(v.id),
        local_dir: ON_DISK.has(v.id) ? `C:\\JustVoice\\data\\speech-cache\\${e.id}\\${v.id}` : null,
        placement: PINNED[v.id] ?? "auto",
        measured_mb: MEASURED_MB[v.id] ?? null,
        cpu_here: CPU_HERE[v.id] ?? null,
        failed_on_card: FAILED_ON_CARD.has(v.id),
        runtime_options: optionsOf(v),
        runs_on: null,
        runs_on_reason: "",
      })),
    })),
    isLoaded: (e, v) => e.status === "loaded" && e.current_variant_id === v.id,
  });
  if (scenario.runtimeInstalled && !scenario.empty) {
    for (const [kind, [engineId, variantId]] of Object.entries(LOADED)) loadNow(state, engineId, variantId, kind);
  }
  refreshPlacements(state);
  return state;
}

/** Load a model into its slot now, where Auto (or its pin) puts it — the reason it was given. */
export function loadNow(state, engineId, variantId, kind = null) {
  const e = state.engines.find((x) => x.id === engineId);
  const v = e.variants.find((x) => x.id === variantId);
  const slotKind = kind || e.kind;
  const prev = state.loaded[slotKind];
  if (prev) {
    const pe = state.engines.find((x) => x.id === prev.engineId);
    pe.status = "installed";
    pe.current_variant_id = null;
    pe.resolved_device = null;
  }
  const [runsOn, why] = placementFor(state, e, v);
  e.status = "loaded";
  e.current_variant_id = v.id;
  e.resolved_device = runsOn === "cpu" ? "cpu" : state.runtime.backend;
  v.on_disk = true;
  v.local_dir = `C:\\JustVoice\\data\\speech-cache\\${e.id}\\${v.id}`;
  v.runs_on = runsOn;
  v.runs_on_reason = why;
  // A first card load measures it (its warm-up); the CPU holds no card memory.
  if (runsOn !== "cpu" && !v.measured_mb) v.measured_mb = Math.round(v.size_mb * 1.4);
  state.loaded[slotKind] = { engineId: e.id, variantId: v.id, device: e.resolved_device, mb: runsOn === "cpu" ? 0 : v.measured_mb };
  refreshPlacements(state);
  return { engine: e, variant: v };
}

/** Free a slot (the files stay on disk). */
export function unloadKind(state, kind) {
  const slot = state.loaded[kind];
  if (!slot) return null;
  const e = state.engines.find((x) => x.id === slot.engineId);
  e.status = state.runtime.installed ? "installed" : "not_installed";
  e.current_variant_id = null;
  e.resolved_device = null;
  state.loaded[kind] = null;
  refreshPlacements(state);
  return e;
}

/**
 * The made-up server behind the app's own task channels (services/ttsJobChannel.js): an
 * install/download is a job polled at /v1/jobs/{id}; a load is one request. MOSS-TTSD's load on
 * the CPU is refused for memory, in the server's words (engines/manager.js, the memory check).
 */
export function mockApi(state) {
  const jobs = new Map();
  let seq = 0;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  return {
    async request(path, opts = {}) {
      const method = opts.method || "GET";
      const body = opts.body ? JSON.parse(opts.body) : {};
      let m = path.match(/^\/v1\/engines\/([^/]+)\/install$/);
      if (m && method === "POST") {
        const e = state.engines.find((x) => x.id === m[1]);
        const v = e.variants.find((x) => x.id === body.model_variant);
        const id = `job_${++seq}`;
        // A model's files at about 40 MB a second, or the runtime's.
        const total = v ? v.size_mb * 1024 * 1024 : 464 * 1024 * 1024;
        jobs.set(id, { phase: "downloading", bytes_downloaded: 0, bytes_total: total, started: Date.now(), engine: e, variant: v, speed: body.slow ? 6e5 : 4e7 });
        return { job_id: id };
      }
      if (path === "/v1/speech-runtime/japanese-dictionary" && method === "POST") {
        const id = `job_${++seq}`;
        const total = state.runtime.japanese_dictionary.download_bytes;
        jobs.set(id, { phase: "downloading", bytes_downloaded: 0, bytes_total: total, started: Date.now(), speed: 2e7 });
        return { job_id: id };
      }
      m = path.match(/^\/v1\/jobs\/(.+)$/);
      if (m) {
        const job = jobs.get(m[1]);
        if (method === "DELETE") {
          job.phase = "cancelled";
          return {};
        }
        if (job.phase === "cancelled") return { phase: "failed", error: "cancelled" };
        job.bytes_downloaded = Math.min(job.bytes_total, (Date.now() - job.started) * (job.speed / 1000));
        if (job.bytes_downloaded >= job.bytes_total) {
          job.phase = "completed";
          if (job.variant) {
            job.variant.on_disk = true;
            job.variant.local_dir = `C:\\JustVoice\\data\\speech-cache\\${job.engine.id}\\${job.variant.id}`;
          }
        }
        return { ...job, engine: undefined, variant: undefined };
      }
      m = path.match(/^\/v1\/engines\/([^/]+)\/load$/);
      if (m && method === "POST") {
        const e = state.engines.find((x) => x.id === m[1]);
        const v = e.variants.find((x) => x.id === body.model_variant);
        await wait(1500);
        const [runsOn] = placementFor(state, e, v);
        if (e.id === "moss_ttsd" && runsOn === "cpu") {
          throw new Error(
            "not enough memory to load MOSS-TTSD on the CPU: its files are about 12.1 GB (+1024 MB safety margin) " +
              "but only 9.6 GB of this machine's 32 GB is free. Close other programs, or pick a smaller model.",
          );
        }
        loadNow(state, e.id, v.id);
        return { engine_id: e.id };
      }
      if (path.match(/^\/v1\/engines\/[^/]+\/cancel-load$/)) return {};
      throw new Error(`the mock has no ${method} ${path}`);
    },
  };
}
