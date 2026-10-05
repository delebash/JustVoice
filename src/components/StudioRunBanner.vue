<!-- SPDX-License-Identifier: MIT -->
<!--
  The book's chapter run, on Discover and on Script's chapter grid (one banner
  for both, 2026-10-05 — it was Script's alone, so Discover showed no progress).
  Discover's scan and Script's Analyze share one run per book
  (services/chapterRun.js): the banner says which is running, on which chapter,
  done of total, the time so far and about how long is left, with Cancel. Under
  it, the strip of the chapter running now — or the last one that finished, so
  a failure stays readable.
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AiTaskStrip, UiButton, UiProgress, useAiTasksStore } from "@delebash/llm-ui";
import { useCopy } from "../services/copy.js";
import { cancelRun, chapterRunFor, runStripTask } from "../services/chapterRun.js";

const props = defineProps({
  project: { type: Object, required: true },
});

const tasks = useAiTasksStore();
const copy = useCopy();
const word = computed(() => copy.value.chapter);
const lower = (n) => (n === 1 ? word.value.singular : word.value.plural).toLowerCase();

const run = computed(() => chapterRunFor(props.project.id));
const running = computed(() => !!run.value?.current);
const task = computed(() => runStripTask(tasks, props.project.id));

// A second's tick for the elapsed time while a run is going.
const now = ref(Date.now());
let timer = null;
watch(running, (on) => {
  clearInterval(timer);
  if (on) timer = setInterval(() => { now.value = Date.now(); }, 1000);
}, { immediate: true });
onBeforeUnmount(() => clearInterval(timer));

function secs(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}
const line = computed(() => {
  const r = run.value;
  if (!r?.current) return "";
  const elapsed = now.value - r.startedAt;
  const bits = [`${r.current.title || word.value.singular}`, `${r.finished} of ${r.total} done`, secs(elapsed)];
  // Only once a chapter has finished is there anything to estimate from.
  if (r.finished > 0) bits.push(`about ${secs((elapsed / r.finished) * (r.total - r.finished))} left`);
  return bits.join(" · ");
});
</script>

<template>
  <div v-if="running || task" class="studio-run">
    <div v-if="running" class="jv-banner studio-run__bar">
      <strong>{{ run.current.kind === "analyze" ? "✨ Analyze" : "🔍 Discover" }} · {{ run.total }} {{ lower(run.total) }}</strong>
      <span class="jv-hint">{{ line }}</span>
      <UiProgress class="studio-run__progress" :value="run.finished" :max="run.total" bare />
      <span class="jv-hint">Keeps running while you work elsewhere.</span>
      <span class="jv-spacer" />
      <UiButton intent="secondary" size="small" label="Cancel"
        :title="`Stops the run. ${word.plural} already done are kept.`"
        @click="cancelRun(project.id)" />
    </div>
    <AiTaskStrip v-if="task" :task="task" />
  </div>
</template>

<style scoped>
.studio-run { display: flex; flex-direction: column; gap: 8px; margin: 0 0 10px; }
.studio-run__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0; }
.studio-run__progress { flex: 0 1 220px; min-width: 120px; }
</style>
