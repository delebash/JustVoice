<!-- SPDX-License-Identifier: MIT -->
<!--
  The AI area's app tab ("Speech AI") — JustVoice's OWN AI knobs, the ruling-8
  rehoming target: everything app-specific that lived in the retired Settings
  "AI features" section lands here (never dropped). Today that is the Speaker
  corrections memory; the routing/roles/pins/production-config cards it lived
  beside were pin-era residue the kit's Routing-by-feature replaces.
-->
<script setup>
import { onMounted, ref } from "vue";
import { UiButton, UiTag, confirmDialog, pushToast } from "@delebash/llm-ui";
import { useApi } from "../stores/api.js";

const api = useApi();

// ── Speaker corrections (Phase 5 surfacing — moved from Settings) ────
const correctionsCounts = ref({});   // {projectId: count}
const projectsForCorrections = ref([]);
async function loadCorrections() {
  try {
    const r = await api.safeRequest("/v1/projects", { projects: [] });
    projectsForCorrections.value = r?.projects || [];
    // Pull corrections per project. Cap at 30 to keep this cheap.
    const slice = projectsForCorrections.value.slice(0, 30);
    const counts = {};
    await Promise.all(
      slice.map(async (p) => {
        try {
          const c = await api.safeRequest(`/v1/projects/${p.id}/corrections/count`, { count: 0 });
          counts[p.id] = c?.count ?? 0;
        } catch {
          counts[p.id] = 0;
        }
      }),
    );
    correctionsCounts.value = counts;
  } catch { /* ignore */ }
}
async function clearProjectCorrections(projectId) {
  const ok = await confirmDialog({
    title: "Clear corrections?",
    message: "Clear all speaker corrections for this project? This cannot be undone.",
    danger: true,
    confirmLabel: "Clear all",
  });
  if (!ok) return;
  try {
    await api.request(`/v1/projects/${projectId}/corrections`, { method: "DELETE" });
    correctionsCounts.value = { ...correctionsCounts.value, [projectId]: 0 };
    pushToast({ message: "Corrections cleared.", kind: "success" });
  } catch (e) {
    pushToast({ message: `Clear failed: ${e?.message || e}`, kind: "error" });
  }
}

onMounted(loadCorrections);
</script>

<template>
  <div class="jv-card">
    <div class="jv-card__header">
      <h3 class="jv-card__title">Speaker corrections</h3>
    </div>
    <p class="jv-muted" style="font-size: 12.5px; margin: 4px 0 12px">
      Manual fixes you make on the Studio Script tab become correction memory — the top 12 most recent corrections per project inject into the next Analyze run as worked examples. Clearing wipes the project's correction history.
    </p>
    <p v-if="!projectsForCorrections.length" class="jv-muted">No projects yet.</p>
    <table v-else class="jv-table" style="max-width: 720px">
      <thead>
        <tr><th>Project</th><th style="width: 120px; text-align: right">Corrections</th><th style="width: 120px" /></tr>
      </thead>
      <tbody>
        <tr v-for="p in projectsForCorrections" :key="p.id">
          <td>{{ p.name }}</td>
          <td style="text-align: right">
            <UiTag :intent="correctionsCounts[p.id] ? 'solid' : 'ghost'">
              {{ correctionsCounts[p.id] ?? 0 }}
            </UiTag>
          </td>
          <td>
            <UiButton
              intent="ghost" size="small" label="Clear all"
              :disabled="!correctionsCounts[p.id]"
              @click="clearProjectCorrections(p.id)"
            />
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
