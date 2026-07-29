// SPDX-License-Identifier: MIT
/**
 * generationStore — in-flight generation tracking + deferred story-add queue.
 */
import { defineStore } from "pinia";
import { computed, ref } from "vue";

export const useGenerationStore = defineStore("generation", () => {
  const pendingIds = ref(new Set());
  const pendingStoryAdds = ref(new Map());
  const activeGenerationId = ref(null);

  const isGenerating = computed(() => pendingIds.value.size > 0);

  function addPending(id) {
    const next = new Set(pendingIds.value);
    next.add(id);
    pendingIds.value = next;
  }
  function removePending(id) {
    const next = new Set(pendingIds.value);
    next.delete(id);
    pendingIds.value = next;
  }
  function addStoryAdd(generationId, storyId) {
    const next = new Map(pendingStoryAdds.value);
    next.set(generationId, storyId);
    pendingStoryAdds.value = next;
  }
  function removeStoryAdd(generationId) {
    const storyId = pendingStoryAdds.value.get(generationId);
    if (storyId) {
      const next = new Map(pendingStoryAdds.value);
      next.delete(generationId);
      pendingStoryAdds.value = next;
    }
    return storyId;
  }
  function setActiveGenerationId(id) {
    activeGenerationId.value = id;
  }

  return {
    pendingIds,
    pendingStoryAdds,
    activeGenerationId,
    isGenerating,
    addPending,
    removePending,
    addStoryAdd,
    removeStoryAdd,
    setActiveGenerationId,
  };
});
