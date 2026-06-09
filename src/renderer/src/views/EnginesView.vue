<script setup>
import { ref, onMounted, computed } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog, promptDialog } from "../services/dialog.js";

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
  const e = await api.request("/v1/engines");
  engines.value = e.engines;
}

async function loadSystem() {
  try {
    system.value = await api.request("/v1/system/info");
  } catch (_) {
    // Hardware panel is best-effort; the engine list is the point.
  }
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
  // Surface a task strip at the top of the page so the user sees a global
  // spinner during the 5–30 s subprocess-spawn + model-load window.
  const task = tasks.start({
    label: `Loading · ${eng?.name || id}${variantSuffix}`,
    kind: "load",
    statsFn: () => ["spawning subprocess", "loading model weights"],
  });
  try {
    await api.request(`/v1/engines/${id}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "auto", model_variant: variant || null }),
    });
    await refresh();
    tasks.finish(task.id);
    pushToast({
      message: `${eng?.name || id}${variantSuffix} loaded.`,
      kind: "success",
      duration: 4500,
    });
  } catch (e) {
    const raw = String(e.message || e);
    // External engines fail to load when the remote server is unreachable —
    // surface that root cause and a remediation hint up front rather than
    // making the user parse the 503 JSON body.
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

// Variant rows in the "Show variants" subtable just pick which model
// checkpoint to load — the engine venv is already installed. Wraps load()
// with the chosen variant id; same UX path as the row's Load button.
function loadVariant(engineId, variantId) {
  return load(engineId, variantId);
}

// Variant displayed as the engine's "default" — the one Load on the row loads.
// Resolved from `engine.default_variant_id` (declared in the engine manifest)
// against the variants returned by /v1/engines/<id>/models.
function defaultVariantFor(engine) {
  const v = variants.value[engine.id];
  if (!v) return null;
  const did = engine.default_variant_id;
  if (!did) return null;
  return (v.variants || []).find((x) => x.id === did) || null;
}

// All variants EXCEPT the engine's default — these get their own Load button.
// The default is shown separately in the header so the user isn't offered
// two routes to the same model.
// Compact "what kind of engine is this" badge — derived from the engine's
// capabilities so each tag stays in one place. Three big buckets:
//   - "Preset + clone"  — has preset voices AND supports voice cloning
//   - "Presets only"    — has preset voices, no cloning
//   - "Clone-only"      — voice cloning, no presets (the user has to clone first)
//   - "Other"           — neither (rare; might be a model with weird API)
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
    // Two-state choice: model files only, or also pip-uninstall the engine's
    // exclusive packages. Shared deps (e.g. torch with other installed
    // engines) are kept either way — that's a server-side decision.
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
      // Managed engines: the whole engine venv + models + voices + state were
      // rmtree'd — surface that so the user knows disk has been reclaimed.
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
      <table>
        <thead>
          <tr><th>Vendor</th><th>Model</th><th>VRAM</th><th>Driver</th></tr>
        </thead>
        <tbody>
          <tr v-for="(g, i) in system.gpus" :key="i">
            <td><span class="tag">{{ g.vendor }}</span></td>
            <td><strong>{{ g.name }}</strong></td>
            <td>{{ g.vram_mb ? (g.vram_mb / 1024).toFixed(1) + " GB" : "—" }}</td>
            <td class="mono">{{ g.driver || "—" }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="subblock">
      <h4>Acceleration runtimes</h4>
      <div class="tags">
        <span v-for="r in activeRuntimes" :key="r" class="tag">{{ r }}</span>
        <span v-if="!activeRuntimes.length" class="endnote">CPU only — no accelerated runtime detected.</span>
      </div>
    </div>
  </section>

  <!-- ─── Engine catalog ─── -->
  <section class="block">
    <h3>{{ engines.length }} engine{{ engines.length === 1 ? "" : "s" }}</h3>
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Backend</th>
          <th>Status</th>
          <th>Disk</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <template v-for="e in engines" :key="e.id">
          <!-- Main engine row -->
          <tr>
            <td>
              <div class="engine-name">{{ e.name }}</div>
              <div class="engine-tags">
                <span class="tag accent">{{ engineType(e) }}</span>
                <span v-if="e.capabilities.includes('voice_design')" class="tag">design</span>
                <span v-if="e.capabilities.includes('instruct_field')" class="tag">instruct</span>
                <span v-if="e.capabilities.includes('paralinguistic_tags')" class="tag">[tags]</span>
                <span v-if="e.capabilities.includes('single_speaker_dialogue')" class="tag">dialogue</span>
              </div>
              <div class="engine-desc">{{ e.description }}</div>
            </td>
            <td class="mono">{{ e.backend }}</td>
            <td>
              <span class="status" :class="e.status">
                <span class="sq"></span>{{ e.status.replace("_", " ") }}
              </span>
            </td>
            <td>{{ fmtDisk(e.prerequisites.disk_space_mb) }}</td>
            <td class="actions">
              <button class="secondary" :disabled="busy[e.id]" @click="loadVariants(e.id)">
                {{ variants[e.id] ? "Hide variants" : "Show variants" }}
              </button>
              <button v-if="e.status === 'not_installed'" class="primary" :disabled="busy[e.id]" @click="install(e.id)">
                {{ busy[e.id] === "install" ? "Installing…" : "Install" }}
              </button>
              <button v-else-if="e.status === 'installed'" class="primary" :disabled="busy[e.id]" @click="load(e.id)">
                {{ busy[e.id] === "load" ? "Loading…" : "Load" }}
              </button>
              <button v-else-if="e.status === 'loaded'" class="bare" @click="unload">Unload</button>
              <button v-if="e.status !== 'not_installed'" class="bare danger" :disabled="busy[e.id]" @click="uninstall(e.id)">
                {{ busy[e.id] === "uninstall" ? "Uninstalling…" : "Uninstall" }}
              </button>
            </td>
          </tr>

          <!-- Inline install-progress row -->
          <tr v-if="progress[e.id]" :key="e.id + '-progress'" class="progress-row-tr">
            <td colspan="5" class="progress-cell">
              <div class="progress-inline-row">
                <span class="progress-phase mono">{{ (progress[e.id].phase || "").toUpperCase() }}</span>
                <div class="progress-track">
                  <div
                    class="progress-bar"
                    :class="[
                      'phase-' + progress[e.id].phase,
                      progress[e.id].bytes_total === 0 && progress[e.id].phase !== 'completed' ? 'indeterminate' : ''
                    ]"
                    :style="progress[e.id].bytes_total > 0 ? { width: pct(progress[e.id]) + '%' } : {}"
                  ></div>
                </div>
                <span class="progress-bytes mono">
                  <template v-if="progress[e.id].bytes_total > 0">
                    {{ (progress[e.id].bytes_downloaded / 1048576).toFixed(1) }} / {{ (progress[e.id].bytes_total / 1048576).toFixed(1) }} MB
                  </template>
                </span>
                <button
                  v-if="installJobs[e.id] && !['completed', 'failed'].includes(progress[e.id].phase)"
                  class="bare danger"
                  @click="cancelInstall(e.id)"
                >Cancel</button>
                <button class="bare" @click="viewInstallLog(e.id)">View log</button>
              </div>
              <div v-if="progress[e.id].current_file" class="endnote progress-file">
                <span class="mono">{{ progress[e.id].current_file }}</span>
              </div>
              <div v-if="progress[e.id].error" class="endnote progress-error">
                <strong>Install failed.</strong> {{ progress[e.id].error }}
                <button class="bare" style="margin-left: 12px;" @click="viewInstallLog(e.id)">View install log</button>
                <button class="bare" style="margin-left: 12px;" @click="dismiss(e.id)">Dismiss</button>
              </div>
            </td>
          </tr>

          <!-- Model variants row -->
          <tr v-if="variants[e.id]" :key="e.id + '-variants'" class="variants-row-tr">
            <td colspan="5" class="variants-cell">
              <div class="variants-header">
                <span class="variants-title">Model variants</span>
                <button class="bare" @click="hideVariants(e.id)">Hide</button>
              </div>

              <!-- Default model — what clicking Load on the engine row loads.
                   Surfaced here so the user can see which variant the
                   adapter actually instantiates. -->
              <div v-if="defaultVariantFor(e)" class="endnote variants-default-note">
                <strong style="font-style: normal; color: var(--ink);">Default model:</strong>
                {{ defaultVariantFor(e).name }}
                <span v-if="defaultVariantFor(e).description"> — {{ defaultVariantFor(e).description }}</span>
              </div>

              <p v-if="otherVariantsFor(e).length === 0" class="endnote variants-default-note">
                No alternative variants — the row's Load button loads the default above.
              </p>
              <table v-else class="variants-table">
                <thead>
                  <tr>
                    <th>Variant</th>
                    <th>Size</th>
                    <th>VRAM</th>
                    <th>Quality</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="v in otherVariantsFor(e)" :key="v.id">
                    <td>
                      <span>{{ v.name }}</span>
                      <span
                        v-if="(variants[e.id].recommended.would_oom || []).includes(v.id)"
                        class="tag danger"
                        style="margin-left: 8px;"
                      >Won't fit</span>
                      <div v-if="v.description" class="endnote" style="margin-top: 3px;">{{ v.description }}</div>
                    </td>
                    <td class="mono">{{ v.size_mb >= 1024 ? (v.size_mb / 1024).toFixed(1) + " GB" : v.size_mb + " MB" }}</td>
                    <td class="mono">{{ v.vram_mb ? (v.vram_mb >= 1024 ? (v.vram_mb / 1024).toFixed(1) + " GB" : v.vram_mb + " MB") : "CPU" }}</td>
                    <td class="mono">{{ v.quality != null ? v.quality + "/100" : "—" }}</td>
                    <td class="actions">
                      <button
                        class="primary"
                        :disabled="busy[e.id] || (variants[e.id].recommended.would_oom || []).includes(v.id)"
                        @click="loadVariant(e.id, v.id)"
                      >Load</button>
                    </td>
                  </tr>
                </tbody>
              </table>
              <div class="endnote variants-note" v-if="variants[e.id].recommended.detected_vram_mb">
                Detected VRAM: {{ (variants[e.id].recommended.detected_vram_mb / 1024).toFixed(1) }} GB
              </div>
            </td>
          </tr>
        </template>
      </tbody>
    </table>
    <p class="endnote foot">
      Engines load one at a time — loading a new engine unloads the previous one to free GPU memory.
      Install downloads the model files; Load brings the engine into memory ready to render.
    </p>
  </section>

  <!-- ─── Install log modal ────────────────────────────────────────────
       Opens when the user clicks "View install log" on a failed or in-flight
       install. Streams the rolling tail of pip / download output from
       /v1/jobs/{id} so the underlying error is visible without tailing the
       server log. -->
  <Teleport to="body">
    <div v-if="logModal.open" class="log-modal-backdrop" @click.self="closeLogModal">
      <div class="log-modal">
        <header class="log-modal-header">
          <div>
            <h3 style="margin: 0; font-size: 18px;">Install log — {{ logModal.engineId }}</h3>
            <p class="endnote" style="margin: 4px 0 0;">
              Phase: <span class="mono">{{ logModal.status || "(unknown)" }}</span>
              <span v-if="logModal.error"> · <span style="color: var(--danger);">error: {{ logModal.error }}</span></span>
            </p>
          </div>
          <button class="bare" @click="closeLogModal" aria-label="Close">✕</button>
        </header>
        <pre class="log-modal-body">{{ (logModal.lines || []).join("\n") || (logModal.busy ? "Loading…" : "(no output captured)") }}</pre>
        <footer class="log-modal-footer">
          <button @click="refreshLogModal">Refresh</button>
          <button @click="copyLogToClipboard">Copy</button>
          <button class="primary" @click="closeLogModal">Close</button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.mono { font-family: var(--font-mono); font-size: 11px; }

/* Engine name + description in the first table cell — readable, not greyed-out.
   The default .endnote (serif italic 300 muted) was washing the description out
   to the point of unreadability inside a packed row. */
.engine-name {
  font-family: var(--font-serif);
  font-weight: 400;
  font-size: 17px;
  letter-spacing: -0.005em;
  font-variation-settings: 'opsz' 24;
  color: var(--ink);
}
.engine-desc {
  margin-top: 6px;
  font-family: var(--font-sans);
  font-size: 13px;
  line-height: 1.5;
  color: var(--ink-2);
  max-width: 480px;
}
.engine-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.subblock { margin-top: 24px; }
.subblock h4 { margin: 0 0 10px; font-weight: 600; font-size: 11px; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }

.tags { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }

/* Status — view-local, matches topbar indicator. */
.status { display: inline-flex; align-items: center; gap: 7px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); white-space: nowrap; }
.status .sq { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.status.installed { color: var(--accent); }
.status.loaded { color: var(--success); }

.actions { white-space: nowrap; }
.actions button + button { margin-left: 8px; }

.foot { margin-top: 16px; }

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
  background: #1c1c1a;
  color: #e8e3d4;
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

/* ── Inline progress row ─────────────────────────────────────────── */
.progress-row-tr td { background: var(--surface-2); border-bottom: 1px solid var(--border-soft); padding: 10px 10px 12px; }
.progress-inline-row { display: flex; align-items: center; gap: 12px; }
.progress-phase { font-size: 11px; letter-spacing: 0.06em; min-width: 90px; color: var(--ink-2); }
.progress-inline-row .progress-track { flex: 1; }
.progress-bytes { font-size: 11px; color: var(--muted); min-width: 120px; text-align: right; }
.progress-file { margin-top: 6px; }
.progress-error { margin-top: 6px; color: var(--danger, #e05); }

/* ── Variants sub-table ──────────────────────────────────────────── */
.variants-row-tr td { background: var(--surface-2); padding: 14px 10px; border-bottom: 1px solid var(--border-soft); }
.variants-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
.variants-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600; color: var(--muted); }
.variants-table { margin: 0; background: transparent; }
.variants-table th { background: transparent; }
.variants-table tbody tr:hover td { background: var(--surface-3, var(--surface-2)); }
.variants-note { margin-top: 8px; }
.variants-default-note {
  margin: 0 0 12px;
  padding: 8px 12px;
  background: var(--accent-soft);
  border-left: 3px solid var(--accent);
  line-height: 1.5;
  font-size: 12.5px;
  color: var(--ink-2);
  font-style: normal;
  font-family: var(--font-sans);
  max-width: 720px;
}
</style>
