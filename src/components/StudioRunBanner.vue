<!-- SPDX-License-Identifier: MIT -->
<!--
  One step's part of the book's chapter run: Discover's scan on Discover,
  Script's Analyze on Script's chapter grid. The two steps share one queue per
  book (services/chapterRun.js — one model, one chapter at a time), but a page
  shows only its own step (decided 2026-10-05): it was one banner for the whole
  queue on both pages, so Discover looked busy while Script ran.

  Two parts, each saying only its own (decided 2026-10-05):
  - the banner is the step's batch — "🔍 Discover · scanning 4 chapters ·
    1 of 4 done · 0:42 · about 2 min left", the bar, Cancel (this step only);
  - the strip under it is the chapter being read now — the kit's task strip,
    "Discover · scan · The Keystone", the prompt reading, the tokens, Retry —
    or the step's last finished one, so a failure stays readable.
  A step queued behind the other is one line, no bar: "🔍 Discover · 2
  chapters — waiting for Script to finish", with its Cancel.
-->
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AiTaskStrip, UiButton, UiProgress, useAiTasksStore } from "@delebash/llm-ui";
import { useCopy } from "../services/copy.js";
import { cancelRun, runStripTask, stepRun } from "../services/chapterRun.js";

const props = defineProps({
  project: { type: Object, required: true },
  // Whose step this page is: "discover" | "analyze" (Script).
  kind: { type: String, required: true },
});

// The step's name leads everywhere outside its own button (2026-10-05).
const STEPS = {
  discover: { icon: "🔍", name: "Discover", verb: "scanning" },
  analyze: { icon: "📜", name: "Script", verb: "analyzing" },
};
const me = computed(() => STEPS[props.kind]);
const other = computed(() => STEPS[props.kind === "discover" ? "analyze" : "discover"]);

const tasks = useAiTasksStore();
const copy = useCopy();
const word = computed(() => copy.value.chapter);
const chapters = (n) => `${n} ${(n === 1 ? word.value.singular : word.value.plural).toLowerCase()}`;

const step = computed(() => stepRun(props.project.id, props.kind));
const running = computed(() => !!step.value?.running);
const task = computed(() => runStripTask(tasks, props.project.id, props.kind));

// A second's tick for the elapsed time while the step runs.
const now = ref(Date.now());
let timer = null;
watch(running, (on) => {
  clearInterval(timer);
  if (on) timer = setInterval(() => { now.value = Date.now(); }, 1000);
}, { immediate: true });
onBeforeUnmount(() => clearInterval(timer));

const clock = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const left = (ms) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `about ${s} s left` : `about ${Math.round(s / 60)} min left`;
};
const line = computed(() => {
  const s = step.value;
  if (!s?.running) return "";
  const bits = [`${s.finished} of ${s.total} done`, clock(now.value - s.startedAt)];
  // Only once a chapter has finished is there anything to estimate from — the
  // step's own time per chapter, not time spent waiting behind the other step.
  if (s.finished > 0) bits.push(left((s.spent / s.finished) * (s.total - s.finished)));
  return bits.join(" · ");
});
</script>

<template>
  <div v-if="step || task" class="jv-task-strips">
    <div v-if="running" class="jv-banner studio-run__bar">
      <strong>{{ me.icon }} {{ me.name }} · {{ me.verb }} {{ chapters(step.total) }}</strong>
      <span class="jv-hint">{{ line }}</span>
      <UiProgress class="studio-run__progress" :value="step.finished" :max="step.total" bare />
      <span class="jv-hint">Keeps running while you work elsewhere.</span>
      <span class="jv-spacer" />
      <UiButton intent="secondary" size="small" label="Cancel"
        :title="`Stops ${me.name}'s run. ${word.plural} already done are kept.`"
        @click="cancelRun(project.id, kind)" />
    </div>
    <div v-else-if="step?.waiting" class="jv-banner studio-run__bar">
      <strong>{{ me.icon }} {{ me.name }} · {{ chapters(step.queued) }}</strong>
      <span class="jv-hint">— waiting for {{ other.name }} to finish</span>
      <span class="jv-spacer" />
      <UiButton intent="secondary" size="small" label="Cancel"
        :title="`Takes these ${word.plural.toLowerCase()} out of the queue.`"
        @click="cancelRun(project.id, kind)" />
    </div>
    <AiTaskStrip v-if="task" :task="task" />
  </div>
</template>

<style scoped>
.studio-run__bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 0; }
.studio-run__progress { flex: 0 1 220px; min-width: 120px; }
</style>
