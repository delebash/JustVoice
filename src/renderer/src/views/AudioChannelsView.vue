<!-- SPDX-License-Identifier: GPL-3.0-or-later -->
<!--
  AudioChannelsView — named audio output configs for multi-device routing.
  OBS / multi-monitor / per-character podcast monitoring use cases.

  Voice profiles assigned to channels with non-default device IDs use native
  playback via Tauri IPC (list_audio_output_devices + play_audio_to_devices).
-->
<script setup>
import { onMounted, ref } from "vue";
import { channelsService } from "../services/projects.js";
import { pushToast } from "../services/toastBridge.js";

const channels = ref([]);
const editing = ref({ id: null, name: "", device_ids: [], is_default: false });
const tauriDevices = ref([]);

async function refresh() {
  try {
    const res = await channelsService.list();
    channels.value = res.channels ?? [];
  } catch (e) {
    pushToast({ kind: "error", title: "Couldn't load channels", description: String(e?.message ?? e) });
  }
}

async function loadDevices() {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    tauriDevices.value = await invoke("list_audio_output_devices");
  } catch {
    // Not running in Tauri; web build has no native device list.
  }
}

async function save() {
  try {
    if (editing.value.id) {
      await channelsService.update(editing.value.id, {
        name: editing.value.name,
        device_ids: editing.value.device_ids,
        is_default: editing.value.is_default,
      });
    } else {
      await channelsService.create({
        name: editing.value.name,
        device_ids: editing.value.device_ids,
        is_default: editing.value.is_default,
      });
    }
    editing.value = { id: null, name: "", device_ids: [], is_default: false };
    await refresh();
    pushToast({ kind: "success", title: "Channel saved" });
  } catch (e) {
    pushToast({ kind: "error", title: "Save failed", description: String(e?.message ?? e) });
  }
}

async function deleteChannel(c) {
  if (!confirm(`Delete channel '${c.name}'?`)) return;
  try {
    await channelsService.remove(c.id);
    await refresh();
  } catch (e) {
    pushToast({ kind: "error", title: "Delete failed", description: String(e?.message ?? e) });
  }
}

function editChannel(c) {
  editing.value = {
    id: c.id,
    name: c.name,
    device_ids: [...(c.device_ids || [])],
    is_default: c.is_default,
  };
}

onMounted(() => {
  refresh();
  loadDevices();
});
</script>

<template>
  <div class="channels">
    <header>
      <h2>Audio output channels</h2>
      <p class="lede">Route specific voices to specific audio outputs. Multi-device broadcast supported (e.g. play through speakers AND OBS virtual mic).</p>
    </header>

    <table class="channels__table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Default</th>
          <th>Devices</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        <tr v-if="channels.length === 0">
          <td colspan="4" class="channels__empty">No channels configured. Add one below to route voices to specific outputs.</td>
        </tr>
        <tr v-for="c in channels" :key="c.id">
          <td>{{ c.name }}</td>
          <td>{{ c.is_default ? "✓" : "" }}</td>
          <td>{{ c.device_ids?.length || 0 }} device(s)</td>
          <td>
            <button class="btn" @click="editChannel(c)">Edit</button>
            <button class="btn btn--danger" @click="deleteChannel(c)">Delete</button>
          </td>
        </tr>
      </tbody>
    </table>

    <section class="channels__editor">
      <h3>{{ editing.id ? "Edit channel" : "Add channel" }}</h3>
      <div class="form-row">
        <label>Name</label>
        <input type="text" v-model="editing.name" placeholder="e.g. OBS virtual mic" />
      </div>
      <div class="form-row">
        <label>Devices (comma-separated IDs)</label>
        <textarea v-model.lazy="editing.device_ids" placeholder="device-id-1, device-id-2"
                  @input="editing.device_ids = $event.target.value.split(',').map((s) => s.trim()).filter(Boolean)"></textarea>
        <details v-if="tauriDevices.length > 0">
          <summary>{{ tauriDevices.length }} system audio devices detected</summary>
          <ul>
            <li v-for="d in tauriDevices" :key="d.id">{{ d.name }} <code>{{ d.id }}</code></li>
          </ul>
        </details>
      </div>
      <div class="form-row">
        <label class="form-row__inline">
          <input type="checkbox" v-model="editing.is_default" />
          <span>Default channel (used when a voice has no explicit channel assignment)</span>
        </label>
      </div>
      <div class="form-actions">
        <button class="btn btn--primary" @click="save" :disabled="!editing.name">{{ editing.id ? "Update" : "Add" }}</button>
        <button v-if="editing.id" class="btn" @click="editing = { id: null, name: '', device_ids: [], is_default: false }">Cancel</button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.channels { padding: 32px; max-width: 900px; }
.lede { color: var(--ink-2, #4a4a4a); margin: 4px 0 24px; }
.channels__table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
.channels__table th, .channels__table td { padding: 8px 12px; border-bottom: 1px solid var(--line, #e3e1dc); text-align: left; font-size: 13px; }
.channels__table th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3, #888); }
.channels__empty { color: var(--ink-3, #888); font-style: italic; text-align: center; padding: 20px; }
.channels__editor { background: var(--surface-2, #fbfaf7); border: 1px solid var(--line, #e3e1dc); border-radius: 6px; padding: 20px; }
.channels__editor h3 { margin: 0 0 12px; }
.form-row { margin-bottom: 12px; }
.form-row label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-3, #888); margin-bottom: 4px; }
.form-row__inline { display: flex; gap: 8px; align-items: center; text-transform: none; letter-spacing: 0; color: inherit; font-size: 13px; }
.form-row input[type="text"], .form-row textarea { width: 100%; padding: 8px 12px; border: 1px solid var(--line, #e3e1dc); border-radius: 6px; font-size: 13px; }
.form-row textarea { min-height: 60px; resize: vertical; }
.form-row details { margin-top: 8px; font-size: 12px; color: var(--ink-2, #4a4a4a); }
.form-row details ul { margin: 4px 0 0; padding-left: 20px; }
.form-row details code { font-size: 11px; opacity: 0.7; }
.form-actions { display: flex; gap: 8px; }
.btn { height: 32px; padding: 0 16px; border-radius: 6px; font-size: 13px; font-weight: 500; cursor: pointer; border: 1px solid var(--line-strong, #cfccc4); background: var(--surface-2, #fbfaf7); color: inherit; }
.btn--primary { background: var(--accent, #3a7d63); color: #fff; border-color: var(--accent, #3a7d63); }
.btn--danger { background: transparent; color: var(--danger, #a8442e); border-color: var(--danger, #a8442e); }
.btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
