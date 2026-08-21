<!-- SPDX-License-Identifier: MIT -->
<!--
  AudioChannelsView — named audio output configs for multi-device routing.
  OBS / multi-monitor / per-character podcast monitoring use cases.

  Voice profiles assigned to channels with non-default device IDs use native
  playback via Tauri IPC (list_audio_output_devices + play_audio_to_devices).
-->
<script setup>
import { onMounted, ref } from "vue";
import { channelsService } from "../services/projects.js";
import { listAudioOutputDevices } from "../services/native.js";
import { pushToast } from "@delebash/llm-ui";
import { confirmDialog } from "@delebash/llm-ui";
import { UiButton, UiInput, UiTextarea, UiField, UiCheckbox, UiTag, UiTable } from "@delebash/llm-ui";

// The kit grid in the JustVoice look (`jv-table-look`). Sorting comes with it.
const CHANNEL_COLUMNS = [
  { id: "name", accessorKey: "name", header: "Name", sortable: true },
  { id: "is_default", accessorKey: "is_default", header: "Default", sortable: true },
  { id: "devices", header: "Devices" },
  { id: "actions", header: "", headerStyle: { width: "1%" }, cellStyle: { width: "1%", whiteSpace: "nowrap" } },
];

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
  // services/native.js — the one place a command name is written. Returns [] in
  // a browser (and today in the desktop app too: the command is a placeholder).
  tauriDevices.value = await listAudioOutputDevices();
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
    <!-- Tab strip already says "Channels" — explainer lede only, no
         duplicate title (same treatment as the Labs sub-views). -->
    <header class="jv-section">
      <p class="jv-muted" style="margin-top: 4px; margin-bottom: 0;">Route specific voices to specific audio outputs. Multi-device broadcast supported (e.g. play through speakers AND OBS virtual mic).</p>
    </header>

    <div class="jv-section">
      <!-- The empty state was a `colspan` row inside <tbody>, so the header
           drew above it; `#empty` is the component's own and keeps no column
           count in step. -->
      <UiTable class="jv-table-look" :data="channels" :columns="CHANNEL_COLUMNS" data-key="id" row-hover>
        <template #name="{ row }"><strong>{{ row.name }}</strong></template>
        <template #is_default="{ row }">
          <UiTag v-if="row.is_default" intent="success">Default</UiTag>
          <span v-else class="jv-muted">—</span>
        </template>
        <template #devices="{ row }">
          <span class="jv-muted">{{ row.device_ids?.length || 0 }} device(s)</span>
        </template>
        <template #actions="{ row }">
          <div class="jv-table__actions">
            <UiButton intent="secondary" size="small" label="Edit" @click="editChannel(row)" />
            <UiButton intent="danger-outline" size="small" label="Delete" @click="deleteChannel(row)" />
          </div>
        </template>
        <template #empty>No channels configured. Add one below to route voices to specific outputs.</template>
      </UiTable>
    </div>

    <section class="jv-card jv-card--soft editor-card">
      <h3 class="jv-section__title" style="margin-bottom: 16px;">{{ editing.id ? "Edit channel" : "Add channel" }}</h3>

      <UiField label="Name" layout="block">
        <UiInput v-model="editing.name" placeholder="e.g. OBS virtual mic" width="name" />
      </UiField>

      <UiField label="Devices (comma-separated IDs)" layout="block">
        <UiTextarea
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
      </UiField>

      <UiField label="" layout="block" style="margin-top: 8px;">
        <UiCheckbox
          v-model="editing.is_default"
          label="Default channel (used when a voice has no explicit channel assignment)"
        />
      </UiField>

      <div class="jv-btn-group" style="margin-top: 16px;">
        <UiButton intent="primary" :disabled="!editing.name" :label="editing.id ? 'Update' : 'Add'" @click="save" />
        <UiButton v-if="editing.id" intent="secondary" label="Cancel" @click="editing = { id: null, name: '', device_ids: [], is_default: false }" />
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
