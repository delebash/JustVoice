<!-- SPDX-License-Identifier: MIT -->
<!--
  Under a failed model load on the boot splash (decided 2026-09-29): when
  speech engines from an earlier session are still running, say what they
  hold and offer to stop them. On 2026-09-29 two leftover Whisper processes
  held 1.6 GB of an 8 GB card and the model could not load; the kit's message
  names every process holding GPU memory, this names ours and stops them.
  Renders nothing when there are none. Filled into the kit BootModelLoad's
  #failed slot; `task.retry()` is the bar's own Retry.
-->
<script setup>
import { computed, onMounted, ref } from "vue";
import { UiButton, pushToast } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";

const props = defineProps({
  task: { type: Object, required: true },
});

const api = useApi();
const found = ref(null);
const busy = ref(false);

onMounted(async () => {
  try {
    found.value = await api.request("/v1/engines/leftovers");
  } catch {
    found.value = null;
  }
});

function fmtMb(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

// "2 Whisper processes and 1 Kokoro process"
const who = computed(() => {
  const counts = new Map();
  for (const lo of found.value?.leftovers || []) {
    counts.set(lo.engine_name, (counts.get(lo.engine_name) || 0) + 1);
  }
  const parts = [...counts].map(([name, n]) => `${n} ${name} ${n === 1 ? "process" : "processes"}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : parts[0] || "";
});

const sentence = computed(() => {
  if (!who.value) return "";
  const mb = found.value?.gpu_mb;
  return mb
    ? `${fmtMb(mb)} of GPU memory is held by ${who.value} from an earlier session.`
    : `${who.value} from an earlier session ${found.value.leftovers.length === 1 ? "is" : "are"} still running.`;
});

async function stopAndRetry() {
  busy.value = true;
  try {
    const out = await api.request("/v1/engines/leftovers/stop", { method: "POST" });
    const n = out?.leftovers?.length || 0;
    pushToast({ kind: "success", message: n === 1 ? "Stopped 1 leftover engine." : `Stopped ${n} leftover engines.` });
    found.value = null;
    props.task.retry();
  } catch (e) {
    pushToast({ kind: "error", message: `Couldn't stop them: ${e?.message || e}` });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div v-if="sentence" class="leftovers">
    <p class="jv-hint">{{ sentence }}</p>
    <UiButton intent="primary" size="small" :disabled="busy" @click="stopAndRetry">Stop them and retry</UiButton>
  </div>
</template>

<style scoped>
.leftovers { display: flex; flex-direction: column; align-items: center; gap: 6px; text-align: center; }
.leftovers .jv-hint { color: inherit; }
</style>
