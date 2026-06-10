<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvTag from "../components/jv/JvTag.vue";

const api = useApi();
const tasks = useRenderTasks();
const engines = ref([]);
const system = ref(null);
const busy = ref({});

// Inline per-engine install progress: { [engineId]: { phase, bytes_downloaded, bytes_total, current_file, error, job_id } }
const progress = ref({});

// In-flight install job ids, so the Cancel button can target the right one.
const installJobs = ref({}); // { [engineId]: job_id }
// Last-known job id per engine (lives even after install completes / fails)
// so the "View log" button can still fetch the captured pip output.
const lastJobs = ref({}); // { [engineId]: job_id }

// Install log modal state.
const logModal = ref({ open: false, engineId: null, lines: [], status: "", error: null, busy: false });
let _logPollTimer = null;

// Per-engine model variants: { [engineId]: { variants: [...], recommended: {...} } }
const variants = ref({});

// Pretty labels for the runtimes dict ({ cuda: true, directml: true, ... }).
const RUNTIME_LABELS = {
  cuda: "CUDA",
  metal: "Metal",
  coreml: "CoreML",
  directml: "DirectML",
  rocm: "ROCm",
  mlx: "MLX",
  vulkan: "Vulkan",
  cpu: "CPU",
};

const activeRuntimes = computed(() => {
  const r = system.value?.runtimes || {};
  return Object.keys(RUNTIME_LABELS)
    .filter((k) => r[k])
    .map((k) => RUNTIME_LABELS[k]);
});

function fmtDisk(mb) {
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb + " MB";
}

function pct(p) {
  return p.bytes_total > 0 ? Math.min(100, Math.round(100 * p.bytes_downloaded / p.bytes_total)) : 0;
}

function dismiss(id) {
  const copy = { ...progress.value };
  delete copy[id];
  progress.value = copy;
}

async function refresh() {
  const e = await api.safeRequest("/v1/engines", { engines: [] });
  engines.value = e?.engines ?? [];
  // Eager-fetch model variants for every engine so the always-visible
  // model picker on each card populates without a per-card "Show
  // variants" toggle. Fire in parallel; failures (missing /models
  // endpoint for an external engine) are swallowed per-engine.
  await Promise.all(
    engines.value.map(async (eng) => {
      if (variants.value[eng.id]) return;
      try {
        const [models, recommended] = await Promise.all([
          api.request(`/v1/engines/${eng.id}/models`).catch(() => ({ variants: [] })),
          api.request(`/v1/engines/${eng.id}/models/recommended`).catch(() => ({})),
        ]);
        variants.value = { ...variants.value, [eng.id]: { variants: models.variants || [], recommended } };
      } catch { /* per-engine failure tolerated */ }
    }),
  );
}

async function loadSystem() {
  system.value = await api.safeRequest("/v1/system/info", null);
}

async function loadVariants(id) {
  // Toggle: if already loaded, hide; otherwise fetch.
  if (variants.value[id]) {
    hideVariants(id);
    return;
  }
  try {
    const [models, recommended] = await Promise.all([
      api.request(`/v1/engines/${id}/models`),
      api.request(`/v1/engines/${id}/models/recommended`),
    ]);
    variants.value = { ...variants.value, [id]: { variants: models.variants, recommended } };
  } catch (e) {
    pushToast({ message: `Could not load variants for ${id}: ${e.message || e}`, kind: "error" });
  }
}

function hideVariants(id) {
  const copy = { ...variants.value };
  delete copy[id];
  variants.value = copy;
}

async function install(id, variant) {
  busy.value[id] = "install";
  // Seed progress row immediately so the user sees it right away.
  progress.value = { ...progress.value, [id]: { phase: "connecting", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: null } };

  const task = tasks.start({
    label: `Installing · ${id}`,
    kind: "install",
    statsFn: (t) => {
      const s = [];
      if (t.meta?.phase) s.push(t.meta.phase);
      if (t.meta?.bytesTotal > 0) s.push(`${(t.meta.bytesDl / 1024 / 1024).toFixed(1)} / ${(t.meta.bytesTotal / 1024 / 1024).toFixed(1)} MB`);
      return s;
    },
  });
  try {
    const accepted = await api.request(`/v1/engines/${id}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(variant ? { model_variant: variant } : {}),
    });
    const jobId = accepted.job_id;
    installJobs.value = { ...installJobs.value, [id]: jobId };
    lastJobs.value = { ...lastJobs.value, [id]: jobId };
    while (true) {
      const job = await api.request(`/v1/jobs/${jobId}`);
      const pctVal = job.bytes_total > 0 ? Math.round(100 * (job.bytes_downloaded || 0) / job.bytes_total) : null;

      // Update inline progress row.
      progress.value = {
        ...progress.value,
        [id]: {
          phase: job.phase,
          bytes_downloaded: job.bytes_downloaded || 0,
          bytes_total: job.bytes_total || 0,
          current_file: job.current_file || null,
          error: job.error || null,
        },
      };

      // Update global task strip.
      tasks.update(task.id, {
        percent: pctVal,
        meta: {
          phase: job.phase,
          bytesDl: job.bytes_downloaded || 0,
          bytesTotal: job.bytes_total || 0,
        },
      });

      if (job.phase === "completed") {
        tasks.finish(task.id);
        pushToast({ message: `${id} installed. Click Load to use it.`, kind: "success", duration: 5000 });
        // Auto-clear progress row after 2.5s on success.
        setTimeout(() => {
          const copy = { ...progress.value };
          delete copy[id];
          progress.value = copy;
        }, 2500);
        break;
      }
      if (job.phase === "failed") {
        tasks.fail(task.id, job.error || "unknown error");
        pushToast({ message: `${id} install failed: ${job.error || "unknown"}`, kind: "error", duration: 8000 });
        // Leave progress[id] in place so the error row stays visible.
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    await refresh();
  } catch (e) {
    tasks.fail(task.id, String(e.message || e));
    pushToast({ message: `Install failed: ${e.message || e}`, kind: "error", duration: 8000 });
    progress.value = {
      ...progress.value,
      [id]: { phase: "failed", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: String(e.message || e) },
    };
  } finally {
    busy.value[id] = null;
    const copy = { ...installJobs.value };
    delete copy[id];
    installJobs.value = copy;
  }
}

// ── Install log viewer ───────────────────────────────────────────────
async function viewInstallLog(engineId) {
  const jobId = installJobs.value[engineId] || lastJobs.value[engineId];
  if (!jobId) {
    pushToast({ message: `No install log for ${engineId} — click Install first.`, kind: "info" });
    return;
  }
  logModal.value = {
    open: true,
    engineId,
    jobId,
    lines: [],
    status: "loading",
    error: null,
    busy: true,
  };
  await refreshLogModal();
  // If the install is still running, poll every 1s for live updates.
  if (_logPollTimer) {
    clearInterval(_logPollTimer);
    _logPollTimer = null;
  }
  _logPollTimer = setInterval(() => {
    const isRunning =
      logModal.value.open &&
      logModal.value.status &&
      !["completed", "failed"].includes(logModal.value.status);
    if (!isRunning) {
      clearInterval(_logPollTimer);
      _logPollTimer = null;
      return;
    }
    refreshLogModal();
  }, 1000);
}

async function refreshLogModal() {
  const jobId = logModal.value.jobId;
  if (!jobId) return;
  try {
    const job = await api.request(`/v1/jobs/${encodeURIComponent(jobId)}`);
    logModal.value = {
      ...logModal.value,
      lines: job.log_tail || [],
      status: job.phase || "",
      error: job.error || null,
      busy: false,
    };
  } catch (e) {
    logModal.value = {
      ...logModal.value,
      error: `Could not fetch job log: ${e.message || e}`,
      busy: false,
    };
  }
}

function closeLogModal() {
  if (_logPollTimer) {
    clearInterval(_logPollTimer);
    _logPollTimer = null;
  }
  logModal.value = { open: false, engineId: null, lines: [], status: "", error: null, busy: false };
}

function copyLogToClipboard() {
  const text = (logModal.value.lines || []).join("\n");
  try {
    navigator.clipboard.writeText(text);
    pushToast({ message: "Install log copied to clipboard.", kind: "success", duration: 2500 });
  } catch (e) {
    pushToast({ message: `Copy failed: ${e.message || e}`, kind: "error" });
  }
}

async function cancelInstall(id) {
  const jobId = installJobs.value[id];
  if (!jobId) return;
  try {
    await api.request(`/v1/jobs/${encodeURIComponent(jobId)}`, { method: "DELETE" });
    pushToast({ message: `Cancelling ${id} install…`, kind: "info", duration: 3000 });
  } catch (e) {
    pushToast({ message: `Cancel failed: ${e.message || e}`, kind: "error" });
  }
}

async function load(id, variant) {
  const eng = engines.value.find((e) => e.id === id);
  const isExternal = eng?.backend === "external-openai-tts";
  busy.value[id] = "load";
  const variantSuffix = variant ? ` (${variant})` : "";
  const ctl = new AbortController();
  const task = tasks.start({
    label: `Loading · ${eng?.name || id}${variantSuffix}`,
    kind: "load",
    statsFn: () => ["spawning subprocess", "loading model weights"],
    // Two-stage cancel: signal the server to abort the in-flight load
    // (kills the subprocess + sets the manager's cancel flag), then
    // abort the client fetch so we stop waiting.
    onCancel: async () => {
      try {
        await fetch(`${api.serverUrl}/v1/engines/${id}/cancel-load`, { method: "POST" });
      } catch (_) { /* best-effort; client abort still fires */ }
      ctl.abort();
    },
    // Retry re-runs the same load. The strip/panel shows a Retry button
    // for finished tasks (failed / cancelled) once this is in place.
    onRetry: () => load(id, variant),
  });
  try {
    await api.request(`/v1/engines/${id}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "auto", model_variant: variant || null }),
      signal: ctl.signal,
    });
    await refresh();
    currentLoadedVariant.value = variant || eng?.default_variant_id || null;
    tasks.finish(task.id);
    pushToast({
      message: `${eng?.name || id}${variantSuffix} loaded.`,
      kind: "success",
      duration: 4500,
    });
  } catch (e) {
    if (ctl.signal.aborted) {
      // tasks.cancel() was triggered by the strip; nothing more to log.
      return;
    }
    const raw = String(e.message || e);
    const hint = isExternal
      ? "The remote TTS server isn't responding. Check that it's running, then try again."
      : "";
    tasks.fail(task.id, raw);
    pushToast({
      message: `Load failed: ${raw}${hint ? "\n" + hint : ""}`,
      kind: "error",
      duration: 12000,
    });
  } finally {
    busy.value[id] = null;
  }
}

function loadVariant(engineId, variantId) {
  return load(engineId, variantId);
}

function defaultVariantFor(engine) {
  const v = variants.value[engine.id];
  if (!v) return null;
  const did = engine.default_variant_id;
  if (!did) return null;
  return (v.variants || []).find((x) => x.id === did) || null;
}

// All variants for a given engine — used by the always-visible model
// picker. Returns an empty list before variants are fetched (eager
// fetch fires on `refresh()` so this rarely matters in practice).
function allVariantsFor(engine) {
  const v = variants.value[engine.id];
  return v?.variants || [];
}

// Per-engine isolation discriminator. Drives whether the engine shows
// an Install button (venv engines need an explicit install step;
// shared engines have their shared venv built transparently on first
// model load). Falls back to "shared" if the field isn't present.
function isolation(engine) {
  return engine.isolation || "shared";
}

// Bottom-of-card destructive action label:
//   - venv-isolated engines: "Uninstall" (removes venv + downloaded models)
//   - shared engines:        "Remove downloaded models" (no venv to remove)
function uninstallLabel(engine) {
  return isolation(engine) === "venv" ? "Uninstall" : "Remove downloaded models";
}

// Currently-loaded model variant id — set when load() resolves, cleared
// on unload. Drives the `Currently loaded` chip in the model picker.
// (Server doesn't track this per-variant today; the variant id is just
// what we last passed to /v1/engines/{id}/load.)
const currentLoadedVariant = ref(null);

// Status pill resolver — derives the three visually-distinct states
// (not_installed / installed / loaded) the user can scan from a list
// of 8 engine cards at a glance. The strings here are user-facing.
function statusLabel(engine) {
  if (engine.status === "loaded") return "Loaded";
  if (engine.status === "installed") return "Installed";
  return "Not installed";
}
function statusIcon(engine) {
  if (engine.status === "loaded") return "●";
  if (engine.status === "installed") return "✓";
  return "⊘";
}

function engineType(engine) {
  const caps = engine.capabilities || [];
  const hasPresets = caps.includes("preset_voices");
  const hasCloning = caps.includes("voice_cloning");
  if (hasPresets && hasCloning) return "Preset + clone";
  if (hasPresets) return "Presets only";
  if (hasCloning) return "Clone-only";
  return "Other";
}

function otherVariantsFor(engine) {
  const v = variants.value[engine.id];
  if (!v) return [];
  const did = engine.default_variant_id;
  return (v.variants || []).filter((x) => x.id !== did);
}

async function unload() {
  try {
    const resp = await api.request("/v1/engines/unload", { method: "POST" });
    currentLoadedVariant.value = null;
    await refresh();
    pushToast({
      message: resp?.previous_engine
        ? `${resp.previous_engine} unloaded — VRAM freed.`
        : "No engine was loaded.",
      kind: resp?.previous_engine ? "success" : "info",
      duration: 4500,
    });
  } catch (e) {
    pushToast({ message: `Unload failed: ${e.message || e}`, kind: "error" });
  }
}

async function uninstall(id) {
  const eng = engines.value.find((e) => e.id === id);
  const isExternal = eng?.backend === "external-openai-tts";
  const hasPipPackages = Array.isArray(eng?.pip_packages) && eng.pip_packages.length > 0;

  let uninstallDeps = false;

  if (isExternal) {
    const ok = await confirmDialog({
      title: `Remove ${id}?`,
      message:
        "The external server registration will be removed. The remote server itself is not affected.",
      danger: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
  } else if (hasPipPackages) {
    const choice = await promptDialog({
      title: `Uninstall ${id}?`,
      message:
        "Model files will be removed from disk. You can also remove the Python packages this engine pulled in.",
      fields: [
        {
          key: "scope",
          label: "What to remove",
          type: "select",
          defaultValue: "files-only",
          options: [
            { value: "files-only", label: "Model files only" },
            {
              value: "files-and-deps",
              label: `Model files + Python packages (${eng.pip_packages.join(", ")})`,
            },
          ],
        },
      ],
      confirmLabel: "Uninstall",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!choice) return;
    uninstallDeps = choice.scope === "files-and-deps";
  } else {
    const ok = await confirmDialog({
      title: `Uninstall ${id}?`,
      message: "Model files will be removed from disk.",
      danger: true,
      confirmLabel: "Uninstall",
    });
    if (!ok) return;
  }

  busy.value[id] = "uninstall";
  try {
    let path;
    if (isExternal) {
      path = `/v1/engines/external/${encodeURIComponent(id)}`;
    } else {
      path = `/v1/engines/${encodeURIComponent(id)}`;
      if (uninstallDeps) path += "?uninstall_deps=true";
    }
    const resp = await api.request(path, { method: "DELETE" });
    await refresh();
    const removedDeps = resp?.pip_packages_removed || [];
    const depsNote = removedDeps.length
      ? ` Also removed Python packages: ${removedDeps.join(", ")}.`
      : "";
    const displayName = eng?.name || id;
    let message;
    if (isExternal) {
      message = `${displayName} removed from this server (the remote service is unaffected).`;
    } else {
      message = `${displayName} uninstalled — venv, model files and state removed.${depsNote}`;
    }
    pushToast({
      message,
      kind: "success",
      duration: removedDeps.length ? 8000 : 4500,
    });
  } catch (e) {
    pushToast({
      message: `${isExternal ? "Remove" : "Uninstall"} failed: ${e.message || e}`,
      kind: "error",
    });
  } finally {
    busy.value[id] = null;
  }
}

onMounted(() => {
  refresh();
  loadSystem();
});
</script>

<template>
  <!-- ─── This machine — hardware + acceleration the engines can use ─── -->
  <section class="block" v-if="system">
    <h3>This machine</h3>
    <div class="stats">
      <div class="stat">
        <div class="k">OS</div>
        <div class="v" style="font-size: 28px;">{{ system.os }}</div>
      </div>
      <div class="stat">
        <div class="k">CPU</div>
        <div class="v">{{ system.cpu_cores }}<span class="unit">threads</span></div>
        <div class="x">{{ system.cpu_name }}</div>
      </div>
      <div class="stat">
        <div class="k">Memory</div>
        <div class="v">{{ Math.round(system.ram_total_mb / 1024) }}<span class="unit">GB</span></div>
        <div class="x">total RAM</div>
      </div>
    </div>

    <div v-if="system.gpus && system.gpus.length" class="subblock">
      <h4>GPU{{ system.gpus.length > 1 ? "s" : "" }}</h4>
      <table class="jv-table">
        <thead>
          <tr><th>Vendor</th><th>Model</th><th>VRAM</th><th>Driver</th></tr>
        </thead>
        <tbody>
          <tr v-for="(g, i) in system.gpus" :key="i">
            <td><JvTag :label="g.vendor" /></td>
            <td><strong>{{ g.name }}</strong></td>
            <td>{{ g.vram_mb ? (g.vram_mb / 1024).toFixed(1) + " GB" : "—" }}</td>
            <td class="jv-mono">{{ g.driver || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="subblock">
      <h4>Acceleration runtimes</h4>
      <div class="tags">
        <JvTag v-for="r in activeRuntimes" :key="r" :label="r" />
        <span v-if="!activeRuntimes.length" class="endnote">CPU only — no accelerated runtime detected.</span>
      </div>
    </div>
  </section>

  <!-- ─── Engine catalog ─── -->
  <section class="block">
    <h3>{{ engines.length }} engine{{ engines.length === 1 ? "" : "s" }}</h3>

    <!-- Server-offline empty state. When engines.length === 0 the most
         likely cause is that the Python server isn't running (manifests
         load fine server-side; the only way to get 0 engines is a fetch
         failure or a brand-new build). Surface this so users don't sit
         on an empty table wondering. -->
    <p v-if="!engines.length" class="jv-banner jv-banner--warn">
      No engines listed — the Python server may not be running. Check the
      <a href="#settings">Settings → Connection</a> tab for the server URL,
      or run <code class="jv-mono">justvoice-server serve</code> from a terminal.
    </p>

    <!-- Engine cards — one per discovered engine. Replaces the prior
         table layout. Per the design pinned 2026-06-09:
           - Status pill at the top, 3 visually distinct states
             (not installed / installed / loaded).
           - "Loaded: <variant>" summary line when in VRAM.
           - Always-visible model picker (variants), with
             `Recommended` (manifest's default_variant_id) and
             `Currently loaded` chips. **No GPU-aware suggestions —
             manifest default only.**
           - Install button only on venv-isolated engines; shared
             engines have their venv set up transparently on first
             model load (per user, 2026-06-09).
           - Uninstall label varies: "Uninstall" (venv: rm venv + models),
             "Remove downloaded models" (shared: rm just models). -->
    <div v-if="engines.length" class="engine-cards">
      <article v-for="e in engines" :key="e.id" class="engine-card" :data-status="e.status">
        <header class="engine-card__head">
          <div class="engine-card__title">
            <h3>{{ e.name }}</h3>
            <div class="engine-card__tags">
              <JvTag variant="accent" :label="engineType(e)" />
              <JvTag v-if="e.capabilities.includes('voice_design')" label="design" />
              <JvTag v-if="e.capabilities.includes('instruct_field')" label="instruct" />
              <JvTag v-if="e.capabilities.includes('paralinguistic_tags')" label="[tags]" />
              <JvTag v-if="e.capabilities.includes('single_speaker_dialogue')" label="dialogue" />
            </div>
          </div>
          <span class="engine-card__status-pill" :data-status="e.status">
            <span class="engine-card__status-icon">{{ statusIcon(e) }}</span>
            {{ statusLabel(e) }}
          </span>
        </header>

        <p class="engine-card__desc">{{ e.description }}</p>

        <!-- License + attribution. weights_license differs from the
             framework code license (LICENSE field on the manifest) when
             the model weights have their own terms — e.g. TADA ships
             Apache-2.0 code on top of Llama 3.2 weights. Attribution is
             surfaced inline because it's a CONTRACT the producing
             audiobook / podcast author must honor in their distribution. -->
        <div v-if="e.weights_license || e.attribution" class="engine-card__license">
          <span class="engine-card__license-pill">
            <span class="engine-card__license-icon">⚖</span>
            Weights: <strong>{{ e.weights_license || "Apache-2.0" }}</strong>
          </span>
          <span v-if="e.attribution" class="engine-card__attribution">
            <strong>Required attribution:</strong>
            <code class="jv-mono">{{ e.attribution }}</code>
            <span class="jv-muted">— include in your published work's credits.</span>
          </span>
        </div>

        <!-- Currently-loaded summary — only shown when a model is in VRAM. -->
        <div v-if="e.status === 'loaded'" class="engine-card__loaded">
          <strong>Loaded:</strong>
          <code class="jv-mono">{{ currentLoadedVariant || e.default_variant_id || "(default)" }}</code>
          <span class="jv-muted">· {{ e.backend }} · {{ fmtDisk(e.prerequisites.disk_space_mb) }} on disk</span>
        </div>

        <!-- Install progress (download + venv build) — only while in flight or after failure. -->
        <div v-if="progress[e.id]" class="engine-card__progress">
          <div class="engine-card__progress-row">
            <span class="engine-card__progress-phase jv-mono">{{ (progress[e.id].phase || "").toUpperCase() }}</span>
            <div class="engine-card__progress-track">
              <div
                class="engine-card__progress-fill"
                :class="[
                  'phase-' + progress[e.id].phase,
                  progress[e.id].bytes_total === 0 && progress[e.id].phase !== 'completed' ? 'indeterminate' : ''
                ]"
                :style="progress[e.id].bytes_total > 0 ? { width: pct(progress[e.id]) + '%' } : {}"
              />
            </div>
            <span class="engine-card__progress-bytes jv-mono">
              <template v-if="progress[e.id].bytes_total > 0">
                {{ (progress[e.id].bytes_downloaded / 1048576).toFixed(1) }} / {{ (progress[e.id].bytes_total / 1048576).toFixed(1) }} MB
              </template>
            </span>
            <JvButton
              v-if="installJobs[e.id] && !['completed', 'failed'].includes(progress[e.id].phase)"
              variant="danger-outline"
              size="sm"
              label="Cancel"
              @click="cancelInstall(e.id)"
            />
            <JvButton variant="ghost" size="sm" label="View log" @click="viewInstallLog(e.id)" />
          </div>
          <div v-if="progress[e.id].current_file" class="engine-card__progress-file">
            <span class="jv-mono">{{ progress[e.id].current_file }}</span>
          </div>
          <div v-if="progress[e.id].error" class="engine-card__progress-error">
            <strong>Install failed.</strong> {{ progress[e.id].error }}
            <JvButton variant="ghost" size="sm" label="View install log" @click="viewInstallLog(e.id)" />
            <JvButton variant="ghost" size="sm" label="Dismiss" @click="dismiss(e.id)" />
          </div>
        </div>

        <!-- Model picker — always visible. Recommended (manifest default)
             and Currently loaded chips on appropriate rows. Won't-fit
             rows from the recommender are flagged but still listable. -->
        <div v-if="allVariantsFor(e).length" class="engine-card__models">
          <h4 class="engine-card__models-h">Models</h4>
          <ul class="engine-card__model-list">
            <li
              v-for="v in allVariantsFor(e)"
              :key="v.id"
              class="engine-card__model-row"
              :class="{ 'engine-card__model-row--current': v.id === currentLoadedVariant }"
            >
              <div class="engine-card__model-info">
                <strong>{{ v.name }}</strong>
                <span class="engine-card__model-meta jv-muted">
                  {{ v.size_mb >= 1024 ? (v.size_mb / 1024).toFixed(1) + " GB" : v.size_mb + " MB" }}
                  <template v-if="v.vram_mb"> · {{ v.vram_mb >= 1024 ? (v.vram_mb / 1024).toFixed(1) + " GB" : v.vram_mb + " MB" }} VRAM</template>
                  <template v-if="v.quality != null"> · q{{ v.quality }}/100</template>
                </span>
                <div v-if="v.description" class="engine-card__model-desc">{{ v.description }}</div>
              </div>
              <div class="engine-card__model-chips">
                <span v-if="v.id === e.default_variant_id" class="jv-pill jv-pill--ghost">Recommended</span>
                <span v-if="v.id === currentLoadedVariant && e.status === 'loaded'" class="jv-pill jv-pill--solid">★ Currently loaded</span>
                <JvTag
                  v-if="(variants[e.id]?.recommended?.would_oom || []).includes(v.id)"
                  variant="danger"
                  label="Won't fit"
                />
              </div>
              <JvButton
                v-if="v.id !== currentLoadedVariant || e.status !== 'loaded'"
                variant="primary"
                size="sm"
                label="Load"
                :loading="busy[e.id] === 'load'"
                :disabled="!!busy[e.id] || (variants[e.id]?.recommended?.would_oom || []).includes(v.id)"
                @click="loadVariant(e.id, v.id)"
              />
            </li>
          </ul>
        </div>

        <!-- Bottom actions row -->
        <footer class="engine-card__actions">
          <JvButton
            v-if="isolation(e) === 'venv' && e.status === 'not_installed'"
            variant="primary"
            size="sm"
            :loading="busy[e.id] === 'install'"
            :disabled="!!busy[e.id]"
            :label="busy[e.id] === 'install' ? 'Installing…' : 'Install'"
            @click="install(e.id)"
          />
          <JvButton
            v-if="e.status === 'loaded'"
            variant="secondary"
            size="sm"
            label="Unload"
            @click="unload"
          />
          <span class="engine-card__spacer" />
          <JvButton
            v-if="e.status !== 'not_installed'"
            variant="danger-outline"
            size="sm"
            :disabled="!!busy[e.id]"
            :label="busy[e.id] === 'uninstall' ? 'Working…' : uninstallLabel(e)"
            @click="uninstall(e.id)"
          />
        </footer>
      </article>
    </div>

    <p class="endnote engine-cards__foot">
      Engines load one at a time — loading a new model unloads the previously loaded one to free GPU memory.
      Shared engines (Kokoro, Chatterbox, LuxTTS, Qwen3, TADA) have their runtime set up transparently the first time you load any model.
      Venv-isolated engines (Dia, MOSS) need a one-time Install before you can load.
    </p>
  </section>

  <!-- ─── Install log modal ─────────────────────────────────────────── -->
  <Teleport to="body">
    <div v-if="logModal.open" class="log-modal-backdrop" @click.self="closeLogModal">
      <div class="log-modal">
        <header class="log-modal-header">
          <div>
            <h3 style="margin: 0; font-size: 18px;">Install log — {{ logModal.engineId }}</h3>
            <p class="endnote" style="margin: 4px 0 0;">
              Phase: <span class="jv-mono">{{ logModal.status || "(unknown)" }}</span>
              <span v-if="logModal.error"> · <span style="color: var(--danger);">error: {{ logModal.error }}</span></span>
            </p>
          </div>
          <JvButton variant="ghost" size="icon" label="✕" aria-label="Close" @click="closeLogModal" />
        </header>
        <pre class="log-modal-body">{{ (logModal.lines || []).join("\n") || (logModal.busy ? "Loading…" : "(no output captured)") }}</pre>
        <footer class="log-modal-footer">
          <div class="jv-btn-group">
            <JvButton variant="secondary" label="Refresh" @click="refreshLogModal" />
            <JvButton variant="secondary" label="Copy" @click="copyLogToClipboard" />
            <JvButton variant="primary" label="Close" @click="closeLogModal" />
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* ── Engine cards grid ────────────────────────────────────────────── */
.engine-cards {
  display: grid;
  gap: 18px;
  grid-template-columns: repeat(auto-fill, minmax(560px, 1fr));
  margin-top: 8px;
}
.engine-cards__foot {
  margin-top: 18px;
  max-width: 920px;
  line-height: 1.55;
}

/* ── Single card ──────────────────────────────────────────────────── */
.engine-card {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px 20px 16px;
  border: 1px solid var(--border, var(--border-soft));
  border-radius: var(--r-lg, 10px);
  background: var(--surface);
  transition: border-color 0.18s, box-shadow 0.18s;
}
.engine-card:hover {
  border-color: var(--border-strong, var(--accent-line));
}
.engine-card[data-status="loaded"] {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-line, transparent) inset;
}
.engine-card[data-status="loading"] {
  border-color: var(--warn, var(--accent-line));
}

/* ── Card header (title block + status pill) ──────────────────────── */
.engine-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}
.engine-card__title {
  flex: 1 1 auto;
  min-width: 0;
}
.engine-card__title h3 {
  margin: 0;
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 19px;
  letter-spacing: -0.005em;
  color: var(--ink);
}
.engine-card__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

/* Status pill — three visual states. Loaded = solid accent;
   loading = warn outline; installed = neutral outline; not_installed
   = muted ghost. Same shape across states for predictable scanning. */
.engine-card__status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 11px;
  border-radius: var(--r-pill, 999px);
  border: 1px solid var(--border, var(--border-soft));
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  white-space: nowrap;
  flex-shrink: 0;
}
.engine-card__status-pill[data-status="loaded"] {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--surface);
}
.engine-card__status-pill[data-status="loading"] {
  background: var(--warn-bg, transparent);
  border-color: var(--warn, var(--accent-line));
  color: var(--warn-ink, var(--accent));
}
.engine-card__status-pill[data-status="installed"] {
  background: var(--accent-soft, transparent);
  border-color: var(--accent-line, var(--border));
  color: var(--accent);
}
.engine-card__status-pill[data-status="not_installed"] {
  background: transparent;
  border-style: dashed;
  color: var(--muted);
}
.engine-card__status-icon {
  font-size: 12px;
  line-height: 1;
}

/* ── Description + currently-loaded summary ───────────────────────── */
.engine-card__desc {
  margin: 0;
  font-family: var(--font-sans);
  font-size: 13.5px;
  line-height: 1.55;
  color: var(--ink-2);
  max-width: 720px;
}
.engine-card__loaded {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  background: var(--accent-soft, var(--surface-2));
  border-left: 3px solid var(--accent);
  border-radius: 0 6px 6px 0;
  font-size: 12.5px;
  color: var(--ink-2);
}
.engine-card__loaded code {
  font-family: var(--font-mono);
  font-size: 12px;
  background: transparent;
  color: var(--accent);
}

/* ── License + attribution row ────────────────────────────────────── */
.engine-card__license {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--ink-2);
}
.engine-card__license-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: var(--r-pill, 999px);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  font-size: 11.5px;
  color: var(--ink-2);
  white-space: nowrap;
}
.engine-card__license-pill strong {
  font-weight: 600;
  color: var(--ink);
}
.engine-card__license-icon {
  font-size: 11px;
  opacity: 0.7;
}
.engine-card__attribution {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  padding: 5px 10px;
  background: var(--warn-bg, var(--accent-soft));
  border-left: 3px solid var(--warn, var(--accent));
  border-radius: 0 6px 6px 0;
  font-size: 12px;
  color: var(--warn-ink, var(--ink-2));
}
.engine-card__attribution code {
  background: transparent;
  padding: 0;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--ink);
}

/* ── Install progress block ───────────────────────────────────────── */
.engine-card__progress {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
}
.engine-card__progress-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.engine-card__progress-phase {
  font-size: 10.5px;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--ink-2);
  min-width: 80px;
}
.engine-card__progress-track {
  flex: 1 1 200px;
  height: 6px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: var(--r-pill, 999px);
  overflow: hidden;
  min-width: 140px;
}
.engine-card__progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
.engine-card__progress-fill.phase-failed { background: var(--danger); }
.engine-card__progress-fill.phase-completed { background: var(--success, var(--accent)); }
.engine-card__progress-fill.indeterminate {
  width: 35% !important;
  animation: engineCardIndeterminate 1.4s ease-in-out infinite;
}
@keyframes engineCardIndeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(285%); }
}
.engine-card__progress-bytes {
  font-size: 10.5px;
  color: var(--muted);
  min-width: 110px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.engine-card__progress-file {
  font-size: 11px;
  color: var(--muted);
  word-break: break-all;
}
.engine-card__progress-error {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 4px;
  padding: 8px 10px;
  background: var(--danger-bg, var(--surface));
  border-left: 3px solid var(--danger);
  border-radius: 0 6px 6px 0;
  font-size: 12px;
  color: var(--danger-ink, var(--danger));
}

/* ── Models picker (always-visible variant list) ──────────────────── */
.engine-card__models {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.engine-card__models-h {
  margin: 0;
  font-size: 10.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--muted);
}
.engine-card__model-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.engine-card__model-row {
  display: grid;
  grid-template-columns: 1fr auto auto;
  gap: 12px;
  align-items: start;
  padding: 10px 12px;
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--surface);
  transition: background 0.15s, border-color 0.15s;
}
.engine-card__model-row:hover {
  background: var(--surface-2);
  border-color: var(--border, var(--accent-line));
}
.engine-card__model-row--current {
  background: var(--accent-soft, var(--surface-2));
  border-color: var(--accent);
  border-left-width: 3px;
}
.engine-card__model-info {
  min-width: 0;
}
.engine-card__model-info > strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}
.engine-card__model-meta {
  display: block;
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.engine-card__model-desc {
  margin-top: 6px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--ink-2);
  max-width: 480px;
}
.engine-card__model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  align-items: center;
  justify-content: flex-end;
}

/* ── Bottom actions row ───────────────────────────────────────────── */
.engine-card__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-top: 12px;
  border-top: 1px solid var(--border-soft);
}
.engine-card__spacer {
  flex: 1;
  min-width: 4px;
}

/* ── Install log modal ────────────────────────────────────────────── */
:deep(.log-modal-backdrop) {
  position: fixed;
  inset: 0;
  background: rgba(28, 28, 26, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 200;
  padding: 32px;
}
:deep(.log-modal) {
  background: var(--surface);
  border: 1px solid var(--border-strong);
  width: min(900px, 100%);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(28, 28, 26, 0.18);
  border-radius: var(--r-lg);
}
:deep(.log-modal-header) {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding: 18px 22px 14px;
  border-bottom: 1px solid var(--border);
  gap: 14px;
}
:deep(.log-modal-body) {
  flex: 1 1 auto;
  overflow: auto;
  margin: 0;
  padding: 16px 22px;
  background: var(--ink);
  color: var(--surface);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  min-height: 200px;
}
:deep(.log-modal-footer) {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  padding: 14px 22px;
  border-top: 1px solid var(--border);
}

</style>
