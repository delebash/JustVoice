// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * useTakesStore — per-block take versioning state.
 *
 * Keyed by block_id. Tracks all takes for each block,
 * which take is currently displayed (activeTakeId), and
 * whether the list has been fetched (loaded).
 */
import { defineStore } from "pinia";
import { ref } from "vue";
import { takesService } from "../services/projects.js";

export const useTakesStore = defineStore("takes", () => {
  // Map<block_id, Take[]> — all takes returned from server, newest first.
  const takes = ref(new Map());

  // Set<block_id> — blocks whose takes have been loaded at least once.
  const loaded = ref(new Set());

  // Map<block_id, take_id> — which take is currently displayed in the UI.
  // This is the "active" (selected) take for navigation, independent of
  // is_default.  Initialised to the default take when the list loads.
  const activeTakeIds = ref(new Map());

  // Map<block_id, boolean> — true while the list is being fetched.
  const loading = ref(new Map());

  async function fetchTakes(blockId) {
    if (loading.value.get(blockId)) return;
    loading.value.set(blockId, true);
    try {
      const res = await takesService.byBlock(blockId);
      takes.value.set(blockId, res.takes || []);
      loaded.value.add(blockId);
      // If no active take is set yet, default to the server's default_take_id,
      // then to the first take, then leave null.
      if (!activeTakeIds.value.has(blockId)) {
        const defaultId = res.default_take_id || (res.takes?.[0]?.id) || null;
        activeTakeIds.value.set(blockId, defaultId);
      }
    } finally {
      loading.value.set(blockId, false);
    }
  }

  function getTakes(blockId) {
    return takes.value.get(blockId) || [];
  }

  function getActiveTakeId(blockId) {
    return activeTakeIds.value.get(blockId) || null;
  }

  function getActiveTake(blockId) {
    const id = getActiveTakeId(blockId);
    if (!id) return null;
    return getTakes(blockId).find((t) => t.id === id) || null;
  }

  function setActiveTakeId(blockId, takeId) {
    activeTakeIds.value.set(blockId, takeId);
  }

  function navigatePrev(blockId) {
    const list = getTakes(blockId);
    if (!list.length) return;
    const cur = getActiveTakeId(blockId);
    const idx = list.findIndex((t) => t.id === cur);
    if (idx < 0) {
      activeTakeIds.value.set(blockId, list[0].id);
    } else if (idx < list.length - 1) {
      activeTakeIds.value.set(blockId, list[idx + 1].id);
    }
  }

  function navigateNext(blockId) {
    const list = getTakes(blockId);
    if (!list.length) return;
    const cur = getActiveTakeId(blockId);
    const idx = list.findIndex((t) => t.id === cur);
    if (idx < 0) {
      activeTakeIds.value.set(blockId, list[0].id);
    } else if (idx > 0) {
      activeTakeIds.value.set(blockId, list[idx - 1].id);
    }
  }

  async function promoteToDefault(takeId, blockId) {
    await takesService.setDefault(takeId);
    await fetchTakes(blockId);
    // Keep the promoted take selected.
    activeTakeIds.value.set(blockId, takeId);
  }

  async function removeTake(takeId, blockId) {
    await takesService.remove(takeId);
    const prev = activeTakeIds.value.get(blockId);
    await fetchTakes(blockId);
    // If we deleted the currently active take, fall back to default.
    if (prev === takeId) {
      const list = takes.value.get(blockId) || [];
      const defaultId = list.find((t) => t.is_default)?.id || list[0]?.id || null;
      activeTakeIds.value.set(blockId, defaultId);
    }
  }

  async function relabelTake(takeId, blockId, label) {
    await takesService.update(takeId, { label });
    await fetchTakes(blockId);
  }

  function invalidate(blockId) {
    loaded.value.delete(blockId);
    takes.value.delete(blockId);
    activeTakeIds.value.delete(blockId);
  }

  return {
    takes,
    loaded,
    activeTakeIds,
    loading,
    fetchTakes,
    getTakes,
    getActiveTakeId,
    getActiveTake,
    setActiveTakeId,
    navigatePrev,
    navigateNext,
    promoteToDefault,
    removeTake,
    relabelTake,
    invalidate,
  };
});
