<script setup>
import { ref, onMounted } from "vue";
import { useApi } from "../stores/api.js";
import { useRenderTasks } from "../stores/renderTasks.js";
import { pushToast } from "../services/toastBridge.js";
import { confirmDialog } from "../services/dialog.js";

const api = useApi();
const tasks = useRenderTasks();
const engines = ref([]);
const busy = ref({});

async function refresh() {
  const e = await api.request("/v1/engines");
  engines.value = e.engines;
}

async function install(id) {
  busy.value[id] = "install";
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
      body: JSON.stringify({}),
    });
    const jobId = accepted.job_id;
    while (true) {
      const job = await api.request(`/v1/jobs/${jobId}`);
      const pct = job.bytes_total > 0 ? Math.round(100 * (job.bytes_downloaded || 0) / job.bytes_total) : null;
      tasks.update(task.id, {
        percent: pct,
        meta: {
          phase: job.phase,
          bytesDl: job.bytes_downloaded || 0,
          bytesTotal: job.bytes_total || 0,
        },
      });
      if (job.phase === "completed") {
        tasks.finish(task.id);
        pushToast({ message: `${id} installed. Click Load to use it.`, duration: 5000 });
        break;
      }
      if (job.phase === "failed") {
        tasks.fail(task.id, job.error || "unknown error");
        pushToast({ message: `${id} install failed: ${job.error || "unknown"}`, kind: "error", duration: 8000 });
        break;
      }
      await new Promise((r) => setTimeout(r, 800));
    }
    await refresh();
  } catch (e) {
    tasks.fail(task.id, String(e.message || e));
    pushToast({ message: `Install failed: ${e.message || e}`, kind: "error", duration: 8000 });
  } finally {
    busy.value[id] = null;
  }
}

async function load(id) {
  busy.value[id] = "load";
  try {
    await api.request(`/v1/engines/${id}/load`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device: "auto" }),
    });
    await refresh();
    pushToast({ message: `${id} loaded.` });
  } catch (e) {
    pushToast({ message: `Load failed: ${e.message || e}`, kind: "error", duration: 8000 });
  } finally {
    busy.value[id] = null;
  }
}

async function unload() {
  try {
    const resp = await api.request("/v1/engines/unload", { method: "POST" });
    await refresh();
    pushToast({ message: resp?.previous_engine ? `${resp.previous_engine} unloaded — VRAM freed.` : "No engine was loaded." });
  } catch (e) {
    pushToast({ message: `Unload failed: ${e.message || e}`, kind: "error" });
  }
}

async function uninstall(id) {
  const ok = await confirmDialog({
    title: `Uninstall ${id}?`,
    message: "Model files will be removed from disk.",
    danger: true,
    confirmLabel: "Uninstall",
  });
  if (!ok) return;
  busy.value[id] = "uninstall";
  try {
    await api.request(`/v1/engines/${id}`, { method: "DELETE" });
    await refresh();
    pushToast({ message: `${id} uninstalled.` });
  } catch (e) {
    pushToast({ message: `Uninstall failed: ${e.message || e}`, kind: "error" });
  } finally {
    busy.value[id] = null;
  }
}

onMounted(refresh);
</script>

<template>
  <section class="block">
    <h3>Engines ({{ engines.length }})</h3>
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
        <tr v-for="e in engines" :key="e.id">
          <td>
            <strong>{{ e.name }}</strong>
            <div class="endnote">{{ e.description }}</div>
          </td>
          <td class="mono">{{ e.backend }}</td>
          <td>
            <span class="status" :class="e.status">{{ e.status.replace("_", " ") }}</span>
          </td>
          <td>{{ e.prerequisites.disk_space_mb >= 1024 ? (e.prerequisites.disk_space_mb / 1024).toFixed(1) + " GB" : e.prerequisites.disk_space_mb + " MB" }}</td>
          <td>
            <button v-if="e.status === 'not_installed'" class="primary" :disabled="busy[e.id]" @click="install(e.id)">
              {{ busy[e.id] === "install" ? "Installing…" : "Install" }}
            </button>
            <button v-else-if="e.status === 'installed'" class="primary" :disabled="busy[e.id]" @click="load(e.id)">
              {{ busy[e.id] === "load" ? "Loading…" : "Load" }}
            </button>
            <button v-else-if="e.status === 'loaded'" class="bare" @click="unload">Unload</button>
            <button v-if="e.status !== 'not_installed'" class="bare danger" :disabled="busy[e.id]" @click="uninstall(e.id)" style="margin-left: 8px">
              {{ busy[e.id] === "uninstall" ? "Uninstalling…" : "Uninstall" }}
            </button>
          </td>
        </tr>
      </tbody>
    </table>
  </section>
</template>

<style scoped>
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; color: var(--muted); }
td { padding: 12px 10px; border-bottom: 1px solid var(--border-soft); vertical-align: top; }
.endnote { font-size: 11px; color: var(--muted); margin-top: 4px; max-width: 60ch; }
.mono { font-family: var(--font-mono); font-size: 11px; }
.status { font-family: var(--font-mono); font-size: 11px; padding: 2px 8px; background: var(--surface-3); }
.status.loaded { background: var(--success-soft, #dcefdc); color: var(--success, #2d9d2d); }
.status.installed { background: var(--accent-soft); color: var(--accent-ink); }
button.primary { background: var(--ink); color: var(--surface); border: 1px solid var(--ink); padding: 6px 14px; cursor: pointer; font-size: 13px; }
button.bare { background: none; border: none; color: var(--muted); padding: 6px 10px; cursor: pointer; }
button.bare.danger { color: var(--danger); }
</style>
