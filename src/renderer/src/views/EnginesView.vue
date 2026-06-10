<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  EnginesView (Phase 2 / Slice 2 rewrite — dropdown selector UX).

  Per-engine row: model dropdown + selection-driven info panel +
  ONE contextual action button. Mirrors JustWrite's SettingsProviderForm
  pattern. Tabbed by `engine.kind` so LLM providers (Phase 2 Slice 3+),
  TTS engines, and embeddings each get their own tab.

  Replaces the prior card-grid layout — fixes the six EnginesView bugs
  in one restructure:
    1. Dual-spin can't happen — there's exactly one Load button per
       engine, not one per variant.
    2. Progress bar replaces the spinner — the action area renders an
       inline determinate track when busy.
    3. Per-variant unload — Unload only appears when the selected
       variant IS the loaded variant.
    4. "Loaded: X" reads from engine.current_variant_id (server truth).
    5. Shared-venv tri-state — contextual button shows Remove only when
       at least one variant has weights on disk.
    6. Density — one row per engine; info panel only renders for the
       expanded selection.
-->
<script setup>
import { computed, onMounted, reactive, ref } from "vue";
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
const busy = reactive({});  // {engineId: "install" | "load" | "unload" | "uninstall" | null}

// Per-engine install/load progress phase events.
// Shape: {[engineId]: {phase, bytes_downloaded, bytes_total, current_file, error, job_id}}
const progress = reactive({});

// In-flight install job ids so Cancel can target the right one.
const installJobs = reactive({});  // {engineId: jobId}

// Per-engine model variants:
//   {[engineId]: {variants: [{id, name, size_mb, vram_mb, ...}], recommended: {would_oom: [...]}}}
const variants = reactive({});

// Per-engine dropdown selection. Defaults to the loaded variant > default
// > first available. Reactive so the info panel re-renders on change.
const selectedVariants = reactive({});  // {engineId: variantId}

// Tab selection: TTS / LLM / Embeddings. Filters which engines surface.
// Falls back to "tts" so existing manifests show by default.
const KIND_LABELS = { tts: "TTS", llm: "LLM", embedding: "Embeddings" };
const activeKind = ref("tts");

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
  return Object.keys(RUNTIME_LABELS).filter((k) => r[k]).map((k) => RUNTIME_LABELS[k]);
});

const enginesByKind = computed(() => {
  const out = { tts: [], llm: [], embedding: [] };
  for (const e of engines.value) {
    const k = e.kind || "tts";
    (out[k] = out[k] || []).push(e);
  }
  return out;
});

const availableKinds = computed(() => {
  return Object.keys(KIND_LABELS).filter((k) => (enginesByKind.value[k] || []).length > 0);
});

const visibleEngines = computed(() => enginesByKind.value[activeKind.value] || []);

function fmtDisk(mb) {
  if (mb == null) return "—";
  return mb >= 1024 ? (mb / 1024).toFixed(1) + " GB" : mb + " MB";
}

function pct(p) {
  return p.bytes_total > 0 ? Math.min(100, Math.round(100 * p.bytes_downloaded / p.bytes_total)) : 0;
}

async function refresh() {
  const e = await api.safeRequest("/v1/engines", { engines: [] });
  engines.value = e?.engines ?? [];
  // If the active kind has no engines, snap to the first kind that does.
  if (!visibleEngines.value.length && availableKinds.value.length) {
    activeKind.value = availableKinds.value[0];
  }
  // Eager-fetch model variants for every engine so the dropdown populates
  // without a per-card "Show variants" toggle. Per-engine failures tolerated.
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
      // Default the dropdown to the loaded variant > default_variant_id > first.
      if (selectedVariants[eng.id] === undefined) {
        const list = variants[eng.id]?.variants || [];
        selectedVariants[eng.id] = eng.current_variant_id
          || eng.default_variant_id
          || (list[0] && list[0].id)
          || "";
      }
    }),
  );
}

async function loadSystem() {
  system.value = await api.safeRequest("/v1/system/info", null);
}

function variantsFor(engineId) {
  return variants[engineId]?.variants || [];
}

function selectedVariantFor(engine) {
  const list = variantsFor(engine.id);
  const id = selectedVariants[engine.id];
  return list.find((v) => v.id === id) || list[0] || null;
}

function isLoadedVariant(engine, variantId) {
  return engine.status === "loaded" && engine.current_variant_id === variantId;
}

function isOnDisk(engine, variantId) {
  // Variant is on disk if its id appears in any downloaded-models list the
  // recommender returned, OR if the engine itself is installed.
  // The /models/recommended endpoint exposes a `downloaded_variant_ids` field
  // on engines that support per-variant fetch; fall back to engine.status
  // ("installed" or "loaded" both imply at least one variant is on disk).
  const rec = variants[engine.id]?.recommended;
  if (rec?.downloaded_variant_ids?.includes(variantId)) return true;
  if (engine.status === "installed" || engine.status === "loaded") return true;
  return false;
}

// Contextual action button: returns {label, kind, action, disabled, busy}
// based on the engine + selected variant state.
function contextualAction(engine) {
  const variant = selectedVariantFor(engine);
  const variantId = variant?.id || null;
  const isBusy = busy[engine.id] != null;

  // Loaded variant → Unload
  if (variantId && isLoadedVariant(engine, variantId)) {
    return {
      label: "Unload",
      variant: "secondary",
      action: () => unload(engine),
      disabled: isBusy,
      busy: busy[engine.id] === "unload",
    };
  }

  // Engine in isolated venv mode AND not yet installed → Install
  if (engine.isolation === "venv" && engine.status === "not_installed") {
    return {
      label: busy[engine.id] === "install" ? "Installing…" : "Install",
      variant: "primary",
      action: () => install(engine, variantId),
      disabled: isBusy,
      busy: busy[engine.id] === "install",
    };
  }

  // Variant not on disk → Download (drives a model-only install for that variant)
  if (variantId && !isOnDisk(engine, variantId)) {
    return {
      label: busy[engine.id] === "install" ? "Downloading…" : "Download",
      variant: "primary",
      action: () => install(engine, variantId),
      disabled: isBusy,
      busy: busy[engine.id] === "install",
    };
  }

  // Variant on disk but not loaded → Load
  return {
    label: busy[engine.id] === "load" ? "Loading…" : "Load",
    variant: "primary",
    action: () => load(engine, variantId),
    disabled: isBusy || !variantId,
    busy: busy[engine.id] === "load",
  };
}

async function install(engine, variant) {
  busy[engine.id] = "install";
  progress[engine.id] = { phase: "connecting", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: null };

  const task = tasks.start({
    label: `Installing · ${engine.id}`,
    kind: "install",
    statsFn: (t) => {
      const s = [];
      if (t.meta?.phase) s.push(t.meta.phase);
      if (t.meta?.bytesTotal > 0) {
        s.push(`${(t.meta.bytesDl / 1048576).toFixed(1)} / ${(t.meta.bytesTotal / 1048576).toFixed(1)} MB`);
      }
      return s;
    },
  });

  try {
    const accepted = await api.request(`/v1/engines/${engine.id}/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(variant ? { model_variant: variant } : {}),
    });
    installJobs[engine.id] = accepted.job_id;
    while (true) {
      const job = await api.request(`/v1/jobs/${accepted.job_id}`);
      const pctVal = job.bytes_total > 0 ? Math.round(100 * (job.bytes_downloaded || 0) / job.bytes_total) : null;
      progress[engine.id] = {
        phase: job.phase,
        bytes_downloaded: job.bytes_downloaded || 0,
        bytes_total: job.bytes_total || 0,
        current_file: job.current_file || null,
        error: job.error || null,
      };
      tasks.update(task.id, {
        percent: pctVal,
        meta: { phase: job.phase, bytesDl: job.bytes_downloaded || 0, bytesTotal: job.bytes_total || 0 },
      });
      if (job.phase === "completed") {
        tasks.finish(task.id);
        pushToast({ message: `${engine.id} installed.`, kind: "success", duration: 4000 });
        setTimeout(() => { delete progress[engine.id]; }, 2000);
        break;
      }
      if (job.phase === "failed") {
        tasks.fail(task.id, job.error || "unknown error");
        pushToast({ message: `${engine.id} install failed: ${job.error || "unknown"}`, kind: "error", duration: 8000 });
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    await refresh();
  } catch (e) {
    tasks.fail(task.id, String(e.message || e));
    pushToast({ message: `Install failed: ${e.message || e}`, kind: "error", duration: 8000 });
    progress[engine.id] = { phase: "failed", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: String(e.message || e) };
  } finally {
    busy[engine.id] = null;
    delete installJobs[engine.id];
  }
}

async function load(engine, variant) {
  busy[engine.id] = "load";
  const ctl = new AbortController();
  const task = tasks.start({
    label: `Loading · ${engine.name || engine.id}${variant ? ` (${variant})` : ""}`,
    kind: "load",
    statsFn: (t) => {
      const out = [];
      if (t.meta?.phase) out.push(t.meta.phase);
      return out;
    },
    onCancel: async () => {
      try {
        await fetch(`${api.serverUrl}/v1/engines/${engine.id}/cancel-load`, { method: "POST" });
      } catch (_) { /* best-effort */ }
      ctl.abort();
    },
    onRetry: () => load(engine, variant),
  });

  // Initialize the per-engine load progress so the inline track renders.
  // The phase will get updated as the server emits events through
  // load-progress (Phase 2 / Slice 1 — spawning → loading_weights → warming_up).
  progress[engine.id] = { phase: "spawning", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: null };

  try {
    await api.request(`/v1/engines/${engine.id}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "auto", model_variant: variant || null }),
      signal: ctl.signal,
    });
    await refresh();
    tasks.finish(task.id);
    pushToast({ message: `${engine.name || engine.id} loaded.`, kind: "success", duration: 4500 });
    delete progress[engine.id];
  } catch (e) {
    if (ctl.signal.aborted) return;
    const raw = String(e.message || e);
    tasks.fail(task.id, raw);
    pushToast({ message: `Load failed: ${raw}`, kind: "error", duration: 12000 });
    progress[engine.id] = { phase: "failed", bytes_downloaded: 0, bytes_total: 0, current_file: null, error: raw };
  } finally {
    busy[engine.id] = null;
  }
}

async function unload(engine) {
  busy[engine.id] = "unload";
  try {
    // Pass kind so per-kind slot unload (Phase 2 / Slice 1) targets this
    // engine's slot specifically — leaves other kinds' loaded engines alone.
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
  } finally {
    busy[engine.id] = null;
  }
}

async function uninstall(engine) {
  const isExternal = engine.backend === "external-openai-tts";
  const hasPipPackages = Array.isArray(engine.pip_packages) && engine.pip_packages.length > 0;
  let uninstallDeps = false;

  if (isExternal) {
    const ok = await confirmDialog({
      title: `Remove ${engine.id}?`,
      message: "The external server registration will be removed. The remote server itself is not affected.",
      danger: true,
      confirmLabel: "Remove",
    });
    if (!ok) return;
  } else if (hasPipPackages) {
    const choice = await promptDialog({
      title: `Uninstall ${engine.id}?`,
      message: "Model files will be removed from disk. You can also remove the Python packages this engine pulled in.",
      fields: [
        {
          key: "scope",
          label: "What to remove",
          type: "select",
          defaultValue: "files-only",
          options: [
            { value: "files-only", label: "Model files only" },
            { value: "files-and-deps", label: `Model files + Python packages (${engine.pip_packages.join(", ")})` },
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
      title: `Uninstall ${engine.id}?`,
      message: "Model files will be removed from disk.",
      danger: true,
      confirmLabel: "Uninstall",
    });
    if (!ok) return;
  }

  busy[engine.id] = "uninstall";
  try {
    let path;
    if (isExternal) {
      path = `/v1/engines/external/${encodeURIComponent(engine.id)}`;
    } else {
      path = `/v1/engines/${encodeURIComponent(engine.id)}`;
      if (uninstallDeps) path += "?uninstall_deps=true";
    }
    await api.request(path, { method: "DELETE" });
    await refresh();
    pushToast({
      message: `${engine.name || engine.id} ${isExternal ? "removed" : "uninstalled"}.`,
      kind: "success",
      duration: 4000,
    });
  } catch (e) {
    pushToast({ message: `${isExternal ? "Remove" : "Uninstall"} failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy[engine.id] = null;
  }
}

onMounted(() => { refresh(); loadSystem(); });
</script>

<template>
  <!-- ─── This machine — hardware probe ─── -->
  <section class="jv-section" v-if="system">
    <h3 class="jv-section__title">This machine</h3>
    <div class="jv-card engines-view__hw">
      <div class="engines-view__hw-cell">
        <div class="engines-view__hw-k">OS</div>
        <strong>{{ system.os }}</strong>
      </div>
      <div class="engines-view__hw-cell">
        <div class="engines-view__hw-k">CPU</div>
        <strong>{{ system.cpu_cores }}</strong>
        <span class="jv-muted">threads</span>
      </div>
      <div class="engines-view__hw-cell">
        <div class="engines-view__hw-k">Memory</div>
        <strong>{{ Math.round(system.ram_total_mb / 1024) }} GB</strong>
      </div>
      <div class="engines-view__hw-cell" v-for="(g, i) in system.gpus || []" :key="i">
        <div class="engines-view__hw-k">GPU {{ i + 1 }}</div>
        <strong>{{ g.name }}</strong>
        <span class="jv-muted" v-if="g.vram_mb">{{ (g.vram_mb / 1024).toFixed(1) }} GB VRAM</span>
      </div>
      <div class="engines-view__hw-cell">
        <div class="engines-view__hw-k">Acceleration</div>
        <span class="engines-view__hw-runtimes">
          <JvTag v-for="r in activeRuntimes" :key="r" :label="r" />
          <span v-if="!activeRuntimes.length" class="jv-muted">CPU only</span>
        </span>
      </div>
    </div>
  </section>

  <!-- ─── Engine catalog ─── -->
  <section class="jv-section">
    <h3 class="jv-section__title">Engines</h3>

    <p v-if="!engines.length" class="jv-banner jv-banner--warn">
      No engines listed — the Python server may not be running. Check
      <a href="#settings">Settings → Connection</a> for the server URL.
    </p>

    <!-- Tabs by kind. Hidden when only one kind has any engines. -->
    <div v-if="availableKinds.length > 1" class="engines-view__tabs">
      <button
        v-for="k in availableKinds"
        :key="k"
        type="button"
        class="engines-view__tab"
        :class="{ 'engines-view__tab--active': activeKind === k }"
        @click="activeKind = k"
      >{{ KIND_LABELS[k] }} ({{ enginesByKind[k].length }})</button>
    </div>

    <!-- Per-engine row: dropdown + selection-driven info + ONE contextual button -->
    <ul v-if="visibleEngines.length" class="engines-view__list">
      <li
        v-for="e in visibleEngines"
        :key="e.id"
        class="engines-view__engine"
        :data-status="e.status"
      >
        <header class="engines-view__head">
          <div class="engines-view__title">
            <strong>{{ e.name }}</strong>
            <span class="engines-view__id jv-muted">{{ e.id }}</span>
          </div>
          <span class="engines-view__status" :data-status="e.status">
            {{ e.status === 'loaded' ? '● Loaded' : e.status === 'installed' ? '✓ Installed' : '⊘ Not installed' }}
          </span>
        </header>

        <p v-if="e.description" class="engines-view__desc">{{ e.description }}</p>

        <!-- Model dropdown + contextual action button row. -->
        <div class="engines-view__pick">
          <label class="engines-view__pick-label">Model:</label>
          <select
            v-model="selectedVariants[e.id]"
            class="jv-input engines-view__pick-select"
            :disabled="busy[e.id] != null"
          >
            <option v-if="!variantsFor(e.id).length" value="">— no variants —</option>
            <option
              v-for="v in variantsFor(e.id)"
              :key="v.id"
              :value="v.id"
            >
              {{ v.name }}
              <template v-if="v.id === e.current_variant_id"> · loaded</template>
              <template v-else-if="v.id === e.default_variant_id"> · recommended</template>
              <template v-if="v.size_mb"> · {{ fmtDisk(v.size_mb) }}</template>
              <template v-if="v.vram_mb"> · {{ fmtDisk(v.vram_mb) }} VRAM</template>
            </option>
          </select>
          <span class="jv-spacer" />
          <!-- Contextual action button — Download / Load / Unload / etc. -->
          <JvButton
            :variant="contextualAction(e).variant"
            size="sm"
            :loading="contextualAction(e).busy"
            :disabled="contextualAction(e).disabled"
            :label="contextualAction(e).label"
            @click="contextualAction(e).action()"
          />
          <!-- Delete button — only enabled when at least one variant is on disk. -->
          <button
            type="button"
            class="jv-btn jv-btn--danger-outline jv-btn--sm"
            :disabled="e.status === 'not_installed' || busy[e.id] != null"
            @click="uninstall(e)"
          >Remove</button>
        </div>

        <!-- Selection-driven info panel: shows the SELECTED variant's
             detail (not the loaded one) so the user can audit before
             clicking Load / Download. -->
        <div v-if="selectedVariantFor(e)" class="engines-view__info">
          <div class="engines-view__info-row">
            <span class="engines-view__info-k">Size on disk</span>
            <span>{{ fmtDisk(selectedVariantFor(e).size_mb) }}</span>
          </div>
          <div class="engines-view__info-row" v-if="selectedVariantFor(e).vram_mb">
            <span class="engines-view__info-k">VRAM required</span>
            <span>{{ fmtDisk(selectedVariantFor(e).vram_mb) }}</span>
          </div>
          <div class="engines-view__info-row" v-if="selectedVariantFor(e).quality != null">
            <span class="engines-view__info-k">Quality</span>
            <span>{{ selectedVariantFor(e).quality }}/100</span>
          </div>
          <div class="engines-view__info-row" v-if="e.weights_license || e.attribution">
            <span class="engines-view__info-k">License</span>
            <span>{{ e.weights_license || 'Apache-2.0' }}<template v-if="e.attribution"> — must show "{{ e.attribution }}"</template></span>
          </div>
          <div class="engines-view__info-row" v-if="selectedVariantFor(e).description">
            <span class="engines-view__info-k">About</span>
            <span>{{ selectedVariantFor(e).description }}</span>
          </div>
        </div>

        <!-- Inline progress for active install / load — consumes phase
             events from EngineManager.load() (Phase 2 / Slice 1). -->
        <div v-if="progress[e.id]" class="engines-view__progress">
          <span class="engines-view__progress-phase jv-mono">{{ (progress[e.id].phase || '').toUpperCase() }}</span>
          <div class="engines-view__progress-track">
            <div
              class="engines-view__progress-fill"
              :class="{ 'engines-view__progress-fill--indeterminate': progress[e.id].bytes_total === 0 && progress[e.id].phase !== 'completed' }"
              :style="progress[e.id].bytes_total > 0 ? { width: pct(progress[e.id]) + '%' } : {}"
            />
          </div>
          <span class="engines-view__progress-bytes jv-mono" v-if="progress[e.id].bytes_total > 0">
            {{ (progress[e.id].bytes_downloaded / 1048576).toFixed(1) }} / {{ (progress[e.id].bytes_total / 1048576).toFixed(1) }} MB
          </span>
          <span v-if="progress[e.id].error" class="engines-view__progress-error">{{ progress[e.id].error }}</span>
        </div>
      </li>
    </ul>
    <p v-else-if="engines.length" class="jv-muted engines-view__empty">
      No {{ KIND_LABELS[activeKind] }} engines yet.
    </p>

    <p class="engines-view__foot jv-muted">
      <strong>One engine per kind</strong> — loading a new TTS engine unloads the prior TTS; LLM and embedding engines stay loaded independently. Shared engines (Kokoro, Chatterbox, LuxTTS, Qwen3, TADA) build their venv transparently on first load. Venv-isolated engines (Dia, MOSS) need a one-time Install before Load.
    </p>
  </section>
</template>

<style scoped>
.engines-view__hw {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
  gap: 16px 24px;
}
.engines-view__hw-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.engines-view__hw-k {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.engines-view__hw-runtimes {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 2px;
}

/* ── Kind tabs ────────────────────────────────────────────────────── */
.engines-view__tabs {
  display: flex;
  gap: 4px;
  margin: 6px 0 14px;
  border-bottom: 1px solid var(--border-soft);
}
.engines-view__tab {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 8px 14px;
  font: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
}
.engines-view__tab:hover { color: var(--ink); }
.engines-view__tab--active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}

/* ── Engine row ───────────────────────────────────────────────────── */
.engines-view__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.engines-view__engine {
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  background: var(--surface);
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: border-color 0.15s;
}
.engines-view__engine:hover {
  border-color: var(--border);
}
.engines-view__engine[data-status="loaded"] {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-line, transparent) inset;
}

.engines-view__head {
  display: flex;
  align-items: center;
  gap: 12px;
}
.engines-view__title {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex: 1;
}
.engines-view__title strong { font-size: 15px; }
.engines-view__id {
  font-family: var(--font-mono);
  font-size: 11px;
}

.engines-view__status {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  font-weight: 600;
  padding: 3px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-soft);
  background: var(--surface-2);
  color: var(--ink-2);
  white-space: nowrap;
}
.engines-view__status[data-status="loaded"] {
  background: var(--accent);
  color: var(--surface);
  border-color: var(--accent);
}
.engines-view__status[data-status="installed"] {
  color: var(--accent);
  border-color: var(--accent-line, var(--accent));
}
.engines-view__status[data-status="not_installed"] {
  border-style: dashed;
  color: var(--muted);
}

.engines-view__desc {
  margin: 0;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--ink-2);
}

.engines-view__pick {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.engines-view__pick-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}
.engines-view__pick-select {
  flex: 1 1 260px;
  min-width: 200px;
}

.engines-view__info {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 4px 12px;
  padding: 10px 12px;
  background: var(--surface-2);
  border-radius: 6px;
  font-size: 12.5px;
}
.engines-view__info-row {
  display: contents;
}
.engines-view__info-k {
  font-size: 10.5px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--ink-3);
  font-weight: 600;
}

/* ── Inline progress ──────────────────────────────────────────────── */
.engines-view__progress {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  font-size: 11px;
}
.engines-view__progress-phase {
  font-size: 10px;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--ink-2);
  min-width: 100px;
}
.engines-view__progress-track {
  flex: 1 1 200px;
  height: 6px;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  overflow: hidden;
  min-width: 140px;
}
.engines-view__progress-fill {
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}
.engines-view__progress-fill--indeterminate {
  width: 35% !important;
  animation: engineCardIndeterminate 1.4s ease-in-out infinite;
}
@keyframes engineCardIndeterminate {
  0%   { transform: translateX(-100%); }
  100% { transform: translateX(285%); }
}
.engines-view__progress-bytes {
  font-size: 10.5px;
  color: var(--muted);
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.engines-view__progress-error {
  font-size: 11px;
  color: var(--danger);
}

.engines-view__empty { padding: 16px 0; }

.engines-view__foot {
  margin-top: 18px;
  font-size: 11.5px;
  max-width: 880px;
  line-height: 1.55;
}
</style>
