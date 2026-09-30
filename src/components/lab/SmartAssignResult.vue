<!-- SPDX-License-Identifier: MIT -->
<!--
  SmartAssignResult — the smart-assign Lab column's readable result (Part 6,
  2026-08-06: "a readable rendering for id-JSON results" — the raw
  speakerId → personaId object told the user nothing). Render-only adapter:
  the generic /v1/ai/run path still runs the column; this just resolves the
  ids to the app's speaker and persona NAMES (2026-09-29: Smart-assign
  matches a book's speakers to personas). Unparseable replies fall back
  honestly to a pointer at the raw output.
-->
<script setup>
import { computed, ref, watch } from "vue";
import { usePersonasStore } from "../../stores/personas.js";
import { useApi } from "../../stores/api.js";
import { useActiveProject } from "../../stores/activeProject.js";

const props = defineProps({
  result: { type: Object, default: null },
  allResults: { type: Array, default: () => [] },
  config: { type: Object, default: null },
  action: { type: String, default: "" },
  columnLabel: { type: String, default: "" },
});

const personasStore = usePersonasStore();
personasStore.ensureLoaded();
// The open book's speakers name the left column; a Lab run filled from
// another book shows those ids as they came.
const api = useApi();
const activeProject = useActiveProject();
const speakers = ref([]);
watch(() => activeProject.id, async (id) => {
  const r = id ? await api.safeRequest(`/v1/projects/${id}/speakers`, { speakers: [] }) : null;
  speakers.value = r?.speakers || [];
}, { immediate: true });

function firstJsonObject(text) {
  const t = String(text || "").replace(/<think>[\s\S]*?<\/think>/g, "");
  const m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = JSON.parse(m[0]);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const assignments = computed(() => {
  const obj = firstJsonObject(props.result?.content);
  if (!obj) return null;
  const sName = (id) => speakers.value.find((sp) => sp.id === id)?.name || id;
  const pName = (id) => personasStore.items.find((p) => p.id === id)?.name || id;
  return Object.entries(obj).map(([sid, pid]) => ({
    sid,
    pid: String(pid),
    speaker: sName(sid),
    persona: pName(String(pid)),
  }));
});
</script>

<template>
  <div class="sar">
    <table v-if="assignments && assignments.length" class="sar__table">
      <thead><tr><th>Speaker</th><th>Persona</th></tr></thead>
      <tbody>
        <tr v-for="a in assignments" :key="a.sid">
          <td><strong :title="a.sid">{{ a.speaker }}</strong></td>
          <td :title="a.pid">{{ a.persona }}</td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="assignments" class="sar__empty">No assignments returned.</p>
    <p v-else class="sar__empty">Couldn't read the reply as assignments — see the raw output above.</p>
  </div>
</template>

<style scoped>
.sar__table { border-collapse: collapse; font-size: 12.5px; width: 100%; }
.sar__table th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ink-2, #777); padding: 4px 10px 4px 0; }
.sar__table td { padding: 4px 10px 4px 0; border-top: 1px solid var(--line, #e3e0d8); }
.sar__empty { margin: 0; font-size: 12.5px; color: var(--ink-2, #777); }
</style>
