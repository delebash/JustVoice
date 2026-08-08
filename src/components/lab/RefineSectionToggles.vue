<!-- SPDX-License-Identifier: MIT -->
<!--
  RefineSectionToggles — the Dictation cleanup card's LIVE Capture toggles
  (the 2026-08-08 sectioned redesign; the Lab-mirrors-production premise in
  the user's words: "that is premise of the lab that it mirrors production").

  These are the REAL server settings (captures.smart_cleanup /
  self_correction / preserve_technical — the exact flags production's
  compose_refinement_system reads). No Lab-only state: flip one here and the
  next dictation changes too; the `changed` emit makes the pane re-fetch the
  composed preview so you watch the section enter or leave the prompt.
  PATCH deep-merges (settings_store.patch), so one flag never wipes its
  siblings.
-->
<script setup>
import { onMounted, ref } from "vue";
import { UiToggle, pushToast } from "@delebash/llm-ui";
import { useApi } from "../../stores/api.js";

const emit = defineEmits(["changed"]);
const api = useApi();

// Label + order mirror the section rows (and their {{…}} markers in the base
// template): smart_cleanup → self_correction → preserve_technical.
const ROWS = [
  { key: "smart_cleanup", label: "Remove filler" },
  { key: "self_correction", label: "Take your corrections" },
  { key: "preserve_technical", label: "Keep technical words" },
];

const flags = ref({ smart_cleanup: true, self_correction: true, preserve_technical: true });
const busy = ref("");

async function load() {
  const s = await api.safeRequest("/v1/settings", null);
  const c = s?.captures;
  if (!c) return;
  for (const r of ROWS) flags.value[r.key] = c[r.key] !== false;
}

async function toggle(key, value) {
  const prev = flags.value[key];
  flags.value = { ...flags.value, [key]: value };
  busy.value = key;
  try {
    await api.request("/v1/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captures: { [key]: value } }),
    });
    emit("changed");
  } catch (e) {
    flags.value = { ...flags.value, [key]: prev };
    pushToast({ message: `Couldn't save: ${e?.message || e}`, kind: "error" });
  } finally {
    busy.value = "";
  }
}

onMounted(load);
</script>

<template>
  <div class="rst">
    <p class="rst__intro">
      Your Capture toggles — the same settings a real dictation uses. Flip one
      and the generated prompt below recomposes.
    </p>
    <div v-for="r in ROWS" :key="r.key" class="rst__row">
      <UiToggle
        :model-value="flags[r.key]"
        :disabled="busy === r.key"
        :aria-label="r.label"
        @update:model-value="(v) => toggle(r.key, v)"
      />
      <span class="rst__label">{{ r.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.rst { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; margin: 0 0 14px; }
.rst__intro { flex-basis: 100%; margin: 0; font-size: 12px; color: var(--muted); }
.rst__row { display: inline-flex; align-items: center; gap: 7px; }
.rst__label { font-size: 12.5px; }
</style>
