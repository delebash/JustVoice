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
import { confirmDialog } from "../services/dialog.js";
import JvButton from "../components/jv/JvButton.vue";
import JvInput from "../components/jv/JvInput.vue";
import JvTextarea from "../components/jv/JvTextarea.vue";
import JvCheckbox from "../components/jv/JvCheckbox.vue";
import JvField from "../components/jv/JvField.vue";

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
  const ok = await confirmDialog({
    title: "Delete channel?",
    message: `Delete channel '${c.name}'?`,
    danger: true,
    confirmLabel: "Delete",
  });
  if (!ok) return;
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
  <div class="channels-view">
    <header class="jv-section">
      <h2 class="jv-section__title">Audio output channels</h2>
      <p class="jv-muted" style="margin-top: 4px; margin-bottom: 0;">Route specific voices to specific audio outputs. Multi-device broadcast supported (e.g. play through speakers AND OBS virtual mic).</p>
    </header>

    <div class="jv-section">
      <table class="jv-table">
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
            <td colspan="4" class="jv-table__empty">No channels configured. Add one below to route voices to specific outputs.</td>
          </tr>
          <tr v-for="c in channels" :key="c.id">
            <td><strong>{{ c.name }}</strong></td>
            <td>
              <span v-if="c.is_default" class="jv-pill jv-pill--green">Default</span>
              <span v-else class="jv-muted">—</span>
            </td>
            <td class="jv-muted">{{ c.device_ids?.length || 0 }} device(s)</td>
            <td>
              <div class="jv-table__actions">
                <JvButton variant="secondary" size="sm" label="Edit" @click="editChannel(c)" />
                <JvButton variant="danger-outline" size="sm" label="Delete" @click="deleteChannel(c)" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <section class="jv-card jv-card--soft editor-card">
      <h3 class="jv-section__title" style="margin-bottom: 16px;">{{ editing.id ? "Edit channel" : "Add channel" }}</h3>

      <JvField label="Name" layout="block">
        <JvInput v-model="editing.name" placeholder="e.g. OBS virtual mic" width="name" />
      </JvField>

      <JvField label="Devices (comma-separated IDs)" layout="block">
        <JvTextarea
          :model-value="editing.device_ids.join(', ')"
          placeholder="device-id-1, device-id-2"
          :rows="3"
          @update:model-value="editing.device_ids = $event.split(',').map((s) => s.trim()).filter(Boolean)"
        />
        <details v-if="tauriDevices.length > 0" class="devices-details">
          <summary>{{ tauriDevices.length }} system audio devices detected</summary>
          <ul>
            <li v-for="d in tauriDevices" :key="d.id">{{ d.name }} <code class="jv-mono">{{ d.id }}</code></li>
          </ul>
        </details>
      </JvField>

      <JvField label="" layout="block" style="margin-top: 8px;">
        <JvCheckbox
          v-model="editing.is_default"
          label="Default channel (used when a voice has no explicit channel assignment)"
        />
      </JvField>

      <div class="jv-btn-group" style="margin-top: 16px;">
        <JvButton variant="primary" :disabled="!editing.name" :label="editing.id ? 'Update' : 'Add'" @click="save" />
        <JvButton v-if="editing.id" variant="secondary" label="Cancel" @click="editing = { id: null, name: '', device_ids: [], is_default: false }" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.channels-view { padding: 32px; max-width: var(--shell-form); }
.editor-card { margin-top: 8px; }
.devices-details { margin-top: 8px; font-size: 12px; color: var(--ink-2); }
.devices-details ul { margin: 4px 0 0; padding-left: 20px; }
</style>
