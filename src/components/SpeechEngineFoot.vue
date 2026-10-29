<!-- SPDX-License-Identifier: MIT -->
<!--
  One engine's foot on AI Settings → Speech — the kit's audio.cpp tab, its `group-foot` slot under
  the engine's models (round E, docs/plans/2026-10-29-round-e-onto-the-kit.md §4 step 5, G6): its
  licence or terms, accepted or not, with Read and accept (EngineTermsDialog, decided 2026-10-02
  and 2026-10-11), and Delete downloaded models — each of its models on this computer deleted
  through the kit's own Delete, the runtime staying. Moved from the Speech engines tab, which went
  with round E; its words are that tab's.
-->
<script setup>
import { computed } from "vue";
import { UiButton, confirmDialog, pushToast } from "@delebash/ui";
import { useApi } from "../stores/api.js";
import { useEnginesStore } from "../stores/engines.js";
import { openEngineTerms } from "../services/engineTerms.js";

const props = defineProps({
  engineId: { type: String, required: true },
  // the engine's every model, as the kit's tab lists them (GET /v1/ai/runtimes/audiocpp/models)
  models: { type: Array, default: () => [] },
  // the tab's own `refresh` — it reads its models again
  refresh: { type: Function, default: null },
});

const api = useApi();
const engines = useEnginesStore();
const e = computed(() => engines.byId(props.engineId));
const onDisk = computed(() => props.models.filter((m) => m.onDisk));

// Every downloaded model of the engine — the engine-level removal, now that there is no
// environment to uninstall (the runtime stays). A loaded one is the kit's to refuse.
async function removeEngineModels() {
  const name = e.value?.name || props.engineId;
  const ok = await confirmDialog({
    title: `Delete every downloaded ${name} model?`,
    message: "Deletes this engine's model files from disk. The speech runtime stays installed, and any model downloads again when you need it.",
    danger: true, confirmLabel: "Delete downloaded models",
  });
  if (!ok) return;
  const failed = [];
  for (const m of onDisk.value) {
    try {
      await api.del(`/v1/ai/runtimes/audiocpp/models/${encodeURIComponent(m.id)}`);
    } catch (err) {
      failed.push(`${m.name}: ${err?.message || err}`);
    }
  }
  window.dispatchEvent(new Event("jv:health-refresh"));
  await props.refresh?.();
  if (failed.length) pushToast({ message: `Delete failed: ${failed.join(" · ")}`, kind: "error" });
  else pushToast({ message: `${name} models deleted.`, kind: "success", duration: 4000 });
}
</script>

<template>
  <div v-if="e && (onDisk.length || e.terms)" class="ev-gfoot">
    <template v-if="e.terms">
      <template v-if="e.terms.gates === 'download'">
        <span v-if="e.terms_accepted">Licence accepted — downloads are on</span>
        <span v-else>Downloads wait until you accept its licence ({{ e.terms.owner }})</span>
      </template>
      <span v-else-if="e.terms_accepted">{{ e.terms.owner }}'s terms accepted — cloning is on</span>
      <template v-if="!e.terms_accepted">
        <span v-if="e.terms.gates !== 'download'">Cloning waits until you accept {{ e.terms.owner }}'s terms</span>
        <UiButton intent="secondary" size="small" label="Read and accept" @click="openEngineTerms(e.id)" />
      </template>
    </template>
    <UiButton v-if="onDisk.length" intent="ghost" size="small" label="Delete downloaded models" class="ev-danger"
      title="Delete every downloaded model of this engine — the speech runtime stays" @click="removeEngineModels" />
  </div>
</template>
