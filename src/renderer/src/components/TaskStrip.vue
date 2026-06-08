<script setup>
/* Inline progress strip — adapted from JustWrite's AiTaskStrip pattern.
 * Renders one row per running task with elapsed, per-kind stats,
 * freshness chip, and cancel button.
 */
import { computed } from "vue";
import { useRenderTasks } from "../stores/renderTasks.js";

const props = defineProps({ task: { type: Object, required: true } });
const store = useRenderTasks();

const elapsed = computed(() => store.elapsedSeconds(props.task));
const fresh = computed(() => store.freshness(props.task));
const statList = computed(() => store.stats(props.task));
</script>

<template>
  <div class="task-strip" :data-status="task.status">
    <span class="task-spin" :data-status="task.status"></span>
    <span class="task-label">{{ task.label }}</span>
    <span class="task-stat">{{ elapsed }}s</span>
    <span v-for="(s, i) in statList" :key="i" class="task-stat">{{ s }}</span>
    <span v-if="fresh" class="task-stat" :data-fresh="fresh">
      <span class="task-dot"></span>
      <template v-if="fresh === 'fresh'">live</template>
      <template v-else-if="fresh === 'stalling'">stalling</template>
      <template v-else>stuck</template>
    </span>
    <span v-if="task.status === 'completed'" class="task-stat" style="color: var(--success)">done</span>
    <span v-if="task.status === 'failed'" class="task-stat" style="color: var(--danger)">failed</span>
    <div v-if="task.percent != null" class="task-track">
      <div class="task-fill" :style="{ width: task.percent + '%' }"></div>
    </div>
    <span class="task-spacer"></span>
    <button
      v-if="task.onCancel && task.status === 'running'"
      class="bare"
      @click="store.cancel(task.id)">
      Cancel
    </button>
  </div>
</template>
