<!-- SPDX-License-Identifier: MIT -->
<!--
  The kit's AI task strip for each task this page started (decided 2026-10-05:
  a page shows only its own tasks; the app-wide strip went). `features` names
  the tasks, `meta` narrows them to this page's project or chapter — the same
  keys the page stamps on the task. Running, done, failed or cancelled, each
  strip keeps the kit's own lifetime (a failure stays until dismissed).
-->
<script setup>
import { computed } from "vue";
import { AiTaskStrip, useAiTasksStore } from "@delebash/llm-ui";
import { pageTasks } from "../services/pageTasks.js";

const props = defineProps({
  features: { type: Array, required: true },
  meta: { type: Object, default: () => ({}) },
});

const tasks = useAiTasksStore();
const mine = computed(() => pageTasks(tasks, props.features, props.meta));
</script>

<template>
  <div v-if="mine.length" class="jv-task-strips">
    <AiTaskStrip v-for="t in mine" :key="t.id" :task="t" />
  </div>
</template>
