// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * audioChannelStore — named audio output configs (multi-device routing).
 * Persisted to localStorage (key: justvoice-audio-channels). Server holds
 * the source of truth in /v1/channels; this store caches for fast UI render.
 */
import { defineStore } from "pinia";
import { ref, watch } from "vue";

const STORAGE_KEY = "justvoice-audio-channels";

function loadInitial() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* */
  }
  return { channels: [] };
}

export const useAudioChannelStore = defineStore("audioChannel", () => {
  const persisted = loadInitial();
  const channels = ref(Array.isArray(persisted.channels) ? persisted.channels : []);

  function setChannels(list) {
    channels.value = [...list];
  }
  function addChannel(channel) {
    channels.value = [...channels.value, channel];
  }
  function updateChannel(id, updates) {
    channels.value = channels.value.map((c) => (c.id === id ? { ...c, ...updates } : c));
  }
  function removeChannel(id) {
    channels.value = channels.value.filter((c) => c.id !== id);
  }

  watch(
    channels,
    (v) => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ channels: v }));
      } catch {
        /* */
      }
    },
    { deep: true },
  );

  return { channels, setChannels, addChannel, updateChannel, removeChannel };
});
